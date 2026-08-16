"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  CheckCircle, Clock, MagnifyingGlass, PaperPlaneTilt, Plus, Robot, ShieldCheck, Trash, WarningCircle,
} from "@phosphor-icons/react";
import type { BotAdminOverview, BotChatAllowlist, BotPlatform, BotPreview } from "@ai-card/contracts";

type AdminRequest = <T>(path: string, init?: RequestInit) => Promise<T>;
type Props = {
  data: BotAdminOverview | null;
  busy: string | null;
  request: AdminRequest;
  act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void>;
};

export function BotAdminPanel({ data, busy, request, act }: Props) {
  const [platform, setPlatform] = useState<BotPlatform>("telegram");
  const [chats, setChats] = useState<BotChatAllowlist[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatDraft, setChatDraft] = useState({ externalChatId: "", label: "", note: "" });
  const [previewQuery, setPreviewQuery] = useState("");
  const [preview, setPreview] = useState<BotPreview | null>(null);

  const loadChats = useCallback(async () => {
    setChatLoading(true);
    try { setChats(await request<BotChatAllowlist[]>(`/bots/${platform}/chats`)); }
    finally { setChatLoading(false); }
  }, [platform, request]);

  useEffect(() => { void loadChats(); }, [loadChats]);
  const integration = data?.integrations.find((item) => item.platform === platform) || null;

  const addChat = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void act("bot-chat-add", async () => {
      await request(`/bots/${platform}/chats`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...chatDraft, active: true }) });
      setChatDraft({ externalChatId: "", label: "", note: "" });
      await loadChats();
    }, "群白名单已保存");
  };

  const toggleChat = (chat: BotChatAllowlist) => void act(`bot-chat-${chat.id}`, async () => {
    await request(`/bots/${platform}/chats`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ externalChatId: chat.externalChatId, label: chat.label, note: chat.note, active: !chat.active }) });
    await loadChats();
  }, chat.active ? "群白名单已停用" : "群白名单已启用");

  const removeChat = (chat: BotChatAllowlist) => {
    if (!window.confirm(`确认删除“${chat.label}”的群白名单？`)) return;
    void act(`bot-chat-delete-${chat.id}`, async () => {
      await request(`/bots/${platform}/chats/${chat.id}`, { method: "DELETE" });
      await loadChats();
    }, "群白名单已删除");
  };

  const runPreview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void act("bot-preview", async () => {
      setPreview(await request<BotPreview>("/bots/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: previewQuery, page: 1 }) }));
    }, "已生成机器人回复预览");
  };

  return <div className="admin-module bot-admin-module">
    <section className="bot-integration-grid" aria-label="机器人平台状态">
      {data?.integrations.map((item) => <button type="button" aria-pressed={platform === item.platform} className={`bot-integration-card${platform === item.platform ? " is-selected" : ""}`} onClick={() => setPlatform(item.platform)} key={item.platform}>
        <span className={`bot-platform-icon ${item.platform}`}><Robot /></span>
        <span><strong>{item.platform === "telegram" ? "Telegram Bot" : "QQ 机器人"}</strong><small>{integrationStatus(item)}</small></span>
        <i className={`bot-status-dot ${statusTone(item)}`} aria-hidden="true" />
      </button>)}
      {!data && <div className="admin-empty compact"><Robot /><strong>正在读取机器人状态</strong></div>}
    </section>

    <section className="admin-panel bot-status-panel">
      <div className="admin-section-head"><div><span className="kicker">接入状态</span><h2>{platform === "telegram" ? "Telegram" : "QQ 官方平台"}</h2></div>
        <button className={integration?.enabled ? "button ghost compact" : "button dark compact"} type="button" disabled={Boolean(busy) || !integration} onClick={() => void act(`bot-toggle-${platform}`, () => request(`/bots/${platform}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !integration?.enabled }) }), integration?.enabled ? "机器人已停用" : "机器人已设为启用")}>{integration?.enabled ? "停用" : "启用"}</button>
      </div>
      <div className="bot-status-details">
        <StatusDetail icon={<ShieldCheck />} label="环境凭据" value={integration?.configured ? "已配置" : "等待配置"} tone={integration?.configured ? "good" : "muted"} />
        <StatusDetail icon={<PaperPlaneTilt />} label="运行状态" value={integration ? runtimeLabel(integration.runtimeStatus) : "读取中"} tone={integration?.effectiveEnabled ? "good" : integration?.runtimeStatus === "error" ? "bad" : "muted"} />
        <StatusDetail icon={<Clock />} label="最近心跳" value={integration?.lastHeartbeatAt ? formatTime(integration.lastHeartbeatAt) : "尚未上报"} tone="muted" />
      </div>
      {integration?.lastError && <p className="bot-runtime-error"><WarningCircle />{integration.lastError}</p>}
      <p className="form-note">Token 和平台密钥仅通过服务器环境变量配置，后台不会保存或回显。{platform === "telegram" ? "在目标群发送 /chatid 可获取群 ID。" : "QQ 首版仅保留官方适配器，尚不建立网络连接。"}</p>
    </section>

    <section className="admin-panel bot-chat-panel">
      <div className="admin-section-head"><div><span className="kicker">访问控制</span><h2>群白名单</h2></div><span className="source-state active">{chats.filter((chat) => chat.active).length} 个启用</span></div>
      <form className="bot-chat-form" onSubmit={addChat}>
        <label><span>群 ID</span><input inputMode="numeric" required pattern="-?[0-9]+" maxLength={30} value={chatDraft.externalChatId} onChange={(event) => setChatDraft((current) => ({ ...current, externalChatId: event.target.value }))} placeholder="例如：-1001234567890" /></label>
        <label><span>群名称</span><input required maxLength={100} value={chatDraft.label} onChange={(event) => setChatDraft((current) => ({ ...current, label: event.target.value }))} placeholder="运营测试群" /></label>
        <label><span>备注</span><input maxLength={500} value={chatDraft.note} onChange={(event) => setChatDraft((current) => ({ ...current, note: event.target.value }))} placeholder="可选" /></label>
        <button className="button dark" type="submit" disabled={Boolean(busy)}><Plus />添加群</button>
      </form>
      <div className="bot-chat-list" aria-busy={chatLoading}>
        {chatLoading && <p className="bot-loading-state">正在加载群白名单...</p>}
        {chats.map((chat) => <div className={!chat.active ? "is-disabled" : ""} key={chat.id}>
          <span><strong>{chat.label}</strong><code>{chat.externalChatId}</code>{chat.note && <small>{chat.note}</small>}</span>
          <span className={chat.active ? "source-state active" : "source-state manual"}>{chat.active ? "已启用" : "已停用"}</span>
          <button className="button ghost compact" type="button" disabled={Boolean(busy)} onClick={() => toggleChat(chat)}>{chat.active ? "停用" : "启用"}</button>
          <button className="icon-button" type="button" aria-label={`删除 ${chat.label}`} title="删除白名单" disabled={Boolean(busy)} onClick={() => removeChat(chat)}><Trash /></button>
        </div>)}
        {!chatLoading && !chats.length && <div className="admin-empty compact"><ShieldCheck /><strong>暂无群白名单</strong><small>添加群后才允许执行商品查询。</small></div>}
      </div>
    </section>

    <section className="admin-panel bot-preview-panel">
      <div className="admin-section-head"><div><span className="kicker">消息模拟器</span><h2>商品组回复预览</h2></div></div>
      <form className="bot-preview-form" onSubmit={runPreview}><label><MagnifyingGlass /><input aria-label="商品关键词" value={previewQuery} minLength={2} maxLength={100} required onChange={(event) => setPreviewQuery(event.target.value)} placeholder="输入商品关键词" /></label><button className="button dark" type="submit" disabled={Boolean(busy)}>{busy === "bot-preview" ? "生成中" : "生成预览"}</button></form>
      {preview && <div className="bot-preview-result"><header><span>查到“{preview.query}”相关商品组 {preview.total} 个</span><small>第 {preview.page}/{Math.max(preview.totalPages, 1)} 页</small></header>{preview.items.map((item, index) => <article key={item.productSlug}><b>{index + 1}</b><span><strong>{item.productName}</strong><small>最低 ¥{item.lowestPrice.toFixed(2)} · {item.offerCount} 家报价 · {item.inStockOfferCount} 家有货</small></span></article>)}{!preview.items.length && <p>没有找到相关商品，请更换关键词。</p>}</div>}
    </section>

    <section className="bot-metric-strip" aria-label="最近 24 小时机器人指标">
      <div><small>查询次数</small><strong>{data?.metrics.queryCount24h ?? 0}</strong></div>
      <div><small>成功率</small><strong>{data?.metrics.successRate24h ?? 0}%</strong></div>
      <div><small>平均耗时</small><strong>{data?.metrics.averageDurationMs24h ?? 0} ms</strong></div>
      <div><small>热门关键词</small><strong>{data?.metrics.topKeywords.slice(0, 3).map((item) => item.keyword).join("、") || "暂无"}</strong></div>
    </section>
  </div>;
}

function StatusDetail({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone: "good" | "bad" | "muted" }) {
  return <div className={tone}><span>{icon}</span><small>{label}</small><strong>{value}</strong></div>;
}

function integrationStatus(item: BotAdminOverview["integrations"][number]) {
  if (!item.configured) return "等待环境变量配置";
  if (!item.enabled) return "后台未启用";
  return runtimeLabel(item.runtimeStatus);
}
function runtimeLabel(value: BotAdminOverview["integrations"][number]["runtimeStatus"]) { return ({ disabled: "已停用", waiting_config: "等待配置", starting: "正在启动", running: "运行中", error: "运行异常" })[value]; }
function statusTone(item: BotAdminOverview["integrations"][number]) { return item.effectiveEnabled ? "good" : item.runtimeStatus === "error" ? "bad" : "muted"; }
function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)); }
