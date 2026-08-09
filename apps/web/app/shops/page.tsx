import type { Metadata } from "next";
import Link from "next/link";
import { ListBullets, MagnifyingGlass, SquaresFour, Storefront } from "@phosphor-icons/react/dist/ssr";
import { ShopRow, type ShopRowModel } from "@/components/ShopRow";
import { serverApi } from "@/lib/server-api";

export const metadata: Metadata = { title: "全部店铺" };
export const dynamic = "force-dynamic";
type ShopPage = { items: ShopRowModel[]; total: number; page: number; pageSize: number; totalPages: number };
export default async function ShopsPage({ searchParams }: { searchParams: Promise<{ q?: string; sort?: string; page?: string; view?: string }> }) {
  const { q = "", sort = "newest", page = "1", view: rawView } = await searchParams;
  const view = rawView === "list" ? "list" : "grid";
  const query = new URLSearchParams({ q, sort, page, pageSize: "20" });
  const result = await serverApi<ShopPage>(`/shops?${query}`);
  const pageHref = (nextPage: number) => `/shops?${new URLSearchParams({ q, sort, page: String(nextPage), view })}`;
  const viewHref = (nextView: "grid" | "list") => `/shops?${new URLSearchParams({ q, sort, page, view: nextView })}`;
  return <><section className="page-hero"><div className="shell"><span className="kicker"><Storefront />已审核商家</span><h1>全部店铺</h1><p>只展示经过人工审核并已正式发布的店铺，默认按发布时间排序。</p><form className="category-search" action="/shops"><MagnifyingGlass /><input name="q" defaultValue={q} placeholder="搜索店铺名称" aria-label="搜索店铺" /><input type="hidden" name="sort" value={sort} /><input type="hidden" name="view" value={view} /><button className="button dark">搜索店铺</button></form></div></section><section className="shell page-section"><div className={`all-shops shop-collection is-${view}`}><div className="all-shops-head"><div><strong>{result.total.toLocaleString("zh-CN")} 家店铺</strong><span>资料与报价以最近一次来源观测为准</span></div><nav className="shop-view-switcher" aria-label="店铺展示方式"><Link className={view === "grid" ? "active" : ""} href={viewHref("grid")} aria-current={view === "grid" ? "page" : undefined} title="网格展示"><SquaresFour /><span>网格</span></Link><Link className={view === "list" ? "active" : ""} href={viewHref("list")} aria-current={view === "list" ? "page" : undefined} title="列表展示"><ListBullets /><span>列表</span></Link></nav></div>{result.items.map((shop, index) => <ShopRow shop={shop} rank={(result.page - 1) * result.pageSize + index + 1} key={shop.id} />)}{!result.items.length && <div className="empty-state shop-empty"><Storefront /><h2>暂无已发布店铺</h2><p>候选店铺经运营审核后才会显示在这里。</p></div>}</div>{result.totalPages > 1 && <nav className="offer-pagination" aria-label="店铺分页">{result.page > 1 && <Link className="button ghost compact" href={pageHref(result.page - 1)}>上一页</Link>}<span>第 {result.page} / {result.totalPages} 页</span>{result.page < result.totalPages && <Link className="button ghost compact" href={pageHref(result.page + 1)}>下一页</Link>}</nav>}</section></>;
}
