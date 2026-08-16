import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  GatewayProbeErrorCategory, GatewayProbeKind, GatewayProbeModelStatus, Prisma, Role,
} from "@prisma/client";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { z } from "zod";
import { PrismaService } from "./prisma.service";

const MAX_RESPONSE_BYTES = 256 * 1024;
const probeConfigSchema = z.object({
  baseUrl: z.string().trim().url(), enabled: z.boolean(),
  modelListIntervalMinutes: z.number().int().min(1).max(1440),
  inferenceIntervalMinutes: z.number().int().min(1).max(1440),
  bucketIntervalMinutes: z.number().int().refine((value) => [1, 5, 15, 30, 60, 360, 1440].includes(value), "时间桶间隔无效").default(60),
});
const probeModelsSchema = z.object({
  models: z.array(z.object({ modelId: z.string().trim().min(1).max(200), displayName: z.string().trim().min(1).max(200), enabled: z.boolean() })).max(100),
}).refine((value) => value.models.filter((model) => model.enabled).length <= 10, "最多启用 10 个模型");

@Injectable()
export class GatewayProbeService {
  constructor(private readonly prisma: PrismaService) {}

  async adminView(gatewayId: string, role: string) {
    return this.adminViewTarget({ gatewayId }, role, "中转站不存在");
  }

  async saveConfig(gatewayId: string, input: unknown, role: string) {
    return this.saveConfigTarget({ gatewayId }, input, role, "中转站不存在");
  }

  async adminViewForListing(managedListingId: string, role: string) {
    return this.adminViewTarget({ managedListingId }, role, "赞助商不存在");
  }

  async saveConfigForListing(managedListingId: string, input: unknown, role: string) {
    return this.saveConfigTarget({ managedListingId }, input, role, "赞助商不存在");
  }

  async replaceKeyForListing(id: string, apiKey: unknown, role: string) { return this.replaceKeyTarget({ managedListingId: id }, apiKey, role); }
  async clearKeyForListing(id: string, role: string) { return this.clearKeyTarget({ managedListingId: id }, role); }
  async saveModelsForListing(id: string, input: unknown, role: string) { return this.saveModelsTarget({ managedListingId: id }, input, role); }
  async requestRunForListing(id: string, kind: "models" | "inference") { return this.requestRunTarget({ managedListingId: id }, kind); }
  async resumeForListing(id: string, role: string) { return this.resumeTarget({ managedListingId: id }, role); }

  private async adminViewTarget(target: { gatewayId?: string; managedListingId?: string }, role: string, missingMessage: string) {
    const owner = target.gatewayId
      ? await this.prisma.gatewayDirectoryEntry.findUnique({ where: { id: target.gatewayId }, select: { id: true, name: true } })
      : await this.prisma.managedListing.findUnique({ where: { id: target.managedListingId }, select: { id: true, title: true } }).then((item) => item && { id: item.id, name: item.title });
    if (!owner) throw new NotFoundException(missingMessage);
    const config = target.gatewayId
      ? await this.prisma.gatewayProbeConfig.findUnique({ where: { gatewayId: target.gatewayId }, include: { models: { orderBy: [{ enabled: "desc" }, { modelId: "asc" }] } } })
      : await this.prisma.gatewayProbeConfig.findFirst({ where: target, include: { models: { orderBy: [{ enabled: "desc" }, { modelId: "asc" }] } } });
    const results = config && this.prisma.gatewayProbeResult?.findMany
      ? await this.prisma.gatewayProbeResult.findMany({ where: { configId: config.id, kind: GatewayProbeKind.INFERENCE, checkedAt: { gte: new Date(Date.now() - 48 * 60 * 60_000) }, modelId: { not: null } }, orderBy: { checkedAt: "asc" } })
      : [];
    return { gateway: owner, canManageKey: role === "admin", canManageConfig: role === "admin", config: config ? adminConfig(config, results) : null };
  }

