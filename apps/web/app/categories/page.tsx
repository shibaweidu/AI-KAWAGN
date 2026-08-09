import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Fire, MagnifyingGlass, SquaresFour } from "@phosphor-icons/react/dist/ssr";
import { serverApi } from "@/lib/server-api";

export const metadata: Metadata = { title: "商品分类" };
export const dynamic = "force-dynamic";
export default async function CategoriesPage() {
  const [categories, hot] = await Promise.all([
    serverApi<Array<{ slug: string; name: string; count: number }>>("/categories"),
    serverApi<{ hotSearches: string[] }>("/search/hot"),
  ]);
  return <><section className="page-hero"><div className="shell"><span className="kicker"><SquaresFour />分类导航</span><h1>商品分类</h1><p>分类数量来自当前已审核、有效的真实报价。</p><form className="category-search" action="/search"><MagnifyingGlass /><input name="q" placeholder="搜索平台或分类名称" aria-label="搜索分类" /><button className="button dark">查找分类</button></form>{hot.hotSearches.length > 0 && <nav className="hot-search category-hot-search" aria-label="热门搜索"><span><Fire />热门搜索</span>{hot.hotSearches.slice(0, 10).map((term) => <Link href={`/search?q=${encodeURIComponent(term)}`} key={term}>{term}</Link>)}</nav>}</div></section><section className="shell page-section"><div className="category-grid">{categories.map((item) => <Link className="category-card panel" href={`/search?category=${encodeURIComponent(item.name)}`} key={item.slug}><span>{Array.from(item.name)[0] || "AI"}</span><div><h2>{item.name}</h2><p>浏览该分类下已审核店铺的当前报价</p><small>{item.count.toLocaleString()} 个商品组</small></div><ArrowRight /></Link>)}</div>{!categories.length && <div className="panel empty-state"><SquaresFour /><h2>暂无已发布分类</h2><p>批准候选店铺及报价后，分类会自动生成。</p></div>}</section></>;
}
