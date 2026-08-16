import "./load-env";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import pino from "pino";
import { PrismaClient, SyncStatus } from "@prisma/client";

const logger = pino({ name: "ldxp-index-worker" });
const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", { maxRetriesPerRequest: null });
const prisma = new PrismaClient();
const defaultJobOptions = { attempts: 5, backoff: { type: "exponential" as const, delay: 5000 }, removeOnComplete: 1000, removeOnFail: 5000 };

export const indexOutboxQueue = new Queue("index-outbox", { connection, defaultJobOptions });
export const ldxpSyncQueue = new Queue("ldxp-sync", { connection, defaultJobOptions: { ...defaultJobOptions, attempts: 3, backoff: { type: "exponential", delay: 30_000 } } });
export const gatewaySyncQueue = new Queue("gateway-directory-sync", { connection, defaultJobOptions: { ...defaultJobOptions, attempts: 3, backoff: { type: "exponential", delay: 30_000 } } });
export const gatewayProbeQueue = new Queue("gateway-model-probe", { connection, defaultJobOptions: { ...defaultJobOptions, attempts: 1, removeOnComplete: 1000, removeOnFail: 5000 } });

const indexWorker = new Worker("index-outbox", async () => {
  const events = await prisma.outboxEvent.findMany({ where: { processedAt: null }, orderBy: { createdAt: "asc" }, take: 100 });
  for (const event of events) {
    if (event.topic === "offer.updated") await indexOffer(event.aggregateId);
    if (event.topic === "shop.published") await indexShop(event.aggregateId);
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
  }
  return { processed: events.length };
}, { connection, concurrency: 1 });

const ldxpWorker = new Worker("ldxp-sync", async (job) => {
  const source = await prisma.dataSource.findUnique({ where: { key: "ldxp" } });
  if (!source) return { skipped: "source_missing" };
  const backfill = await prisma.ingestionRun.findFirst({
    where: { dataSourceId: source.id, kind: "ldxp-product-backfill", status: { in: [SyncStatus.QUEUED, SyncStatus.RUNNING] } },
    orderBy: { createdAt: "asc" },
  });
  if (backfill) {
    try {
      return await refreshLdxpProductBackfill(backfill.id);
    } catch (error) {
      const finalAttempt = job.attemptsMade + 1 >= Number(job.opts.attempts || 1);
      if (finalAttempt) {
        await prisma.ingestionRun.update({
          where: { id: backfill.id },
          data: {
            status: SyncStatus.FAILED,
            finishedAt: new Date(),
            errorCode: error instanceof Error ? error.name : "UnknownError",
            errorMessage: String(error instanceof Error ? error.message : error).slice(0, 2000),
          },
        });
      }
      throw error;
    }
  }
  if (process.env.PAUSE_SOURCE_JOBS === "true") return { skipped: "source_jobs_paused" };
  await reconcileStaleLdxpRuns(source.id);
  const persistedRunId = typeof job.data?.runId === "string" ? job.data.runId : null;
  let run = persistedRunId ? await prisma.ingestionRun.findFirst({ where: { id: persistedRunId, dataSourceId: source.id } }) : null;
  if (!run) {
    const inProgress = await prisma.ingestionRun.findFirst({
      where: {
        dataSourceId: source.id,
        kind: { in: ["ldxp-sync-request", "ldxp-scheduled-sync"] },
        status: { in: [SyncStatus.QUEUED, SyncStatus.RUNNING] },
        startedAt: { not: null },
      },
      orderBy: { startedAt: "asc" },
    });
    if (inProgress) return { skipped: "already_running", runId: inProgress.id };
    const requested = await prisma.ingestionRun.findFirst({
      where: { dataSourceId: source.id, kind: "ldxp-sync-request", status: SyncStatus.QUEUED },
      orderBy: { createdAt: "asc" },
    });
    const dueAt = (source.lastCheckedAt?.getTime() || 0) + source.pollIntervalSeconds * 1000;
    const due = process.env.ENABLE_SOURCE_SCHEDULERS === "true" && source.enabled && source.pollIntervalSeconds >= 30 * 60 && Date.now() >= dueAt;
    if (!requested && !due) return { skipped: "not_due" };
    run = requested || await prisma.ingestionRun.create({
      data: { dataSourceId: source.id, kind: "ldxp-scheduled-sync", status: SyncStatus.QUEUED },
    });
    await job.updateData({ ...job.data, runId: run.id });
  }
  if (run.status === SyncStatus.SUCCEEDED || run.status === SyncStatus.FAILED) return { skipped: "already_finished", runId: run.id };
  await prisma.ingestionRun.update({ where: { id: run.id }, data: { status: SyncStatus.RUNNING, startedAt: new Date(), finishedAt: null, errorCode: null, errorMessage: null } });
  try {
    const result = await refreshLdxpDirectory();
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: { status: SyncStatus.SUCCEEDED, finishedAt: new Date(), counts: result },
    });
    return result;
  } catch (error) {
    const finalAttempt = job.attemptsMade + 1 >= Number(job.opts.attempts || 1);
    await prisma.ingestionRun.update({
      where: { id: run.id },
      data: {
        status: finalAttempt ? SyncStatus.FAILED : SyncStatus.QUEUED,
        finishedAt: finalAttempt ? new Date() : null,
        errorCode: error instanceof Error ? error.name : "UnknownError",
        errorMessage: String(error instanceof Error ? error.message : error).slice(0, 2000),
      },
    });
    if (finalAttempt) {
      await prisma.dataSource.update({ where: { id: source.id }, data: { lastCheckedAt: new Date() } });
      const recent = await prisma.ingestionRun.findMany({
        where: { dataSourceId: source.id, kind: { in: ["ldxp-sync-request", "ldxp-scheduled-sync"] } },
        orderBy: { createdAt: "desc" }, take: 3, select: { status: true },
      });
      if (recent.length === 3 && recent.every((item) => item.status === SyncStatus.FAILED)) {
        await prisma.dataSource.update({ where: { id: source.id }, data: { enabled: false } });
      }
    }
    throw error;
  }
}, { connection, concurrency: 1, lockDuration: 30 * 60_000 });