  private async saveConfigTarget(target: { gatewayId?: string; managedListingId?: string }, input: unknown, role: string, missingMessage: string) {
    requireProbeAdmin(role);
    const parsed = parseProbeConfig(input);
    if (!isSafeProbeBaseUrlSyntax(parsed.baseUrl)) throw new BadRequestException("请填写公网 HTTPS API Base URL 和有效探测频率");
    const baseUrl = normalizeBaseUrl(parsed.baseUrl);
    const now = new Date();
    const ownerExists = target.gatewayId
      ? await this.prisma.gatewayDirectoryEntry.count({ where: { id: target.gatewayId } })
      : await this.prisma.managedListing.count({ where: { id: target.managedListingId } });
    if (!ownerExists) throw new NotFoundException(missingMessage);
    const existing = await this.prisma.gatewayProbeConfig.findFirst({ where: target });
    const config = existing
      ? await this.prisma.gatewayProbeConfig.update({ where: { id: existing.id }, data: { baseUrl, enabled: parsed.enabled, modelListIntervalMinutes: parsed.modelListIntervalMinutes, inferenceIntervalMinutes: parsed.inferenceIntervalMinutes, bucketIntervalMinutes: parsed.bucketIntervalMinutes, nextModelListAt: parsed.enabled ? now : null, nextInferenceAt: parsed.enabled ? now : null }, include: { models: true } })
      : await this.prisma.gatewayProbeConfig.create({ data: { ...target, baseUrl, enabled: parsed.enabled, modelListIntervalMinutes: parsed.modelListIntervalMinutes, inferenceIntervalMinutes: parsed.inferenceIntervalMinutes, bucketIntervalMinutes: parsed.bucketIntervalMinutes, nextModelListAt: now, nextInferenceAt: now }, include: { models: true } });
    return adminConfig(config);
  }

  async replaceKey(gatewayId: string, apiKey: unknown, role: string) {
    return this.replaceKeyTarget({ gatewayId }, apiKey, role);
  }
  private async replaceKeyTarget(target: { gatewayId?: string; managedListingId?: string }, apiKey: unknown, role: string) {
    if (role !== "admin") throw new ForbiddenException("仅管理员可以更换探测密钥");
    const parsed = z.string().trim().min(8).max(1000).safeParse(apiKey);
    if (!parsed.success) throw new BadRequestException("API Key 长度无效");
    const config = await this.requireConfig(target);
    return this.prisma.gatewayProbeConfig.update({ where: { id: config.id }, data: {
      apiKeyCiphertext: encryptSecret(parsed.data), apiKeyLastFour: parsed.data.slice(-4), inferencePaused: false, pauseReason: null, nextModelListAt: new Date(), nextInferenceAt: new Date(),
    }, select: { apiKeyLastFour: true } });
  }

  async clearKey(gatewayId: string, role: string) {
    return this.clearKeyTarget({ gatewayId }, role);
  }
  private async clearKeyTarget(target: { gatewayId?: string; managedListingId?: string }, role: string) {
    if (role !== "admin") throw new ForbiddenException("仅管理员可以清除探测密钥");
    const config = await this.requireConfig(target);
    await this.prisma.gatewayProbeConfig.update({ where: { id: config.id }, data: { apiKeyCiphertext: null, apiKeyLastFour: null, inferencePaused: true, pauseReason: GatewayProbeErrorCategory.AUTHENTICATION } });
    return { ok: true };
  }

  async saveModels(gatewayId: string, input: unknown, role: string) {
    return this.saveModelsTarget({ gatewayId }, input, role);
  }
  private async saveModelsTarget(target: { gatewayId?: string; managedListingId?: string }, input: unknown, role: string) {
    requireProbeAdmin(role);
    const parsed = parseProbeModels(input);
    const config = await this.requireConfig(target);
    const unique = new Map(parsed.models.map((model) => [model.modelId, model]));
    if (unique.size !== parsed.models.length) throw new BadRequestException("模型 ID 不能重复");
    await this.prisma.$transaction([...unique.values()].map((model) => this.prisma.gatewayProbeModel.upsert({
      where: { configId_modelId: { configId: config.id, modelId: model.modelId } },
      create: { configId: config.id, ...model }, update: { displayName: model.displayName, enabled: model.enabled },
    })));
    await this.prisma.gatewayProbeModel.updateMany({ where: { configId: config.id, modelId: { notIn: [...unique.keys()] } }, data: { enabled: false } });
    return { updated: unique.size };
  }

