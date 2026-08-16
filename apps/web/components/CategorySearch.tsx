"use client";

import { FormEvent, useEffect, useState, useTransition } from "react";
import { MagnifyingGlass, SpinnerGap, X } from "@phosphor-icons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function CategorySearch({ initialValue }: { initialValue: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();

  useEffect(() => setValue(initialValue), [initialValue]);
  useEffect(() => {
    if (value.trim() === initialValue) return;
    const timer = window.setTimeout(() => navigate(value), 350);
    return () => window.clearTimeout(timer);
  }, [value, initialValue]);

  function navigate(nextValue: string) {
    const query = new URLSearchParams(searchParams.toString());
    const normalized = nextValue.trim();
    if (normalized) query.set("q", normalized); else query.delete("q");
    query.delete("page");
    startTransition(() => router.replace(`${pathname}${query.size ? `?${query}` : ""}`, { scroll: false }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate(value);
  }

  return <form className="category-search category-live-search" role="search" onSubmit={submit} aria-busy={pending}>
    <MagnifyingGlass aria-hidden="true" />
    <input value={value} onChange={(event) => setValue(event.target.value)} placeholder="搜索分类名称" aria-label="搜索分类名称" autoComplete="off" />
    {value && <button className="category-search-clear" type="button" aria-label="清除分类搜索" title="清除搜索" onClick={() => { setValue(""); navigate(""); }}><X /></button>}
    <button className="button dark" type="submit">{pending ? <SpinnerGap className="spin" /> : <MagnifyingGlass />}<span>{pending ? "筛选中" : "查找分类"}</span></button>
  </form>;
}
