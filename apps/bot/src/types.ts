export type BotHealth = {
  configured: boolean;
  runtimeStatus: "disabled" | "waiting_config" | "starting" | "running" | "error";
  botUsername: string | null;
  lastError: string | null;
};

export interface BotAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): BotHealth;
}

export type PaginationState = { query: string; page: number; chatId: string };
