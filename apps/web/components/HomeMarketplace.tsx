"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowSquareOut,
  ArrowsClockwise,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  Clock,
  MagnifyingGlass,
  Package,
  ShieldCheck,
  Storefront,
  Tag,
  WarningCircle,
} from "@phosphor-icons/react";
import type { HomeResponse, OfferListItem, OfferSort, ProductOfferGroup, SearchAd, SearchAdPage, StockStatus } from "@ai-card/contracts";
import { getHome, getOffers, getSuggestions } from "@/lib/home-api";
import { OfferFeedbackDialog } from "./OfferFeedbackDialog";
import { MediaThumbnail } from "./MediaThumbnail";

const stockLabels: Record<StockStatus, string> = { in_stock: "有货", low_stock: "低库存", out_of_stock: "缺货" };
const sortLabels: Record<OfferSort, string> = { price_asc: "价格从低到高", newest: "最近更新", stock_desc: "库存优先" };
const allowedSorts: OfferSort[] = ["price_asc", "newest", "stock_desc"];

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function exactTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

export function HomeMarketplace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const [home, setHome] = useState<HomeResponse | null>(null);
  const [offers, setOffers] = useState<SearchAdPage | null>(null);
  const [homeError, setHomeError] = useState(false);
  const [offersError, setOffersError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [category, setCategory] = useState(searchParams.get("category") || "");
  const [minPrice, setMinPrice] = useState(searchParams.get("minPrice") || "");
  const [maxPrice, setMaxPrice] = useState(searchParams.get("maxPrice") || "");
  const [stock, setStock] = useState(searchParams.get("stock") || "");
  const [sort, setSort] = useState<OfferSort>(() => allowedSorts.includes(searchParams.get("sort") as OfferSort) ? searchParams.get("sort") as OfferSort : "price_asc");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [expandedProductId, setExpandedProductId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getHome(controller.signal).then((data) => { setHome(data); setHomeError(false); }).catch((error) => { if (error.name !== "AbortError") setHomeError(true); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    setQ(searchParams.get("q") || "");
    setCategory(searchParams.get("category") || "");
    setMinPrice(searchParams.get("minPrice") || "");
    setMaxPrice(searchParams.get("maxPrice") || "");
    setStock(searchParams.get("stock") || "");
    const nextSort = searchParams.get("sort") as OfferSort;
    setSort(allowedSorts.includes(nextSort) ? nextSort : "price_asc");
    setExpandedProductId(null);
  }, [searchKey, searchParams]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    const query = new URLSearchParams(searchKey);
    if (!query.has("sort")) query.set("sort", "price_asc");
    query.set("pageSize", "20");
    getOffers(query, controller.signal)
      .then((data) => { setOffers(data); setOffersError(false); })
      .catch((error) => { if (error.name !== "AbortError") setOffersError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [searchKey]);

  useEffect(() => {
    if (!q.trim()) { setSuggestions([]); return; }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      getSuggestions(q, controller.signal).then(setSuggestions).catch(() => setSuggestions([]));
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [q]);

  const currentPage = Math.max(1, Number(searchParams.get("page") || 1));
  const hasFilters = useMemo(() => ["q", "category", "minPrice", "maxPrice", "stock"].some((key) => searchParams.has(key)), [searchKey, searchParams]);
  function navigate(values: Record<string, string | number | undefined>, resetPage = false) {
    const next = new URLSearchParams(searchKey);
    Object.entries(values).forEach(([key, value]) => value === "" || value === undefined ? next.delete(key) : next.set(key, String(value)));
    if (resetPage) next.delete("page");
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSuggestionsOpen(false);
    navigate({ q: q.trim(), category, minPrice, maxPrice, stock, sort }, true);
  }

  function clearFilters() {
    setQ(""); setCategory(""); setMinPrice(""); setMaxPrice(""); setStock(""); setSort("price_asc");
    router.push(pathname, { scroll: false });
  }

  function chooseSuggestion(value: string) {
    setQ(value);
    setSuggestionsOpen(false);
    navigate({ q: value }, true);
  }

  return <div className="home-marketplace">
    {!home?.banner && <h1 className="visually-hidden">数字商品报价检索</h1>}
    <div className={`home-intro shell ${home?.banner ? "" : "without-banner"}`}>
    {home?.banner && <section className="home-banner-shell" aria-label="运营广告">
      <article className="home-banner">
        <picture><source media="(max-width: 900px)" srcSet={home.banner.imageMobile}/><img src={home.banner.imageDesktop} alt="" /></picture>
        <div className="home-banner-copy"><span className="ad-label">{home.banner.label}</span><h1>{home.banner.title}</h1><p>{home.banner.summary}</p><a className="button dark" href={`/api/v1/go/banner/${home.banner.id}`} target="_blank" rel="noreferrer sponsored">{home.banner.buttonLabel}<ArrowRight /></a></div>
      </article>
    </section>}

    <section className="home-search-band" aria-labelledby="home-search-title">
      <div className="home-section-heading"><div className="home-heading-inline"><span className="kicker"><MagnifyingGlass />报价检索</span><h2 id="home-search-title">搜索商品报价</h2></div><span className="result-summary">{loading ? "正在检索" : `找到 ${offers?.total || 0} 个商品`}</span></div>
      <form className="home-search-form" onSubmit={submitSearch}>
        <label className="keyword-field"><span>关键词</span><div><MagnifyingGlass /><input value={q} onChange={(event) => { setQ(event.target.value); setSuggestionsOpen(true); }} onFocus={() => setSuggestionsOpen(true)} autoComplete="off" placeholder="商品名称或规格" role="combobox" aria-autocomplete="list" aria-controls="home-search-suggestions" aria-expanded={suggestionsOpen && suggestions.length > 0}/></div>{suggestionsOpen && suggestions.length > 0 && <div id="home-search-suggestions" className="suggestion-list" role="listbox">{suggestions.map((item) => <button type="button" role="option" key={item} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSuggestion(item)}>{item}</button>)}</div>}</label>
        <label><span>商品分类</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="">全部分类</option>{home?.categories.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>
        <label><span>最低价</span><input type="number" min="0" step="0.01" inputMode="decimal" value={minPrice} onChange={(event) => setMinPrice(event.target.value)} placeholder="¥ 0" /></label>
        <label><span>最高价</span><input type="number" min="0" step="0.01" inputMode="decimal" value={maxPrice} onChange={(event) => setMaxPrice(event.target.value)} placeholder="不限" /></label>
        <label><span>库存状态</span><select value={stock} onChange={(event) => setStock(event.target.value)}><option value="">全部库存</option><option value="in_stock">有货</option><option value="low_stock">低库存</option><option value="out_of_stock">缺货</option></select></label>
        <label><span>排序方式</span><select value={sort} onChange={(event) => setSort(event.target.value as OfferSort)}>{allowedSorts.map((value) => <option key={value} value={value}>{sortLabels[value]}</option>)}</select></label>
        <div className="search-actions"><button className="button dark" type="submit"><MagnifyingGlass />搜索</button>{hasFilters && <button className="button ghost" type="button" onClick={clearFilters}>清除</button>}</div>
      </form>
      <div className="hot-keywords"><span>热门搜索</span>{home?.hotSearches.map((item) => <button type="button" key={item} onClick={() => chooseSuggestion(item)}>{item}</button>)}</div>
    </section>

    <aside className="home-stats-band" aria-labelledby="home-stats-title">
      <div className="home-section-heading"><div><span className="kicker">平台收录</span><h2 id="home-stats-title">数据概览</h2></div>{home?.isDemo && <span className="demo-label">演示数据</span>}</div>
      {homeError ? <p className="inline-error"><WarningCircle />统计数据暂时无法加载</p> : <dl className="home-stats" aria-label="平台收录情况">
        {[
          { Icon: Storefront, label: "收录店铺", value: home?.stats.shops },
          { Icon: Package, label: "收录商品", value: home?.stats.products },
          { Icon: ShieldCheck, label: "认证店铺", value: home?.stats.verifiedShops },
          { Icon: ArrowsClockwise, label: "今日更新", value: home?.stats.updatedToday },
        ].map(({ Icon, label, value }) => <div key={label}><dt><Icon aria-hidden="true" /><span>{label}</span></dt><dd>{typeof value === "number" ? value.toLocaleString("zh-CN") : "--"}</dd></div>)}
        <div className="last-sync"><dt><Clock aria-hidden="true" /><span>最近同步</span></dt><dd><strong>{home?.stats.lastSyncedAt ? relativeTime(home.stats.lastSyncedAt) : "暂无同步"}</strong><small>{home?.stats.lastSyncedAt ? exactTime(home.stats.lastSyncedAt) : home ? "等待首条发布数据" : "正在读取"}</small></dd></div>
      </dl>}
    </aside>
    </div>

    <section className="offer-results shell" aria-labelledby="offer-results-title">
      <div className="home-section-heading"><div className="home-heading-inline"><span className="kicker"><Tag />实时报价</span><h2 id="offer-results-title">报价结果</h2></div><span className="result-summary">默认按最低价展示 20 款商品</span></div>
      {!loading && !offersError && offers?.ad && <SearchAdCard ad={offers.ad} />}
      {loading ? <OfferSkeleton /> : offersError ? <div className="results-state"><WarningCircle /><h3>报价加载失败</h3><p>请检查接口服务后重试。</p><button className="button dark" onClick={() => router.refresh()}>重新加载</button></div> : offers && offers.items.length > 0 ? <>
        <GroupedOfferResults groups={offers.items} sort={sort} expandedProductId={expandedProductId} onToggle={(productId) => setExpandedProductId((current) => current === productId ? null : productId)} onSort={(nextSort) => navigate({ sort: nextSort }, true)} />
        <Pagination page={offers.page} totalPages={offers.totalPages} onPage={(page) => navigate({ page }, false)} />
      </> : <div className="results-state"><MagnifyingGlass /><h3>暂无逐条商品报价</h3><p>当前已完成店铺目录收录，商品明细和同款报价将在授权同步后展示。</p><div className="empty-keywords">{home?.hotSearches.slice(0, 4).map((item) => <button key={item} type="button" onClick={() => chooseSuggestion(item)}>{item}</button>)}</div>{hasFilters && <button className="button dark" onClick={clearFilters}>清除筛选</button>}</div>}
    </section>
  </div>;
}

function SearchAdCard({ ad }: { ad: SearchAd }) {
  return <article className="search-ad-card" aria-label={`推广：${ad.title}`}>
    {ad.imageUrl ? <img src={ad.imageUrl} alt="" loading="lazy" /> : <div className="search-ad-placeholder"><Tag /></div>}
    <div className="search-ad-copy">
      <span className="ad-label">{ad.label}</span>
      <h3>{ad.title}</h3>
      <p>{ad.description || "由平台运营置顶展示，访问前请自行核对服务内容与交易条款。"}</p>
    </div>
    <a className="button dark compact" href={`/api/v1/go/search-ad/${ad.id}`} target="_blank" rel="noreferrer sponsored">查看推广 <ArrowSquareOut /></a>
  </article>;
}

function GroupedOfferResults({ groups, sort, expandedProductId, onToggle, onSort }: {
  groups: ProductOfferGroup[];
  sort: OfferSort;
  expandedProductId: string | null;
  onToggle: (productId: string) => void;
  onSort: (sort: OfferSort) => void;
}) {
  return <>
    <div className="offer-table-wrap"><table className="home-offer-table grouped-offer-table">
      <caption>按商品归并的店铺报价，可展开查看每家店铺的价格、库存与更新时间</caption>
      <colgroup><col className="col-product"/><col className="col-shop"/><col className="col-price"/><col className="col-time"/><col className="col-stock"/><col className="col-action"/></colgroup>
      <thead><tr><th scope="col">商品名称</th><th scope="col">店铺报价</th><th scope="col"><SortButton active={sort === "price_asc"} label="最低价" direction="up" onClick={() => onSort("price_asc")} /></th><th scope="col"><SortButton active={sort === "newest"} label="更新时间" direction="down" onClick={() => onSort("newest")} /></th><th scope="col"><SortButton active={sort === "stock_desc"} label="可购店铺" direction="down" onClick={() => onSort("stock_desc")} /></th><th scope="col">操作</th></tr></thead>
      <tbody>{groups.map((group) => {
        const expanded = expandedProductId === group.productId;
        const detailsId = `offer-details-desktop-${group.productId}`;
        return <Fragment key={group.productId}>
          <tr className={expanded ? "offer-group-row is-expanded" : "offer-group-row"}>
            <td><div className="product-cell"><MediaThumbnail value={group.productThumbnailUrl} label={group.productName} kind="product" /><span><span className="table-category">{group.category}</span><Link className="product-name" href={`/products/${group.productSlug}`}>{group.productName}</Link><small>{group.specification}</small></span></div></td>
            <td><ShopGroupSummary group={group} /></td>
            <td><strong className="offer-price">¥{group.lowestPrice.toFixed(2)} 起</strong>{group.highestPrice > group.lowestPrice && <small className="price-range">¥{group.lowestPrice.toFixed(2)}–{group.highestPrice.toFixed(2)}</small>}</td>
            <td><time dateTime={group.latestSyncedAt} title={new Date(group.latestSyncedAt).toLocaleString("zh-CN")}>{relativeTime(group.latestSyncedAt)}</time><small>{exactTime(group.latestSyncedAt)}</small></td>
            <td><span className={`stock-badge ${group.inStockOfferCount > 0 ? "in_stock" : "out_of_stock"}`}><i />{group.inStockOfferCount} 家可购</span><small>共 {group.offerCount} 家报价</small></td>
            <td><div className="offer-actions group-actions"><Link className="icon-button" href={`/products/${group.productSlug}`} aria-label={`查看 ${group.productName} 比价详情`} title="查看比价详情"><MagnifyingGlass /></Link><button className="button ghost compact group-toggle" type="button" aria-expanded={expanded} aria-controls={detailsId} title={expanded ? "收起店铺报价" : `展开 ${group.offerCount} 家店铺报价`} onClick={() => onToggle(group.productId)}><Storefront />{expanded ? "收起报价" : `查看 ${group.offerCount} 家`} {expanded ? <CaretUp /> : <CaretDown />}</button></div></td>
          </tr>
          {expanded && <tr className="offer-group-detail"><td colSpan={6}><OfferDetailList id={detailsId} group={group} /></td></tr>}
        </Fragment>;
      })}</tbody>
    </table></div>

    <div className="offer-card-list grouped-card-list">{groups.map((group) => {
      const expanded = expandedProductId === group.productId;
      const detailsId = `offer-details-mobile-${group.productId}`;
      return <article className={expanded ? "offer-mobile-card group-card is-expanded" : "offer-mobile-card group-card"} key={group.productId}>
        <div className="offer-card-top"><MediaThumbnail value={group.productThumbnailUrl} label={group.productName} kind="product" /><div><span className="table-category">{group.category}</span><Link href={`/products/${group.productSlug}`}>{group.productName}</Link><small>{group.specification}</small></div></div>
        <ShopGroupSummary group={group} />
        <div className="offer-card-metrics group-card-metrics"><span><small>最低价</small><strong className="offer-price">¥{group.lowestPrice.toFixed(2)}</strong></span><span><small>价格区间</small><b>¥{group.lowestPrice.toFixed(2)}–{group.highestPrice.toFixed(2)}</b></span><span><small>可购店铺</small><b className={group.inStockOfferCount > 0 ? "stock-text in_stock" : "stock-text out_of_stock"}>{group.inStockOfferCount} / {group.offerCount} 家</b></span></div>
        <time className="group-card-updated" dateTime={group.latestSyncedAt}>最近更新 {relativeTime(group.latestSyncedAt)} · {exactTime(group.latestSyncedAt)}</time>
        <div className="offer-card-actions"><Link className="button ghost" href={`/products/${group.productSlug}`}>比价详情</Link><button className="button dark" type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => onToggle(group.productId)}>{expanded ? "收起报价" : `展开 ${group.offerCount} 家`} {expanded ? <CaretUp /> : <CaretDown />}</button></div>
        {expanded && <OfferMobileDetailList id={detailsId} group={group} />}
      </article>;
    })}</div>
  </>;
}

function ShopGroupSummary({ group }: { group: ProductOfferGroup }) {
  return <div className="group-shop-summary"><span className="shop-logo-stack" aria-hidden="true">{group.offers.slice(0, 3).map((offer) => <MediaThumbnail value={offer.shopLogo} label={offer.shopName} kind="shop" className="offer-shop-logo" key={offer.id} />)}</span><span className="group-shop-copy"><strong>{group.offerCount} 家报价</strong><small>全部已认证</small></span></div>;
}

function OfferDetailList({ id, group }: { id: string; group: ProductOfferGroup }) {
  return <div className="offer-detail-panel" id={id} role="region" aria-label={`${group.productName} 店铺报价`}>
    <div className="offer-detail-heading"><div><strong>全部店铺报价</strong><span>按价格从低到高</span></div><Link href={`/products/${group.productSlug}`}>完整比价详情 <ArrowRight /></Link></div>
    <div className="offer-detail-grid offer-detail-grid-head" aria-hidden="true"><span>店铺</span><span>价格</span><span>库存</span><span>更新时间</span><span>操作</span><span>反馈</span></div>
    {group.offers.map((offer) => <OfferDetailRow key={offer.id} offer={offer} lowestPrice={group.lowestPrice} productName={group.productName} />)}
  </div>;
}

function OfferDetailRow({ offer, lowestPrice, productName }: { offer: OfferListItem; lowestPrice: number; productName: string }) {
  return <div className={offer.stockStatus === "out_of_stock" ? "offer-detail-grid is-out" : "offer-detail-grid"}>
    <Link className="shop-cell" href={`/shops/${offer.shopSlug}`}><MediaThumbnail value={offer.shopLogo} label={offer.shopName} kind="shop" className="offer-shop-logo" /><span><strong>{offer.shopName}</strong><small className="verified"><ShieldCheck weight="fill"/>已认证</small></span></Link>
    <span><strong className="offer-price">¥{offer.price.toFixed(2)}</strong>{offer.price === lowestPrice && <small className="lowest-label">当前最低</small>}</span>
    <span><span className={`stock-badge ${offer.stockStatus}`}><i />{stockLabels[offer.stockStatus]}</span><small>{offer.stock === null ? "库存充足" : `剩余 ${offer.stock}`}</small></span>
    <span><time dateTime={offer.syncedAt} title={new Date(offer.syncedAt).toLocaleString("zh-CN")}>{relativeTime(offer.syncedAt)}</time><small>{exactTime(offer.syncedAt)}</small></span>
    <span>{offer.stockStatus === "out_of_stock" ? <button className="button ghost compact" disabled>当前缺货</button> : <a className="button dark compact" href={`/api/v1/go/offer/${offer.id}`} target="_blank" rel="noreferrer">前往店铺 <ArrowSquareOut /></a>}</span>
    <OfferFeedbackDialog offerId={offer.id} productName={productName} />
  </div>;
}

function OfferMobileDetailList({ id, group }: { id: string; group: ProductOfferGroup }) {
  return <div className="mobile-group-offers" id={id} role="region" aria-label={`${group.productName} 店铺报价`}><div className="mobile-group-offers-head"><strong>全部店铺报价</strong><span>按价格从低到高</span></div>{group.offers.map((offer) => <div className={offer.stockStatus === "out_of_stock" ? "mobile-group-offer is-out" : "mobile-group-offer"} key={offer.id}>
    <Link className="mobile-group-shop" href={`/shops/${offer.shopSlug}`}><MediaThumbnail value={offer.shopLogo} label={offer.shopName} kind="shop" className="offer-shop-logo" /><span><strong>{offer.shopName}</strong><small>已认证</small></span></Link>
    <span className="mobile-group-price"><strong className="offer-price">¥{offer.price.toFixed(2)}</strong><small className={`stock-text ${offer.stockStatus}`}>{stockLabels[offer.stockStatus]}</small></span>
    <time dateTime={offer.syncedAt}>{relativeTime(offer.syncedAt)}</time>
    <span className="mobile-group-actions"><OfferFeedbackDialog offerId={offer.id} productName={group.productName} />{offer.stockStatus === "out_of_stock" ? <button className="icon-button" disabled aria-label="当前缺货"><ArrowSquareOut /></button> : <a className="icon-button primary" href={`/api/v1/go/offer/${offer.id}`} target="_blank" rel="noreferrer" aria-label={`前往 ${offer.shopName}`}><ArrowSquareOut /></a>}</span>
  </div>)}</div>;
}

function SortButton({ active, label, direction, onClick }: { active: boolean; label: string; direction: "up" | "down"; onClick: () => void }) {
  const Icon = direction === "up" ? CaretUp : CaretDown;
  return <button className={active ? "table-sort active" : "table-sort"} type="button" onClick={onClick}>{label}<Icon /><span className="visually-hidden">{active ? "当前排序" : "点击排序"}</span></button>;
}

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  if (totalPages <= 1) return <p className="pagination-end">已展示全部商品</p>;
  return <nav className="offer-pagination" aria-label="商品分页"><button className="icon-button" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="上一页"><CaretLeft /></button><span>第 {page} / {totalPages} 页</span><button className="icon-button" type="button" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="下一页"><CaretRight /></button></nav>;
}

function OfferSkeleton() {
  return <div className="offer-skeleton" role="status" aria-label="报价加载中">{Array.from({ length: 6 }, (_, index) => <div key={index}><span/><span/><span/><span/></div>)}</div>;
}