  async requestRun(gatewayId: string, kind: "models" | "inference") {
    return this.requestRunTarget({ gatewayId }, kind);
  }
  private async requestRunTarget(target: { gatewayId?: string; managedListingId?: string }, kind: "models" | "inference") {
    const config = await this.requireConfig(target);
    if (!config.apiKeyCiphertext) throw new BadRequestException("请先配置 API Key");
    if (kind === "inference" && !config.enabled) throw new BadRequestException("请先启用探测配置");
    if (kind === "inference" && config.inferencePaused) throw new BadRequestException("真实推理已暂停，请由管理员恢复");
    const now = new Date();
    await this.prisma.gatewayProbeConfig.update({ where: { id: config.id }, data: kind === "models" ? { modelListRequestedAt: now, nextModelListAt: now } : { inferenceRequestedAt: now, nextInferenceAt: now } });
    return { queued: true, kind };
  }

  async resume(gatewayId: string, role: string) {
    return this.resumeTarget({ gatewayId }, role);
  }
  private async resumeTarget(target: { gatewayId?: string; managedListingId?: string }, role: string) {
    requireProbeAdmin(role);
    const config = await this.requireConfig(target);
    if (!config.apiKeyCiphertext) throw new BadRequestException("请先配置 API Key");
    await this.prisma.gatewayProbeConfig.update({ where: { id: config.id }, data: { inferencePaused: false, pauseReason: null, nextInferenceAt: new Date() } });
    return { resumed: true };
  }

  async publicAvailability(slug: string) {
    const gateway = await this.prisma.gatewayDirectoryEntry.findFirst({ where: { slug, active: true, reviewStatus: "APPROVED" }, select: { probeConfig: { select: { id: true, enabled: true, bucketIntervalMinutes: true, lastInferenceAt: true, nextInferenceAt: true, models: { where: { enabled: true, lastCheckedAt: { not: null } }, orderBy: { modelId: "asc" } } } } } });
    if (!gateway) throw new NotFoundException("Gateway not found");
    return this.publicAvailabilityForConfig(gateway.probeConfig);
  }

  async publicAvailabilityForListing(managedListingId: string) {
    const listing = await this.prisma.managedListing.findFirst({
      where: { id: managedListingId, type: "GATEWAY", active: true },
      select: { probeConfig: { select: { id: true, enabled: true, bucketIntervalMinutes: true, lastInferenceAt: true, nextInferenceAt: true, models: { where: { enabled: true, lastCheckedAt: { not: null } }, orderBy: { modelId: "asc" } } } } },
    });
    if (!listing) throw new NotFoundException("Sponsor not found");
    return this.publicAvailabilityForConfig(listing.probeConfig);
  }

  private async publicAvailabilityForConfig(config: { id: string; enabled: boolean; bucketIntervalMinutes?: number; lastInferenceAt?: Date | null; nextInferenceAt?: Date | null; models: Array<{ id: string; modelId: string; displayName: string; status: GatewayProbeModelStatus; lastCheckedAt: Date | null; lastSuccessAt: Date | null; lastResponseMs: number | null; lastErrorCategory: GatewayProbeErrorCategory | null }> } | null) {
    if (!config?.enabled) return { configured: false, models: [] };
    const since = new Date(Date.now() - 48 * 60 * 60_000);
    const results = await this.prisma.gatewayProbeResult.findMany({ where: { configId: config.id, kind: GatewayProbeKind.INFERENCE, checkedAt: { gte: since }, modelId: { not: null } }, orderBy: { checkedAt: "asc" } });
    const granularityMinutes = config.bucketIntervalMinutes || 60;
    return { configured: true, ...(config.bucketIntervalMinutes ? { granularityMinutes } : {}), lastInferenceAt: config.lastInferenceAt?.toISOString() || null, nextInferenceAt: config.nextInferenceAt?.toISOString() || null, models: config.models.map((model) => ({
      id: model.id, modelId: model.modelId, displayName: model.displayName, status: model.status.toLowerCase(),
      lastCheckedAt: model.lastCheckedAt?.toISOString() || null, lastSuccessAt: model.lastSuccessAt?.toISOString() || null,
      lastResponseMs: model.lastResponseMs, errorCategory: model.lastErrorCategory?.toLowerCase() || null,
      buckets: visibleProbeBuckets(aggregateProbeBuckets(results.filter((result) => result.modelId === model.id), bucketCount(granularityMinutes), granularityMinutes), granularityMinutes),
    })) };
  }

