import "./load-env";
import { randomUUID } from "node:crypto";
import pino from "pino";
import { BotApiClient } from "./api-client";
import { QqOfficialAdapter } from "./qq-adapter";
import { BotRedisStore } from "./redis-store";
import { TelegramAdapter } from "./telegram-adapter";
import type { BotHealth } from "./types";

const logger = pino({ name: "ai-card-bot" });
const apiOrigin = process.env.API_ORIGIN || "http://localhost:4000";
const internalSecret = process.env.BOT_INTERNAL_SECRET || "";
const hashSecret = process.env.BOT_HASH_SECRET || "";
if (internalSecret.length < 16) throw new Error("BOT_INTERNAL_SECRET must contain at least 16 characters");
if (hashSecret.length < 16) throw new Error("BOT_HASH_SECRET must contain at least 16 characters");

const store = new BotRedisStore(process.env.REDIS_URL || "redis://localhost:6379", hashSecret);
const telegramApi = new BotApiClient(apiOrigin, internalSecret, "telegram");
const qqApi = new BotApiClient(apiOrigin, internalSecret, "qq");
const telegramToken = process.env.TELEGRAM_BOT_TOKEN?.trim() || "";
const telegramEnvironmentEnabled = process.env.TELEGRAM_BOT_ENABLED === "true";
const telegram = telegramToken ? new TelegramAdapter(telegramToken, telegramApi, store, process.env.PUBLIC_SITE_URL || "http://localhost:3000", logger) : null;
const qqConfigured = Boolean(process.env.QQ_APP_ID?.trim() && process.env.QQ_CLIENT_SECRET?.trim());
const qqEnvironmentEnabled = process.env.QQ_BOT_ENABLED === "true";
const qq = new QqOfficialAdapter(qqConfigured);
const pollerOwner = randomUUID();
let ownsPollerLock = false;
let stopping = false;

async function reconcile() {
  const config = await telegramApi.config();
  const shouldRun = config.enabled && telegramEnvironmentEnabled && Boolean(telegram);
  if (shouldRun && !ownsPollerLock) ownsPollerLock = await store.acquirePollerLock(pollerOwner) === "OK";
  if (shouldRun && ownsPollerLock) {
    if (telegram?.health().runtimeStatus !== "running" && telegram?.health().runtimeStatus !== "starting") await telegram?.start();
    ownsPollerLock = await store.refreshPollerLock(pollerOwner);
  } else if (telegram?.health().runtimeStatus === "running" || telegram?.health().runtimeStatus === "starting") {
    await telegram.stop();
  }

  let health: BotHealth;
  if (!telegramToken) health = { configured: false, runtimeStatus: "waiting_config", botUsername: null, lastError: null };
  else if (!telegramEnvironmentEnabled || !config.enabled) health = { ...telegram!.health(), configured: true, runtimeStatus: "disabled", lastError: null };
  else if (!ownsPollerLock) health = { ...telegram!.health(), configured: true, runtimeStatus: "error", lastError: "另一个 Telegram 机器人实例正在运行" };
  else health = telegram!.health();
  await telegramApi.heartbeat(health);

  const qqConfig = await qqApi.config();
  const qqHealth = qq.health();
  await qqApi.heartbeat({
    ...qqHealth,
    runtimeStatus: qqConfig.enabled && qqEnvironmentEnabled && !qqConfigured ? "waiting_config" : "disabled",
    lastError: qqConfig.enabled && qqConfigured ? "QQ 官方适配器已预留，等待后续启用" : qqHealth.lastError,
  });
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "Stopping bot service");
  await telegram?.stop().catch(() => undefined);
  if (ownsPollerLock) await store.releasePollerLock(pollerOwner).catch(() => undefined);
  await store.close().catch(() => undefined);
  process.exit(0);
}

async function main() {
  await store.connect();
  await reconcile().catch((error) => logger.warn({ error }, "API is not ready; bot service will retry"));
  const timer = setInterval(() => void reconcile().catch((error) => logger.error({ error }, "Bot reconciliation failed")), 30_000);
  timer.unref();
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  logger.info({ telegramConfigured: Boolean(telegramToken), telegramEnvironmentEnabled, qqConfigured }, "Bot service ready");
}

void main().catch((error) => {
  logger.fatal({ error }, "Bot service failed to start");
  process.exit(1);
});
