"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowSquareOut, CaretDown, Clock, Gauge, ThumbsDown, ThumbsUp, WifiHigh, WifiSlash,
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
  const [loading, setLoading] = useState(false);
  const hasMore = page < directory.other.totalPages;

  async function loadMore() {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ ...query, otherPage: String(page + 1), pageSize: String(directory.other.pageSize) });
      if (!query.online) params.delete("online");
      const response = await fetch(`/api/v1/gateway-directory-grouped?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("加载失败");
      const next = await response.json() as GatewayGroupedDirectory;
      setOtherItems((current) => [...current, ...next.other.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setPage(next.other.page);
    } finally {
      setLoading(false);
    }
  }

  return <div className="gateway-group-stack">
    {directory.groups.filter((group) => group.items.length > 0).map((group) => <section className="gateway-display-group" aria-labelledby={`gateway-group-${group.key}`} key={group.id}>
      <header><div><span>精选分组</span><h2 id={`gateway-group-${group.key}`}>{group.name}</h2></div><strong>{group.items.length} 个中转站</strong></header>
      <div className="gateway-feature-grid">{group.items.map((item) => <GatewayFeatureCard item={item} key={item.id} />)}</div>
    </section>)}

    <section className="gateway-other-group" aria-labelledby="gateway-other-title">
      <header><div><span>全部收录</span><h2 id="gateway-other-title">其他中转站</h2></div><strong>{directory.other.total.toLocaleString("zh-CN")} 个中转站</strong></header>
      {otherItems.length > 0 ? <div className="gateway-compact-grid">{otherItems.map((item) => <GatewayCompactCard item={item} key={item.id} />)}</div> : <div className="gateway-group-empty">暂无符合条件的中转站</div>}
      {hasMore && <button className="gateway-load-more" type="button" onClick={() => void loadMore()} disabled={loading}>{loading ? <Clock className="spin" /> : <CaretDown />}{loading ? "正在加载" : "加载更多"}</button>}
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
