import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CaretLeft, CaretRight, CheckCircle, Clock, Storefront } from "@phosphor-icons/react/dist/ssr";
import { FollowButton } from "@/components/FollowButton";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import { serverApi } from "@/lib/server-api";
import { ShopCategoryNavigator } from "@/components/ShopCategoryNavigator";

export const dynamic = "force-dynamic";
type ShopDetail = {
  id: string; slug: string; name: string; description: string; logo: string;
  productCount: number; lowestPrice: number; highestPrice?: number; aggregateStock?: number | null;
  categories: string[]; dataLevel: "offers" | "directory" | "profile"; syncedAt: string; verified: boolean;
  sourceName?: string;
  categoryStats: Array<{ name: string; productCount: number | null }>;
  productPage: { page: number; pageSize: number; total: number; totalPages: number; category: string | null };
  products: Array<{ id: string; slug: string; title: string; summary: string; thumbnailUrl?: string | null; category: string; price: number; stock: number | null; sourceName: string }>;
};

async function load(slug: string, query?: { category?: string; page?: number }) { try { const search = new URLSearchParams(); if (query?.category) search.set("category", query.category); if (query?.page && query.page > 1) search.set("page", String(query.page)); search.set("pageSize", "20"); return await serverApi<ShopDetail>(`/shops/${encodeURIComponent(slug)}?${search.toString()}`); } catch { return null; } }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> { const { slug } = await params; const shop = await load(slug); return { title: shop?.name || "店铺" }; }

export default async function ShopPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ category?: string | string[]; page?: string | string[] }> }) {
  const { slug } = await params;
  const rawQuery = await searchParams;
  const category = typeof rawQuery.category === "string" ? rawQuery.category.slice(0, 100) : undefined;
  const requestedPage = typeof rawQuery.page === "string" ? Number(rawQuery.page) : 1;
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const shop = await load(slug, { category, page });
  if (!shop) notFound();
  const directory = shop.dataLevel === "directory";
  return <>
    <section className="shop-hero"><div className="shell">
      <Link className="back-link" href="/shops"><ArrowLeft />返回全部店铺</Link>
      <div className="shop-hero-card">
        <MediaThumbnail value={shop.logo} label={shop.name} kind="shop" className="hero-logo" />
        <div className="shop-hero-info"><span className="kicker"><CheckCircle weight="fill" />已认证店铺</span><h1>{shop.name}</h1><p>{directory ? "已收录链动小店目录汇总，交易、库存和交付信息请在原店确认。" : shop.description}</p>{shop.categories.length > 0 && <div className="shop-category-tags hero-categories" aria-label="主要商品分类">{shop.categories.slice(0, 5).map((category) => <span key={category}>{category}</span>)}</div>}<div className="shop-meta"><span><Storefront />{shop.productCount.toLocaleString("zh-CN")} 件{directory ? "目录" : "在售"}商品</span><span><CheckCircle weight="fill" />平台已认证</span><span><Clock />{formatTime(shop.syncedAt)} 更新</span></div></div>
        <div className="shop-hero-actions"><FollowButton shopId={shop.id} /><a className="button ghost" href={`/api/v1/go/shop/${shop.id}`} target="_blank" rel="noreferrer">前往店铺 <ArrowUpRight /></a></div>
      </div>
    </div></section>
    <section className="shell page-section">
      <div className="shop-summary-grid"><div><span>认证状态</span><strong className="verified-summary"><CheckCircle weight="fill" />已认证</strong></div><div><span>{directory ? "目录价格区间" : "店内起价"}</span><strong className="price">¥{shop.lowestPrice.toFixed(2)}{directory && shop.highestPrice !== undefined ? ` – ¥${shop.highestPrice.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}` : ""}</strong></div><div><span>{directory ? "目录商品" : "在售商品"}</span><strong>{shop.productCount.toLocaleString("zh-CN")}</strong></div><div><span>{directory ? "汇总库存" : "数据来源"}</span><strong>{directory ? shop.aggregateStock?.toLocaleString("zh-CN") || "—" : shop.sourceName || "链动小店"}</strong></div></div>
      <div className="section-title"><div><span className="kicker"><Storefront />店铺货架</span><h2>{directory ? "目录分类" : shop.productPage.category || "全部商品"}</h2></div><span>{directory ? `${shop.categoryStats.length} 个分类` : `共 ${shop.productPage.total.toLocaleString("zh-CN")} 件商品`} · {formatTime(shop.syncedAt)} 更新</span></div>
      <ShopCategoryNavigator slug={shop.slug} categories={shop.categoryStats} activeCategory={shop.productPage.category} totalProducts={shop.productCount} />
      <div className="shop-products" id="shop-products">{shop.products.length ? shop.products.map((product) => <article className="shop-product panel" key={product.id}><MediaThumbnail value={product.thumbnailUrl} label={product.title} kind="product" /><div><span>{product.category}</span><h3>{product.title}</h3><p>{product.summary || "商品详情请前往比价页查看"}</p></div><strong className="price">¥{product.price.toFixed(2)}<small>库存 {product.stock ?? "来源未提供"}</small></strong><Link className="button dark compact" href={`/products/${product.slug}`}>查看商品</Link></article>) : directory ? <section className="directory-detail compact"><div><span className="kicker"><Storefront />目录汇总</span><h2>{shop.productCount.toLocaleString("zh-CN")} 件商品已收录</h2><p>分类已收纳到上方分类导航中。当前快照尚未包含可独立核验的单品报价。</p></div><div className="directory-detail-note"><strong>{shop.categoryStats.length.toLocaleString("zh-CN")}</strong><span>个商品分类</span></div><a className="button dark" href={`/api/v1/go/shop/${shop.id}`} target="_blank" rel="noreferrer">前往原店查看商品 <ArrowUpRight /></a></section> : shop.productPage.category ? <div className="panel empty-state"><h2>该分类暂无商品</h2><p>分类可能已调整，返回全部商品继续浏览。</p><Link className="button dark" href={`/shops/${shop.slug}#shop-products`}>查看全部商品</Link></div> : <div className="panel empty-state"><h2>暂无已发布商品</h2><p>链动小店数据完成审核后会显示在这里。</p></div>}</div>
      {!directory && shop.productPage.totalPages > 1 && <ShopPagination slug={shop.slug} category={shop.productPage.category} page={shop.productPage.page} totalPages={shop.productPage.totalPages} />}
    </section>
  </>;
}

function ShopPagination({ slug, category, page, totalPages }: { slug: string; category: string | null; page: number; totalPages: number }) {
  const href = (nextPage: number) => { const query = new URLSearchParams(); if (category) query.set("category", category); if (nextPage > 1) query.set("page", String(nextPage)); const value = query.toString(); return `/shops/${slug}${value ? `?${value}` : ""}#shop-products`; };
  return <nav className="shop-product-pagination" aria-label="店铺商品分页"><Link className={page <= 1 ? "button ghost compact is-disabled" : "button ghost compact"} href={href(Math.max(1, page - 1))} aria-disabled={page <= 1} scroll={false}><CaretLeft />上一页</Link><span>第 <strong>{page}</strong> / {totalPages} 页</span><Link className={page >= totalPages ? "button ghost compact is-disabled" : "button ghost compact"} href={href(Math.min(totalPages, page + 1))} aria-disabled={page >= totalPages} scroll={false}>下一页<CaretRight /></Link></nav>;
}

function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value)); }
