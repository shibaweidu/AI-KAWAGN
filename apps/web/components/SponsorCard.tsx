import Link from "next/link";
import { ArrowRight, ArrowSquareOut, Megaphone } from "@phosphor-icons/react/dist/ssr";
import { MediaThumbnail } from "./MediaThumbnail";

export type SponsorCardItem = {
  id: string;
  title: string;
  description: string;
  url: string;
  thumbnailUrl?: string | null;
  imageUrl?: string | null;
  badge?: string | null;
  modelTags?: string[];
  pricingClaims?: string | null;
  probe?: { configured: boolean; status: "online" | "partial" | "offline" | "unconfigured"; availableModels: number; totalModels: number } | null;
  shop?: boolean;
};

export function SponsorCard({ item }: { item: SponsorCardItem }) {
  const image = item.thumbnailUrl ?? item.imageUrl ?? null;
  return <article className="gateway-sponsor-card">
    <MediaThumbnail value={image} label={item.title} kind="listing" className="gateway-sponsor-media" />
    <div className="gateway-sponsor-copy">
      <div className="gateway-sponsor-title"><h3>{item.title}</h3><span><Megaphone />赞助</span></div>
      {item.badge && <b>{item.badge}</b>}
      <p>{item.description || "详细服务信息请以赞助商网站为准。"}</p>
      {(item.modelTags?.length || item.pricingClaims || item.probe) && <div className="gateway-sponsor-meta">{item.modelTags?.map((tag) => <span key={tag}>{tag}</span>)}{item.pricingClaims && <b>{item.pricingClaims}</b>}{item.probe && <small className={`sponsor-probe ${item.probe.status}`}>{item.probe.status === "online" ? "探测在线" : item.probe.status === "partial" ? "部分异常" : item.probe.status === "offline" ? "探测异常" : "尚未配置"}{item.probe.configured && ` · ${item.probe.availableModels}/${item.probe.totalModels} 个模型可用`}</small>}</div>}
      <div className="gateway-sponsor-actions">{item.shop ? <a className="button dark compact" href={`/api/v1/go/shop-sponsor/${item.id}`} target="_blank" rel="noreferrer sponsored">访问店铺 <ArrowSquareOut /></a> : <><Link className="button ghost compact" href={`/gateways/sponsors/${item.id}`}>监测详情 <ArrowRight /></Link><a className="button dark compact" href={`/api/v1/go/listing/${item.id}`} target="_blank" rel="noreferrer sponsored">访问服务 <ArrowSquareOut /></a></>}</div>
    </div>
  </article>;
}