const gatewayWorker = new Worker("gateway-directory-sync", async () => {
  if (process.env.PAUSE_SOURCE_JOBS === "true") return { skipped: "source_jobs_paused" };
  const source = await prisma.dataSource.findUnique({ where: { key: "zuiquanapi" } });
  if (!source) return { skipped: "source_missing" };
  const dueAt = (source.lastCheckedAt?.getTime() || 0) + source.pollIntervalSeconds * 1000;
  const due = source.enabled && source.pollIntervalSeconds >= 30 * 60 && Date.now() >= dueAt;
  if (!due) return { skipped: "not_due" };
  const running = await prisma.gatewayDirectorySyncRun.findFirst({
    where: { sourceKey: "zuiquanapi", status: SyncStatus.RUNNING, startedAt: { gte: new Date(Date.now() - 2 * 60 * 60_000) } },
    orderBy: { startedAt: "desc" },
  });
  if (running) return { skipped: "already_running", runId: running.id };
  return refreshGatewayDirectory();
}, { connection, concurrency: 1, lockDuration: 30 * 60_000 });

const gatewayProbeWorker = new Worker("gateway-model-probe", async (job) => {
  if (job.name === "scan") {
    // Keep scheduled probes behind the explicit safety switch, but allow an
    // administrator's one-shot request to run so the UI can verify a key and
    // endpoint before enabling the recurring scheduler.
    const recurringEnabled = process.env.ENABLE_GATEWAY_PROBES === "true";
    const now = new Date();
    const configs = await prisma.gatewayProbeConfig.findMany({
      where: { apiKeyCiphertext: { not: null }, OR: [
        { modelListRequestedAt: { not: null } }, { inferenceRequestedAt: { not: null } },
        ...(recurringEnabled ? [{ enabled: true, nextModelListAt: { lte: now } }, { enabled: true, nextInferenceAt: { lte: now }, inferencePaused: false }] : []),
      ] }, select: { id: true }, orderBy: { updatedAt: "asc" }, take: 100,
    });
    for (const config of configs) await gatewayProbeQueue.add("execute", { configId: config.id }, { jobId: `gateway-probe-${config.id}-${Math.floor(Date.now() / 10_000)}` });
    return { queued: configs.length };
  }
  if (job.name === "cleanup") return runGatewayProbe(["--cleanup"]);
  return runGatewayProbe([`--config-id=${String(job.data.configId)}`]);
}, { connection, concurrency: 3, lockDuration: 5 * 60_000 });

