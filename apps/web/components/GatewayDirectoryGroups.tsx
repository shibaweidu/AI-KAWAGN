"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import {
  ArrowLeft, ArrowRight, ArrowSquareOut, CaretDown, CaretUp, Clock, Gauge, ThumbsDown, ThumbsUp, WifiHigh, WifiSlash,
} from "@phosphor-icons/react";
import type { GatewayDirectoryEntry, GatewayGroupedDirectory } from "@ai-card/contracts";
import { MediaThumbnail } from "./MediaThumbnail";

type Props = {
  directory: GatewayGroupedDirectory;
  query: { q: string; online: string; sort: string };
};

export function GatewayDirectoryGroups({ directory, query }: Props) {
  const [otherItems, setOtherItems] = useState(directory.other.items);
  const [page, setPage] = useState(directory.other.page);
  const [jumpPage, setJumpPage] = useState(String(directory.other.page));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const initialItems = useRef(directory.other.items);
  const requestSequence = useRef(0);
  const abortController = useRef<AbortController | null>(null);
  const lastRequest = useRef<{ targetPage: number; mode: "append" | "replace" } | null>(null);
  const queryKey = JSON.stringify(query);
  const hasMore = page < directory.other.totalPages;
  const hasPrevious = page > 1;
  const hasNext = page < directory.other.totalPages;
  const hasExpandedView = page > 1 || otherItems.length > initialItems.current.length;

  useEffect(() => {
    initialItems.current = directory.other.items;
    setOtherItems(directory.other.items);
    setPage(directory.other.page);
    setJumpPage(String(directory.other.page));
    setError("");
    setLoading(false);
    requestSequence.current += 1;
    abortController.current?.abort();
    abortController.current = null;
    lastRequest.current = null;
    return () => {
      requestSequence.current += 1;
      abortController.current?.abort();
      abortController.current = null;
    };
  }, [queryKey]);

  function paramsFor(targetPage: number) {
    const params = new URLSearchParams({ ...query, otherPage: String(targetPage), pageSize: String(directory.other.pageSize) });
    if (!query.online) params.delete("online");
    return params;
  }

  async function fetchPage(targetPage: number, mode: "append" | "replace") {
    if (loading || abortController.current) return false;
    const requestId = ++requestSequence.current;
    const controller = new AbortController();
    abortController.current = controller;
    lastRequest.current = { targetPage, mode };
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/gateway-directory-grouped?${paramsFor(targetPage)}`, { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("加载失败");
      const next = await response.json() as GatewayGroupedDirectory;
      if (requestId !== requestSequence.current) return false;
      if (mode === "append") {
        setOtherItems((current) => [...current, ...next.other.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      } else {
        setOtherItems(next.other.items);
      }
      setPage(next.other.page);
      setJumpPage(String(next.other.page));
      return true;
    } catch (requestError) {
      if (requestError instanceof DOMException && requestError.name === "AbortError") return false;
      if (requestId === requestSequence.current) setError("页面加载失败，请重试");
      return false;
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        abortController.current = null;
      }
    }
  }

  function loadMore() {
    if (!hasMore) return;
    void fetchPage(page + 1, "append");
  }

  async function navigate(targetPage: number) {
    if (targetPage < 1 || targetPage > directory.other.totalPages) {
      lastRequest.current = null;
      setError(`请输入 1-${directory.other.totalPages} 之间的页码`);
      return false;
    }
    const succeeded = await fetchPage(targetPage, "replace");
    if (succeeded) scrollToOtherGroup();
    return succeeded;
  }

  function submitJump(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!/^\d+$/.test(jumpPage.trim())) {
      lastRequest.current = null;
      setError("请输入有效的整数页码");
      return;
    }
    void navigate(Number(jumpPage));
  }

  function collapse() {
    if (loading) return;
    setOtherItems(initialItems.current);
    setPage(1);
    setJumpPage("1");
    setError("");
    lastRequest.current = null;
    scrollToOtherGroup();
  }

  function scrollToOtherGroup() {
    window.requestAnimationFrame(() => document.getElementById("gateway-other-title")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function retry() {
    if (!lastRequest.current) return;
    const { targetPage, mode } = lastRequest.current;
    void fetchPage(targetPage, mode).then((succeeded) => {
      if (succeeded && mode === "replace") scrollToOtherGroup();
    });
  }

  return <div className="gateway-group-stack">
    {directory.groups.filter((group) => group.items.length > 0).map((group) => <section className="gateway-display-group" aria-labelledby={`gateway-group-${group.key}`} key={group.id}>
      <header><div><span>精选分组</span><h2 id={`gateway-group-${group.key}`}>{group.name}</h2></div><strong>{group.items.length} 个中转站</strong></header>
      <div className="gateway-feature-grid">{group.items.map((item) => <GatewayFeatureCard item={item} key={item.id} />)}</div>
    </section>)}

    <section className="gateway-other-group" aria-labelledby="gateway-other-title">
      <header><div><span>全部收录</span><h2 id="gateway-other-title">其他中转站</h2></div><strong>{directory.other.total.toLocaleString("zh-CN")} 个中转站</strong></header>
      {otherItems.length > 0 ? <div className="gateway-compact-grid">{otherItems.map((item) => <GatewayCompactCard item={item} key={item.id} />)}</div> : <div className="gateway-group-empty">暂无符合条件的中转站</div>}
      {(hasMore || hasExpandedView || directory.other.totalPages > 1) && <div className="gateway-pagination" aria-label="其他中转站分页">
        {hasMore && <button className="gateway-load-more" type="button" onClick={loadMore} disabled={loading}>{loading ? <Clock className="spin" /> : <CaretDown />}{loading ? "正在加载" : "加载更多"}</button>}
        <div className="gateway-page-controls">
          <button className="gateway-page-button" type="button" onClick={() => void navigate(page - 1)} disabled={loading || !hasPrevious}><ArrowLeft />上一页</button>
          <span className="gateway-page-indicator">第 {page} / {Math.max(directory.other.totalPages, 1)} 页</span>
          <button className="gateway-page-button" type="button" onClick={() => void navigate(page + 1)} disabled={loading || !hasNext}>下一页<ArrowRight /></button>
          <form className="gateway-page-jump" onSubmit={submitJump} noValidate><label htmlFor="gateway-page-input">跳转到</label><input id="gateway-page-input" inputMode="numeric" maxLength={8} value={jumpPage} onChange={(event) => setJumpPage(event.target.value)} aria-label="页码" disabled={loading} /><span>页</span><button className="button ghost compact" type="submit" disabled={loading}>跳转</button></form>
          {hasExpandedView && <button className="gateway-collapse-button" type="button" onClick={collapse} disabled={loading}><CaretUp />收起</button>}
        </div>
        {error && <div className="gateway-pagination-error" role="alert"><span>{error}</span>{lastRequest.current && <button type="button" onClick={retry} disabled={loading}>重试</button>}</div>}
      </div>}
    </section>
  </div>;
}

function GatewayFeatureCard({ item }: { item: GatewayDirectoryEntry }) {
  return <article className="gateway-feature-card">
    <div className="gateway-feature-title"><MediaThumbnail value={item.logoUrl} label={item.name} kind="listing" /><div><Link href={`/gateways/${item.slug}`}>{item.name}</Link><GatewayStatus item={item} /></div></div>
    <p>{item.description || "暂无服务说明"}</p>
    <div className="gateway-feature-tags">{item.modelTags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}{item.pricingClaims && <b>{item.pricingClaims}</b>}</div>
    <dl><div><dt>7 日可用率</dt><dd>{item.availability7d === null ? "—" : `${item.availability7d}%`}</dd></div><div><dt>平均响应</dt><dd>{item.averageResponseMs === null ? "—" : `${item.averageResponseMs}ms`}</dd></div><div><dt>参考投票</dt><dd><ThumbsUp />{item.upVotes}<ThumbsDown />{item.downVotes}</dd></div></dl>
    <div className="gateway-feature-actions"><Link className="button ghost compact" href={`/gateways/${item.slug}`}>监测详情</Link><a className="button dark compact" href={`/api/v1/go/gateway/${item.id}`} target="_blank" rel="noreferrer sponsored">访问 <ArrowSquareOut /></a></div>
  </article>;
}

function GatewayCompactCard({ item }: { item: GatewayDirectoryEntry }) {
  return <article className="gateway-compact-card"><MediaThumbnail value={item.logoUrl} label={item.name} kind="listing" /><div><Link href={`/gateways/${item.slug}`}>{item.name}</Link><span><GatewayStatus item={item} />{item.availability7d !== null && <small><Gauge />{item.availability7d}%</small>}</span></div><a href={`/api/v1/go/gateway/${item.id}`} target="_blank" rel="noreferrer sponsored" aria-label={`访问 ${item.name}`} title="访问中转站"><ArrowSquareOut /></a></article>;
}

function GatewayStatus({ item }: { item: GatewayDirectoryEntry }) {
  return <span className={item.online === true ? "gateway-status online" : item.online === false ? "gateway-status offline" : "gateway-status unknown"}>{item.online === true ? <WifiHigh /> : item.online === false ? <WifiSlash /> : <Clock />}{item.online === true ? "在线" : item.online === false ? "离线" : "未检测"}</span>;
}