  async executeConfig(configId: string) {
    const leaseToken = randomUUID();
    const now = new Date();
    const claimed = await this.prisma.gatewayProbeConfig.updateMany({ where: { id: configId, OR: [{ enabled: true }, { modelListRequestedAt: { not: null } }, { inferenceRequestedAt: { not: null } }], AND: [{ OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] }] }, data: { leaseToken, leaseUntil: new Date(Date.now() + 10 * 60_000) } });
    if (!claimed.count) return { skipped: "leased_or_disabled" };
    try {
      const config = await this.prisma.gatewayProbeConfig.findUnique({ where: { id: configId }, include: { gateway: true, managedListing: true, models: { where: { enabled: true }, orderBy: { modelId: "asc" }, take: 10 } } });
      if (!config?.apiKeyCiphertext) return { skipped: "key_missing" };
      const apiKey = decryptSecret(config.apiKeyCiphertext);
      const modelListDue = Boolean(config.modelListRequestedAt || !config.nextModelListAt || config.nextModelListAt <= now);
      const inferenceDue = !config.inferencePaused && Boolean(config.inferenceRequestedAt || !config.nextInferenceAt || config.nextInferenceAt <= now);
      if (modelListDue) await this.executeModelDiscovery(config.id, config.baseUrl, apiKey);
      if (inferenceDue) {
        // Keep the cadence anchored to the scheduled due time. Anchoring the
        // next run to completion time makes a slow request drift into the next
        // bucket and creates misleading gray gaps for one-minute probes.
        const plannedAt = config.nextInferenceAt && config.nextInferenceAt <= now ? config.nextInferenceAt : now;
        const staleCutoff = now.getTime() - config.inferenceIntervalMinutes * 60_000 * 2;
        await this.executeInference(config.id, config.baseUrl, apiKey, config.models, plannedAt.getTime() < staleCutoff ? now : plannedAt);
      }
      return { models: modelListDue, inference: inferenceDue };
    } finally {
      await this.prisma.gatewayProbeConfig.updateMany({ where: { id: configId, leaseToken }, data: { leaseToken: null, leaseUntil: null } });
    }
  }

  async cleanup() {
    const result = await this.prisma.gatewayProbeResult.deleteMany({ where: { checkedAt: { lt: new Date(Date.now() - 30 * 86400_000) } } });
    return { deleted: result.count };
  }

  private async executeModelDiscovery(configId: string, baseUrl: string, apiKey: string) {
    const started = Date.now();
    const response = await requestProbeEndpoint(baseUrl, "models", "GET", apiKey, undefined, 10_000);
    const errorCategory = classifyProbeError(response.status, response.error, false, response.json);
    const success = response.status !== null && response.status >= 200 && response.status < 300 && Array.isArray((response.json as { data?: unknown[] } | null)?.data);
    if (success) {
      const ids = [...new Set(((response.json as { data: unknown[] }).data).map((row) => row && typeof row === "object" ? String((row as { id?: unknown }).id || "").trim() : "").filter(Boolean))].slice(0, 500);
      await this.prisma.$transaction(ids.map((modelId) => this.prisma.gatewayProbeModel.upsert({ where: { configId_modelId: { configId, modelId } }, create: { configId, modelId, displayName: modelId }, update: { discoveredAt: new Date() } })));
    }
    const interval = await this.prisma.gatewayProbeConfig.findUniqueOrThrow({ where: { id: configId }, select: { modelListIntervalMinutes: true } });
    await this.prisma.$transaction([
      this.prisma.gatewayProbeResult.create({ data: { configId, kind: GatewayProbeKind.MODELS, success, errorCategory: success ? null : errorCategory, httpStatus: response.status, dnsMs: response.dnsMs, connectMs: response.connectMs, ttfbMs: response.ttfbMs, totalMs: Date.now() - started } }),
      this.prisma.gatewayProbeConfig.update({ where: { id: configId }, data: { lastModelListAt: new Date(), modelListRequestedAt: null, nextModelListAt: new Date(Date.now() + interval.modelListIntervalMinutes * 60_000) } }),
    ]);
  }

  private async executeInference(configId: string, baseUrl: string, apiKey: string, models: Array<{ id: string; modelId: string; consecutiveFailures: number }>, plannedAt: Date) {
    let pauseReason: GatewayProbeErrorCategory | null = null;
    for (const model of models) {
      const response = await requestProbeEndpoint(baseUrl, "chat/completions", "POST", apiKey, { model: model.modelId, messages: [{ role: "user", content: "Reply OK" }], stream: true, max_tokens: 1 }, 30_000, "text/event-stream");
      const success = response.status !== null && response.status >= 200 && response.status < 300 && isValidChatCompletionResponse(response);
      const category = success ? null : classifyProbeError(response.status, response.error, true, response.json);
      const nextState = nextModelProbeState(model.consecutiveFailures, success, category);
      await this.prisma.$transaction([
        this.prisma.gatewayProbeResult.create({ data: { configId, modelId: model.id, kind: GatewayProbeKind.INFERENCE, success, errorCategory: category, httpStatus: response.status, dnsMs: response.dnsMs, connectMs: response.connectMs, ttfbMs: response.ttfbMs, totalMs: response.totalMs } }),
        this.prisma.gatewayProbeModel.update({ where: { id: model.id }, data: { ...nextState, lastCheckedAt: new Date(), lastSuccessAt: success ? new Date() : undefined, lastResponseMs: response.totalMs, lastErrorCategory: category } }),
      ]);
      if (category === GatewayProbeErrorCategory.AUTHENTICATION || category === GatewayProbeErrorCategory.QUOTA_EXHAUSTED) { pauseReason = category; break; }
    }
    const config = await this.prisma.gatewayProbeConfig.findUniqueOrThrow({ where: { id: configId }, include: { gateway: true, managedListing: true } });
    await this.prisma.gatewayProbeConfig.update({ where: { id: configId }, data: { lastInferenceAt: new Date(), inferenceRequestedAt: null, nextInferenceAt: new Date(plannedAt.getTime() + config.inferenceIntervalMinutes * 60_000), inferencePaused: Boolean(pauseReason), pauseReason } });
    if (pauseReason) {
      const owner = config.gateway || (config.managedListing ? { id: config.managedListing.id, name: config.managedListing.title } : null);
      if (owner) await notifyOperatorsOnce(this.prisma, owner.name, owner.id, pauseReason);
    }
  }

  private async requireConfig(target: { gatewayId?: string; managedListingId?: string }) {
    const config = await this.prisma.gatewayProbeConfig.findFirst({ where: target });
    if (!config) throw new NotFoundException("请先保存探测配置");
    return config;
  }
}

