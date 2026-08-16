"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ArrowsClockwise, CheckCircle, EyeSlash, Gear, Key, Pause, Play, Plus, Sparkle, Trash, WarningCircle, X } from "@phosphor-icons/react";

type ProbeModel = {
  id: string;
  modelId: string;
  displayName: string;
  enabled: boolean;
  status: string;
  lastCheckedAt: string | null;
  lastResponseMs: number | null;
  lastErrorCategory: string | null;
  buckets: ProbeBucket[];
};
type ProbeBucket = { startedAt: string; attempts: number; successes: number; successRate: number | null; averageResponseMs: number | null };
type ProbeConfig = {
  id: string;
  baseUrl: string;
  hasApiKey: boolean;
  apiKeyLastFour: string | null;
  enabled: boolean;
  inferencePaused: boolean;
  pauseReason: string | null;
  modelListIntervalMinutes: number;
  inferenceIntervalMinutes: number;
  bucketIntervalMinutes: number;
  nextModelListAt: string | null;
  nextInferenceAt: string | null;
  lastModelListAt: string | null;
  lastInferenceAt: string | null;
  models: ProbeModel[];
};
type ProbeView = { gateway: { id: string; name: string }; canManageKey: boolean; canManageConfig: boolean; config: ProbeConfig | null };
type Props = { gatewayId?: string; gatewayName?: string; managedListingId?: string; managedListingName?: string; request: <T>(path: string, init?: RequestInit) => Promise<T> };

const statusLabel: Record<string, string> = { untested: "未探测", available: "可用", degraded: "波动", unavailable: "不可用", protocol_unsupported: "协议不支持" };
const errorLabel: Record<string, string> = { timeout: "超时", rate_limited: "限流", authentication: "鉴权异常", quota_exhausted: "额度不足", model_unavailable: "模型不可用", upstream_error: "上游异常", protocol_error: "协议异常", network_error: "网络异常" };

