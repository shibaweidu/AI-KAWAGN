"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { MagnifyingGlass, SquaresFour, X } from "@phosphor-icons/react";

type CategoryStat = { name: string; productCount: number | null };

export function ShopCategoryNavigator({ slug, categories, activeCategory, totalProducts }: { slug: string; categories: CategoryStat[]; activeCategory: string | null; totalProducts: number }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const triggerButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const drawer = useRef<HTMLElement>(null);
  const popular = categories.slice(0, 5);
  const activeOutsidePopular = activeCategory ? categories.find((item) => item.name === activeCategory && !popular.some((popularItem) => popularItem.name === item.name)) : null;
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("zh-CN");
    return needle ? categories.filter((item) => item.name.toLocaleLowerCase("zh-CN").includes(needle)) : categories;
  }, [categories, query]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); return; }
      if (event.key !== "Tab") return;
      const focusable = drawer.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    closeButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      triggerButton.current?.focus();
    };
  }, [open]);

  if (!categories.length) return null;
  return <>
    <nav className="shop-category-nav" aria-label="店铺商品分类">
      <div className="shop-category-popular">
        <Link className={!activeCategory ? "is-active" : ""} aria-current={!activeCategory ? "page" : undefined} href={`/shops/${slug}#shop-products`} scroll={false}>全部商品 <span>{totalProducts.toLocaleString("zh-CN")}</span></Link>
        {popular.map((category) => <CategoryLink key={category.name} slug={slug} category={category} active={activeCategory === category.name} />)}
        {activeOutsidePopular && <CategoryLink slug={slug} category={activeOutsidePopular} active />}
      </div>
      {categories.length > 5 && <button ref={triggerButton} className="button ghost compact category-browser-trigger" type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-expanded={open} aria-controls="shop-category-drawer"><SquaresFour />全部分类 <span>{categories.length}</span></button>}
    </nav>

    {open && <div className="category-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section id="shop-category-drawer" ref={drawer} className="category-drawer" role="dialog" aria-modal="true" aria-labelledby="category-drawer-title">
        <header><div><span className="kicker"><SquaresFour />店铺分类</span><h2 id="category-drawer-title">全部分类</h2><p>选择分类后仅展示该分类下的商品。</p></div><button ref={closeButton} className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="关闭全部分类"><X /></button></header>
        <label className="category-drawer-search"><span>搜索分类</span><div><MagnifyingGlass /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入分类名称" autoComplete="off" /></div></label>
        <div className="category-drawer-list">
          <Link className={!activeCategory ? "is-active" : ""} href={`/shops/${slug}#shop-products`} onClick={() => setOpen(false)} scroll={false}><span>全部商品</span><strong>{totalProducts.toLocaleString("zh-CN")}</strong></Link>
          {filtered.map((category) => <Link className={activeCategory === category.name ? "is-active" : ""} href={categoryHref(slug, category.name)} key={category.name} onClick={() => setOpen(false)} scroll={false}><span>{category.name}</span><strong>{category.productCount === null ? "查看" : category.productCount.toLocaleString("zh-CN")}</strong></Link>)}
          {!filtered.length && <div className="category-drawer-empty"><MagnifyingGlass /><strong>没有匹配分类</strong><span>尝试缩短关键词或清除搜索内容。</span></div>}
        </div>
      </section>
    </div>}
  </>;
}

function CategoryLink({ slug, category, active }: { slug: string; category: CategoryStat; active: boolean }) {
  return <Link className={active ? "is-active" : ""} aria-current={active ? "page" : undefined} href={categoryHref(slug, category.name)} scroll={false}>{category.name}{category.productCount !== null && <span>{category.productCount.toLocaleString("zh-CN")}</span>}</Link>;
}

function categoryHref(slug: string, category: string) {
  return `/shops/${slug}?category=${encodeURIComponent(category)}#shop-products`;
}