export function encryptionKey(value = process.env.GATEWAY_PROBE_ENCRYPTION_KEY || "") {
  const key = /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, "hex") : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("GATEWAY_PROBE_ENCRYPTION_KEY must be 32 bytes (64 hex characters or base64)");
  return key;
}
export function encryptSecret(value: string, key = encryptionKey()) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, iv); const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}
export function decryptSecret(value: string, key = encryptionKey()) {
  const [version, iv, tag, encrypted] = value.split("."); if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Invalid encrypted secret");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export async function isSafeProbeBaseUrl(value: string) {
  try { const url = new URL(value); if (!isSafeProbeBaseUrlSyntax(value)) return false; const addresses = await lookup(url.hostname, { all: true, verbatim: true }); return addresses.length > 0 && addresses.every((entry) => isPublicIp(entry.address)); } catch { return false; }
}
export function isSafeProbeBaseUrlSyntax(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".localhost")) return false;
    return isIP(url.hostname) === 0 || isPublicIp(url.hostname);
  } catch { return false; }
}
export function isPublicIp(address: string) {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0)
      || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return !(normalized === "::" || normalized === "::1" || normalized.startsWith("::ffff:")
      || normalized.startsWith("fc") || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff")
      || normalized.startsWith("100:") || normalized.startsWith("2001:db8:")
      || normalized.startsWith("3fff:"));
  }
  return false;
}

