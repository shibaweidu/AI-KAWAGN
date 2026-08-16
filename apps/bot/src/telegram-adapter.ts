import { Bot, InlineKeyboard, type Context } from "grammy";
import type { SearchAdPage } from "@ai-card/contracts";
import type { Logger } from "pino";
import { BotApiClient } from "./api-client";
import { commandQuery, formatSearchReply, validateQuery } from "./format";
import { BotRedisStore } from "./redis-store";
import type { BotAdapter, BotHealth } from "./types";

export class TelegramAdapter implements BotAdapter {
  private bot: Bot | null = null;
  private state: BotHealth = { configured: true, runtimeStatus: "disabled", botUsername: null, lastError: null };

  constructor(
    private readonly token: string,
    private readonly api: BotApiClient,
    private readonly store: BotRedisStore,
    private readonly siteUrl: string,
    private readonly logger: Logger,
  ) {}

  async start() {
    if (this.bot) return;
    this.state = { ...this.state, runtimeStatus: "starting", lastError: null };
    const bot = new Bot(this.token);
    this.register(bot);
    bot.catch((error) => {
      this.logger.error({ error: error.error }, "Telegram update failed");
      this.state = { ...this.state, runtimeStatus: "error", lastError: safeError(error.error) };
    });
    const me = await bot.api.getMe();
    this.state.botUsername = me.username || null;
    await bot.api.setMyCommands([
      { command: "price", description: "查询商品比价" },
      { command: "search", description: "搜索商品" },
      { command: "chatid", description: "查看当前群 ID" },
      { command: "help", description: "查看使用说明" },
    ]);
    this.bot = bot;
    this.state.runtimeStatus = "running";
    void bot.start({ onStart: () => this.logger.info({ username: me.username }, "Telegram long polling started") }).catch((error) => {
      this.bot = null;
      this.state = { ...this.state, runtimeStatus: "error", lastError: safeError(error) };
      this.logger.error({ error }, "Telegram polling stopped unexpectedly");
    });
  }

  async stop() {
    if (this.bot?.isRunning()) await this.bot.stop();
    this.bot = null;
    this.state.runtimeStatus = "disabled";
  }

  health() { return { ...this.state }; }

  private register(bot: Bot) {
    bot.command("help", async (ctx) => {
      if (!(await this.store.firstUpdate(ctx.update.update_id))) return;
      await ctx.reply("AI卡网商品比价机器人\n\n/price 商品名 - 按最低价查询\n/search 商品名 - 搜索商品\n/chatid - 查看当前群 ID");
    });
    bot.command("chatid", async (ctx) => {
      if (!(await this.store.firstUpdate(ctx.update.update_id))) return;
      await ctx.reply(`当前会话 ID：<code>${ctx.chat.id}</code>`, { parse_mode: "HTML" });
    });
    bot.command("price", (ctx) => this.handleSearch(ctx, commandQuery(ctx.message?.text || "", "price")));
    bot.command("search", (ctx) => this.handleSearch(ctx, commandQuery(ctx.message?.text || "", "search")));
    bot.callbackQuery(/^page:([A-Za-z0-9_-]+)$/, async (ctx) => {
      if (!(await this.store.firstUpdate(ctx.update.update_id))) return;
      const state = await this.store.paginationState(ctx.match[1]);
      if (!state || String(ctx.chat?.id || "") !== state.chatId) {
        await ctx.answerCallbackQuery({ text: "分页已过期，请重新搜索", show_alert: true });
        return;
      }
      if (!(await this.api.chatAllowed(state.chatId)).allowed) {
        await ctx.answerCallbackQuery({ text: "当前群未获得查询权限", show_alert: true });
        return;
      }
      await ctx.answerCallbackQuery();
      try {
        const result = await this.search(state.query, state.page);
        await ctx.editMessageText(formatSearchReply(result, state.query, this.siteUrl), {
          parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: await this.keyboard(result, state.query, state.chatId),
        });
      } catch (error) {
        this.logger.warn({ error }, "Telegram pagination failed");
        await ctx.reply("暂时无法加载下一页报价，请稍后重试");
      }
    });
  }

  private async handleSearch(ctx: Context, query: string) {
    if (!(await this.store.firstUpdate(ctx.update.update_id))) return;
    const problem = validateQuery(query);
    if (problem) { await ctx.reply(problem); return; }
    if (!ctx.chat || !["group", "supergroup"].includes(ctx.chat.type)) { await ctx.reply("商品查询仅在后台授权的群聊中开放"); return; }
    const chatId = String(ctx.chat.id);
    if (!(await this.api.chatAllowed(chatId)).allowed) { await ctx.reply("当前群未加入查询白名单。管理员可使用 /chatid 获取群 ID 后在后台添加。"); return; }
    const userId = String(ctx.from?.id || "anonymous");
    if (!(await this.store.allowRate("user", userId, 5)) || !(await this.store.allowRate("chat", chatId, 20))) {
      await this.api.metric({ keyword: query, resultCount: 0, durationMs: 0, status: "rate_limited" }).catch(() => undefined);
      await ctx.reply("查询过于频繁，请稍后再试");
      return;
    }
    await ctx.replyWithChatAction("typing");
    try {
      const result = await this.search(query, 1);
      await ctx.reply(formatSearchReply(result, query, this.siteUrl), {
        parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: await this.keyboard(result, query, chatId),
      });
    } catch (error) {
      this.logger.warn({ error }, "Telegram search failed");
      await ctx.reply("暂时无法获取报价，请稍后重试");
    }
  }

  private async search(query: string, page: number) {
    const startedAt = Date.now();
    try {
      const result = await this.store.cachedSearch(query, page, () => this.api.search(query, page));
      await this.api.metric({ keyword: query, resultCount: result.total, durationMs: Date.now() - startedAt, status: result.total ? "success" : "empty" }).catch(() => undefined);
      return result;
    } catch (error) {
      await this.api.metric({ keyword: query, resultCount: 0, durationMs: Math.min(Date.now() - startedAt, 60_000), status: "error" }).catch(() => undefined);
      throw error;
    }
  }

  private async keyboard(result: SearchAdPage, query: string, chatId: string) {
    const keyboard = new InlineKeyboard();
    if (result.page > 1) keyboard.text("上一页", `page:${await this.store.paginationToken({ query, page: result.page - 1, chatId })}`);
    if (result.page < result.totalPages) keyboard.text("下一页", `page:${await this.store.paginationToken({ query, page: result.page + 1, chatId })}`);
    return keyboard;
  }
}

function safeError(error: unknown) {
  return String(error instanceof Error ? error.message : error).slice(0, 1000);
}
