import type { Metadata } from "next";
import Link from "next/link";
import { ArrowSquareOut, ArrowsLeftRight, Funnel, MagnifyingGlass, SlidersHorizontal, WifiHigh, WifiSlash } from "@phosphor-icons/react/dist/ssr";
import type { GatewayDirectoryPage, SearchAdPage } from "@ai-card/contracts";
import { ProductCard } from "@/components/ProductCard";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import { SearchAdCard } from "@/components/SearchAdCard";
import { serverApi } from "@/lib/server-api";

export const metadata: Metadata = { title: "搜索货源" };
export const dynamic = "force-dynamic";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; sort?: string; page?: string }> }) {
  const params = await searchParams;
  const q = (params.q || "").trim();
  const category = params.category || "";
  const sort = params.sort === "newest" ? "newest" : "price_asc";
  const query = new URLSearchParams({ q, category, sort, page: params.page || "1", pageSize: "20" });
  const gatewayQuery = new URLSearchParams({ q, page: "1", pageSize: "6", sort: "featured" });
  const [results, categories, gateways] = await Promise.all([
    serverApi<SearchAdPage>(`/search?${query}`),
    serverApi<Array<{ slug: string; name: string; count: number }>>("/categories"),
    q ? serverApi<GatewayDirectoryPage>(`/gateway-directory?${gatewayQuery}`).catch(() => null) : Promise.resolve(null),
  ]);
  const categoryHref = (nextCategory = "") => {
    const next = new URLSearchParams({ q, sort });
    if (nextCategory) next.set("category", nextCategory);
    return `/search?${next.toString()}`;
  };

  return <>
    <section className="search-header"><div className="shell"><form className="search-bar" action="/search"><MagnifyingGlass /><input name="q" defaultValue={q} aria-label="搜索商品和中转站" placeholder="输入商品、模型或中转站..." /><button className="button dark">搜索</button></form></div></section>
    <section className="shell search-layout">
      <aside className="filter-panel panel"><div className="filter-title"><Funnel /><strong>筛选条件</strong></div><div className="filter-group"><span>商品分类</span><div className="filter-category-scroll" aria-label="商品分类筛选"><Link className={!category ? "active" : ""} href={categoryHref()}>全部商品 <b>{results.total}</b></Link>{categories.map((item) => <Link className={category === item.name ? "active" : ""} href={categoryHref(item.name)} key={item.slug}>{item.name}<b>{item.count}</b></Link>)}</div></div></aside>
      <div className="search-results">
        {gateways && gateways.items.length > 0 && <section className="search-gateway-results">
          <div className="results-head compact"><div><span className="kicker"><ArrowsLeftRight />中转站</span><h2>相关中转站</h2><p>找到 {gateways.total} 条已审核目录记录</p></div><Link href={`/gateways?q=${encodeURIComponent(q)}`}>查看全部</Link></div>
          <div>{gateways.items.map((item) => <article key={item.id}>
            <MediaThumbnail value={item.logoUrl} label={item.name} kind="listing" />
            <div><Link href={`/gateways/${item.slug}`}>{item.name}</Link><p>{item.description || "暂无服务说明"}</p><span className={item.online === true ? "online" : item.online === false ? "offline" : ""}>{item.online === true ? <WifiHigh /> : <WifiSlash />}{item.online === true ? "在线" : item.online === false ? "离线" : "未检测"}{item.availability7d !== null && ` · ${item.availability7d}%`}</span></div>
            <a className="icon-button" href={`/api/v1/go/gateway/${item.id}`} target="_blank" rel="noreferrer sponsored" aria-label={`访问 ${item.name}`}><ArrowSquareOut /></a>
          </article>)}</div>
        </section>}
        <div className="results-head"><div><span className="kicker"><MagnifyingGlass />真实报价</span><h1>{q ? `“${q}”的商品结果` : "全部商品"}</h1><p>共找到 <strong>{results.total}</strong> 个同款商品组</p></div><form action="/search"><input type="hidden" name="q" value={q} /><input type="hidden" name="category" value={category} /><SlidersHorizontal /><select name="sort" defaultValue={sort} aria-label="排序方式"><option value="price_asc">低价优先</option><option value="newest">最近更新</option></select><button className="visually-hidden">应用排序</button></form></div>
        {results.ad && <SearchAdCard ad={results.ad} standalone />}
        {results.items.length ? <div className="product-grid">{results.items.map((group) => <ProductCard product={{ id: group.productId, slug: group.productSlug, title: group.productName, summary: "", thumbnailUrl: group.productThumbnailUrl, category: group.category, specification: group.specification, lowestPrice: group.lowestPrice, highestPrice: group.highestPrice, offerCount: group.offerCount }} key={group.productId} />)}</div> : <div className="panel empty-state"><MagnifyingGlass size={34} /><h2>没有找到相关商品</h2><p>当前只展示已经人工审核发布的真实报价。</p></div>}
      </div>
    </section>
  </>;
}