type SecureResponse = { status: number | null; json: unknown; rawText: string; contentType: string; error: unknown; dnsMs: number; connectMs: number | null; ttfbMs: number | null; totalMs: number };
async function requestProbeEndpoint(baseUrl: string, endpoint: string, method: "GET" | "POST", apiKey: string, body?: unknown, timeoutMs = 10_000, accept = "application/json") {
  const base = new URL(baseUrl);
  const path = base.pathname.replace(/\/+$/, "");
  const candidates = path === "" || path === "/"
    ? [`/v1/${endpoint}`, `/${endpoint}`]
    : [`${path}/${endpoint}`];
  let response = await secureJsonRequest(new URL(candidates[0], base.origin), method, apiKey, body, timeoutMs, accept);
  if (response.status === 404 && candidates.length > 1 && !describesMissingModel(response.json)) {
    response = await secureJsonRequest(new URL(candidates[1], base.origin), method, apiKey, body, timeoutMs, accept);
  }
  return response;
}
export async function secureJsonRequest(url: URL, method: "GET" | "POST", apiKey: string, body?: unknown, timeoutMs = 10_000, accept = "application/json"): Promise<SecureResponse> {
  const started = Date.now(); const dnsStarted = Date.now();
  try {
    if (url.protocol !== "https:") throw new Error("Only HTTPS is allowed");
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((entry) => !isPublicIp(entry.address))) throw new Error("Unsafe destination address");
    // Prefer IPv4 because some hosts publish IPv6 records while the worker network has no IPv6 route.
    const selected = addresses.find((entry) => entry.family === 4) || addresses[0]; const dnsMs = Date.now() - dnsStarted; const requestStarted = Date.now(); const encoded = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    return await new Promise((resolve) => {
      let connectMs: number | null = null; let ttfbMs: number | null = null; let settled = false;
      const finish = (value: SecureResponse) => { if (!settled) { settled = true; resolve(value); } };
      const request = httpsRequest({ protocol: "https:", hostname: url.hostname, servername: url.hostname, path: `${url.pathname}${url.search}`, method, port: 443, family: selected.family, agent: false, headers: { accept, authorization: `Bearer ${apiKey}`, ...(encoded ? { "content-type": "application/json", "content-length": String(encoded.length) } : {}) }, lookup: (_host, _options, callback) => callback(null, selected.address, selected.family) }, (response) => {
        ttfbMs = Date.now() - requestStarted; const chunks: Buffer[] = []; let size = 0;
        response.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_RESPONSE_BYTES) request.destroy(new Error("Response body exceeds limit")); else chunks.push(chunk); });
        response.on("end", () => { const rawText = Buffer.concat(chunks).toString("utf8"); let json: unknown = null; try { json = rawText ? JSON.parse(rawText) : null; } catch {} finish({ status: response.statusCode || null, json, rawText, contentType: String(response.headers["content-type"] || "").toLowerCase(), error: null, dnsMs, connectMs, ttfbMs, totalMs: Date.now() - started }); });
      });
      request.on("socket", (socket) => socket.once("secureConnect", () => { connectMs = Date.now() - requestStarted; }));
      request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("Probe timeout"), { code: "ETIMEDOUT" })));
      request.on("error", (error) => finish({ status: null, json: null, rawText: "", contentType: "", error, dnsMs, connectMs, ttfbMs, totalMs: Date.now() - started }));
      if (encoded) request.write(encoded); request.end();
    });
  } catch (error) { return { status: null, json: null, rawText: "", contentType: "", error, dnsMs: Date.now() - dnsStarted, connectMs: null, ttfbMs: null, totalMs: Date.now() - started }; }
}

export function classifyProbeError(status: number | null, error: unknown, inference: boolean, payload?: unknown) {
  if ((error as { code?: string } | null)?.code === "ETIMEDOUT" || String(error).toLowerCase().includes("timeout")) return GatewayProbeErrorCategory.TIMEOUT;
  if (status === 429) return GatewayProbeErrorCategory.RATE_LIMITED;
  if (status === 401 || status === 403) return GatewayProbeErrorCategory.AUTHENTICATION;
  if (status === 402) return GatewayProbeErrorCategory.QUOTA_EXHAUSTED;
  if (inference && status === 404) return describesMissingModel(payload)
    ? GatewayProbeErrorCategory.MODEL_UNAVAILABLE
    : GatewayProbeErrorCategory.PROTOCOL_ERROR;
  if (status && status >= 500) return GatewayProbeErrorCategory.UPSTREAM_ERROR;
  if (status && status >= 200 && status < 300) return GatewayProbeErrorCategory.PROTOCOL_ERROR;
  if (status && status >= 400) return GatewayProbeErrorCategory.PROTOCOL_ERROR;
  return error ? GatewayProbeErrorCategory.NETWORK_ERROR : GatewayProbeErrorCategory.PROTOCOL_ERROR;
}

