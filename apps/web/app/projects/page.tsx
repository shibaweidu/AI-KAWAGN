import type { Metadata } from "next";
import { Fire } from "@phosphor-icons/react/dist/ssr";
import { ManagedListingGrid, type ManagedListingItem } from "@/components/ManagedListingGrid";
import { serverApi } from "@/lib/server-api";

export const metadata: Metadata = { title: "热门项目", description: "经过平台审核展示的 AI 产品与数字服务。" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const items = await serverApi<ManagedListingItem[]>("/projects").catch(() => []);
  return <><section className="page-hero compact"><div className="shell"><span className="kicker"><Fire />项目发现</span><h1>热门项目展示</h1><p>精选经过运营审核的 AI 产品与数字服务，热度标签由后台统一维护。</p></div></section><section className="shell page-section"><ManagedListingGrid items={items} emptyTitle="暂无已启用的热门项目" emptyDescription="后台添加并启用后会显示在这里。" /></section></>;
}
