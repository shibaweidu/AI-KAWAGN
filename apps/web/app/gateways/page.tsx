import type { Metadata } from "next";
import {
  ArrowsLeftRight, MagnifyingGlass, Megaphone, ShieldWarning, SlidersHorizontal, WifiHigh,
} from "@phosphor-icons/react/dist/ssr";
import type { GatewayGroupedDirectory, SiteSettings } from "@ai-card/contracts";
import type { ManagedListingItem } from "@/components/ManagedListingGrid";
import { GatewayDirectoryGroups } from "@/components/GatewayDirectoryGroups";
import { GatewaySponsorGrid } from "@/components/GatewaySponsorGrid";
import { serverApi } from "@/lib/server-api";

export const metadata: Metadata = { title: "AI API 中转站目录", description: "按稳定性、性价比和收录时间查看 AI API 中转站。" };
export const dynamic = "force-dynamic";

type Params = { q?: string; online?: string; sort?: string };

export default async function GatewaysPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const q = (params.q || "").trim();
  const online = params.online === "true" || params.online === "false" ? params.online : "";
  const sort = ["featured", "reputation", "availability", "newest"].includes(params.sort || "") ? params.sort! : "featured";
  const query = new URLSearchParams({ q, sort, otherPage: "1", pageSize: "36" });
  if (online) query.set("online", online);
  const [directory, curated, settings] = await Promise.all([
    serverApi<GatewayGroupedDirectory>(`/gateway-directory-grouped?${query}`).catch(() => emptyDirectory()),
    serverApi<ManagedListingItem[]>("/gateways").catch(() => []),
    serverApi<SiteSettings>("/site-settings").catch(() => null),
  ]);
  const notice = settings?.gatewayNotice || {
    title: "使用前请独立核验",
    description: "建议少额充值，并避免通过第三方服务传输敏感信息。",
    enabled: true,
  };

  return <>
    <section className="page-hero compact gateway-hero"><div className="shell"><span className="kicker"><ArrowsLeftRight />中转服务目录</span><h1>AI API 中转站</h1><p>按使用场景快速筛选中转服务，展示信息不代表本平台认证。</p></div></section>
    <section className="shell gateway-page">
      {notice.enabled && <div className="gateway-risk-note"><ShieldWarning /><div><strong>{notice.title}</strong><p>{notice.description}</p></div></div>}
      {curated.length > 0 && <section className="gateway-sponsors" aria-labelledby="gateway-sponsors-title"><div className="gateway-sponsor-head"><div><span className="kicker"><Megaphone />合作推广</span><h2 id="gateway-sponsors-title">赞助商</h2></div><span>后台推荐</span></div><GatewaySponsorGrid items={curated} /></section>}
      <section className="gateway-directory-section">
        <div className="gateway-directory-head"><div><span className="kicker"><WifiHigh />中转目录</span><h2>选择适合的中转站</h2><p>共 {directory.total.toLocaleString("zh-CN")} 条已审核记录</p></div>
          <form className="gateway-filter-form grouped" action="/gateways"><label><MagnifyingGlass /><input name="q" defaultValue={q} placeholder="搜索站名、模型或倍率" aria-label="搜索中转站" /></label><select name="online" defaultValue={online} aria-label="在线状态"><option value="">全部状态</option><option value="true">当前在线</option><option value="false">当前离线</option></select><select name="sort" defaultValue={sort} aria-label="排序"><option value="featured">综合排序</option><option value="availability">可用率优先</option><option value="reputation">口碑优先</option><option value="newest">最近收录</option></select><button className="button dark" type="submit"><SlidersHorizontal />筛选</button></form>
        </div>
        <GatewayDirectoryGroups directory={directory} query={{ q, online, sort }} />
      </section>
    </section>
  </>;
}

function emptyDirectory(): GatewayGroupedDirectory {
  return { groups: [], other: { items: [], total: 0, page: 1, pageSize: 36, totalPages: 0 }, total: 0 };
}