async function meiliWrite(index: string, documents: unknown[]) {
  const host = process.env.MEILI_HOST || "http://localhost:7700";
  const response = await fetch(`${host}/indexes/${index}/documents`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.MEILI_MASTER_KEY || "change-me"}` },
    body: JSON.stringify(documents),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Meilisearch returned ${response.status}`);
}

async function indexOffer(id: string) {
  const offer = await prisma.offer.findUnique({ where: { id }, include: { canonicalProduct: { include: { category: true } }, shop: true, dataSource: true } });
  if (!offer || offer.dataSource.key !== "ldxp") return;
  await meiliWrite("offers", [{
    id: offer.id, productId: offer.canonicalProductId, title: offer.canonicalProduct.title,
    normalizedTitle: offer.canonicalProduct.normalizedTitle, category: offer.canonicalProduct.category.name,
    thumbnailUrl: offer.canonicalProduct.thumbnailUrl, shopId: offer.shopId, shopName: offer.shop.name,
    price: offer.price.toNumber(), stock: offer.stock, active: offer.active && offer.shop.status === "ACTIVE",
    sourceName: offer.dataSource.name, observedAt: offer.sourceObservedAt.toISOString(),
  }]);
}

async function indexShop(id: string) {
  const shop = await prisma.shop.findUnique({ where: { id }, include: { sourceMappings: { include: { dataSource: true } } } });
  if (!shop || !shop.sourceMappings.some((mapping) => mapping.dataSource.key === "ldxp")) return;
  await meiliWrite("shops", [{ id: shop.id, slug: shop.slug, name: shop.name, logoUrl: shop.logoUrl, description: shop.description, verified: true, active: shop.status === "ACTIVE", publishedAt: shop.publishedAt?.toISOString() }]);
}

async function refreshLdxpDirectory() {
  const repoRoot = resolve(__dirname, "../../..");
  const runner = process.env.NODE_ENV === "production"
    ? resolve(repoRoot, "apps/api/dist/sync-ldxp-211b.js")
    : require.resolve("tsx/cli");
  const args = process.env.NODE_ENV === "production"
    ? [runner]
    : [runner, resolve(repoRoot, "apps/api/src/sync-ldxp-211b.ts")];
  const output = await runNode(args, repoRoot);
  return { source: new URL(process.env.SOURCE_211B_ORIGIN || "https://2dou.org").hostname, output: output.slice(-8000) };
}

async function reconcileStaleLdxpRuns(sourceId: string) {
  const cutoff = new Date(Date.now() - 45 * 60_000);
  return prisma.ingestionRun.updateMany({
    where: {
      dataSourceId: sourceId,
      kind: { in: ["ldxp-sync-request", "ldxp-scheduled-sync"] },
      status: { in: [SyncStatus.QUEUED, SyncStatus.RUNNING] },
      startedAt: { lt: cutoff },
    },
    data: {
      status: SyncStatus.FAILED,
      finishedAt: new Date(),
      errorCode: "StaleRunRecovered",
      errorMessage: "同步任务超过 45 分钟未完成，Worker 已自动结束该遗留任务",
    },
  });
}

async function refreshLdxpProductBackfill(runId: string) {
  const repoRoot = resolve(__dirname, "../../..");
  const runner = process.env.NODE_ENV === "production"
    ? resolve(repoRoot, "apps/api/dist/run-ldxp-product-backfill.js")
    : require.resolve("tsx/cli");
  const args = process.env.NODE_ENV === "production"
    ? [runner, `--run-id=${runId}`]
    : [runner, resolve(repoRoot, "apps/api/src/run-ldxp-product-backfill.ts"), `--run-id=${runId}`];
  const output = await runNode(args, repoRoot);
  return { runId, output: output.slice(-4000) };
}

