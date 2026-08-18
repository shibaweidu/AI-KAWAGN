import { BadRequestException } from "@nestjs/common";
import { GatewayProbeErrorCategory, GatewayProbeModelStatus } from "@prisma/client";
import {
  aggregateProbeBuckets, classifyProbeError, decryptSecret, encryptSecret, encryptionKey, GatewayProbeService,
  isPublicIp, isSafeProbeBaseUrlSyntax, isValidChatCompletionResponse, nextModelProbeState, parseChatCompletionSse, parseProbeConfig, parseProbeModels,
} from "./gateway-probe.service";

describe("gateway probe secret encryption", () => {
  const key = Buffer.alloc(32, 7);

  it("round-trips without exposing plaintext", () => {
    const encrypted = encryptSecret("sk-probe-secret", key);
    expect(encrypted).not.toContain("sk-probe-secret");
    expect(decryptSecret(encrypted, key)).toBe("sk-probe-secret");
  });

  it("rejects a wrong master key and malformed key material", () => {
    const encrypted = encryptSecret("sk-probe-secret", key);
    expect(() => decryptSecret(encrypted, Buffer.alloc(32, 8))).toThrow();
    expect(() => encryptionKey("too-short")).toThrow("32 bytes");
  });
});

describe("gateway probe role permissions", () => {
  const service = new GatewayProbeService({} as never);

  it("allows moderators to trigger configured probes but not mutate configuration", async () => {
    await expect(service.saveConfig("gateway", {}, "moderator")).rejects.toThrow("仅管理员");
    await expect(service.saveModels("gateway", {}, "moderator")).rejects.toThrow("仅管理员");
    await expect(service.resume("gateway", "moderator")).rejects.toThrow("仅管理员");
  });
});

