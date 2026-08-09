import Link from "next/link";
import { CheckCircle, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { MediaThumbnail } from "./MediaThumbnail";

export type ShopRowModel = { id: string; slug: string; name: string; logo: string; productCount: number; lowestPrice: number; highestPrice?: number; aggregateStock?: number | null; categories?: string[]; dataLevel?: "offers" | "directory" | "profile"; verified: boolean; syncedAt: string; sourceName?: string };
export function ShopRow({ shop, rank }: { shop: ShopRowModel; rank: number }) {
  const directory = shop.dataLevel === "directory";
  const categories = (shop.categories || []).slice(0, 5);
  return <article className="shop-row"><span className="rank">{rank}</span><MediaThumbnail value={shop.logo} label={shop.name} kind="shop" /><div className="shop-info"><strong>{shop.name}<CheckCircle weight="fill" aria-label="已认证" /></strong><small>{shop.productCount.toLocaleString("zh-CN")} 件{directory ? "目录" : "在售"}商品 · 更新于 {formatTime(shop.syncedAt)}</small>{categories.length > 0 && <div className="shop-category-tags" aria-label="主要商品分类">{categories.map((category) => <span key={category}>{category}</span>)}</div>}</div><div className="shop-price"><b>¥{shop.lowestPrice.toFixed(2)}</b><small>{directory ? "目录起价" : "店内起价"}</small></div><Link className="button dark compact" href={`/shops/${shop.slug}`}>查看 <ArrowUpRight /></Link></article>;
}
function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value)); }