export function nextModelProbeState(consecutiveFailures: number, success: boolean, category: GatewayProbeErrorCategory | null) {
  if (success) return { status: GatewayProbeModelStatus.AVAILABLE, consecutiveFailures: 0 };
  if (category === GatewayProbeErrorCategory.PROTOCOL_ERROR) return { status: GatewayProbeModelStatus.PROTOCOL_UNSUPPORTED, consecutiveFailures: consecutiveFailures + 1 };
  if (category === GatewayProbeErrorCategory.MODEL_UNAVAILABLE) return { status: GatewayProbeModelStatus.UNAVAILABLE, consecutiveFailures: consecutiveFailures + 1 };
  const failures = consecutiveFailures + 1;
  return { status: failures >= 5 ? GatewayProbeModelStatus.UNAVAILABLE : GatewayProbeModelStatus.DEGRADED, consecutiveFailures: failures };
}

/** Validate the actual OpenAI-compatible completion, including streamed SSE responses. */
export function isValidChatCompletionResponse(response: Pick<SecureResponse, "json" | "rawText" | "contentType">) {
  const raw = response.rawText.trim();
  const isSse = response.contentType.includes("text/event-stream") || /^((event|id|retry|data):|:\s*)/m.test(raw);
  if (isSse) return parseChatCompletionSse(raw);
  return hasCompletionChoices(response.json);
}

export function parseChatCompletionSse(raw: string) {
  let sawChoice = false;
  let sawDone = false;
  let buffer = "";
  for (const line of raw.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("data:")) {
      buffer = `${buffer}${line.slice(5).trimStart()}\n`;
      continue;
    }
    if (line.trim() !== "" || buffer === "") continue;
    const data = buffer.trim();
    buffer = "";
    if (data === "[DONE]") { sawDone = true; continue; }
    let payload: unknown;
    try { payload = JSON.parse(data); } catch { return false; }
    if (hasCompletionChoices(payload)) sawChoice = true;
  }
  const finalData = buffer.trim();
  if (finalData === "[DONE]") sawDone = true;
  else if (finalData) {
    try { const payload = JSON.parse(finalData); if (hasCompletionChoices(payload)) sawChoice = true; else return false; }
    catch { return false; }
  }
  return sawChoice && sawDone;
}

function hasCompletionChoices(payload: unknown) {
  return Boolean(payload && typeof payload === "object" && Array.isArray((payload as { choices?: unknown[] }).choices) && (payload as { choices: unknown[] }).choices.length > 0);
}

export function parseProbeConfig(input: unknown) {
  const parsed = probeConfigSchema.safeParse(input);
  if (!parsed.success) throw new BadRequestException("请填写公网 HTTPS API Base URL 和有效探测频率");
  return parsed.data;
}

export function parseProbeModels(input: unknown) {
  const parsed = probeModelsSchema.safeParse(input);
  if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message || "模型配置无效");
  return parsed.data;
}

function describesMissingModel(payload: unknown) {
  if (!payload || typeof payload !== "object") return false;
  const error = (payload as { error?: unknown }).error;
  if (!error || typeof error !== "object") return false;
  const detail = `${String((error as { code?: unknown }).code || "")} ${String((error as { type?: unknown }).type || "")} ${String((error as { message?: unknown }).message || "")}`.toLowerCase();
  return /(?:model_(?:not_found|unavailable)|\bmodel\b[^\n]{0,80}\b(?:not found|does not exist|unavailable|unsupported|invalid)\b|\binvalid model\b)/.test(detail);
}

function requireProbeAdmin(role: string) {
  if (role !== "admin") throw new ForbiddenException("仅管理员可以修改探测配置");
}