describe("gateway probe response redaction", () => {
  it("returns only a key presence flag and last four characters to admins", async () => {
    const prisma = {
      gatewayDirectoryEntry: { findUnique: jest.fn().mockResolvedValue({ id: "gateway", name: "Gateway" }) },
      gatewayProbeConfig: { findUnique: jest.fn().mockResolvedValue({
        id: "config", baseUrl: "https://api.example.com/v1/", apiKeyCiphertext: "v1.secret-ciphertext",
        apiKeyLastFour: "1234", enabled: true, inferencePaused: false, pauseReason: null,
        modelListIntervalMinutes: 15, inferenceIntervalMinutes: 60, nextModelListAt: null,
        nextInferenceAt: null, lastModelListAt: null, lastInferenceAt: null, models: [],
      }) },
    };
    const response = await new GatewayProbeService(prisma as never).adminView("gateway", "admin");
    expect(response.config).toMatchObject({ hasApiKey: true, apiKeyLastFour: "1234" });
    expect(JSON.stringify(response)).not.toContain("secret-ciphertext");
  });

  it("never exposes endpoint or credentials in the public response", async () => {
    const prisma = {
      gatewayDirectoryEntry: { findFirst: jest.fn().mockResolvedValue({ probeConfig: { id: "config", enabled: true, models: [] } }) },
      gatewayProbeResult: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const response = await new GatewayProbeService(prisma as never).publicAvailability("gateway");
    expect(response).toEqual({ configured: true, lastInferenceAt: null, nextInferenceAt: null, models: [] });
    expect(JSON.stringify(response)).not.toMatch(/baseUrl|apiKey|ciphertext|destination/i);
  });

  it("returns sponsor model availability with hourly buckets", async () => {
    const checkedAt = new Date();
    const prisma = {
      managedListing: { findFirst: jest.fn().mockResolvedValue({ probeConfig: { id: "config", enabled: true, models: [{
        id: "model", modelId: "gpt-test", displayName: "GPT Test", status: GatewayProbeModelStatus.AVAILABLE,
        lastCheckedAt: checkedAt, lastSuccessAt: checkedAt, lastResponseMs: 120, lastErrorCategory: null,
      }] } }) },
      gatewayProbeResult: { findMany: jest.fn().mockResolvedValue([{ checkedAt, modelId: "model", success: true, totalMs: 120 }]) },
    };
    const response = await new GatewayProbeService(prisma as never).publicAvailabilityForListing("listing");
    expect(response).toMatchObject({ configured: true, models: [{ modelId: "gpt-test", status: "available", buckets: expect.any(Array) }] });
    expect(response.models[0].buckets).toHaveLength(60);
    expect(response.models[0].buckets.filter((bucket) => bucket.attempts === 0)).toHaveLength(59);
  });

  it("does not expose inactive or non-sponsor listings", async () => {
    const prisma = { managedListing: { findFirst: jest.fn().mockResolvedValue(null) } };
    await expect(new GatewayProbeService(prisma as never).publicAvailabilityForListing("project-or-inactive"))
      .rejects.toThrow("Sponsor not found");
  });
});

describe("gateway probe destination safety", () => {
  it("validates HTTPS syntax without requiring API-container DNS access", () => {
    expect(isSafeProbeBaseUrlSyntax("https://api.example.com/v1")).toBe(true);
    expect(isSafeProbeBaseUrlSyntax("http://api.example.com/v1")).toBe(false);
    expect(isSafeProbeBaseUrlSyntax("https://localhost/v1")).toBe(false);
    expect(isSafeProbeBaseUrlSyntax("https://127.0.0.1/v1")).toBe(false);
    expect(isSafeProbeBaseUrlSyntax("https://user:pass@api.example.com/v1")).toBe(false);
  });
  it.each(["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])("accepts public address %s", (address) => {
    expect(isPublicIp(address)).toBe(true);
  });

  it.each([
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1",
    "192.0.0.1", "192.0.2.1", "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1",
    "224.0.0.1", "::", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1",
  ])("rejects non-public address %s", (address) => {
    expect(isPublicIp(address)).toBe(false);
  });
});

describe("gateway probe validation and classification", () => {
  it("enforces interval bounds and enabled model limit", () => {
    expect(parseProbeConfig({ baseUrl: "https://api.example.com/v1", enabled: true, modelListIntervalMinutes: 1, inferenceIntervalMinutes: 15 })).toBeTruthy();
    expect(() => parseProbeConfig({ baseUrl: "https://api.example.com", enabled: true, modelListIntervalMinutes: 0, inferenceIntervalMinutes: 15 })).toThrow(BadRequestException);
    expect(parseProbeConfig({ baseUrl: "https://api.example.com", enabled: true, modelListIntervalMinutes: 15, inferenceIntervalMinutes: 60 }).bucketIntervalMinutes).toBe(60);
    expect(() => parseProbeConfig({ baseUrl: "https://api.example.com", enabled: true, modelListIntervalMinutes: 15, inferenceIntervalMinutes: 60, bucketIntervalMinutes: 2 })).toThrow(BadRequestException);
    expect(() => parseProbeModels({ models: Array.from({ length: 11 }, (_, i) => ({ modelId: `m${i}`, displayName: `M${i}`, enabled: true })) })).toThrow("最多启用 10 个模型");
  });

  it("maps public errors and distinguishes missing models from unsupported endpoints", () => {
    expect(classifyProbeError(429, null, true)).toBe(GatewayProbeErrorCategory.RATE_LIMITED);
    expect(classifyProbeError(401, null, true)).toBe(GatewayProbeErrorCategory.AUTHENTICATION);
    expect(classifyProbeError(402, null, true)).toBe(GatewayProbeErrorCategory.QUOTA_EXHAUSTED);
    expect(classifyProbeError(404, null, true, { error: { code: "model_not_found", message: "Model not found" } })).toBe(GatewayProbeErrorCategory.MODEL_UNAVAILABLE);
    expect(classifyProbeError(404, null, true, { error: { message: "The requested model gpt-test was not found" } })).toBe(GatewayProbeErrorCategory.MODEL_UNAVAILABLE);
    expect(classifyProbeError(404, null, true, { error: { message: "Route not found" } })).toBe(GatewayProbeErrorCategory.PROTOCOL_ERROR);
  });
});

describe("gateway model status and hourly aggregation", () => {
  it("keeps transient failures degraded and immediately recovers", () => {
    expect(nextModelProbeState(0, false, GatewayProbeErrorCategory.TIMEOUT)).toEqual({ status: GatewayProbeModelStatus.DEGRADED, consecutiveFailures: 1 });
    expect(nextModelProbeState(1, false, GatewayProbeErrorCategory.TIMEOUT)).toEqual({ status: GatewayProbeModelStatus.DEGRADED, consecutiveFailures: 2 });
    expect(nextModelProbeState(4, false, GatewayProbeErrorCategory.TIMEOUT)).toEqual({ status: GatewayProbeModelStatus.UNAVAILABLE, consecutiveFailures: 5 });
    expect(nextModelProbeState(0, false, GatewayProbeErrorCategory.MODEL_UNAVAILABLE)).toEqual({ status: GatewayProbeModelStatus.UNAVAILABLE, consecutiveFailures: 1 });
    expect(nextModelProbeState(5, true, null)).toEqual({ status: GatewayProbeModelStatus.AVAILABLE, consecutiveFailures: 0 });
    expect(nextModelProbeState(0, false, GatewayProbeErrorCategory.PROTOCOL_ERROR).status).toBe(GatewayProbeModelStatus.PROTOCOL_UNSUPPORTED);
  });

  it("validates a complete OpenAI SSE stream and rejects incomplete streams", () => {
    const stream = [
      "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}",
      "",
      "data: {\"choices\":[{\"delta\":{\"content\":\"OK\"},\"finish_reason\":\"stop\"}]}",
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    expect(parseChatCompletionSse(stream)).toBe(true);
    expect(parseChatCompletionSse(stream.replace("data: [DONE]", "data: {\"choices\":[]}"))).toBe(false);
    expect(isValidChatCompletionResponse({ rawText: JSON.stringify({ choices: [{ message: { content: "OK" } }] }), json: { choices: [{}] }, contentType: "application/json" })).toBe(true);
    expect(isValidChatCompletionResponse({ rawText: JSON.stringify({ choices: [] }), json: { choices: [] }, contentType: "application/json" })).toBe(false);
  });

  it("builds continuous buckets with attempts, success rate and successful latency", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-13T08:40:00.000Z"));
    const buckets = aggregateProbeBuckets([
      { checkedAt: new Date("2026-08-13T07:10:00.000Z"), success: true, totalMs: 100 },
      { checkedAt: new Date("2026-08-13T07:20:00.000Z"), success: false, totalMs: 900 },
    ], 2);
    expect(buckets).toEqual([
      { startedAt: "2026-08-13T07:00:00.000Z", attempts: 2, successes: 1, successRate: 50, averageResponseMs: 100 },
      { startedAt: "2026-08-13T08:00:00.000Z", attempts: 0, successes: 0, successRate: null, averageResponseMs: null },
    ]);
    jest.useRealTimers();
  });

  it("supports a custom bucket interval across the same 48-hour window", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-13T08:40:00.000Z"));
    const buckets = aggregateProbeBuckets([], 192, 15);
    expect(buckets).toHaveLength(192);
    expect(new Date(buckets[0].startedAt).getTime()).toBe(new Date("2026-08-11T08:45:00.000Z").getTime());
    expect(new Date(buckets.at(-1)!.startedAt).getTime()).toBe(new Date("2026-08-13T08:30:00.000Z").getTime());
    jest.useRealTimers();
  });
});
