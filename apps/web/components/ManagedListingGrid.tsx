import { ArrowSquareOut, CheckCircle } from "@phosphor-icons/react/dist/ssr";
import { MediaThumbnail } from "./MediaThumbnail";

export type ManagedListingItem = {
  id: string;
  type: "gateway" | "project";
  title: string;
  description: string;
  url: string;
  thumbnailUrl: string | null;
  badge: string | null;
  modelTags?: string[];
  pricingClaims?: string | null;
  probe?: { configured: boolean; status: "online" | "partial" | "offline" | "unconfigured"; availableModels: number; totalModels: number; lastCheckedAt: string | null } | null;
};

export function ManagedListingGrid({ items, emptyTitle, emptyDescription }: { items: ManagedListingItem[]; emptyTitle: string; emptyDescription: string }) {
  if (!items.length) return <div className="listing-empty"><strong>{emptyTitle}</strong><p>{emptyDescription}</p></div>;
  return <div className="managed-listing-grid">{items.map((item) => <article className="managed-listing-card" key={item.id}>
    <MediaThumbnail value={item.thumbnailUrl} label={item.title} kind="listing" />
    <div><div className="managed-listing-title"><h2>{item.title}</h2>{item.badge && <span>{item.badge}</span>}</div><p>{item.description || "详细信息请以项目官方网站为准。"}</p><small><CheckCircle weight="fill" />已通过平台展示审核</small></div>
    <a className="button ghost" href={item.url} target="_blank" rel="noreferrer">访问官网 <ArrowSquareOut /></a>
  </article>)}</div>;
}
