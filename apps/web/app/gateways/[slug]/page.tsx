import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowSquareOut, Clock, ShieldWarning, ThumbsDown, ThumbsUp, WifiHigh, WifiSlash } from "@phosphor-icons/react/dist/ssr";
import type { GatewayDirectoryEntry, GatewayModelAvailability, GatewayMonitorHistory } from "@ai-card/contracts";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import { GatewayProbeAvailability } from "@/components/GatewayProbeAvailability";
import { serverApi } from "@/lib/server-api";

export const dynamic = "force-dynamic";
async function load(slug: string) { return serverApi<GatewayDirectoryEntry>(`/gateway-directory/${encodeURIComponent(slug)}`).catch(() => null); }
async function loadHistory(slug: string) { return serverApi<GatewayMonitorHistory>(`/gateway-directory/${encodeURIComponent(slug)}/checks`).catch(() => null); }
async function loadAvailability(slug: string) { return serverApi<GatewayModelAvailability>(`/gateway-directory/${encodeURIComponent(slug)}/model-availability`).catch(() => null); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const item = await load((await params).slug);
  return item ? { title: item.name, description: item.description.slice(0, 150) } : { title: "中转站不存在" };
}

export default async function GatewayDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const slug = (await params).slug;
  const item = await load(slug);
  if (!item) notFound();
  const [history, availability] = await Promise.all([item.monitoringAvailable ? loadHistory(slug) : null, loadAvailability(slug)]);
  return <main className="shell gateway-detail-page">
    <Link className="gateway-back-link" href="/gateways"><ArrowLeft />返回中转站目录</Link>
    <section className="gateway-detail-header"><MediaThumbnail value={item.logoUrl} label={item.name} kind="listing" /><div><div className="gateway-detail-title"><h1>{item.name}</h1></div><p>{item.providerType} · {sectionLabel(item.sourceSection)}</p><div className="gateway-detail-tags"><span className="gateway-claim-label">服务宣称</span>{item.modelTags.map((tag) => <span key={tag}>{tag}</span>)}{item.pricingClaims && <span>{item.pricingClaims}</span>}</div></div><a className="button dark" href={`/api/v1/go/gateway/${item.id}`} target="_blank" rel="noreferrer sponsored">访问中转站 <ArrowSquareOut /></a></section>
    <section className="gateway-detail-metrics"><div><span>站点连通状态</span><strong className={item.online === true ? "online" : item.online === false ? "offline" : ""}>{item.online === true ? <WifiHigh /> : item.online === false ? <WifiSlash /> : <Clock />}{item.online === true ? "在线" : item.online === false ? "离线" : "未检测"}</strong></div><div><span>站点 7 日可用率</span><strong>{item.availability7d === null ? "—" : `${item.availability7d}%`}</strong></div><div><span>站点平均响应</span><strong>{item.averageResponseMs === null ? "—" : `${item.averageResponseMs} ms`}</strong></div><div><span>来源站参考投票</span><strong><ThumbsUp />{item.upVotes}<ThumbsDown />{item.downVotes}</strong></div></section>
    <MonitorTimeline available={item.monitoringAvailable} history={history} />
    <GatewayProbeAvailability availability={availability} />
    <section className="gateway-detail-content"><div><span className="kicker">服务介绍</span><h2>服务说明</h2><p>{item.description || "暂未提供详细说明。"}</p></div><aside><ShieldWarning /><strong>交易与隐私提示</strong><p>本站仅展示公开目录信息，不代收款、不提供质量担保。建议首次少额充值，不要向不可信服务提交密钥、个人资料或敏感业务数据。</p></aside></section>
    <footer className="gateway-source-meta"><span>{item.sourceUpdatedAt ? "来源监测时间" : "信息更新时间"}：{formatDate(item.sourceUpdatedAt || item.lastSeenAt)}</span><span>{item.monitoringAvailable ? "监测数据来自授权公开源，仅代表站点连通性，不区分模型，也并非本站服务器实测" : "该站点由后台手动收录，尚未配置连通性监测"}</span></footer>
  </main>;
}

function MonitorTimeline({ available, history }: { available: boolean; history: GatewayMonitorHistory | null }) {
  const buckets = history?.buckets || [];
  return <section className="gateway-monitor-history" aria-labelledby="gateway-monitor-title">
    <header><div><span className="kicker">来源站监测</span><h2 id="gateway-monitor-title">站点连通性 · 最近 48 小时</h2><p>未区分 GPT、Claude、Gemini 等具体模型</p></div><div className="gateway-monitor-legend"><span className="online">正常</span><span className="offline">异常</span><span className="missing">无数据</span></div></header>
    {buckets.length ? <><ol aria-label="按小时统计的站点连通性记录，不区分具体模型">{buckets.map((bucket) => <li aria-label={bucketTitle(bucket)} className={bucket.online === true ? "online" : bucket.online === false ? "offline" : "missing"} key={bucket.startedAt} title={bucketTitle(bucket)} />)}</ol><div className="gateway-monitor-range"><time dateTime={buckets[0].startedAt}>{formatShortDate(buckets[0].startedAt)}</time><span>每格 1 小时</span><time dateTime={buckets.at(-1)?.startedAt}>{formatShortDate(buckets.at(-1)?.startedAt || "")}</time></div></> : <p className="gateway-monitor-empty">{available ? "来源监测记录暂时无法获取" : "该站点尚未配置连通性监测"}</p>}
  </section>;
}

function bucketTitle(bucket: GatewayMonitorHistory["buckets"][number]) {
  const status = bucket.online === true ? "正常" : bucket.online === false ? "异常" : "无数据";
  const response = bucket.responseMs === null ? "" : `，响应 ${bucket.responseMs} ms`;
  return `${formatDate(bucket.checkedAt || bucket.startedAt)}，${status}${response}`;
}

function sectionLabel(value: string) { return ({ "premium-stable": "稳定企业向", "ultra-cheap": "便宜个人向", "special-featured": "小有特色", new: "新站", all: "其他中转站", fom: "FOM 专区" } as Record<string, string>)[value] || value; }
function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value)); }
function formatShortDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", timeZone: "Asia/Shanghai" }).format(new Date(value)); }
