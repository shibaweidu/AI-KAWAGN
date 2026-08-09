import type { Metadata } from "next";
import { ArrowsLeftRight } from "@phosphor-icons/react/dist/ssr";
import { ManagedListingGrid, type ManagedListingItem } from "@/components/ManagedListingGrid";
import { serverApi } from "@/lib/server-api";

export const metadata: Metadata = { title: "中转站", description: "经过平台审核展示的 AI API 中转服务。" };
export const dynamic = "force-dynamic";

export default async function GatewaysPage() {
  const items = await serverApi<ManagedListingItem[]>("/gateways").catch(() => []);
  return <><section className="page-hero compact"><div className="shell"><span className="kicker"><ArrowsLeftRight />中转服务</span><h1>中转站展示</h1><p>展示经过运营审核的中转服务，访问前请核对价格、协议和服务状态。</p></div></section><section className="shell page-section"><ManagedListingGrid items={items} emptyTitle="暂无已启用的中转站" emptyDescription="后台添加并启用后会显示在这里。" /></section></>;
}