export function GatewayProbeConfig({ gatewayId, gatewayName, managedListingId, managedListingName, request }: Props) {
  const targetId = gatewayId || managedListingId || "";
  const targetName = gatewayName || managedListingName || "模型探测";
  const resourcePath = gatewayId ? `/gateway-directory/${gatewayId}/probe` : `/listings/${managedListingId}/probe`;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<ProbeView | null>(null);
  const [draft, setDraft] = useState({ baseUrl: "", enabled: false, modelListIntervalMinutes: "15", inferenceIntervalMinutes: "60", bucketIntervalMinutes: "60" });
  const [key, setKey] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  async function load() {
    setLoading(true); setError("");
    try {
      const next = await request<ProbeView>(resourcePath);
      setView(next);
      if (next.config) setDraft({ baseUrl: next.config.baseUrl, enabled: next.config.enabled, modelListIntervalMinutes: String(next.config.modelListIntervalMinutes), inferenceIntervalMinutes: String(next.config.inferenceIntervalMinutes), bucketIntervalMinutes: String(next.config.bucketIntervalMinutes || 60) });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "探测配置加载失败"); }
    finally { setLoading(false); }
  }
  async function openPanel() { setOpen(true); setNotice(""); await load(); }
  async function refreshUntilProbeCompletes(kind: "models" | "inference", previousAt: string | null) {
    for (let attempt = 0; attempt < 15; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const next = await request<ProbeView>(resourcePath);
      setView(next);
      if (next.config) {
        setDraft({ baseUrl: next.config.baseUrl, enabled: next.config.enabled, modelListIntervalMinutes: String(next.config.modelListIntervalMinutes), inferenceIntervalMinutes: String(next.config.inferenceIntervalMinutes), bucketIntervalMinutes: String(next.config.bucketIntervalMinutes || 60) });
        const completedAt = kind === "models" ? next.config.lastModelListAt : next.config.lastInferenceAt;
        if (completedAt && completedAt !== previousAt) return true;
      }
    }
    return false;
  }
  async function run(path: string, init: RequestInit, message: string, probeKind?: "models" | "inference") {
    setSaving(true); setError(""); setNotice("");
    try {
      const previousAt = probeKind ? (probeKind === "models" ? view?.config?.lastModelListAt : view?.config?.lastInferenceAt) || null : null;
      await request(path, init);
      if (probeKind) {
        const completed = await refreshUntilProbeCompletes(probeKind, previousAt);
        setNotice(completed ? `${message}，数据已更新` : `${message}，Worker仍在执行，请稍后刷新`);
      } else {
        setNotice(message);
        await load();
      }
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "操作失败"); }
    finally { setSaving(false); }
  }
  function saveConfig(event: FormEvent) {
    event.preventDefault();
    if (!view?.canManageConfig) return;
    void run(resourcePath, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseUrl: draft.baseUrl, enabled: draft.enabled, modelListIntervalMinutes: Number(draft.modelListIntervalMinutes), inferenceIntervalMinutes: Number(draft.inferenceIntervalMinutes), bucketIntervalMinutes: Number(draft.bucketIntervalMinutes) }) }, "探测配置已保存");
  }
  function saveModels() {
    if (!view?.config || !view.canManageConfig) return;
    void run(`${resourcePath}/models`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ models: view.config.models.map((model) => ({ modelId: model.modelId, displayName: model.displayName, enabled: model.enabled })) }) }, "模型选择已保存");
  }
  function addCustomModel(event: FormEvent) {
    event.preventDefault();
    if (!view?.canManageConfig) return;
    const modelId = customModel.trim();
    if (!modelId || !view?.config || view.config.models.some((model) => model.modelId === modelId)) return;
    setView({ ...view, config: { ...view.config, models: [...view.config.models, { id: `custom-${modelId}`, modelId, displayName: modelId, enabled: false, status: "untested", lastCheckedAt: null, lastResponseMs: null, lastErrorCategory: null, buckets: [] }] } });
    setCustomModel("");
  }
  function updateModel(id: string, patch: Partial<ProbeModel>) {
    if (!view?.config || !view.canManageConfig) return;
    setView({ ...view, config: { ...view.config, models: view.config.models.map((model) => model.id === id ? { ...model, ...patch } : model) } });
  }
  const enabledCount = view?.config?.models.filter((model) => model.enabled).length || 0;
  const config = view?.config;
  return <>
    <button className="gateway-probe-trigger" type="button" title={`探测配置：${targetName}`} aria-label={`打开 ${targetName} 的探测配置`} onClick={() => void openPanel()}><Gear /><span>探测配置</span></button>
    {open && <div className="probe-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><section className="probe-modal" data-read-only={view ? !view.canManageConfig : undefined} role="dialog" aria-modal="true" aria-labelledby={`probe-title-${targetId}`}>
      <header className="probe-modal-head"><div><span className="kicker"><Sparkle />模型探测</span><h2 id={`probe-title-${targetId}`}>{targetName}</h2><p>只请求后台启用的公网 HTTPS OpenAI 兼容接口。</p></div><button className="icon-button" type="button" aria-label="关闭探测配置" onClick={() => setOpen(false)}><X /></button></header>
      {loading && !view ? <div className="probe-empty"><ArrowsClockwise className="spin" />正在读取配置</div> : <>
        <div className="probe-notices">{notice && <p className="admin-success"><CheckCircle />{notice}</p>}{error && <p className="admin-error"><WarningCircle />{error}</p>}</div>
        <form className="probe-config-form" onSubmit={saveConfig}>
          <label className="wide"><span>API Base URL <b>*</b></span><input required type="url" value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /><small>请填写实际 API 地址，不会自动使用赞助商落地页 URL。</small></label>
          <label><span>模型列表频率</span><select value={draft.modelListIntervalMinutes} onChange={(event) => setDraft({ ...draft, modelListIntervalMinutes: event.target.value })}><option value="1">每 1 分钟</option><option value="5">每 5 分钟</option><option value="15">每 15 分钟</option><option value="30">每 30 分钟</option><option value="60">每 1 小时</option><option value="360">每 6 小时</option><option value="1440">每 24 小时</option></select></label>
          <label><span>真实推理频率</span><select value={draft.inferenceIntervalMinutes} onChange={(event) => setDraft({ ...draft, inferenceIntervalMinutes: event.target.value })}><option value="1">每 1 分钟</option><option value="5">每 5 分钟</option><option value="15">每 15 分钟</option><option value="30">每 30 分钟</option><option value="60">每 1 小时</option><option value="360">每 6 小时</option><option value="1440">每 24 小时</option></select></label>
          <label><span>时间桶间隔</span><select value={draft.bucketIntervalMinutes} onChange={(event) => setDraft({ ...draft, bucketIntervalMinutes: event.target.value })}><option value="1">每 1 分钟</option><option value="5">每 5 分钟</option><option value="15">每 15 分钟</option><option value="30">每 30 分钟</option><option value="60">每 1 小时</option><option value="360">每 6 小时</option><option value="1440">每 24 小时</option></select><small>后台显示和前台监测页共用此粒度。</small></label>
          <label className="probe-switch"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /><span aria-hidden="true" /><strong>启用本站模型探测</strong></label>
          <button className="button dark" type="submit" disabled={saving}><CheckCircle />保存配置</button>
        </form>
        <section className="probe-key-section"><div><span className="kicker"><Key />凭据</span><h3>专用 API Key</h3><p>{config?.hasApiKey ? `已配置，末四位 ${config.apiKeyLastFour || "****"}` : "尚未配置，模型探测不会执行"}</p></div>{view?.canManageKey ? <div className="probe-key-actions"><input type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder="输入新 Key" autoComplete="new-password" /><button className="button ghost compact" disabled={saving || key.trim().length < 8} onClick={() => { void run(`${resourcePath}/key`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: key }) }, "Key 已加密保存"); setKey(""); }}><Key />替换 Key</button>{config?.hasApiKey && <button className="icon-button danger" type="button" title="清除 API Key" aria-label="清除 API Key" disabled={saving} onClick={() => void run(`${resourcePath}/key`, { method: "DELETE" }, "Key 已清除")}><Trash /></button>}</div> : <small className="probe-role-note"><EyeSlash />仅管理员可更换凭据</small>}</section>
        {config?.inferencePaused && <div className="probe-paused"><Pause /><span>真实推理已暂停：{errorLabel[config.pauseReason || ""] || "鉴权异常"}。模型列表检查仍会继续。</span><button className="button ghost compact" disabled={saving} onClick={() => void run(`${resourcePath}/resume`, { method: "POST" }, "真实推理已恢复")}>恢复推理</button></div>}
        <section className="probe-model-section"><div className="probe-section-head"><div><span className="kicker">模型管理</span><h3>发现并选择探测模型</h3><p>已启用 {enabledCount} / 10 个。手动发现只需保存 API Key，定时探测仍由上方开关控制。</p></div><div className="probe-actions"><button className="button ghost compact" disabled={saving || !config?.hasApiKey} title={!config?.hasApiKey ? "请先保存 API Key" : "立即发现模型"} onClick={() => void run(`${resourcePath}/run/models`, { method: "POST" }, "模型发现已排队", "models")}><ArrowsClockwise />发现模型</button><button className="button ghost compact" disabled={saving || !config?.enabled || !config?.hasApiKey || Boolean(config.inferencePaused)} onClick={() => void run(`${resourcePath}/run/inference`, { method: "POST" }, "真实推理已排队", "inference")}><Play />立即探测</button></div></div>
          {config?.models.length ? <div className="probe-model-table"><div className="probe-model-table-head"><span>启用</span><span>实际模型 ID / 展示名称</span><span>状态</span><span>最近一次</span></div>{config.models.map((model) => <div className="probe-model-entry" key={model.id}><div className="probe-model-row"><input type="checkbox" checked={model.enabled} disabled={!model.enabled && enabledCount >= 10} onChange={(event) => updateModel(model.id, { enabled: event.target.checked })} aria-label={`启用 ${model.modelId}`} /><div><strong title={model.modelId}>{model.modelId}</strong><input value={model.displayName} onChange={(event) => updateModel(model.id, { displayName: event.target.value })} aria-label={`${model.modelId} 展示名称`} /></div><span className={`probe-status ${model.status}`}>{statusLabel[model.status] || model.status}</span><small>{model.lastCheckedAt ? `${formatTime(model.lastCheckedAt)}${model.lastResponseMs === null ? "" : ` · ${model.lastResponseMs} ms`}` : model.lastErrorCategory ? errorLabel[model.lastErrorCategory] || "异常" : "暂无记录"}</small></div><ProbeTimeline buckets={model.buckets} intervalMinutes={config.bucketIntervalMinutes || 60} label={model.displayName} /></div>)}</div> : <div className="probe-empty"><Sparkle /><strong>尚未发现模型</strong><span>保存配置和 Key 后，点击发现模型。</span></div>}
          <form className="probe-custom-model" onSubmit={addCustomModel}><input value={customModel} onChange={(event) => setCustomModel(event.target.value)} placeholder="补充自定义模型 ID" maxLength={200} /><button className="button ghost compact" type="submit" disabled={!config}><Plus />添加模型</button><button className="button dark compact" type="button" disabled={saving || !config} onClick={saveModels}><CheckCircle />保存模型选择</button></form>
        </section>
        {config && <footer className="probe-modal-foot"><span>{config.lastModelListAt ? `列表检查：${formatTime(config.lastModelListAt)}` : "列表尚未检查"}</span><span>{config.lastInferenceAt ? `推理检查：${formatTime(config.lastInferenceAt)}` : "推理尚未检查"}</span></footer>}
      </>}
    </section></div>}
  </>;
}

