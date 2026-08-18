import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CaretLeft, CaretRight, ListBullets, MagnifyingGlass, SquaresFour, Storefront } from "@phosphor-icons/react/dist/ssr";
import { ShopRow, type ShopRowModel } from "@/components/ShopRow";
import { serverApi } from "@/lib/server-api";
import { ShopSponsorGrid, type ShopSponsor } from "@/components/ShopSponsorGrid";

export const metadata: Metadata = { title: "全部店铺" };
export const dynamic = "force-dynamic";
type ShopPage = { items: ShopRowModel[]; total: number; page: number; pageSize: number; totalPages: number; sponsors: ShopSponsor[] };
const PAGE_SIZE_OPTIONS = [18, 24, 30, 36, 48] as const;
const DEFAULT_PAGE_SIZE = PAGE_SIZE_OPTIONS[0];

export default async function ShopsPage({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string; page?: string; view?: string }> }) {
  const { q = "", sort = "newest", page = "1", pageSize: rawPageSize, view: rawView } = await searchParams as { q?: string; sort?: string; page?: string; pageSize?: string; view?: string };
  const view = rawView === "list" ? "list" : "grid";
  const requestedPageSize = Number(rawPageSize);
  const pageSize = PAGE_SIZE_OPTIONS.includes(requestedPageSize as typeof PAGE_SIZE_OPTIONS[number]) ? requestedPageSize : DEFAULT_PAGE_SIZE;
  const requestedPage = Number(page);
  const currentPage = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const query = new URLSearchParams({ q, sort, page: String(currentPage), pageSize: String(pageSize) });
  const result = await serverApi<ShopPage>(`/shops?${query}`);
  const pageHref = (nextPage: number) => `/shops?${new URLSearchParams({ q, sort, page: String(nextPage), pageSize: String(pageSize), view })}`;
  const viewHref = (nextView: "grid" | "list") => `/shops?${new URLSearchParams({ q, sort, page: String(result.page), pageSize: String(pageSize), view: nextView })}`;
  return <><section className="page-hero"><div className="shell"><span className="kicker"><Storefront />已审核商家</span><h1>全部店铺</h1><p>只展示经过人工审核并已正式发布的店铺，默认按发布时间排序。</p><form className="category-search" action="/shops"><MagnifyingGlass /><input name="q" defaultValue={q} placeholder="搜索店铺名称" aria-label="搜索店铺" /><input type="hidden" name="sort" value={sort} /><input type="hidden" name="pageSize" value={pageSize} /><input type="hidden" name="view" value={view} /><button className="button dark">搜索店铺</button></form></div></section><section className="shell page-section"><ShopSponsorGrid items={result.sponsors || []} /><div className={`all-shops shop-collection is-${view}`}><div className="all-shops-head"><div><strong>{result.total.toLocaleString("zh-CN")} 家店铺</strong><span>资料与报价以最近一次来源观测为准</span></div><nav className="shop-view-switcher" aria-label="店铺展示方式"><Link className={view === "grid" ? "active" : ""} href={viewHref("grid")} aria-current={view === "grid" ? "page" : undefined} title="网格展示"><SquaresFour /><span>网格</span></Link><Link className={view === "list" ? "active" : ""} href={viewHref("list")} aria-current={view === "list" ? "page" : undefined} title="列表展示"><ListBullets /><span>列表</span></Link></nav></div>{result.items.map((shop, index) => <ShopRow shop={shop} rank={(result.page - 1) * result.pageSize + index + 1} key={shop.id} />)}{!result.items.length && <div className="empty-state shop-empty"><Storefront /><h2>暂无已发布店铺</h2><p>候选店铺经运营审核后才会显示在这里。</p></div>}</div>{result.totalPages > 1 && <ShopPagination query={{ q, sort, view }} page={result.page} pageSize={pageSize} totalPages={result.totalPages} pageHref={pageHref} />}</section></>;
}

function ShopPagination({ query, page, pageSize, totalPages, pageHref }: { query: { q: string; sort: string; view: "grid" | "list" }; page: number; pageSize: number; totalPages: number; pageHref: (page: number) => string }) {
  return <div className="shop-pagination-wrap"><nav className="offer-pagination" aria-label="店铺分页"><Link className={page <= 1 ? "button ghost compact is-disabled" : "button ghost compact"} href={pageHref(Math.max(1, page - 1))} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined}><CaretLeft />上一页</Link><span>第 <strong>{page}</strong> / {totalPages} 页</span><Link className={page >= totalPages ? "button ghost compact is-disabled" : "button ghost compact"} href={pageHref(Math.min(totalPages, page + 1))} aria-disabled={page >= totalPages} tabIndex={page >= totalPages ? -1 : undefined}>下一页<CaretRight /></Link></nav><form className="shop-pagination-tools shop-page-size-form" action="/shops" method="get"><input type="hidden" name="q" value={query.q} /><input type="hidden" name="sort" value={query.sort} /><input type="hidden" name="view" value={query.view} /><input type="hidden" name="page" value="1" /><label>每页<select name="pageSize" defaultValue={String(pageSize)} aria-label="每页店铺数量">{PAGE_SIZE_OPTIONS.map((size) => <option value={size} key={size}>{size} 家</option>)}</select></label><button className="button ghost compact" type="submit">应用</button></form><form className="shop-pagination-tools shop-page-jump-form" action="/shops" method="get"><input type="hidden" name="q" value={query.q} /><input type="hidden" name="sort" value={query.sort} /><input type="hidden" name="view" value={query.view} /><input type="hidden" name="pageSize" value={pageSize} /><label>跳转到<input name="page" type="number" min="1" max={totalPages} defaultValue={page} inputMode="numeric" aria-label={`跳转到第 ${page} 页`} /></label><button className="button ghost compact" type="submit">跳转<ArrowRight /></button></form></div>;
}
