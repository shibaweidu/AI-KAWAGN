import type { BotAdapter, BotHealth } from "./types";

export class QqOfficialAdapter implements BotAdapter {
  private state: BotHealth;
  constructor(configured: boolean) {
    this.state = { configured, runtimeStatus: configured ? "disabled" : "waiting_config", botUsername: null, lastError: configured ? "QQ 官方适配器已预留，首版暂不启动网络连接" : null };
  }
  async start() { this.state.runtimeStatus = "disabled"; }
  async stop() { this.state.runtimeStatus = "disabled"; }
  health() { return { ...this.state }; }
}