function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value)); }
function ProbeTimeline({ buckets, intervalMinutes, label }: { buckets: ProbeBucket[]; intervalMinutes: number; label: string }) {
  const visibleBuckets = buckets.filter((bucket) => bucket.attempts > 0);
  if (!visibleBuckets.length) return <div className="probe-model-timeline"><span>暂无已记录的探测时间桶</span></div>;
  const unit = intervalMinutes >= 60 && intervalMinutes % 60 === 0 ? `每格 ${intervalMinutes / 60} 小时` : `每格 ${intervalMinutes} 分钟`;
  return <div className="probe-model-timeline"><ol style={{ gridTemplateColumns: `repeat(${Math.max(visibleBuckets.length, 1)}, minmax(2px, 1fr))` }} aria-label={`${label} 已记录的探测时间桶`}>{visibleBuckets.map((bucket) => <li key={bucket.startedAt} className={bucket.successRate === 100 ? "online" : bucket.successRate === 0 ? "offline" : "partial"} title={`${formatTime(bucket.startedAt)}，${bucket.successes}/${bucket.attempts} 次成功，成功率 ${bucket.successRate}%${bucket.averageResponseMs === null ? "" : `，平均 ${bucket.averageResponseMs} ms`}`} />)}</ol><span>{unit}</span></div>;
}