export function aggregateProbeBuckets(results: Array<{ checkedAt: Date; success: boolean; totalMs: number | null }>, count = 48, bucketIntervalMinutes = 60) {
  const intervalMs = bucketIntervalMinutes * 60_000;
  const latest = new Date(); latest.setTime(Math.floor(latest.getTime() / intervalMs) * intervalMs);
  return Array.from({ length: count }, (_, index) => { const startedAt = new Date(latest.getTime() - (count - index - 1) * intervalMs); const end = startedAt.getTime() + intervalMs; const rows = results.filter((row) => row.checkedAt.getTime() >= startedAt.getTime() && row.checkedAt.getTime() < end); const successes = rows.filter((row) => row.success); const timings = successes.map((row) => row.totalMs).filter((value): value is number => value !== null); return { startedAt: startedAt.toISOString(), attempts: rows.length, successes: successes.length, successRate: rows.length ? Math.round(successes.length / rows.length * 1000) / 10 : null, averageResponseMs: timings.length ? Math.round(timings.reduce((sum, value) => sum + value, 0) / timings.length) : null }; });
}

function bucketCount(bucketIntervalMinutes: number) { return bucketIntervalMinutes <= 1 ? 48 : Math.max(1, Math.round(48 * 60 / bucketIntervalMinutes)); }
function visibleProbeBuckets<T>(buckets: T[], bucketIntervalMinutes: number) { return bucketIntervalMinutes <= 1 ? buckets.slice(-48) : buckets; }

function normalizeBaseUrl(value: string) { const url = new URL(value); url.pathname = `${url.pathname.replace(/\/+$/, "")}/`; url.search = ""; url.hash = ""; return url.href; }
function adminConfig(config: { id: string; baseUrl: string; apiKeyCiphertext: string | null; apiKeyLastFour: string | null; enabled: boolean; inferencePaused: boolean; pauseReason: GatewayProbeErrorCategory | null; modelListIntervalMinutes: number; inferenceIntervalMinutes: number; bucketIntervalMinutes?: number; nextModelListAt: Date | null; nextInferenceAt: Date | null; lastModelListAt: Date | null; lastInferenceAt: Date | null; models: Array<{ id: string; modelId: string; displayName: string; enabled: boolean; status: GatewayProbeModelStatus; lastCheckedAt: Date | null; lastResponseMs: number | null; lastErrorCategory: GatewayProbeErrorCategory | null }> }, results: Array<{ modelId: string | null; checkedAt: Date; success: boolean; totalMs: number | null }> = []) {
  const interval = config.bucketIntervalMinutes || 60;
  return { id: config.id, baseUrl: config.baseUrl, hasApiKey: Boolean(config.apiKeyCiphertext), apiKeyLastFour: config.apiKeyLastFour, enabled: config.enabled, inferencePaused: config.inferencePaused, pauseReason: config.pauseReason?.toLowerCase() || null, modelListIntervalMinutes: config.modelListIntervalMinutes, inferenceIntervalMinutes: config.inferenceIntervalMinutes, ...(config.bucketIntervalMinutes ? { bucketIntervalMinutes: interval } : {}), nextModelListAt: config.nextModelListAt?.toISOString() || null, nextInferenceAt: config.nextInferenceAt?.toISOString() || null, lastModelListAt: config.lastModelListAt?.toISOString() || null, lastInferenceAt: config.lastInferenceAt?.toISOString() || null, models: config.models.map((model) => ({ ...model, status: model.status.toLowerCase(), lastCheckedAt: model.lastCheckedAt?.toISOString() || null, lastErrorCategory: model.lastErrorCategory?.toLowerCase() || null, buckets: visibleProbeBuckets(aggregateProbeBuckets(results.filter((result) => result.modelId === model.id), bucketCount(interval), interval), interval) })) };
}
async function notifyOperatorsOnce(prisma: PrismaService, gatewayName: string, gatewayId: string, reason: GatewayProbeErrorCategory) { const title = "中转站模型探测已暂停"; const recent = await prisma.notification.findFirst({ where: { title, body: { contains: gatewayId }, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } } }); if (recent) return; const users = await prisma.user.findMany({ where: { role: { in: [Role.ADMIN, Role.MODERATOR] } }, select: { id: true } }); if (users.length) await prisma.notification.createMany({ data: users.map((user) => ({ userId: user.id, type: "gateway_probe_alert", title, body: `${gatewayName} (${gatewayId}) 的探测因 ${reason.toLowerCase()} 暂停，请更新专用 Key 后恢复。`, href: "/admin" })) }); }
