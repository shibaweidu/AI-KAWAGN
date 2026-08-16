import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CaretLeft, CaretRight, Fire, SquaresFour } from "@phosphor-icons/react/dist/ssr";
import { categoryGroupIdSchema, type CategoryBrowsePage, type CategoryGroupId } from "@ai-card/contracts";
import { CategorySearch } from "@/components/CategorySearch";
import { serverApi } from "@/lib/server-api";

export const metadata: Metadata = { title: "商品分类" };
export const dynamic = "force-dynamic";
const PAGE_SIZES = [18, 36, 60] as const;

type Params = { q?: string; group?: string; page?: string; pageSize?: string };

export default async function CategoriesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const raw = await searchParams;
  const q = String(raw.q || "").trim().slice(0, 100);
  const parsedGroup = categoryGroupIdSchema.safeParse(raw.group);
  const group: CategoryGroupId = parsedGroup.success ? parsedGroup.data : "all";
  const requestedPage = Number(raw.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const requestedPageSize = Number(raw.pageSize);
  const pageSize = PAGE_SIZES.includes(requestedPageSize as typeof PAGE_SIZES[number]) ? requestedPageSize : 18;
  const query = new URLSearchParams({ q, group, page: String(page), pageSize: String(pageSize) });
  const [result, hot] = await Promise.all([
    serverApi<CategoryBrowsePage>(`/categories/browse?${query}`),
    serverApi<{ hotSearches: string[] }>("/search/hot"),
  ]);
  const href = (changes: Partial<{ q: string; group: CategoryGroupId; page: number; pageSize: number }>) => {
    const params = new URLSearchParams({ q, group, page: String(result.page), pageSize: String(pageSize) });
    for (const [key, value] of Object.entries(changes)) {
      if (value === "" || value === undefined) params.delete(key); else params.set(key, String(value));
    }
    if (changes.q !== undefined || changes.group !== undefined || changes.pageSize !== undefined) params.delete("page");
    if (!params.get("q")) params.delete("q");
    if (params.get("group") === "all") params.delete("group");
    if (params.get("page") === "1") params.delete("page");
    if (params.get("pageSize") === "18") params.delete("pageSize");
    return `/categories${params.size ? `?${params}` : ""}`;
  };

  return <main className="category-page">
    <section className="page-hero category-page-hero"><div className="shell">
      <span className="kicker"><SquaresFour />分类导航</span>
      <h1>商品分类</h1>
      <p>按平台、用途和服务类型快速定位已收录商品。</p>
      <CategorySearch initialValue={q} />
      {hot.hotSearches.length > 0 && <nav className="hot-search category-hot-search" aria-label="热门搜索"><span><Fire />热门搜索</span>{hot.hotSearches.slice(0, 10).map((term) => <Link href={`/search?q=${encodeURIComponent(term)}`} key={term}>{term}</Link>)}</nav>}
    </div></section>

    <section className="shell category-page-section">
      {!q && group === "all" && result.popular.length > 0 && <section className="category-popular" aria-labelledby="popular-category-title">
        <div className="category-section-head"><div><span className="kicker">高频分类</span><h2 id="popular-category-title">热门分类</h2></div><span>按已发布商品组数量排序</span></div>
        <div className="category-popular-grid">{result.popular.map((item) => <Link href={`/search?category=${encodeURIComponent(item.name)}`} key={item.slug}><span title={item.name}>{item.name}</span><small>{item.count.toLocaleString("zh-CN")} 个商品组</small><ArrowRight /></Link>)}</div>
      </section>}

      <section className="category-directory" aria-labelledby="category-directory-title">
        <div className="category-section-head category-directory-head"><div><span className="kicker">分类目录</span><h2 id="category-directory-title">全部细分类</h2></div><span>找到 {result.total.toLocaleString("zh-CN")} 个分类</span></div>
        <nav className="category-group-tabs" aria-label="一级分类">
          {result.groups.map((item) => <Link className={group === item.id ? "is-active" : ""} aria-current={group === item.id ? "page" : undefined} href={href({ group: item.id })} key={item.id}><span>{item.name}</span><small>{item.categoryCount.toLocaleString("zh-CN")}</small></Link>)}
        </nav>

        {result.items.length > 0 ? <div className="category-compact-grid">{result.items.map((item) => <Link href={`/search?category=${encodeURIComponent(item.name)}`} key={item.slug} title={item.name}><span>{item.name}</span><small>{item.count.toLocaleString("zh-CN")} 个商品组</small><ArrowRight /></Link>)}</div> : <div className="category-empty"><SquaresFour /><h2>没有匹配的分类</h2><p>尝试更换关键词或查看全部一级分类。</p><Link className="button dark" href="/categories">查看全部分类</Link></div>}

        {result.totalPages > 1 && <CategoryPagination result={result} href={href} q={q} group={group} />}
      </section>
    </section>
  </main>;
}

function CategoryPagination({ result, href, q, group }: { result: CategoryBrowsePage; href: (changes: Partial<{ q: string; group: CategoryGroupId; page: number; pageSize: number }>) => string; q: string; group: CategoryGroupId }) {
  const pages = pageWindow(result.page, result.totalPages);
  return <div className="category-pagination-wrap">
    <nav className="category-pagination" aria-label="分类分页">
      <Link className={result.page <= 1 ? "is-disabled" : ""} href={href({ page: Math.max(1, result.page - 1) })} aria-disabled={result.page <= 1} tabIndex={result.page <= 1 ? -1 : undefined}><CaretLeft /><span>上一页</span></Link>
      <div>{pages.map((page) => <Link className={page === result.page ? "is-active" : ""} aria-current={page === result.page ? "page" : undefined} href={href({ page })} key={page}>{page}</Link>)}</div>
      <Link className={result.page >= result.totalPages ? "is-disabled" : ""} href={href({ page: Math.min(result.totalPages, result.page + 1) })} aria-disabled={result.page >= result.totalPages} tabIndex={result.page >= result.totalPages ? -1 : undefined}><span>下一页</span><CaretRight /></Link>
    </nav>
    <form className="category-page-tools" action="/categories" method="get">
      {q && <input type="hidden" name="q" value={q} />}
      {group !== "all" && <input type="hidden" name="group" value={group} />}
      <label>每页<select name="pageSize" defaultValue={result.pageSize} aria-label="每页分类数量">{PAGE_SIZES.map((size) => <option value={size} key={size}>{size} 条</option>)}</select></label>
      <label>跳转到<input name="page" type="number" min="1" max={result.totalPages} defaultValue={result.page} inputMode="numeric" aria-label="分类页码" /></label>
      <button className="button ghost compact" type="submit">应用</button>
    </form>
  </div>;
}

function pageWindow(current: number, total: number) {
  const start = Math.max(1, Math.min(current - 2, total - 4));
  return Array.from({ length: Math.min(5, total) }, (_, index) => start + index);
}
