import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowSquareOut, Megaphone, ShieldWarning } from "@phosphor-icons/react/dist/ssr";
import type { ManagedListingProbeDetail } from "@ai-card/contracts";
import { GatewayProbeAvailability } from "@/components/GatewayProbeAvailability";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import { serverApi } from "@/lib/server-api";

export const dynamic = "force-dynamic";

async function load(id: string) {
  return serverApi<ManagedListingProbeDetail>(`/listings/${encodeURIComponent(id)}/probe`).catch(() => null);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const detail = await load((await params).id);
  return detail ? { title: `${detail.listing.title}监测详情`, description: detail.listing.description.slice(0, 150) } : { title: "赞助商不存在" };
}

export default async function SponsorGatewayDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id;
  const detail = await load(id);
  if (!detail) notFound();
  const { listing, availability } = detail;
  return <main className="shell gateway-detail-page sponsor-detail-page">
    <Link className="gateway-back-link" href="/gateways"><ArrowLeft />返回中转站目录</Link>
    <section className="sponsor-detail-header">
      <MediaThumbnail value={listing.thumbnailUrl} label={listing.title} kind="listing" className="sponsor-detail-media" />
      <div className="sponsor-detail-heading"><span className="kicker"><Megaphone />合作推广</span><div className="gateway-detail-title"><h1>{listing.title}</h1>{listing.badge && <span>{listing.badge}</span>}</div><div className="gateway-detail-tags"><span className="gateway-claim-label">赞助商</span>{listing.modelTags.map((tag) => <span key={tag}>{tag}</span>)}{listing.pricingClaims && <span>{listing.pricingClaims}</span>}</div></div>
      <a className="button dark" href={`/api/v1/go/listing/${listing.id}`} target="_blank" rel="noreferrer sponsored">访问服务 <ArrowSquareOut /></a>
    </section>
    <section className="sponsor-detail-content"><div><span className="kicker">服务介绍</span><h2>完整说明</h2><p>{listing.description || "暂未提供详细说明。"}</p></div><aside><ShieldWarning /><strong>使用提示</strong><p>本站仅展示赞助商提供的信息和本站探测结果，不代表平台对服务质量、隐私或交易作出担保。</p></aside></section>
    <GatewayProbeAvailability availability={availability} refreshPath={`/listings/${encodeURIComponent(listing.id)}/probe`} title="本站模型探测 · 最近 48 小时" description="时间桶按后台配置的间隔聚合；页面会自动刷新探测状态。" />
    <footer className="gateway-source-meta"><span>信息更新时间：{formatDate(listing.updatedAt)}</span><span>模型探测数据由本站后台定时任务生成</span></footer>
  </main>;
}

function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value)); }
