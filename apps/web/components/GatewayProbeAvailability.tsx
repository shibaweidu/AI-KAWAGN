"use client";

import { useEffect, useState } from "react";
import type { GatewayModelAvailability } from "@ai-card/contracts";

type Props = {
  availability: GatewayModelAvailability | null;
  title?: string;
  description?: string;
  refreshPath?: string;
};

export function GatewayProbeAvailability({ availability, title = "本站模型探测 · 最近 48 小时", description = "只展示后台明确配置并执行过的 OpenAI 兼容模型，不代表来源站宣传标签。", refreshPath }: Props) {
  const [current, setCurrent] = useState(availability);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => setCurrent(availability), [availability]);
  useEffect(() => {
    if (!refreshPath) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/v1${refreshPath}`, { cache: "no-store" });
        if (!response.ok) return;
        const payload = await response.json() as { availability?: GatewayModelAvailability };
        if (active && payload.availability) setCurrent(payload.availability);
      } catch { /* Keep the last successful probe snapshot on transient network errors. */ }
    };
    const timer = window.setInterval(refresh, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [refreshPath]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const granularityMinutes = current?.granularityMinutes || 60;
  const displayTitle = title.replace(/最近 48 小时|最近 48 分钟/, formatBucketWindow(granularityMinutes));
  const countdown = formatCountdown(current?.nextInferenceAt || null, now);
  return <section className="gateway-model-availability" aria-labelledby="gateway-model-title">
    <header><div><span className="kicker">本站真实探测</span><h2 id="gateway-model-title">{displayTitle}</h2><p>{description}</p></div><div className="gateway-probe-meta"><span className="gateway-probe-protocol">GET /v1/models · POST /v1/chat/completions</span>{current?.configured && <span className="gateway-probe-next">下次更新时间：{countdown}</span>}</div></header>
    {!current?.configured ? <p className="gateway-monitor-empty">尚未配置本站模型探测</p> : !current.models.length ? <p className="gateway-monitor-empty">探测已配置，尚无完成过真实推理的模型</p> : <div className="gateway-model-list">{current.models.map((model) => { const buckets = model.buckets; return <article className="gateway-model-card" key={model.id}><div className="gateway-model-head"><div><strong title={model.modelId}>{model.displayName}</strong><code>{model.modelId}</code></div><span className={`probe-status ${model.status}`}>{modelStatusLabel(model.status)}</span></div><dl><div><dt>最近检测</dt><dd>{model.lastCheckedAt ? formatDate(model.lastCheckedAt) : "—"}</dd></div><div><dt>响应时间</dt><dd>{model.lastResponseMs === null ? "—" : `${model.lastResponseMs} ms`}</dd></div><div><dt>公开错误</dt><dd>{model.errorCategory ? probeErrorLabel(model.errorCategory) : "无"}</dd></div></dl>{buckets.length ? <ol className="gateway-probe-buckets" aria-label={`${model.displayName} 最近 60 个探测时间桶`}>{buckets.map((bucket) => <li key={bucket.startedAt} className={bucket.attempts === 0 ? undefined : bucket.successRate === 100 ? "online" : bucket.successRate === 0 ? "offline" : "partial"} title={probeBucketTitle(bucket)} />)}</ol> : <p className="gateway-monitor-no-buckets">暂无已记录的探测时间桶</p>}<div className="gateway-monitor-range"><span>{model.lastSuccessAt ? `最近成功 ${formatShortDate(model.lastSuccessAt)}` : "尚无成功记录"}</span><span>{formatInterval(granularityMinutes)} · 自动刷新</span></div></article>; })}</div>}
  </section>;
}

function modelStatusLabel(value: string) { return ({ untested: "未探测", available: "可用", degraded: "波动", unavailable: "不可用", protocol_unsupported: "协议不支持" } as Record<string, string>)[value] || value; }
function probeErrorLabel(value: string) { return ({ timeout: "超时", rate_limited: "限流", authentication: "鉴权异常", quota_exhausted: "额度不足", model_unavailable: "模型不可用", upstream_error: "上游异常", protocol_error: "协议异常", network_error: "网络异常" } as Record<string, string>)[value] || "异常"; }
function probeBucketTitle(bucket: GatewayModelAvailability["models"][number]["buckets"][number]) { return `${formatShortDate(bucket.startedAt)}，${bucket.attempts ? `${bucket.successes}/${bucket.attempts} 次成功，成功率 ${bucket.successRate}%` : "无记录"}${bucket.averageResponseMs === null ? "" : `，平均 ${bucket.averageResponseMs} ms`}`; }
function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value)); }
function formatShortDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Shanghai" }).format(new Date(value)); }
function formatInterval(minutes: number) { return minutes >= 60 && minutes % 60 === 0 ? `每格 ${minutes / 60} 小时` : `每格 ${minutes} 分钟`; }
function formatBucketWindow(intervalMinutes: number) {
  const totalMinutes = intervalMinutes * 60;
  if (totalMinutes % (24 * 60) === 0) return `最近 ${totalMinutes / (24 * 60)} 天`;
  if (totalMinutes % 60 === 0) return `最近 ${totalMinutes / 60} 小时`;
  return `最近 ${totalMinutes} 分钟`;
}
function formatCountdown(value: string | null, now: number) {
  if (!value) return "等待探测";
  const remaining = new Date(value).getTime() - now;
  if (remaining <= 0) return "即将更新";
  const totalSeconds = Math.ceil(remaining / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}分${String(seconds).padStart(2, "0")}秒` : `${seconds}秒`;
}