async function refreshGatewayDirectory() {
  const repoRoot = resolve(__dirname, "../../..");
  const runner = process.env.NODE_ENV === "production"
    ? resolve(repoRoot, "apps/api/dist/sync-gateway-directory.js")
    : require.resolve("tsx/cli");
  const args = process.env.NODE_ENV === "production"
    ? [runner]
    : [runner, resolve(repoRoot, "apps/api/src/sync-gateway-directory.ts")];
  const output = await runNode(args, repoRoot);
  return { output: output.slice(-8000) };
}

async function runGatewayProbe(extraArgs: string[]) {
  const repoRoot = resolve(__dirname, "../../..");
  const runner = process.env.NODE_ENV === "production" ? resolve(repoRoot, "apps/api/dist/run-gateway-probe.js") : require.resolve("tsx/cli");
  const args = process.env.NODE_ENV === "production" ? [runner, ...extraArgs] : [runner, resolve(repoRoot, "apps/api/src/run-gateway-probe.ts"), ...extraArgs];
  const output = await runNode(args, repoRoot);
  return { output: output.slice(-4000) };
}

function runNode(args: string[], cwd: string) {
  return new Promise<string>((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, { cwd, env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let errorOutput = "";
    child.stdout.on("data", (chunk) => { output = `${output}${String(chunk)}`.slice(-64_000); });
    child.stderr.on("data", (chunk) => { errorOutput = `${errorOutput}${String(chunk)}`.slice(-64_000); });
    child.once("error", rejectRun);
    child.once("exit", (code) => code === 0 ? resolveRun(output) : rejectRun(new Error(errorOutput || output || `Node process exited with code ${code}`)));
  });
}

async function registerScheduler() {
  await indexOutboxQueue.upsertJobScheduler("outbox-every-10s", { every: 10_000 }, { name: "drain", data: {} });
  await ldxpSyncQueue.upsertJobScheduler("ldxp-source-every-minute", { every: 60_000 }, { name: "refresh", data: {} });
  await gatewaySyncQueue.upsertJobScheduler("gateway-directory-every-minute", { every: 60_000 }, { name: "refresh", data: {} });
  // Manual probe requests should be picked up quickly; the config lease still prevents duplicate execution.
  await gatewayProbeQueue.upsertJobScheduler("gateway-model-probe-every-minute", { every: 10_000 }, { name: "scan", data: {} });
  await gatewayProbeQueue.upsertJobScheduler("gateway-model-probe-cleanup-daily", { every: 24 * 60 * 60_000 }, { name: "cleanup", data: {} });
}

registerScheduler().catch((error) => { logger.error({ error }, "index scheduler registration failed"); process.exitCode = 1; });
indexWorker.on("failed", (job, error) => logger.error({ queue: indexWorker.name, jobId: job?.id, error: error.message }, "index job failed"));
ldxpWorker.on("failed", (job, error) => logger.error({ queue: ldxpWorker.name, jobId: job?.id, error: error.message }, "LDXP sync job failed"));
gatewayWorker.on("failed", (job, error) => logger.error({ queue: gatewayWorker.name, jobId: job?.id, error: error.message }, "Gateway directory sync job failed"));
gatewayProbeWorker.on("failed", (job, error) => logger.error({ queue: gatewayProbeWorker.name, jobId: job?.id, error: error.message }, "Gateway model probe failed"));
process.on("SIGTERM", async () => {
  await indexWorker.close();
  await ldxpWorker.close();
  await gatewayWorker.close();
  await gatewayProbeWorker.close();
  await indexOutboxQueue.close();
  await ldxpSyncQueue.close();
  await gatewaySyncQueue.close();
  await gatewayProbeQueue.close();
  await prisma.$disconnect();
  await connection.quit();
});
