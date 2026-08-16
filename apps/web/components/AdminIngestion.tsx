"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowsClockwise, ArrowDown, ArrowUp, CheckCircle, Database, Eye, EyeSlash, Fire,
  Gauge, Gear, ImageSquare, MagnifyingGlass, Play, Plus, ShieldCheck, SidebarSimple, Storefront, Tag, Timer,
  UploadSimple, WarningCircle, XCircle, ArrowsLeftRight, Star, Megaphone, LinkSimple,
  Robot, Pencil, Trash,
} from "@phosphor-icons/react";
import type { AdminHomeBanner, AdminSideAd, Announcement, AnnouncementSegment, BotAdminOverview, GatewayNotice, SearchAd, SiteSettings, SideAdSlot } from "@ai-card/contracts";
import { MediaThumbnail } from "./MediaThumbnail";
import { GatewayProbeConfig } from "./GatewayProbeConfig";
import { BotAdminPanel } from "./BotAdminPanel";
import { AnnouncementRichTextEditor } from "./AnnouncementRichTextEditor";

type SectionKey = "overview" | "site" | "announcement" | "banner" | "source" | "candidates" | "submissions" | "searches" | "ads" | "gateways" | "projects" | "bots";
type Candidate = { id: string; externalId: string; name: string; directoryUrl: string; homepageUrl: string | null; logoUrl: string | null; firstSeenAt: string; sourceSyncedAt: string | null; reviewStatus: string; dataSource: { key: string; name: string }; _count: { offerCandidates: number } };
type CandidatePage = { items: Candidate[]; total: number; offerTotal: number; page: number; pageSize: number; totalPages: number };
type Source = { id: string; key: string; name: string; kind: string; enabled: boolean; pollIntervalSeconds: number; lastCheckedAt: string | null; lastSuccessAt: string | null; lastSnapshotId: string | null; nextRunAt: string | null };
type Run = { id: string; kind: string; status: string; createdAt: string; counts: Record<string, unknown> | null; dataSource: { name: string } };
type DiscoveryResult = { runId: string; pages: number; totalPages: number; totalShops: number; uniqueShops: number; created: number; updated: number; unchanged: number; pageDuplicates: number; caseVariantSkipped: number; productShopsRequested?: number; productShopsSucceeded?: number; productShopsFailed?: number; productsUpserted?: number; offersPromoted?: number; offersDeactivated?: number; categoriesSynced?: number; sampleCreated: Array<{ token: string; name: string }> };
type ProductBackfillStatus = { totalShops: number; syncedShops: number; remainingShops: number; activeRun: { id: string; status: string; counts: Record<string, unknown> | null; createdAt: string } | null };
type HotSearch = { id: string; term: string; position: number; active: boolean };
type Listing = { id: string; title: string; description: string; url: string; thumbnailUrl: string | null; badge: string | null; modelTags: string[]; pricingClaims: string | null; active: boolean; position: number };
type ListingDraft = { title: string; description: string; url: string; thumbnailUrl: string; badge: string; modelTags: string; pricingClaims: string };
type SearchAdDraft = { title: string; description: string; url: string; backgroundImageUrl: string; logoUrl: string; label: string; keywords: string; content: AnnouncementSegment[]; global: boolean; startsAt: string; endsAt: string; active: boolean; clearBackgroundImage: boolean; clearLogo: boolean };
type SideAdDraft = { title: string; url: string; imageUrl: string; label: string; active: boolean; clearImage: boolean };
type GatewayReviewStatus = "pending" | "approved" | "rejected" | "duplicate" | "source_removed";
type GatewayDisplayGroup = { id: string; key: string; name: string; position: number; active: boolean; count: number; filteredCount: number };
type GatewayDirectoryAdminItem = {
  id: string; sourceSiteId: string; slug: string; name: string; description: string; sourceSection: string;
  sourceRedirectUrl: string; destinationHost: string | null; logoUrl: string | null; sponsored: boolean;
  online: boolean | null; upVotes: number; downVotes: number; availability7d: number | null; modelTags: string[];
  reviewStatus: GatewayReviewStatus; active: boolean; featured: boolean; manual: boolean; suspectedDuplicate: boolean; lastSeenAt: string;
  displayGroup: Pick<GatewayDisplayGroup, "id" | "key" | "name" | "position"> | null;
};
type GatewayDirectoryAdminPage = {
  items: GatewayDirectoryAdminItem[]; total: number; page: number; pageSize: number; totalPages: number;
  counts: Partial<Record<GatewayReviewStatus, number>>;
  group: string; unassignedCount: number; filteredUnassignedCount: number;
  lastRun: { status: string; mode: string; completeFeed: boolean; counts: Record<string, number> | null; errorMessage: string | null; finishedAt: string | null } | null;
  schedule: { enabled: boolean; intervalMinutes: number; lastCheckedAt: string | null; lastSuccessAt: string | null; nextRunAt: string | null };
  displayGroups: GatewayDisplayGroup[];
};
type ManualGatewayDraft = { name: string; url: string; logoUrl: string; description: string; modelTags: string; pricingClaims: string; displayGroupId: string };
type SubmissionKind = "shop" | "gateway";
type SubmissionStatus = "pending" | "published" | "rejected";
type SubmissionPublished = { type: SubmissionKind; id: string; name: string; description: string; url: string; logoUrl?: string; modelTags?: string; pricingClaims?: string; displayGroupId?: string };
type SubmissionItem = { id: string; kind: SubmissionKind; name: string; url: string; contactEmail: string; description: string; authorizationConfirmed: boolean; status: SubmissionStatus; reviewNote: string | null; reviewedAt: string | null; createdAt: string; published: SubmissionPublished | null };
type SubmissionPage = { items: SubmissionItem[]; total: number; pending: number; page: number; pageSize: number; totalPages: number };
type AdminRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

const sections = [
  { key: "overview" as const, label: "数据概览", Icon: Gauge },
  { key: "site" as const, label: "网站设置", Icon: Gear },
  { key: "announcement" as const, label: "顶部公告", Icon: Megaphone },
  { key: "banner" as const, label: "首页广告", Icon: ImageSquare },
  { key: "source" as const, label: "链动小店采集", Icon: Database },
  { key: "candidates" as const, label: "候选审核", Icon: ShieldCheck },
  { key: "submissions" as const, label: "收录投稿", Icon: LinkSimple },
  { key: "searches" as const, label: "热门搜索词", Icon: MagnifyingGlass },
  { key: "ads" as const, label: "搜索广告", Icon: Tag },
  { key: "gateways" as const, label: "中转站展示", Icon: ArrowsLeftRight },
  { key: "projects" as const, label: "热门项目展示", Icon: Fire },
  { key: "bots" as const, label: "机器人接入", Icon: Robot },
];

const emptyRichTextSegment: AnnouncementSegment = { text: "", bold: false, italic: false, underline: false, color: "default", href: null };
const emptyListingDraft: ListingDraft = { title: "", description: "", url: "", thumbnailUrl: "", badge: "", modelTags: "", pricingClaims: "" };
const emptySearchAdDraft: SearchAdDraft = { title: "", description: "", url: "", backgroundImageUrl: "", logoUrl: "", label: "广告", keywords: "", content: [{ ...emptyRichTextSegment }], global: false, startsAt: "", endsAt: "", active: true, clearBackgroundImage: false, clearLogo: false };
const emptyManualGatewayDraft: ManualGatewayDraft = { name: "", url: "", logoUrl: "", description: "", modelTags: "", pricingClaims: "", displayGroupId: "" };

export function AdminIngestion() {
  const [active, setActive] = useState<SectionKey>("overview");
  const [candidates, setCandidates] = useState<CandidatePage | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [hotSearches, setHotSearches] = useState<HotSearch[]>([]);
  const [searchAds, setSearchAds] = useState<SearchAd[]>([]);
  const [gateways, setGateways] = useState<Listing[]>([]);
  const [gatewayDirectory, setGatewayDirectory] = useState<GatewayDirectoryAdminPage | null>(null);
  const [gatewayReviewStatus, setGatewayReviewStatus] = useState<GatewayReviewStatus>("pending");
  const [gatewayGroupFilter, setGatewayGroupFilter] = useState("all");
  const [gatewayPage, setGatewayPage] = useState(1);
  const [gatewaySelected, setGatewaySelected] = useState<Set<string>>(new Set());
  const [submissions, setSubmissions] = useState<SubmissionPage | null>(null);
  const [submissionKind, setSubmissionKind] = useState<SubmissionKind | "all">("all");
  const [submissionStatus, setSubmissionStatus] = useState<SubmissionStatus | "all">("pending");
  const [submissionPage, setSubmissionPage] = useState(1);
  const [projects, setProjects] = useState<Listing[]>([]);
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);
  const [homeBanner, setHomeBanner] = useState<AdminHomeBanner | null>(null);
  const [sideAds, setSideAds] = useState<AdminSideAd[]>([]);
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [productBackfill, setProductBackfill] = useState<ProductBackfillStatus | null>(null);
  const [bots, setBots] = useState<BotAdminOverview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newHotSearch, setNewHotSearch] = useState("");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);

  const request = useCallback<AdminRequest>(async (path, init) => {
    const response = await fetch(`/api/v1/admin${path}`, { credentials: "include", ...init });
    if (response.status === 401) { setUnauthorized(true); throw new Error("请先使用管理员账户登录"); }
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : `请求失败 (${response.status})`);
    return payload as never;
  }, []);

  const refresh = useCallback(async () => {
    try {
      const sessionResponse = await fetch("/api/v1/auth/me", { credentials: "include" });
      const session = await sessionResponse.json().catch(() => null) as { user?: { role?: string } | null } | null;
      if (!sessionResponse.ok) throw new Error(`会话检查失败 (${sessionResponse.status})`);
      if (!session?.user || !["moderator", "admin"].includes(session.user.role || "")) {
        setUnauthorized(true);
        setError("");
        return;
      }
      const [candidatePage, submissionPageData, sourceList, runList, hotList, searchAdList, gatewayList, gatewayDirectoryPage, projectList, settings, announcementConfig, banner, sideAdList, backfill, botOverview] = await Promise.all([
        request<CandidatePage>(`/candidates?status=pending&source=ldxp&pageSize=50&page=${page}`),
        request<SubmissionPage>(`/submissions?kind=${submissionKind}&status=${submissionStatus}&pageSize=30&page=${submissionPage}`),
        request<Source[]>("/sources"), request<Run[]>("/runs"), request<HotSearch[]>("/hot-searches"),
        request<SearchAd[]>("/search-ads"),
        request<Listing[]>("/listings?type=gateway"),
        request<GatewayDirectoryAdminPage>(`/gateway-directory?status=${gatewayReviewStatus}&group=${encodeURIComponent(gatewayGroupFilter)}&pageSize=30&page=${gatewayPage}`),
        request<Listing[]>("/listings?type=project"),
        request<SiteSettings>("/site-settings"), request<Announcement>("/announcement"), request<AdminHomeBanner>("/home-banner"), request<AdminSideAd[]>("/side-ads"), request<ProductBackfillStatus>("/sources/ldxp/product-backfill"),
        request<BotAdminOverview>("/bots"),
      ]);
      setCandidates(candidatePage); setSubmissions(submissionPageData); setSources(sourceList); setRuns(runList); setHotSearches(hotList); setSearchAds(searchAdList); setGateways(gatewayList); setGatewayDirectory(gatewayDirectoryPage); setProjects(projectList); setSiteSettings(settings); setAnnouncement(announcementConfig); setHomeBanner(banner); setSideAds(sideAdList); setProductBackfill(backfill); setBots(botOverview); setUnauthorized(false); setError("");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "加载失败"); }
  }, [page, gatewayGroupFilter, gatewayPage, gatewayReviewStatus, request, submissionKind, submissionPage, submissionStatus]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!productBackfill?.activeRun) return;
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [productBackfill?.activeRun, refresh]);
  const pendingOffers = useMemo(() => candidates?.offerTotal || 0, [candidates]);

  async function act(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key); setError(""); setMessage("");
    try { await action(); setMessage(success); setSelected(new Set()); await refresh(); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "操作失败"); }
    finally { setBusy(null); }
  }

  if (unauthorized) return <section className="admin-auth-state"><ShieldCheck /><h1>需要运营权限</h1><p>请使用 moderator 或 admin 账户登录后访问运营后台。</p><Link className="button dark" href="/account">前往登录</Link></section>;

  return <main className="admin-console">
    <aside className="admin-sidebar" aria-label="后台模块导航">
      <div className="admin-sidebar-brand"><span><SidebarSimple /></span><div><strong>{siteSettings?.siteName || "AI卡网"}后台</strong><small>运营管理系统</small></div></div>
      <nav>{sections.map(({ key, label, Icon }) => <button type="button" key={key} className={active === key ? "is-active" : ""} aria-current={active === key ? "page" : undefined} onClick={() => setActive(key)}><Icon /><span>{label}</span>{key === "submissions" && Boolean(submissions?.pending) && <b className="admin-nav-count">{submissions?.pending}</b>}</button>)}</nav>
      <div className="admin-sidebar-foot"><span className="source-state active">链动小店</span><small>唯一采集来源</small></div>
    </aside>

    <section className="admin-workspace">
      <header className="admin-workspace-head"><div><span className="kicker">运营控制台</span><h1>{sections.find((item) => item.key === active)?.label}</h1></div><button className="button ghost" type="button" disabled={Boolean(busy)} onClick={() => void refresh()}><ArrowsClockwise />刷新数据</button></header>
      <div className="admin-status" aria-live="polite">{message && <p className="admin-success"><CheckCircle />{message}</p>}{error && <p className="admin-error"><WarningCircle />{error}</p>}</div>

      {active === "overview" && <Overview candidates={candidates} pendingOffers={pendingOffers} runs={runs} sources={sources} />}
      {active === "site" && <SiteSettingsPanel settings={siteSettings} busy={busy} request={request} act={act} onSaved={setSiteSettings} />}
      {active === "announcement" && <AnnouncementPanel announcement={announcement} busy={busy} request={request} act={act} />}
      {active === "banner" && <HomeBannerPanel banner={homeBanner} sideAds={sideAds} busy={busy} request={request} act={act} />}
      {active === "source" && <SourcePanel sources={sources} runs={runs} productBackfill={productBackfill} busy={busy} request={request} act={act} />}
      {active === "candidates" && <CandidatesPanel candidates={candidates} selected={selected} setSelected={setSelected} page={page} setPage={setPage} busy={busy} request={request} act={act} />}
      {active === "submissions" && <SubmissionPanel data={submissions} kind={submissionKind} setKind={setSubmissionKind} status={submissionStatus} setStatus={setSubmissionStatus} page={submissionPage} setPage={setSubmissionPage} groups={gatewayDirectory?.displayGroups || []} busy={busy} request={request} act={act} />}
      {active === "searches" && <HotSearchPanel items={hotSearches} newTerm={newHotSearch} setNewTerm={setNewHotSearch} busy={busy} request={request} act={act} />}
      {active === "ads" && <SearchAdPanel items={searchAds} busy={busy} request={request} act={act} />}
      {active === "gateways" && <><GatewayDirectoryPanel data={gatewayDirectory} notice={siteSettings?.gatewayNotice || null} status={gatewayReviewStatus} setStatus={setGatewayReviewStatus} groupFilter={gatewayGroupFilter} setGroupFilter={setGatewayGroupFilter} selected={gatewaySelected} setSelected={setGatewaySelected} page={gatewayPage} setPage={setGatewayPage} busy={busy} request={request} act={act} /><ListingPanel type="gateway" title="中转站赞助位" items={gateways} busy={busy} request={request} act={act} /></>}
      {active === "projects" && <ListingPanel type="project" title="热门项目" items={projects} busy={busy} request={request} act={act} />}
      {active === "bots" && <BotAdminPanel data={bots} busy={busy} request={request} act={act} />}
    </section>
  </main>;
}

function Overview({ candidates, pendingOffers, runs, sources }: { candidates: CandidatePage | null; pendingOffers: number; runs: Run[]; sources: Source[] }) {
  return <div className="admin-module"><section className="admin-metrics" aria-label="数据概览"><div><Storefront /><span>待审店铺<strong>{candidates?.total ?? "—"}</strong></span></div><div><Database /><span>候选报价<strong>{pendingOffers}</strong></span></div><div><ShieldCheck /><span>采集来源<strong>{sources.length}</strong></span></div><div><ArrowsClockwise /><span>最近批次<strong>{runs[0]?.status || "暂无"}</strong></span></div></section><section className="admin-panel"><div className="admin-section-head"><div><span className="kicker">最近任务</span><h2>导入记录</h2></div></div><div className="admin-run-list">{runs.slice(0, 10).map((run) => <div key={run.id}><span className={`run-state ${run.status.toLowerCase()}`}>{run.status}</span><strong>{run.kind}</strong><small>{run.dataSource.name} · {formatTime(run.createdAt)}</small></div>)}{!runs.length && <div className="admin-empty compact"><Database /><strong>暂无导入记录</strong></div>}</div></section></div>;
}

function SiteSettingsPanel({ settings, busy, request, act, onSaved }: { settings: SiteSettings | null; busy: string | null; request: AdminRequest; act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void>; onSaved: (settings: SiteSettings) => void }) {
  const [draft, setDraft] = useState({ siteName: "", slogan: "", description: "", seoTitle: "", seoDescription: "", seoKeywords: "" });
  const [logo, setLogo] = useState<File | null>(null);
  const [dirty, setDirty] = useState(false);
  const preview = useObjectPreview(logo, settings?.logoUrl || null);
  useEffect(() => {
    if (!settings || dirty) return;
    setDraft({ siteName: settings.siteName, slogan: settings.slogan, description: settings.description, seoTitle: settings.seoTitle, seoDescription: settings.seoDescription, seoKeywords: settings.seoKeywords.join("，") });
  }, [dirty, settings]);
  function update(field: keyof typeof draft, value: string) { setDirty(true); setDraft((current) => ({ ...current, [field]: value })); }
  function submit(event: FormEvent) {
    event.preventDefault();
    const form = new FormData();
    Object.entries(draft).forEach(([key, value]) => form.append(key, value));
    if (logo) form.append("logo", logo);
    void act("site-settings", async () => {
      const saved = await request<SiteSettings>("/site-settings", { method: "POST", body: form });
      setDirty(false);
      onSaved(saved);
      setLogo(null);
      window.dispatchEvent(new Event("ai-card-site-settings-changed"));
    }, "网站设置已保存，前台品牌与 SEO 已更新");
  }
  return <div className="admin-module">
    <section className="admin-panel"><div className="admin-section-head"><div><span className="kicker">品牌展示</span><h2>网站基础信息</h2></div><small className="admin-muted">保存后前台导航和页脚同步更新</small></div>
      <form className="site-settings-form" onSubmit={submit}>
        <div className="brand-upload-block">
          <div className="brand-upload-preview">{preview ? <img src={preview} alt="当前网站 Logo 预览" /> : <span><Storefront /></span>}</div>
          <div><strong>网站 Logo</strong><p>建议使用 1:1 的 PNG、JPEG 或 WebP，最大 2 MB。</p><label className="button ghost compact"><UploadSimple />选择图片<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setLogo(event.target.files?.[0] || null)} /></label>{logo && <small>{logo.name}</small>}</div>
        </div>
        <div className="settings-fields">
          <label><span>网站名称 <b>*</b></span><input required maxLength={40} value={draft.siteName} onChange={(event) => update("siteName", event.target.value)} /></label>
          <label><span>广告语 / 英文名</span><input maxLength={80} value={draft.slogan} onChange={(event) => update("slogan", event.target.value)} placeholder="显示在网站名称下方" /></label>
          <label className="full"><span>网站描述 <b>*</b></span><textarea required rows={3} maxLength={500} value={draft.description} onChange={(event) => update("description", event.target.value)} /><small>用于页脚的平台定位说明。</small></label>
          <label className="full"><span>SEO 标题 <b>*</b></span><input required maxLength={100} value={draft.seoTitle} onChange={(event) => update("seoTitle", event.target.value)} /><small>浏览器标题将显示为“网站名称 - SEO 标题”。</small></label>
          <label className="full"><span>SEO 描述 <b>*</b></span><textarea required rows={3} maxLength={300} value={draft.seoDescription} onChange={(event) => update("seoDescription", event.target.value)} /></label>
          <label className="full"><span>关键词描述</span><input maxLength={500} value={draft.seoKeywords} onChange={(event) => update("seoKeywords", event.target.value)} placeholder="AI比价，数字商品，店铺导航" /><small>使用中文或英文逗号分隔，最多 20 个关键词。</small></label>
        </div>
        <div className="settings-submit"><button className="button dark" type="submit" disabled={!settings || Boolean(busy)}>{busy === "site-settings" ? <ArrowsClockwise className="spin" /> : <CheckCircle />}保存网站设置</button></div>
      </form>
    </section>
  </div>;
}

const emptyAnnouncementSegment = emptyRichTextSegment;

function AnnouncementPanel({ announcement, busy, request, act }: { announcement: Announcement | null; busy: string | null; request: AdminRequest; act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [draft, setDraft] = useState<{ label: string; content: AnnouncementSegment[]; enabled: boolean; dismissible: boolean; startsAt: string; endsAt: string }>({ label: "公告", content: [{ ...emptyAnnouncementSegment }], enabled: false, dismissible: true, startsAt: "", endsAt: "" });
  const loadedVersion = useRef<string | null>(null);
  useEffect(() => {
    if (!announcement || loadedVersion.current === announcement.updatedAt) return;
    setDraft({ label: announcement.label, content: announcement.content.length ? announcement.content : [{ ...emptyAnnouncementSegment }], enabled: announcement.enabled, dismissible: announcement.dismissible, startsAt: toDatetimeLocal(announcement.startsAt), endsAt: toDatetimeLocal(announcement.endsAt) });
    loadedVersion.current = announcement.updatedAt;
  }, [announcement]);
  function payload(enabled = draft.enabled, clear = false) {
    const content = clear ? [] : trimAnnouncementEdges(draft.content).filter((segment) => segment.text.trim()).map((segment) => ({ ...segment, href: segment.href?.trim() || null }));
    return {
      label: draft.label.trim() || "公告",
      content,
      enabled,
      dismissible: draft.dismissible,
      startsAt: draft.startsAt || null,
      endsAt: draft.endsAt || null,
    };
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void act("announcement-save", async () => {
      await request("/announcement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
      window.dispatchEvent(new Event("ai-card-site-settings-changed"));
    }, draft.enabled ? "顶部公告已保存并启用" : "顶部公告已保存，当前未启用");
  }
  function clear() {
    void act("announcement-clear", async () => {
      await request("/announcement", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload(false, true)) });
      window.dispatchEvent(new Event("ai-card-site-settings-changed"));
    }, "顶部公告已清空并停用");
  }
  return <div className="admin-module"><section className="admin-panel">
    <div className="admin-section-head"><div><span className="kicker">全站运营</span><h2>顶部公告</h2></div><span className={announcement?.enabled ? "source-state active" : "source-state manual"}>{announcement?.enabled ? "已启用" : "未启用"}</span></div>
    <form className="announcement-admin-editor" onSubmit={save}>
      <div className="settings-fields announcement-meta-fields">
        <label><span>公告前缀</span><input required maxLength={20} value={draft.label} onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))} placeholder="公告 / 通知 / 维护" /></label>
        <label><span>开始时间</span><input type="datetime-local" value={draft.startsAt} onChange={(event) => setDraft((current) => ({ ...current, startsAt: event.target.value }))} /></label>
        <label><span>结束时间</span><input type="datetime-local" value={draft.endsAt} onChange={(event) => setDraft((current) => ({ ...current, endsAt: event.target.value }))} /></label>
      </div>
      <div className="announcement-editor-block"><span>公告内容</span><AnnouncementRichTextEditor value={draft.content} disabled={Boolean(busy)} onChange={(content) => setDraft((current) => ({ ...current, content }))} /></div>
      <div className="announcement-preview-block"><span>当前公告预览</span><div className="announcement-preview"><span className="announcement-label"><Megaphone />{draft.label || "公告"}</span><p>{draft.content.map((segment, index) => {
        const className = `announcement-segment color-${segment.color}${segment.bold ? " is-bold" : ""}${segment.italic ? " is-italic" : ""}${segment.underline ? " is-underlined" : ""}`;
        return segment.href ? <a className={className} href={segment.href} key={index} target={segment.href.startsWith("https://") ? "_blank" : undefined} rel={segment.href.startsWith("https://") ? "noopener noreferrer" : undefined}>{segment.text}</a> : <span className={className} key={index}>{segment.text || (index === 0 ? "公告内容将在这里显示" : "")}</span>;
      })}</p></div></div>
      <div className="announcement-toggle-grid">
        <label className="banner-active-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))} /><span aria-hidden="true" /><strong>启用顶部公告</strong><small>仅在设置的有效时间内显示。</small></label>
        <label className="banner-active-toggle"><input type="checkbox" checked={draft.dismissible} onChange={(event) => setDraft((current) => ({ ...current, dismissible: event.target.checked }))} /><span aria-hidden="true" /><strong>允许用户关闭</strong><small>关闭后当前页面隐藏，刷新网页会再次显示。</small></label>
      </div>
      <div className="settings-submit announcement-submit"><button className="button ghost" type="button" disabled={!announcement || Boolean(busy)} onClick={clear}><XCircle />清空并停用</button><button className="button dark" type="submit" disabled={!announcement || Boolean(busy)}>{busy === "announcement-save" ? <ArrowsClockwise className="spin" /> : <CheckCircle />}保存顶部公告</button></div>
    </form>
  </section></div>;
}

function trimAnnouncementEdges(content: AnnouncementSegment[]) {
  const result = content.map((segment) => ({ ...segment }));
  while (result.length && !result[0].text.trim()) result.shift();
  while (result.length && !result[result.length - 1].text.trim()) result.pop();
  if (result.length) {
    result[0].text = result[0].text.trimStart();
    result[result.length - 1].text = result[result.length - 1].text.trimEnd();
  }
  return result;
}

function HomeBannerPanel({ banner, sideAds, busy, request, act }: { banner: AdminHomeBanner | null; sideAds: AdminSideAd[]; busy: string | null; request: AdminRequest; act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [draft, setDraft] = useState({ title: "", summary: "", buttonLabel: "了解详情", targetUrl: "", label: "广告", startsAt: "", endsAt: "", active: false });
  const [desktopImage, setDesktopImage] = useState<File | null>(null);
  const [mobileImage, setMobileImage] = useState<File | null>(null);
  const desktopPreview = useObjectPreview(desktopImage, banner?.imageDesktop || null);
  const mobilePreview = useObjectPreview(mobileImage, banner?.imageMobile || banner?.imageDesktop || null);
  useEffect(() => {
    if (!banner) return;
    setDraft({ title: banner.title, summary: banner.summary, buttonLabel: banner.buttonLabel, targetUrl: banner.targetUrl === "https://example.com" && !banner.imageDesktop ? "" : banner.targetUrl, label: banner.label, startsAt: toDatetimeLocal(banner.startsAt), endsAt: toDatetimeLocal(banner.endsAt), active: banner.active });
  }, [banner]);
  function update(field: keyof typeof draft, value: string | boolean) { setDraft((current) => ({ ...current, [field]: value })); }
  function submit(event: FormEvent) {
    event.preventDefault();
    const form = new FormData();
    Object.entries(draft).forEach(([key, value]) => form.append(key, String(value)));
    if (desktopImage) form.append("desktopImage", desktopImage);
    if (mobileImage) form.append("mobileImage", mobileImage);
    void act("home-banner", async () => {
      await request("/home-banner", { method: "POST", body: form });
      setDesktopImage(null); setMobileImage(null);
    }, draft.active ? "首页广告已保存并启用" : "首页广告已保存，当前未启用");
  }
  return <div className="admin-module">
    <section className="admin-panel"><div className="admin-section-head"><div><span className="kicker">首页运营</span><h2>广告横幅</h2></div><span className={banner?.active ? "source-state active" : "source-state manual"}>{banner?.active ? "展示中" : "未启用"}</span></div>
      <form className="banner-settings-form" onSubmit={submit}>
        <div className="banner-upload-grid">
          <label className="banner-upload desktop"><span>桌面广告图 <b>*</b></span><div>{desktopPreview ? <img src={desktopPreview} alt="桌面广告图预览" /> : <span><ImageSquare /><strong>1600 × 320</strong><small>建议 5:1 横幅</small></span>}</div><span className="button ghost compact"><UploadSimple />选择桌面图</span><input type="file" accept="image/png,image/jpeg,image/webp" required={draft.active && !banner?.imageDesktop && !desktopImage} onChange={(event) => setDesktopImage(event.target.files?.[0] || null)} /></label>
          <label className="banner-upload mobile"><span>移动广告图</span><div>{mobilePreview ? <img src={mobilePreview} alt="移动广告图预览" /> : <span><ImageSquare /><strong>800 × 400</strong><small>未上传时使用桌面图</small></span>}</div><span className="button ghost compact"><UploadSimple />选择移动图</span><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => setMobileImage(event.target.files?.[0] || null)} /></label>
        </div>
        <div className="settings-fields banner-fields">
          <label><span>广告标题</span><input maxLength={80} value={draft.title} onChange={(event) => update("title", event.target.value)} /></label>
          <label><span>广告标识</span><input required maxLength={20} value={draft.label} onChange={(event) => update("label", event.target.value)} /></label>
          <label className="full"><span>广告摘要</span><textarea rows={3} maxLength={200} value={draft.summary} onChange={(event) => update("summary", event.target.value)} /></label>
          <label><span>按钮文案</span><input maxLength={20} value={draft.buttonLabel} onChange={(event) => update("buttonLabel", event.target.value)} /></label>
          <label><span>目标链接</span><input type="url" pattern="https://.*" value={draft.targetUrl} onChange={(event) => update("targetUrl", event.target.value)} placeholder="选填：https://example.com" /><small>选填；填写后点击广告图跳转，仅允许无账号密码的 HTTPS 地址。</small></label>
          <label><span>开始时间</span><input type="datetime-local" value={draft.startsAt} onChange={(event) => update("startsAt", event.target.value)} /></label>
          <label><span>结束时间</span><input type="datetime-local" value={draft.endsAt} onChange={(event) => update("endsAt", event.target.value)} /></label>
        </div>
        <label className="banner-active-toggle"><input type="checkbox" checked={draft.active} onChange={(event) => update("active", event.target.checked)} /><span aria-hidden="true" /><strong>启用首页广告</strong><small>仅在有效时间内展示；关闭后首页广告区域自动收起。</small></label>
        <div className="settings-submit"><button className="button dark" type="submit" disabled={!banner || Boolean(busy)}>{busy === "home-banner" ? <ArrowsClockwise className="spin" /> : <CheckCircle />}保存首页广告</button></div>
      </form>
    </section>
    <SideAdsPanel items={sideAds} busy={busy} request={request} act={act} />
  </div>;
}

function SideAdsPanel({ items, busy, request, act }: { items: AdminSideAd[]; busy: string | null; request: AdminRequest; act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const bySlot = (slot: SideAdSlot) => items.find((item) => item.slot === slot) || null;
  return <section className="admin-panel side-ads-admin-panel">
    <div className="admin-section-head"><div><span className="kicker">首页桌面端</span><h2>页面侧边广告</h2></div><small className="admin-muted">左右各一个广告位；屏幕较窄或移动端不会展示</small></div>
    <div className="side-ads-admin-grid">
      <SideAdEditor slot="left" item={bySlot("left")} busy={busy} request={request} act={act} />
      <SideAdEditor slot="right" item={bySlot("right")} busy={busy} request={request} act={act} />
    </div>
  </section>;
}

function SideAdEditor({ slot, item, busy, request, act }: { slot: SideAdSlot; item: AdminSideAd | null; busy: string | null; request: AdminRequest; act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [draft, setDraft] = useState<SideAdDraft>({ title: "", url: "", imageUrl: "", label: "广告", active: false, clearImage: false });
  const [image, setImage] = useState<File | null>(null);
  const preview = useObjectPreview(image, draft.clearImage ? null : (draft.imageUrl || item?.imageUrl || null));
  useEffect(() => {
    if (!item) return;
    setDraft({ title: item.title, url: item.url === "https://example.com" && !item.imageUrl ? "" : item.url, imageUrl: item.imageUrl?.startsWith("https://") ? item.imageUrl : "", label: item.label, active: item.active, clearImage: false });
    setImage(null);
  }, [item?.id, item?.updatedAt]);
  const update = (field: keyof SideAdDraft, value: string | boolean) => setDraft((current) => ({ ...current, [field]: value }));
  const sideLabel = slot === "left" ? "左侧广告" : "右侧广告";
  function submit(event: FormEvent) {
    event.preventDefault();
    const form = new FormData();
    Object.entries(draft).forEach(([key, value]) => form.append(key, String(value)));
    if (image) form.append("image", image);
    void act(`side-ad-${slot}`, async () => {
      await request(`/side-ads/${slot}`, { method: "POST", body: form });
      setImage(null);
    }, `${sideLabel}已保存`);
  }
  return <article className="side-ad-admin-editor">
    <div className="side-ad-admin-heading"><div><span className="kicker">{slot === "left" ? "LEFT" : "RIGHT"}</span><h3>{sideLabel}</h3></div><span className={item?.active ? "source-state active" : "source-state manual"}>{item?.active ? "展示中" : "未启用"}</span></div>
    <form className="side-ad-admin-form" onSubmit={submit}>
      <div className="side-ad-admin-preview">{preview ? <img src={preview} alt={`${sideLabel}预览`} /> : <><ImageSquare /><span>尚未设置图片</span></>}</div>
      <p className="side-ad-size-hint">推荐尺寸：800 × 1000 px（4:5），最大 5 MB。其他比例会完整缩放显示，不会裁剪。</p>
      <label><span>广告标题</span><input required maxLength={100} value={draft.title} onChange={(event) => update("title", event.target.value)} placeholder="例如：新用户优惠" /></label>
      <label><span>跳转链接</span><input required type="url" pattern="https://.*" value={draft.url} onChange={(event) => update("url", event.target.value)} placeholder="https://example.com" /><small>只允许无账号密码的 HTTPS 地址。</small></label>
      <label><span>图片 URL</span><input type="url" pattern="https://.*" value={draft.imageUrl} onChange={(event) => { setImage(null); update("imageUrl", event.target.value); update("clearImage", event.target.value ? false : draft.clearImage); }} placeholder="选填，也可上传本地图片" /><small>远程图片同样只允许 HTTPS。</small></label>
      <div className="side-ad-image-actions"><label className="button ghost compact"><UploadSimple />上传图片<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0] || null; if (!file) return; if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) { setImage(null); return; } setImage(file); update("imageUrl", ""); update("clearImage", false); }} /></label><button className="button ghost compact" type="button" disabled={!item?.imageUrl && !draft.imageUrl && !image} onClick={() => { setImage(null); update("imageUrl", ""); update("clearImage", true); }}>清除图片</button></div>
      <label><span>广告标识</span><input required maxLength={20} value={draft.label} onChange={(event) => update("label", event.target.value)} /></label>
      <label className="side-ad-active-toggle"><input type="checkbox" checked={draft.active} onChange={(event) => update("active", event.target.checked)} /><span aria-hidden="true" /><strong>启用{sideLabel}</strong><small>没有图片时无法启用。</small></label>
      <button className="button dark" type="submit" disabled={Boolean(busy)}>{busy === `side-ad-${slot}` ? <ArrowsClockwise className="spin" /> : <CheckCircle />}保存{sideLabel}</button>
    </form>
    <div className="side-ad-admin-metrics"><span>曝光 <b>{item?.impressionCount ?? 0}</b></span><span>点击 <b>{item?.clickCount ?? 0}</b></span><span>更新于 {item?.updatedAt ? formatTime(item.updatedAt) : "尚未保存"}</span></div>
  </article>;
}

function SourcePanel({ sources, runs, productBackfill, busy, request, act }: { sources: Source[]; runs: Run[]; productBackfill: ProductBackfillStatus | null; busy: string | null; request: AdminRequest; act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const source = sources[0];
  const [enabled, setEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState("360");
  const [discoveryPages, setDiscoveryPages] = useState("20");
  const [backfillBatchSize, setBackfillBatchSize] = useState("5");
  const [discoveryResult, setDiscoveryResult] = useState<DiscoveryResult | null>(null);
  useEffect(() => {
    if (!source) return;
    setEnabled(source.enabled);
    setIntervalMinutes(String(Math.max(30, Math.round(source.pollIntervalSeconds / 60) || 360)));
  }, [source]);
  const latestRun = runs.find((run) => run.dataSource.name.includes("链动"));
  return <div className="admin-module">
    <section className="admin-panel source-focus"><div className="source-focus-icon"><Database /></div><div><span className="kicker">唯一数据来源</span><h2>{source?.name || "链动小店"}</h2><p>从 211b 已授权公开目录发现链动店铺、分类和商品，保存链动原始链接；前台购买统一通过本站安全跳转。</p><dl><div><dt>目录来源</dt><dd>211b.site/shops</dd></div><div><dt>购买目标</dt><dd>pay.ldxp.cn</dd></div><div><dt>最近成功</dt><dd>{source?.lastSuccessAt ? formatTime(source.lastSuccessAt) : "等待首次同步"}</dd></div><div><dt>最近批次</dt><dd>{latestRun?.status || "暂无"}</dd></div></dl></div></section>
    <section className="admin-panel source-discovery-panel"><div className="admin-section-head"><div><span className="kicker"><MagnifyingGlass />店铺发现</span><h2>扫描 211b 店铺目录</h2></div><small className="admin-muted">扫描完成后自动排队补全新店商品</small></div>
      <form className="source-discovery-form" onSubmit={(event) => { event.preventDefault(); void act("source-discover-211b", async () => {
        const result = await request<DiscoveryResult>("/sources/ldxp/discover-211b", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPages: Number(discoveryPages), syncProducts: false }) });
        setDiscoveryResult(result);
        await request("/sources/ldxp/product-backfill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchSize: Number(backfillBatchSize), refreshAll: false }) });
      }, "211b 店铺目录扫描完成，新店商品补全已进入队列"); }}>
        <label><span>最多扫描页数</span><select value={discoveryPages} onChange={(event) => setDiscoveryPages(event.target.value)}><option value="1">1 页</option><option value="3">3 页</option><option value="5">5 页</option><option value="14">14 页</option><option value="20">20 页</option><option value="50">50 页</option></select></label>
        <div className="source-discovery-note"><strong>采集流程</strong><small>先保存来源页与原店地址，再由 Worker 单并发读取分类、商品和原始链接。</small></div>
        <button className="button dark" type="submit" disabled={Boolean(busy)}>{busy === "source-discover-211b" ? <ArrowsClockwise className="spin" /> : <MagnifyingGlass />}开始扫描</button>
      </form>
      {discoveryResult && <div className="source-discovery-result" aria-live="polite">
        <div><span>扫描页数</span><strong>{discoveryResult.pages} / {discoveryResult.totalPages}</strong></div>
        <div><span>目录店铺</span><strong>{discoveryResult.totalShops || discoveryResult.uniqueShops}</strong></div>
        <div><span>新增候选</span><strong>{discoveryResult.created}</strong></div>
        <div><span>更新候选</span><strong>{discoveryResult.updated}</strong></div>
        <div><span>疑似重复跳过</span><strong>{discoveryResult.caseVariantSkipped + discoveryResult.pageDuplicates}</strong></div>
        <div><span>商品同步店铺</span><strong>{discoveryResult.productShopsSucceeded ?? 0} / {discoveryResult.productShopsRequested ?? 0}</strong></div>
        <div><span>商品候选</span><strong>{discoveryResult.productsUpserted ?? 0}</strong></div>
        <div><span>分类目录</span><strong>{discoveryResult.categoriesSynced ?? 0}</strong></div>
        <div><span>正式报价更新</span><strong>{discoveryResult.offersPromoted ?? 0}</strong></div>
        <div><span>失效报价下架</span><strong>{discoveryResult.offersDeactivated ?? 0}</strong></div>
        <div><span>同步失败</span><strong>{discoveryResult.productShopsFailed ?? 0}</strong></div>
        {discoveryResult.sampleCreated.length > 0 && <p>新增示例：{discoveryResult.sampleCreated.map((item) => `${item.name} (${item.token})`).join("，")}</p>}
      </div>}
    </section>
    <section className="admin-panel source-backfill-panel"><div className="admin-section-head"><div><span className="kicker"><Database />商品数据</span><h2>补全剩余商品目录与链接</h2></div><span className={productBackfill?.activeRun ? "source-state active" : "source-state manual"}>{productBackfill?.activeRun ? "补全中" : productBackfill?.remainingShops ? "等待启动" : "已完成"}</span></div>
      <div className="source-backfill-summary">
        <div><span>店铺总数</span><strong>{productBackfill?.totalShops ?? "—"}</strong></div>
        <div><span>已补全</span><strong>{productBackfill?.syncedShops ?? "—"}</strong></div>
        <div><span>剩余店铺</span><strong>{productBackfill?.remainingShops ?? "—"}</strong></div>
        <div><span>本次已处理</span><strong>{numberFromUnknown(productBackfill?.activeRun?.counts?.processedShops)}</strong></div>
        <div><span>本次商品数</span><strong>{numberFromUnknown(productBackfill?.activeRun?.counts?.productsUpserted)}</strong></div>
        <div><span>失效报价下架</span><strong>{numberFromUnknown(productBackfill?.activeRun?.counts?.offersDeactivated)}</strong></div>
      </div>
      <form className="source-backfill-form" onSubmit={(event) => { event.preventDefault(); void act("source-product-backfill", () => request("/sources/ldxp/product-backfill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchSize: Number(backfillBatchSize), refreshAll: false }) }), "商品补全任务已启动，Worker 将分批处理全部剩余店铺"); }}>
        <label><span>每批店铺数</span><select value={backfillBatchSize} onChange={(event) => setBackfillBatchSize(event.target.value)} disabled={Boolean(productBackfill?.activeRun)}><option value="1">1 家</option><option value="5">5 家</option><option value="10">10 家</option><option value="25">25 家</option></select></label>
        <div><strong>{productBackfill?.activeRun ? `任务 ${productBackfill.activeRun.status}` : "自动续跑"}</strong><small>分类、商品链接、价格、库存和图片将按店铺唯一标识更新。</small></div>
        <div className="source-backfill-actions"><button className="button dark" type="submit" disabled={Boolean(busy) || Boolean(productBackfill?.activeRun) || !productBackfill?.remainingShops}>{busy === "source-product-backfill" || productBackfill?.activeRun ? <ArrowsClockwise className="spin" /> : <Play />}{productBackfill?.activeRun ? "正在补全" : productBackfill?.remainingShops ? "补全未采集店铺" : "已完成首次补全"}</button><button className="button ghost" type="button" disabled={Boolean(busy) || Boolean(productBackfill?.activeRun) || !productBackfill?.totalShops} onClick={() => void act("source-product-refresh", () => request("/sources/ldxp/product-backfill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchSize: Number(backfillBatchSize), refreshAll: true }) }), "全部店铺刷新任务已启动")}><ArrowsClockwise />刷新全部店铺</button></div>
      </form>
    </section>
    <section className="admin-panel source-schedule-panel"><div className="admin-section-head"><div><span className="kicker"><Timer />自动更新</span><h2>采集计划</h2></div><span className={source?.enabled ? "source-state active" : "source-state manual"}>{source?.enabled ? "运行中" : "已停用"}</span></div>
      <form className="source-schedule-form" onSubmit={(event) => { event.preventDefault(); void act("source-schedule", () => request("/sources/ldxp/schedule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled, intervalMinutes: Number(intervalMinutes) }) }), enabled ? "自动采集计划已保存" : "自动采集已停用"); }}>
        <label className="source-schedule-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span aria-hidden="true" /><strong>启用自动采集</strong><small>Worker 每分钟检查一次，到达设定间隔后执行更新。</small></label>
        <label><span>采集间隔</span><select value={intervalMinutes} onChange={(event) => setIntervalMinutes(event.target.value)} disabled={!enabled}><option value="30">30 分钟</option><option value="60">1 小时</option><option value="180">3 小时</option><option value="360">6 小时</option><option value="720">12 小时</option><option value="1440">24 小时</option></select></label>
        <div className="source-next-run"><span>下一次计划运行</span><strong>{source?.enabled && source.nextRunAt ? formatTime(source.nextRunAt) : "未安排"}</strong><small>{source?.lastCheckedAt ? `最近检查 ${formatTime(source.lastCheckedAt)}` : "尚未执行"}</small></div>
        <div className="source-schedule-actions"><button className="button dark" type="submit" disabled={Boolean(busy)}>保存设置</button><button className="button ghost" type="button" disabled={Boolean(busy)} onClick={() => void act("source-sync-now", () => request("/sources/ldxp/sync", { method: "POST" }), "同步任务已进入队列，Worker 将在一分钟内开始执行")}><Play />立即同步</button></div>
      </form>
      <p className="source-schedule-note"><WarningCircle />完整同步只读取 211b 公开目录，按固定速率逐店执行；项目仅保存并校验链动原始购买链接，不主动请求商品详情页。</p>
    </section>
  </div>;
}

function CandidatesPanel({ candidates, selected, setSelected, page, setPage, busy, request, act }: { candidates: CandidatePage | null; selected: Set<string>; setSelected: (value: Set<string>) => void; page: number; setPage: (value: number | ((current: number) => number)) => void; busy: string | null; request: AdminRequest; act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const decide = (id: string, action: "approve" | "reject") => request(`/candidates/${id}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
  const pageIds = useMemo(() => candidates?.items.map((candidate) => candidate.id) || [], [candidates]);
  const selectedOnPage = pageIds.filter((id) => selected.has(id)).length;
  const allSelectedOnPage = pageIds.length > 0 && selectedOnPage === pageIds.length;
  function toggleCurrentPage() {
    const next = new Set(selected);
    if (allSelectedOnPage) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    setSelected(next);
  }
  return <div className="admin-module"><section className="admin-panel">
    <div className="admin-section-head"><div><span className="kicker">链动小店</span><h2>待审核店铺</h2></div><div className="candidate-bulk"><span>已选 {selected.size} 家</span><button className="button ghost compact" disabled={!pageIds.length || Boolean(busy)} type="button" onClick={toggleCurrentPage}>{allSelectedOnPage ? "取消本页" : "全选本页"}</button><button className="button dark compact" disabled={!selected.size || Boolean(busy)} type="button" onClick={() => void act("batch-approve", () => request("/candidates/batch-decision", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [...selected], action: "approve" }) }), "批量批准完成")}>批量批准</button></div></div>
    <div className="candidate-list">{candidates?.items.map((candidate) => <article className="candidate-row simple" key={candidate.id}>
      <label className="candidate-check"><input type="checkbox" checked={selected.has(candidate.id)} onChange={(event) => { const next = new Set(selected); event.target.checked ? next.add(candidate.id) : next.delete(candidate.id); setSelected(next); }} /><span className="visually-hidden">选择 {candidate.name}</span></label>
      <MediaThumbnail value={candidate.logoUrl} label={candidate.name} kind="shop" />
      <div className="candidate-main"><strong>{candidate.name}</strong><small>{candidate._count.offerCandidates} 条候选报价 · 首次发现 {formatTime(candidate.firstSeenAt)}</small><span className="candidate-source-links"><a href={candidate.directoryUrl} target="_blank" rel="noreferrer">查看 211b 来源页 <Eye /></a>{candidate.homepageUrl && <a href={candidate.homepageUrl} target="_blank" rel="noreferrer">查看链动原店 <Eye /></a>}</span></div>
      <div className="candidate-actions"><button className="button dark compact" type="button" disabled={Boolean(busy)} onClick={() => void act(`approve-${candidate.id}`, () => decide(candidate.id, "approve"), `${candidate.name} 已批准并认证`)}><CheckCircle />批准</button><button className="icon-button danger" type="button" disabled={Boolean(busy)} aria-label={`拒绝 ${candidate.name}`} title="拒绝候选" onClick={() => void act(`reject-${candidate.id}`, () => decide(candidate.id, "reject"), `${candidate.name} 已拒绝`)}><XCircle /></button></div>
    </article>)}{candidates && !candidates.items.length && <div className="admin-empty"><CheckCircle /><strong>没有待审候选</strong><span>当前链动小店候选已处理完成。</span></div>}</div>
    {candidates && candidates.totalPages > 1 && <nav className="admin-pagination" aria-label="候选店铺分页"><button className="button ghost compact" type="button" disabled={page <= 1 || Boolean(busy)} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button><span>第 {candidates.page} / {candidates.totalPages} 页</span><button className="button ghost compact" type="button" disabled={page >= candidates.totalPages || Boolean(busy)} onClick={() => setPage((current) => current + 1)}>下一页</button></nav>}
  </section></div>;
}

function SubmissionPanel({ data, kind, setKind, status, setStatus, page, setPage, groups, busy, request, act }: {
  data: SubmissionPage | null;
  kind: SubmissionKind | "all";
  setKind: (value: SubmissionKind | "all") => void;
  status: SubmissionStatus | "all";
  setStatus: (value: SubmissionStatus | "all") => void;
  page: number;
  setPage: (value: number) => void;
  groups: GatewayDisplayGroup[];
  busy: string | null;
  request: AdminRequest;
  act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  function changeKind(value: SubmissionKind | "all") { setKind(value); setPage(1); }
  function changeStatus(value: SubmissionStatus | "all") { setStatus(value); setPage(1); }
  return <div className="admin-module"><section className="admin-panel submission-admin-panel">
    <div className="admin-section-head"><div><span className="kicker"><LinkSimple />公开投稿</span><h2>收录投稿审核</h2><p className="admin-muted">投稿无需登录；店铺发布后还需单独配置授权数据源，中转站按手动收录发布。</p></div><span className="result-summary">待审核 {data?.pending || 0} 条</span></div>
    <div className="submission-admin-filters"><div className="segmented" aria-label="投稿类型">{(["all", "shop", "gateway"] as const).map((value) => <button type="button" key={value} className={kind === value ? "active" : ""} onClick={() => changeKind(value)}>{value === "all" ? "全部" : value === "shop" ? "店铺" : "中转站"}</button>)}</div><div className="segmented" aria-label="审核状态">{(["pending", "published", "rejected", "all"] as const).map((value) => <button type="button" key={value} className={status === value ? "active" : ""} onClick={() => changeStatus(value)}>{value === "pending" ? "待审核" : value === "published" ? "已发布" : value === "rejected" ? "已拒绝" : "全部状态"}</button>)}</div></div>
    <div className="submission-admin-list">{data?.items.map((item) => <SubmissionReviewRow key={item.id} item={item} groups={groups} busy={busy} request={request} act={act} />)}{!data?.items.length && <div className="admin-empty compact"><LinkSimple /><strong>当前筛选下暂无投稿</strong><span>未登录用户提交的店铺和中转站会出现在这里。</span></div>}</div>
    <div className="admin-pagination"><button className="button ghost compact" type="button" disabled={page <= 1 || Boolean(busy)} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} / {Math.max(data?.totalPages || 0, 1)} 页，共 {data?.total || 0} 条</span><button className="button ghost compact" type="button" disabled={!data || page >= data.totalPages || Boolean(busy)} onClick={() => setPage(page + 1)}>下一页</button></div>
  </section></div>;
}

function SubmissionReviewRow({ item, groups, busy, request, act }: { item: SubmissionItem; groups: GatewayDisplayGroup[]; busy: string | null; request: AdminRequest; act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [name, setName] = useState(item.published?.name || item.name);
  const [url, setUrl] = useState(item.published?.url || item.url);
  const [contactEmail, setContactEmail] = useState(item.contactEmail);
  const [description, setDescription] = useState(item.published?.description || item.description);
  const [reviewNote, setReviewNote] = useState(item.reviewNote || "");
  const [logoUrl, setLogoUrl] = useState(item.published?.logoUrl || "");
  const [modelTags, setModelTags] = useState(item.published?.modelTags || "");
  const [pricingClaims, setPricingClaims] = useState(item.published?.pricingClaims || "");
  const [displayGroupId, setDisplayGroupId] = useState(item.published?.displayGroupId || "");
  const isGateway = item.kind === "gateway";
  const isPending = item.status === "pending";
  function decide(action: "publish" | "edit" | "reject") {
    if (action === "reject" && !reviewNote.trim()) return;
    void act(`submission-${item.id}`, () => request(`/submissions/${item.id}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, name, url, contactEmail, description, reviewNote, ...(isGateway ? { logoUrl, modelTags, pricingClaims, displayGroupId } : {}) }),
    }), action === "publish" ? `${item.name} 已发布` : action === "edit" ? `${item.name} 已保存修改` : `${item.name} 已拒绝并下架`);
  }
  function remove() {
    if (!window.confirm(`确定删除投稿“${item.name}”？${item.status === "published" ? "对应的前台展示也会下架。" : "删除后将不再出现在投稿列表。"}`)) return;
    void act(`submission-delete-${item.id}`, () => request(`/submissions/${item.id}`, { method: "DELETE" }), `${item.name} 投稿已删除`);
  }
  return <article className={`submission-admin-row is-${item.status}`}>
    <div className="submission-admin-summary"><span className={isGateway ? "submission-kind gateway" : "submission-kind"}>{isGateway ? <ArrowsLeftRight /> : <Storefront />}{isGateway ? "中转站" : "店铺"}</span><div><strong>{item.name}</strong><a href={item.url} target="_blank" rel="noreferrer">{item.url}</a><small>{item.contactEmail} · 提交于 {formatTime(item.createdAt)}</small></div><span className={item.status === "published" ? "source-state active" : item.status === "rejected" ? "source-state manual" : "source-state pending"}>{item.status === "published" ? "已发布" : item.status === "rejected" ? "已拒绝" : "待审核"}</span></div><div className="submission-admin-row-actions"><button className="button ghost compact danger" type="button" disabled={Boolean(busy)} onClick={remove}><Trash />删除投稿</button></div>
    {item.description && <p className="submission-admin-description">{item.description}</p>}
    {!isPending && <p className="submission-admin-reviewed">{item.reviewNote || "无审核备注"}{item.reviewedAt ? ` · ${formatTime(item.reviewedAt)}` : ""}</p>}
    <details className="submission-review-editor"><summary>{isPending ? "补全资料并审核" : "再次编辑"}</summary><div>
      <div className="submission-review-fields"><label><span>{isGateway ? "中转站名称" : "店铺名称"}</span><input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} /></label><label><span>官网链接</span><input type="url" pattern="https://.*" value={url} onChange={(event) => setUrl(event.target.value)} /></label><label><span>联系邮箱</span><input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} /></label><label className="full"><span>{isGateway ? "展示描述" : "店铺描述"}</span><textarea value={description} rows={3} maxLength={4000} onChange={(event) => setDescription(event.target.value)} /></label>{isGateway && <><label><span>Logo URL</span><input type="url" pattern="https://.*" value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="https://example.com/logo.webp" /></label><label><span>展示分组</span><select value={displayGroupId} onChange={(event) => setDisplayGroupId(event.target.value)}><option value="">其他中转站</option>{groups.filter((group) => group.active).map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label><label><span>模型标签</span><input value={modelTags} maxLength={500} onChange={(event) => setModelTags(event.target.value)} placeholder="GPT, Claude, Gemini" /></label><label><span>价格标签</span><input value={pricingClaims} maxLength={100} onChange={(event) => setPricingClaims(event.target.value)} placeholder="例如：低至 0.5 折" /></label></>}<label className="full"><span>审核备注（拒绝必填）</span><textarea value={reviewNote} rows={2} maxLength={1000} onChange={(event) => setReviewNote(event.target.value)} placeholder="说明审核结果或补充资料" /></label></div>
      <div className="submission-review-actions">{(isPending || item.status === "rejected") && <button className="button dark compact" type="button" disabled={Boolean(busy) || !name.trim()} onClick={() => decide("publish")}><CheckCircle />{isPending ? "补全并发布" : "重新发布"}</button>}{!isPending && <button className="button dark compact" type="button" disabled={Boolean(busy) || !name.trim()} onClick={() => decide("edit")}><Pencil />保存修改</button>}{(isPending || item.status === "published") && <button className="button ghost compact danger" type="button" disabled={Boolean(busy) || !reviewNote.trim()} onClick={() => decide("reject")}><XCircle />{item.status === "published" ? "拒绝并下架" : "拒绝投稿"}</button>}<button className="button ghost compact danger" type="button" disabled={Boolean(busy)} onClick={remove}><Trash />删除投稿</button></div>
    </div></details>
  </article>;
}

function HotSearchPanel({ items, newTerm, setNewTerm, busy, request, act }: { items: HotSearch[]; newTerm: string; setNewTerm: (value: string) => void; busy: string | null; request: AdminRequest; act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const reorder = (index: number, delta: number) => { const ids = items.map((item) => item.id); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; return request("/hot-searches/reorder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }); };
  return <div className="admin-module"><section className="admin-panel"><div className="admin-section-head"><div><span className="kicker">首页运营</span><h2>热门搜索词</h2></div><small className="admin-muted">启用后立即出现在首页</small></div><form className="hot-search-admin-add" onSubmit={(event) => { event.preventDefault(); if (!newTerm.trim()) return; void act("hot-add", async () => { await request("/hot-searches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ term: newTerm }) }); setNewTerm(""); }, "热门搜索词已添加"); }}><input value={newTerm} onChange={(event) => setNewTerm(event.target.value)} maxLength={40} placeholder="例如 Gemini" aria-label="新热门搜索词"/><button className="button dark compact" type="submit" disabled={Boolean(busy)}><Plus />添加</button></form><div className="hot-search-admin-list">{items.map((item, index) => <div className={item.active ? "hot-search-admin-row" : "hot-search-admin-row is-disabled"} key={item.id}><span className="hot-search-admin-index">{index + 1}</span><strong>{item.term}</strong><span className="hot-search-admin-state">{item.active ? "首页展示" : "已停用"}</span><div className="hot-search-admin-actions"><button className="icon-button" type="button" aria-label={`上移 ${item.term}`} disabled={index === 0 || Boolean(busy)} onClick={() => void act(`hot-up-${item.id}`, () => reorder(index, -1), "顺序已更新")}><ArrowUp /></button><button className="icon-button" type="button" aria-label={`下移 ${item.term}`} disabled={index === items.length - 1 || Boolean(busy)} onClick={() => void act(`hot-down-${item.id}`, () => reorder(index, 1), "顺序已更新")}><ArrowDown /></button><button className="icon-button danger" type="button" aria-label={`${item.active ? "停用" : "启用"} ${item.term}`} disabled={Boolean(busy)} onClick={() => void act(`hot-toggle-${item.id}`, () => request(`/hot-searches/${item.id}/toggle`, { method: "POST" }), `搜索词已${item.active ? "停用" : "启用"}`)}>{item.active ? <EyeSlash /> : <Eye />}</button></div></div>)}</div></section></div>;
}

function SearchAdPanel({ items, busy, request, act }: { items: SearchAd[]; busy: string | null; request: AdminRequest; act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [draft, setDraft] = useState<SearchAdDraft>(emptySearchAdDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const backgroundPreview = useObjectPreview(backgroundFile, draft.clearBackgroundImage ? null : (draft.backgroundImageUrl || items.find((item) => item.id === editingId)?.backgroundImageUrl || items.find((item) => item.id === editingId)?.imageUrl || null));
  const logoPreview = useObjectPreview(logoFile, draft.clearLogo ? null : (draft.logoUrl || items.find((item) => item.id === editingId)?.logoUrl || null));
  function update(field: keyof SearchAdDraft, value: string | boolean) { setDraft((current) => ({ ...current, [field]: value })); }
  function reset() { setDraft({ ...emptySearchAdDraft, content: [{ ...emptyRichTextSegment }] }); setEditingId(null); setBackgroundFile(null); setLogoFile(null); }
  function edit(item: SearchAd) {
    setEditingId(item.id);
    setDraft({
      title: item.title,
      description: item.description,
      url: item.url,
      backgroundImageUrl: item.backgroundImageUrl?.startsWith("https://") ? item.backgroundImageUrl : "",
      logoUrl: item.logoUrl?.startsWith("https://") ? item.logoUrl : "",
      label: item.label,
      keywords: item.keywords.join(", "),
      content: item.content.length ? item.content : [{ ...emptyRichTextSegment, text: item.description }],
      global: item.global,
      startsAt: toDatetimeLocal(item.startsAt),
      endsAt: toDatetimeLocal(item.endsAt),
      active: item.active,
      clearBackgroundImage: false,
      clearLogo: false,
    });
    setBackgroundFile(null); setLogoFile(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const form = new FormData();
    form.append("title", draft.title);
    form.append("description", draft.content.map((segment) => segment.text).join("").slice(0, 300));
    form.append("content", JSON.stringify(draft.content.filter((segment) => segment.text.trim())));
    form.append("url", draft.url); form.append("backgroundImageUrl", draft.backgroundImageUrl); form.append("logoUrl", draft.logoUrl);
    form.append("label", draft.label); form.append("keywords", draft.keywords); form.append("global", String(draft.global));
    form.append("startsAt", draft.startsAt); form.append("endsAt", draft.endsAt); form.append("active", String(draft.active));
    form.append("clearBackgroundImage", String(draft.clearBackgroundImage)); form.append("clearLogo", String(draft.clearLogo));
    if (backgroundFile) form.append("backgroundImage", backgroundFile); if (logoFile) form.append("logo", logoFile);
    void act(editingId ? `search-ad-edit-${editingId}` : "search-ad-add", async () => {
      await request(editingId ? `/search-ads/${editingId}` : "/search-ads", { method: "POST", body: form });
      reset();
    }, editingId ? "搜索广告已更新" : draft.active ? "搜索广告已添加并启用" : "搜索广告已保存，当前未启用");
  }
  const reorder = (index: number, delta: number) => { const ids = items.map((item) => item.id); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; return request("/search-ads/reorder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }); };
  return <div className="admin-module"><section className="admin-panel"><div className="admin-section-head"><div><span className="kicker">搜索结果</span><h2>{editingId ? "编辑置顶广告" : "添加置顶广告"}</h2></div><small className="admin-muted">命中关键词或全局展示时，结果顶部只显示第一条启用广告</small></div><form className="search-ad-admin-form" onSubmit={submit}>
    <label><span>广告标题 <b>*</b></span><input required maxLength={100} value={draft.title} onChange={(event) => update("title", event.target.value)} placeholder="例如 Claude Pro 稳定货源" /></label>
    <label><span>广告标识</span><input required maxLength={20} value={draft.label} onChange={(event) => update("label", event.target.value)} /></label>
    <label className="wide"><span>目标链接 <b>*</b></span><input required type="url" pattern="https://.*" value={draft.url} onChange={(event) => update("url", event.target.value)} placeholder="https://example.com" /></label>
    <label><span>背景图 URL</span><input type="url" pattern="https://.*" value={draft.backgroundImageUrl} onChange={(event) => setDraft((current) => ({ ...current, backgroundImageUrl: event.target.value, clearBackgroundImage: false }))} placeholder="https://example.com/ad.webp" /></label>
    <label><span>Logo URL</span><input type="url" pattern="https://.*" value={draft.logoUrl} onChange={(event) => setDraft((current) => ({ ...current, logoUrl: event.target.value, clearLogo: false }))} placeholder="https://example.com/logo.webp" /></label>
    <div className="search-ad-upload-grid full"><div className="search-ad-upload"><span>背景图片上传</span><div className="search-ad-upload-preview">{backgroundPreview ? <img src={backgroundPreview} alt="背景图预览" /> : <ImageSquare />}</div><label className="button ghost compact"><UploadSimple />选择背景图<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setBackgroundFile(event.target.files?.[0] || null); setDraft((current) => ({ ...current, clearBackgroundImage: false })); }} /></label>{backgroundPreview && <button className="button ghost compact danger" type="button" onClick={() => { setBackgroundFile(null); setDraft((current) => ({ ...current, backgroundImageUrl: "", clearBackgroundImage: true })); }}><XCircle />移除背景图</button>}<small>PNG、JPEG 或 WebP，最大 5 MB，前台背景区域高 120px。</small></div><div className="search-ad-upload"><span>Logo 上传</span><div className="search-ad-upload-preview logo">{logoPreview ? <img src={logoPreview} alt="Logo 预览" /> : <Tag />}</div><label className="button ghost compact"><UploadSimple />选择 Logo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setLogoFile(event.target.files?.[0] || null); setDraft((current) => ({ ...current, clearLogo: false })); }} /></label>{logoPreview && <button className="button ghost compact danger" type="button" onClick={() => { setLogoFile(null); setDraft((current) => ({ ...current, logoUrl: "", clearLogo: true })); }}><XCircle />移除 Logo</button>}<small>PNG、JPEG 或 WebP，最大 2 MB。</small></div></div>
    <label className="wide"><span>关键词</span><input maxLength={500} value={draft.keywords} onChange={(event) => update("keywords", event.target.value)} placeholder="Claude, Pro, plus" /><small>多个关键词用中文或英文逗号分隔。</small></label>
    <div className="search-ad-rich-editor full"><span>广告描述</span><AnnouncementRichTextEditor value={draft.content} disabled={Boolean(busy)} onChange={(content) => setDraft((current) => ({ ...current, content, description: content.map((segment) => segment.text).join("").slice(0, 300) }))} /></div>
    <label><span>开始时间</span><input type="datetime-local" value={draft.startsAt} onChange={(event) => update("startsAt", event.target.value)} /></label>
    <label><span>结束时间</span><input type="datetime-local" value={draft.endsAt} onChange={(event) => update("endsAt", event.target.value)} /></label>
    <label className="search-ad-toggle"><input type="checkbox" checked={draft.global} onChange={(event) => update("global", event.target.checked)} /><span aria-hidden="true" /><strong>全局展示</strong><small>没有关键词命中时也可展示。</small></label>
    <label className="search-ad-toggle"><input type="checkbox" checked={draft.active} onChange={(event) => update("active", event.target.checked)} /><span aria-hidden="true" /><strong>立即启用</strong><small>关闭后仅保存到列表。</small></label>
    <button className="button dark" type="submit" disabled={Boolean(busy)}>{editingId ? <CheckCircle /> : <Plus />}{editingId ? "保存搜索广告" : "添加搜索广告"}</button>{editingId && <button className="button ghost" type="button" disabled={Boolean(busy)} onClick={reset}><XCircle />取消编辑</button>}
  </form></section><section className="admin-panel"><div className="admin-section-head"><div><span className="kicker">展示顺序</span><h2>已添加搜索广告</h2></div><span className="result-summary">{items.filter((item) => item.active).length} 个启用</span></div><div className="search-ad-admin-list">{items.map((item, index) => <article className={item.active ? "search-ad-admin-row" : "search-ad-admin-row is-disabled"} key={item.id}><div className="search-ad-admin-media">{item.backgroundImageUrl || item.imageUrl ? <img src={item.backgroundImageUrl || item.imageUrl || ""} alt="" /> : <span className="search-ad-admin-thumb"><Tag /></span>}{item.logoUrl && <img className="search-ad-admin-logo" src={item.logoUrl} alt="" />}</div><div><strong>{item.title}<span>{item.label}</span></strong><small>{item.global ? "全局展示" : item.keywords.join("，")}</small><p>{item.description || item.url}</p><dl><div><dt>曝光</dt><dd>{item.impressionCount}</dd></div><div><dt>点击</dt><dd>{item.clickCount}</dd></div><div><dt>有效期</dt><dd>{item.startsAt || item.endsAt ? `${item.startsAt ? formatTime(item.startsAt) : "立即"} - ${item.endsAt ? formatTime(item.endsAt) : "长期"}` : "长期"}</dd></div></dl></div><span className={item.active ? "source-state active" : "source-state manual"}>{item.active ? "展示中" : "已停用"}</span><div className="admin-listing-actions"><button className="icon-button" type="button" title="编辑" aria-label={`编辑 ${item.title}`} disabled={Boolean(busy)} onClick={() => edit(item)}><Pencil /></button><button className="icon-button" type="button" aria-label={`上移 ${item.title}`} disabled={index === 0 || Boolean(busy)} onClick={() => void act(`search-ad-up-${item.id}`, () => reorder(index, -1), "广告顺序已更新")}><ArrowUp /></button><button className="icon-button" type="button" aria-label={`下移 ${item.title}`} disabled={index === items.length - 1 || Boolean(busy)} onClick={() => void act(`search-ad-down-${item.id}`, () => reorder(index, 1), "广告顺序已更新")}><ArrowDown /></button><button className="icon-button danger" type="button" aria-label={`${item.active ? "停用" : "启用"} ${item.title}`} disabled={Boolean(busy)} onClick={() => void act(`search-ad-toggle-${item.id}`, () => request(`/search-ads/${item.id}/toggle`, { method: "POST" }), `搜索广告已${item.active ? "停用" : "启用"}`)}>{item.active ? <EyeSlash /> : <Eye />}</button></div></article>)}{!items.length && <div className="admin-empty compact"><Tag /><strong>尚未添加搜索广告</strong><span>添加后会根据关键词或全局规则出现在搜索结果顶部。</span></div>}</div></section></div>;
}

function GatewayDirectoryPanel({
  data, notice, status, setStatus, groupFilter, setGroupFilter, selected, setSelected, page, setPage, busy, request, act,
}: {
  data: GatewayDirectoryAdminPage | null;
  notice: GatewayNotice | null;
  status: GatewayReviewStatus;
  setStatus: (value: GatewayReviewStatus) => void;
  groupFilter: string;
  setGroupFilter: (value: string) => void;
  selected: Set<string>;
  setSelected: (value: Set<string>) => void;
  page: number;
  setPage: (value: number) => void;
  busy: string | null;
  request: AdminRequest;
  act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void>;
}) {
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleInterval, setScheduleInterval] = useState("360");
  const [groupNames, setGroupNames] = useState<Record<string, string>>({});
  const [batchGroupId, setBatchGroupId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [manualDraft, setManualDraft] = useState<ManualGatewayDraft>(emptyManualGatewayDraft);
  const [noticeDraft, setNoticeDraft] = useState<GatewayNotice>({ title: "", description: "", enabled: true });
  const statuses: Array<{ key: GatewayReviewStatus; label: string }> = [
    { key: "pending", label: "待审核" }, { key: "approved", label: "已通过" }, { key: "rejected", label: "已拒绝" },
    { key: "duplicate", label: "重复项" }, { key: "source_removed", label: "来源下架" },
  ];
  useEffect(() => {
    if (!data?.schedule) return;
    setScheduleEnabled(data.schedule.enabled);
    setScheduleInterval(String(data.schedule.intervalMinutes));
  }, [data?.schedule.enabled, data?.schedule.intervalMinutes]);
  useEffect(() => {
    if (!data?.displayGroups) return;
    setGroupNames(Object.fromEntries(data.displayGroups.map((group) => [group.id, group.name])));
  }, [data?.displayGroups]);
  useEffect(() => {
    if (notice) setNoticeDraft(notice);
  }, [notice]);
  const pageIds = data?.items.map((item) => item.id) || [];
  const allSelected = Boolean(pageIds.length) && pageIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(pageIds));
  const toggleOne = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const decide = (action: "approve" | "reject" | "duplicate" | "source_removed", label: string) => {
    if (!selected.size) return;
    void act(`gateway-${action}`, async () => {
      await request("/gateway-directory/decision", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...selected], action }),
      });
      setSelected(new Set());
    }, label);
  };
  const run = data?.lastRun;
  const assignGroup = (ids: string[], groupId: string, success: string) => act(`gateway-group-${ids.join("-")}`, async () => {
    await request("/gateway-directory/group-assignment", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids, groupId: groupId || null }),
    });
    setSelected(new Set());
  }, success);
  const viewGroup = (groupId: string) => {
    setStatus("approved");
    setGroupFilter(groupId);
    setPage(1);
    setSelected(new Set());
  };
  const reorderGroup = (index: number, delta: number) => {
    if (!data) return;
    const ids = data.displayGroups.map((group) => group.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void act(`gateway-group-order-${ids[index]}`, () => request("/gateway-directory/groups/reorder", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }),
    }), "前台分组顺序已更新");
  };
  const toggleGroup = (group: GatewayDisplayGroup) => {
    if (group.active && !window.confirm(`停用“${group.name}”后，其中 ${group.count} 个中转站会移到“其他中转站”。是否继续？`)) return;
    void act(`gateway-group-toggle-${group.id}`, () => request(`/gateway-directory/groups/${group.id}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ active: !group.active }),
    }), group.active ? "分组已停用，原成员已移到其他中转站" : "分组已重新启用");
  };
  const updateManualDraft = (field: keyof ManualGatewayDraft, value: string) => setManualDraft((current) => ({ ...current, [field]: value }));
  const createGroup = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void act("gateway-group-create", async () => {
      await request("/gateway-directory/groups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: newGroupName }) });
      setNewGroupName("");
    }, "展示分组已新增");
  };
  const createManualGateway = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void act("gateway-manual-create", async () => {
      await request("/gateway-directory/manual", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(manualDraft) });
      setManualDraft(emptyManualGatewayDraft);
      setStatus("approved");
      setPage(1);
    }, "中转站已手动添加并发布");
  };
  return <div className="admin-module gateway-directory-admin">
    <section className="admin-panel gateway-notice-admin">
      <div className="admin-section-head"><div><span className="kicker">前台说明</span><h2>中转页风险提示</h2><p className="admin-muted">编辑后会替换中转站目录顶部的提示内容。</p></div><span className={noticeDraft.enabled ? "source-state active" : "source-state manual"}>{noticeDraft.enabled ? "展示中" : "已隐藏"}</span></div>
      <form className="gateway-notice-form" onSubmit={(event) => { event.preventDefault(); void act("gateway-notice", () => request("/gateway-notice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(noticeDraft) }), noticeDraft.enabled ? "中转页提示已更新" : "中转页提示已隐藏"); }}>
        <div className="settings-fields">
          <label><span>提示标题 <b>*</b></span><input required maxLength={40} value={noticeDraft.title} onChange={(event) => setNoticeDraft((current) => ({ ...current, title: event.target.value }))} placeholder="例如：使用前请独立核验" /></label>
          <label className="full"><span>提示说明 <b>*</b></span><textarea required rows={3} maxLength={300} value={noticeDraft.description} onChange={(event) => setNoticeDraft((current) => ({ ...current, description: event.target.value }))} placeholder="填写需要向访问者说明的风险或注意事项" /></label>
        </div>
        <label className="source-schedule-toggle gateway-notice-toggle"><input type="checkbox" checked={noticeDraft.enabled} onChange={(event) => setNoticeDraft((current) => ({ ...current, enabled: event.target.checked }))} /><span aria-hidden="true" /><strong>在前台显示此提示</strong><small>关闭后提示区域会从中转站目录页隐藏。</small></label>
        <div className="settings-submit"><button className="button dark" type="submit" disabled={!notice || Boolean(busy)}>{busy === "gateway-notice" ? <ArrowsClockwise className="spin" /> : <CheckCircle />}保存风险提示</button></div>
      </form>
    </section>
    <section className="admin-panel">
      <div className="admin-section-head"><div><span className="kicker">授权目录同步</span><h2>最全 API 中转站</h2></div><button className="button dark" type="button" disabled={Boolean(busy)} onClick={() => void act("gateway-sync", () => request("/gateway-directory/sync", { method: "POST" }), "中转站目录同步完成")}><ArrowsClockwise className={busy === "gateway-sync" ? "spin" : ""} />立即同步</button></div>
      <div className="gateway-sync-summary">
        <div><span>最近状态</span><strong>{run?.status || "尚未同步"}</strong></div>
        <div><span>同步模式</span><strong>{run?.mode === "authorized-json-feed" ? "授权全量 Feed" : run?.mode === "public-next-flight" ? "页面完整目录" : "公开首页条目"}</strong></div>
        <div><span>最近获取</span><strong>{numberFromUnknown(run?.counts?.fetched)}</strong></div>
        <div><span>完成时间</span><strong>{run?.finishedAt ? formatTime(run.finishedAt) : "—"}</strong></div>
      </div>
      <form className="source-schedule-form gateway-schedule-form" onSubmit={(event) => { event.preventDefault(); void act("gateway-schedule", () => request("/gateway-directory/schedule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: scheduleEnabled, intervalMinutes: Number(scheduleInterval) }) }), scheduleEnabled ? "中转站自动更新频率已保存" : "中转站自动更新已停用"); }}>
        <label className="source-schedule-toggle"><input type="checkbox" checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.target.checked)} /><span aria-hidden="true" /><strong>启用自动更新</strong><small>Worker 到达设定间隔后自动获取最新目录。</small></label>
        <label><span>更新频率</span><select value={scheduleInterval} onChange={(event) => setScheduleInterval(event.target.value)} disabled={!scheduleEnabled}><option value="30">每 30 分钟</option><option value="60">每 1 小时</option><option value="180">每 3 小时</option><option value="360">每 6 小时</option><option value="720">每 12 小时</option><option value="1440">每 24 小时</option></select></label>
        <div className="source-next-run"><span>下一次计划更新</span><strong>{data?.schedule.enabled && data.schedule.nextRunAt ? formatTime(data.schedule.nextRunAt) : "未安排"}</strong><small>{data?.schedule.lastSuccessAt ? `最近成功 ${formatTime(data.schedule.lastSuccessAt)}` : "尚无成功记录"}</small></div>
        <div className="source-schedule-actions"><button className="button dark" type="submit" disabled={Boolean(busy)}><Timer />保存更新频率</button></div>
      </form>
      {!run?.completeFeed && <p className="gateway-feed-notice"><WarningCircle />未能从页面解析完整目录。可配置 <code>ZUIQUANAPI_FEED_URL</code> 使用授权 Feed；当前结果不会触发来源下架判断。</p>}
    </section>
    <section className="admin-panel gateway-group-admin">
      <div className="admin-section-head"><div><span className="kicker">前台分组</span><h2>自定义分组管理</h2><p className="admin-muted">查看组内成员、修改名称与前台顺序；停用后成员会移回其他中转站。</p></div><form className="gateway-group-create" onSubmit={createGroup}><label><span className="sr-only">新分组名称</span><input required maxLength={30} value={newGroupName} onChange={(event) => setNewGroupName(event.target.value)} placeholder="输入新分组名称" /></label><button className="button dark compact" type="submit" disabled={Boolean(busy)}><Plus />新增分组</button></form></div>
      <div className="gateway-group-management" role="table" aria-label="中转站自定义分组">
        <div className="gateway-group-management-head" role="row"><span role="columnheader">分组名称</span><span role="columnheader">状态</span><span role="columnheader">成员</span><span role="columnheader">顺序</span><span role="columnheader">操作</span></div>
        <div className="gateway-group-management-row is-system" role="row">
          <div role="cell"><strong>其他中转站</strong><small>系统默认分组</small></div><span className="source-state active" role="cell">固定显示</span><strong role="cell" data-label="成员">{data?.unassignedCount || 0}</strong><span role="cell" data-label="顺序">最后</span><div className="gateway-group-actions" role="cell"><button className="button ghost compact" type="button" title="查看其他中转站成员" aria-label="查看其他中转站成员" disabled={Boolean(busy)} onClick={() => viewGroup("unassigned")}><MagnifyingGlass />查看成员</button></div>
        </div>
        {data?.displayGroups.map((group, index) => <div className={group.active ? "gateway-group-management-row" : "gateway-group-management-row is-disabled"} role="row" key={group.id}>
          <form role="cell" onSubmit={(event) => { event.preventDefault(); void act(`gateway-group-name-${group.id}`, () => request(`/gateway-directory/groups/${group.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: groupNames[group.id] }) }), "分组名称已更新"); }}><label><span className="sr-only">修改 {group.name} 名称</span><input required maxLength={30} value={groupNames[group.id] || ""} onChange={(event) => setGroupNames((current) => ({ ...current, [group.id]: event.target.value }))} /></label><button className="button ghost compact" type="submit" disabled={Boolean(busy) || groupNames[group.id]?.trim() === group.name}>保存</button></form>
          <span className={group.active ? "source-state active" : "source-state manual"} role="cell">{group.active ? "展示中" : "已停用"}</span>
          <strong role="cell" data-label="成员">{group.count}</strong><span role="cell" data-label="顺序">{index + 1}</span>
          <div className="gateway-group-actions" role="cell"><button className="button ghost compact" type="button" title={`查看 ${group.name} 成员`} aria-label={`查看 ${group.name} 成员`} disabled={Boolean(busy)} onClick={() => viewGroup(group.id)}><MagnifyingGlass />查看成员</button><button className="icon-button" type="button" title="上移分组" aria-label={`上移 ${group.name}`} disabled={Boolean(busy) || index === 0} onClick={() => reorderGroup(index, -1)}><ArrowUp /></button><button className="icon-button" type="button" title="下移分组" aria-label={`下移 ${group.name}`} disabled={Boolean(busy) || index === data.displayGroups.length - 1} onClick={() => reorderGroup(index, 1)}><ArrowDown /></button><button className="icon-button" type="button" title={group.active ? "停用分组" : "启用分组"} aria-label={`${group.active ? "停用" : "启用"} ${group.name}`} disabled={Boolean(busy)} onClick={() => toggleGroup(group)}>{group.active ? <EyeSlash /> : <Eye />}</button></div>
        </div>)}
      </div>
    </section>
    <section className="admin-panel">
      <div className="admin-section-head"><div><span className="kicker">人工收录</span><h2>手动添加中转站</h2></div><small className="admin-muted">保存后直接发布；不会被授权目录同步覆盖</small></div>
      <form className="gateway-manual-form" onSubmit={createManualGateway}>
        <label><span>中转站名称 <b>*</b></span><input required maxLength={200} value={manualDraft.name} onChange={(event) => updateManualDraft("name", event.target.value)} placeholder="例如：示例 API" /></label>
        <label><span>展示分组</span><select value={manualDraft.displayGroupId} onChange={(event) => updateManualDraft("displayGroupId", event.target.value)}><option value="">其他中转站</option>{data?.displayGroups.filter((group) => group.active).map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>
        <label className="wide"><span>中转站官网 <b>*</b></span><input required type="url" pattern="https://.*" value={manualDraft.url} onChange={(event) => updateManualDraft("url", event.target.value)} placeholder="https://api.example.com" /><small>仅接受公网 HTTPS 地址，相同域名不能重复添加。</small></label>
        <label className="wide"><span>Logo URL</span><input type="url" pattern="https://.*" value={manualDraft.logoUrl} onChange={(event) => updateManualDraft("logoUrl", event.target.value)} placeholder="https://example.com/logo.webp" /></label>
        <label><span>模型标签</span><input maxLength={500} value={manualDraft.modelTags} onChange={(event) => updateManualDraft("modelTags", event.target.value)} placeholder="GPT, Claude, Gemini" /><small>多个标签使用逗号分隔。</small></label>
        <label><span>价格标签</span><input maxLength={100} value={manualDraft.pricingClaims} onChange={(event) => updateManualDraft("pricingClaims", event.target.value)} placeholder="例如：低至 0.5 折" /></label>
        <label className="full"><span>完整文字描述</span><textarea rows={4} maxLength={4000} value={manualDraft.description} onChange={(event) => updateManualDraft("description", event.target.value)} placeholder="填写服务特点、适用场景和活动说明" /></label>
        <button className="button dark" type="submit" disabled={Boolean(busy)}><Plus />添加并发布</button>
      </form>
    </section>
    <section className="admin-panel">
      <div className="admin-section-head"><div><span className="kicker">目录审核</span><h2>中转站候选</h2><p className="gateway-probe-admin-hint">每条记录右侧点击“探测配置”，可设置 API Base URL、专用 Key、模型和探测频率。</p></div><span className="result-summary">{data?.total || 0} 条</span></div>
      <div className="gateway-review-tabs" role="tablist">{statuses.map((item) => <button type="button" role="tab" aria-selected={status === item.key} className={status === item.key ? "is-active" : ""} key={item.key} onClick={() => { setStatus(item.key); setPage(1); setSelected(new Set()); }}>{item.label}<span>{data?.counts[item.key] || 0}</span></button>)}</div>
      <div className="gateway-group-filter"><label><span>当前筛选分组</span><select value={groupFilter} onChange={(event) => { setGroupFilter(event.target.value); setPage(1); setSelected(new Set()); }}><option value="all">全部分组</option><option value="unassigned">其他中转站（{data?.filteredUnassignedCount || 0}）</option>{data?.displayGroups.map((group) => <option value={group.id} key={group.id}>{group.name}{group.active ? "" : "（已停用）"}（{group.filteredCount}）</option>)}</select></label><span>当前结果 {data?.total || 0} 条</span></div>
      <div className="gateway-batch-bar">
        <label><input type="checkbox" checked={allSelected} onChange={toggleAll} />全选本页</label>
        <span>{selected.size ? `已选择 ${selected.size} 条` : "请先勾选中转站"}</span>
        <label className="gateway-batch-target"><span>批量移动到</span><select aria-label="批量移动到展示分组" value={batchGroupId} onChange={(event) => setBatchGroupId(event.target.value)}><option value="">其他中转站</option>{data?.displayGroups.filter((group) => group.active).map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select></label>
        <button className="button ghost compact" type="button" disabled={!selected.size || Boolean(busy)} onClick={() => void assignGroup([...selected], batchGroupId, "所选中转站分组已更新")}>设置分组</button>
        <button className="button ghost compact" type="button" disabled={!selected.size || Boolean(busy)} onClick={() => decide("approve", "所选中转站已通过审核")}><CheckCircle />通过</button>
        <button className="button ghost compact" type="button" disabled={!selected.size || Boolean(busy)} onClick={() => decide("duplicate", "所选中转站已标记为重复")}><Tag />标记重复</button>
        <button className="button ghost compact danger" type="button" disabled={!selected.size || Boolean(busy)} onClick={() => decide("reject", "所选中转站已拒绝")}><XCircle />拒绝</button>
      </div>
      <div className="gateway-admin-list">{data?.items.map((item) => <article className="gateway-admin-row" key={item.id}>
        <input type="checkbox" aria-label={`选择 ${item.name}`} checked={selected.has(item.id)} onChange={() => toggleOne(item.id)} />
        <MediaThumbnail value={item.logoUrl} label={item.name} kind="listing" />
        <div className="gateway-admin-copy"><div><strong>{item.name}</strong>{item.manual && <span className="manual-badge">手动添加</span>}{item.sponsored && <span className="source-sponsored">来源站赞助</span>}{item.suspectedDuplicate && <span className="duplicate-badge">疑似重复</span>}</div><small>ID {item.sourceSiteId} · {item.destinationHost || item.sourceSection}</small><p>{item.description || "暂无来源说明"}</p><div className="gateway-admin-metrics"><span className={item.online === true ? "online" : item.online === false ? "offline" : ""}>{item.online === true ? "在线" : item.online === false ? "离线" : "未检测"}</span><span>可用率 {item.availability7d === null ? "—" : `${item.availability7d}%`}</span><span>赞 {item.upVotes} / 踩 {item.downVotes}</span></div></div>
        <select className="gateway-row-group" aria-label={`设置 ${item.name} 的展示分组`} value={item.displayGroup?.id || ""} disabled={Boolean(busy)} onChange={(event) => void assignGroup([item.id], event.target.value, `${item.name} 的分组已更新`)}><option value="">其他中转站</option>{data?.displayGroups.filter((group) => group.active).map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}</select>
        <GatewayProbeConfig gatewayId={item.id} gatewayName={item.name} request={request} />
        <button className={item.featured ? "icon-button is-featured" : "icon-button"} type="button" title={item.featured ? "取消首页精选" : "设为首页精选"} aria-label={item.featured ? `取消精选 ${item.name}` : `精选 ${item.name}`} disabled={Boolean(busy)} onClick={() => void act(`gateway-featured-${item.id}`, () => request(`/gateway-directory/${item.id}/featured`, { method: "POST" }), item.featured ? "已取消首页精选" : "已设为首页精选")}><Star weight={item.featured ? "fill" : "regular"} /></button>
      </article>)}{!data?.items.length && <div className="admin-empty compact"><ArrowsLeftRight /><strong>当前状态暂无中转站</strong><span>同步来源数据后，新条目会进入待审核列表。</span></div>}</div>
      <div className="admin-pagination"><button className="button ghost compact" type="button" disabled={page <= 1 || Boolean(busy)} onClick={() => setPage(page - 1)}>上一页</button><span>第 {page} / {Math.max(data?.totalPages || 0, 1)} 页</span><button className="button ghost compact" type="button" disabled={!data || page >= data.totalPages || Boolean(busy)} onClick={() => setPage(page + 1)}>下一页</button></div>
    </section>
  </div>;
}

function LegacyListingPanel({ type, title, items, busy, request, act }: { type: "gateway" | "project"; title: string; items: Listing[]; busy: string | null; request: AdminRequest; act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [draft, setDraft] = useState<ListingDraft>(emptyListingDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [clearThumbnail, setClearThumbnail] = useState(false);
  const [imageError, setImageError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const isSponsor = type === "gateway";
  const editingItem = editingId ? items.find((item) => item.id === editingId) || null : null;
  const preview = useObjectPreview(thumbnail, clearThumbnail ? null : (draft.thumbnailUrl || editingItem?.thumbnailUrl || null));
  function update(field: keyof ListingDraft, value: string) { setDraft((current) => ({ ...current, [field]: value })); }
  function resetForm() { setDraft(emptyListingDraft); setEditingId(null); setThumbnail(null); setClearThumbnail(false); setImageError(""); }
  function beginEdit(item: Listing) {
    setEditingId(item.id);
    setDraft({ title: item.title, description: item.description, url: item.url, thumbnailUrl: item.thumbnailUrl?.startsWith("https://") ? item.thumbnailUrl : "", badge: item.badge || "", modelTags: item.modelTags.join(", "), pricingClaims: item.pricingClaims || "" });
    setThumbnail(null); setClearThumbnail(false); setImageError("");
    window.requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function selectThumbnail(file: File | null) {
    setImageError("");
    if (!file) { setThumbnail(null); return; }
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setImageError("仅支持 PNG、JPEG 或 WebP 图片"); return; }
    if (file.size > 5 * 1024 * 1024) { setImageError("图片不能超过 5 MB"); return; }
    setThumbnail(file); setClearThumbnail(false); update("thumbnailUrl", "");
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const form = new FormData();
    Object.entries({ type, ...draft, clearThumbnail }).forEach(([key, value]) => form.append(key, String(value)));
    if (thumbnail) form.append("thumbnail", thumbnail);
    const path = editingId ? `/listings/${editingId}` : "/listings";
    void act(`listing-${editingId ? "edit" : "add"}-${editingId || type}`, async () => {
      await request(path, { method: "POST", body: form });
      resetForm();
    }, editingId ? `${title}已更新` : `${title}已添加`);
  }
  const reorder = (index: number, delta: number) => { const ids = items.map((item) => item.id); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; return request("/listings/reorder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }); };
  return <div className="admin-module"><section className={editingId ? "admin-panel listing-editor is-editing" : "admin-panel listing-editor"}><div className="admin-section-head"><div><span className="kicker">前台展示</span><h2>{editingId ? `编辑${title}` : `添加${title}`}</h2></div><small className="admin-muted">{isSponsor ? "支持本地上传或 HTTPS 图片，建议使用 3:1 横幅图" : "仅接受 HTTPS 官网与图片链接"}</small></div><form ref={formRef} className="listing-admin-form" onSubmit={submit}><label><span>{isSponsor ? "赞助商名称" : "名称"}</span><input required maxLength={100} value={draft.title} onChange={(event) => update("title", event.target.value)} placeholder={isSponsor ? "例如：示例 API" : `${title}名称`} /></label><label><span>{isSponsor ? "优惠标签（选填）" : "标签"}</span><input maxLength={30} value={draft.badge} onChange={(event) => update("badge", event.target.value)} placeholder={isSponsor ? "例如：注册送额度" : "推荐 / 热门"} /></label><label className="wide"><span>{isSponsor ? "赞助落地页" : "官网链接"}</span><input required type="url" value={draft.url} onChange={(event) => update("url", event.target.value)} placeholder="https://example.com" /></label><label className="wide"><span>{isSponsor ? "横幅图 URL（选填）" : "缩略图 URL"}</span><input type="url" value={draft.thumbnailUrl} onChange={(event) => { setThumbnail(null); setClearThumbnail(false); update("thumbnailUrl", event.target.value); }} placeholder={isSponsor ? "也可以粘贴 HTTPS 图片地址" : "https://example.com/cover.webp"} /></label>{isSponsor && <div className="listing-image-upload full"><div className="listing-image-preview">{preview ? <img src={preview} alt="赞助横幅预览" /> : <ImageSquare aria-hidden="true" />}</div><div><strong>本地横幅图片</strong><p>PNG、JPEG 或 WebP，最大 5 MB。上传新图会替换当前图片。</p><div><label className="button ghost compact"><UploadSimple />选择本地图片<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => selectThumbnail(event.target.files?.[0] || null)} /></label>{preview && <button className="button ghost compact danger" type="button" onClick={() => { setThumbnail(null); setClearThumbnail(true); update("thumbnailUrl", ""); }}><XCircle />移除图片</button>}</div>{thumbnail && <small>{thumbnail.name}</small>}{imageError && <small className="field-error" role="alert">{imageError}</small>}</div></div>}<label className="full"><span>{isSponsor ? "赞助简介" : "展示说明"}</span><textarea maxLength={500} rows={3} value={draft.description} onChange={(event) => update("description", event.target.value)} placeholder={isSponsor ? "简要介绍服务与主要优势" : "简要说明服务特点和适用场景"} /></label><div className="listing-form-actions"><button className="button dark" type="submit" disabled={Boolean(busy) || Boolean(imageError)}>{editingId ? <CheckCircle /> : <Plus />}{editingId ? "保存修改" : isSponsor ? "添加赞助位" : "添加到展示"}</button>{editingId && <button className="button ghost" type="button" disabled={Boolean(busy)} onClick={resetForm}><XCircle />取消编辑</button>}</div></form></section><section className="admin-panel"><div className="admin-section-head"><div><span className="kicker">展示顺序</span><h2>已添加{title}</h2></div><span className="result-summary">{items.filter((item) => item.active).length} 个启用</span></div><div className="admin-listing-list">{items.map((item, index) => <article className={`${item.active ? "admin-listing-row" : "admin-listing-row is-disabled"}${editingId === item.id ? " is-editing" : ""}`} key={item.id}><MediaThumbnail value={item.thumbnailUrl} label={item.title} kind="listing" /><div><strong>{item.title}{item.badge && <span>{item.badge}</span>}</strong><small>{item.url}</small><p>{item.description || "暂无说明"}</p></div><span className={item.active ? "source-state active" : "source-state manual"}>{item.active ? "展示中" : "已停用"}</span><div className="admin-listing-actions"><button className="icon-button" type="button" title="编辑" aria-label={`编辑 ${item.title}`} disabled={Boolean(busy)} onClick={() => beginEdit(item)}><Pencil /></button><button className="icon-button" type="button" title="上移" aria-label={`上移 ${item.title}`} disabled={index === 0 || Boolean(busy)} onClick={() => void act(`listing-up-${item.id}`, () => reorder(index, -1), "展示顺序已更新")}><ArrowUp /></button><button className="icon-button" type="button" title="下移" aria-label={`下移 ${item.title}`} disabled={index === items.length - 1 || Boolean(busy)} onClick={() => void act(`listing-down-${item.id}`, () => reorder(index, 1), "展示顺序已更新")}><ArrowDown /></button><button className="icon-button danger" type="button" title={item.active ? "停用" : "启用"} aria-label={`${item.active ? "停用" : "启用"} ${item.title}`} disabled={Boolean(busy)} onClick={() => void act(`listing-toggle-${item.id}`, () => request(`/listings/${item.id}/toggle`, { method: "POST" }), `${title}已${item.active ? "停用" : "启用"}`)}>{item.active ? <EyeSlash /> : <Eye />}</button></div></article>)}{!items.length && <div className="admin-empty compact"><Tag /><strong>尚未添加{title}</strong><span>填写上方表单后会进入展示列表。</span></div>}</div></section></div>;
}

function ListingPanel({ type, title, items, busy, request, act }: { type: "gateway" | "project"; title: string; items: Listing[]; busy: string | null; request: AdminRequest; act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const isSponsor = type === "gateway";
  const [draft, setDraft] = useState<ListingDraft>(emptyListingDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [clearThumbnail, setClearThumbnail] = useState(false);
  const [imageError, setImageError] = useState("");
  const preview = useObjectPreview(thumbnail, clearThumbnail ? null : (draft.thumbnailUrl || items.find((item) => item.id === editingId)?.thumbnailUrl || null));
  const update = (field: keyof ListingDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }));
  const reset = () => { setDraft(emptyListingDraft); setEditingId(null); setThumbnail(null); setClearThumbnail(false); setImageError(""); };
  const edit = (item: Listing) => { setEditingId(item.id); setDraft({ title: item.title, description: item.description, url: item.url, thumbnailUrl: item.thumbnailUrl?.startsWith("https://") ? item.thumbnailUrl : "", badge: item.badge || "", modelTags: item.modelTags.join(", "), pricingClaims: item.pricingClaims || "" }); };
  const submit = (event: FormEvent) => { event.preventDefault(); const form = new FormData(); Object.entries({ type, ...draft, clearThumbnail }).forEach(([key, value]) => form.append(key, String(value))); if (thumbnail) form.append("thumbnail", thumbnail); void act(`listing-${editingId || type}`, async () => { await request(editingId ? `/listings/${editingId}` : "/listings", { method: "POST", body: form }); reset(); }, editingId ? `${title}已更新` : `${title}已添加`); };
  return <div className="admin-module">
    <section className="admin-panel listing-editor">
      <div className="admin-section-head"><div><span className="kicker">前台展示</span><h2>{editingId ? `编辑${title}` : `添加${title}`}</h2></div><small className="admin-muted">{isSponsor ? "图片按 16:9 居中裁切展示，原始文件会保留" : "仅接受 HTTPS 官网与图片链接"}</small></div>
      <form className="listing-admin-form" onSubmit={submit}>
        <label><span>{isSponsor ? "赞助商名称" : "名称"}</span><input required maxLength={100} value={draft.title} onChange={(event) => update("title", event.target.value)} /></label>
        <label><span>{isSponsor ? "优惠标签" : "标签"}</span><input maxLength={30} value={draft.badge} onChange={(event) => update("badge", event.target.value)} /></label>
        <label className="wide"><span>{isSponsor ? "赞助落地页" : "官网链接"}</span><input required type="url" value={draft.url} onChange={(event) => update("url", event.target.value)} placeholder="https://example.com" /></label>
        <label className="wide"><span>{isSponsor ? "横幅图 URL（选填）" : "缩略图 URL"}</span><input type="url" value={draft.thumbnailUrl} onChange={(event) => { setThumbnail(null); update("thumbnailUrl", event.target.value); }} /></label>
        {isSponsor && <>
          <div className="listing-image-upload full"><div className="listing-image-preview">{preview ? <img src={preview} alt="赞助横幅预览" /> : <ImageSquare aria-hidden="true" />}</div><div><strong>本地横幅图片（16:9）</strong><p>PNG、JPEG 或 WebP，最大 5 MB，前台将居中裁切。</p><label className="button ghost compact"><UploadSimple />选择本地图片<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0] || null; const valid = !file || (["image/png", "image/jpeg", "image/webp"].includes(file.type) && file.size <= 5 * 1024 * 1024); setImageError(!valid ? (file && file.size > 5 * 1024 * 1024 ? "图片不能超过 5 MB" : "仅支持 PNG、JPEG 或 WebP 图片") : ""); if (valid) { setThumbnail(file); setClearThumbnail(false); update("thumbnailUrl", ""); } }} /></label></div></div>
          <label><span>模型标签</span><input maxLength={500} value={draft.modelTags} onChange={(event) => update("modelTags", event.target.value)} placeholder="GPT, Claude, Gemini" /><small>多个标签使用逗号分隔，最多 20 个。</small></label>
          <label><span>价格标签</span><input maxLength={100} value={draft.pricingClaims} onChange={(event) => update("pricingClaims", event.target.value)} placeholder="例如：低至 0.5 折" /></label>
        </>}
        <label className="full"><span>{isSponsor ? "赞助简介" : "展示说明"}</span><textarea maxLength={4000} rows={5} value={draft.description} onChange={(event) => update("description", event.target.value)} /></label>
        <div className="listing-form-actions"><button className="button dark" type="submit" disabled={Boolean(busy) || Boolean(imageError)}>{editingId ? <CheckCircle /> : <Plus />}{editingId ? "保存修改" : isSponsor ? "添加赞助位" : "添加到展示"}</button>{editingId && <button className="button ghost" type="button" onClick={reset}><XCircle />取消编辑</button>}</div>
      </form>
    </section>
    <section className="admin-panel"><div className="admin-section-head"><div><span className="kicker">展示顺序</span><h2>已添加{title}</h2></div><span className="result-summary">{items.filter((item) => item.active).length} 个启用</span></div>
      <div className="admin-listing-list">{items.map((item) => <article className="admin-listing-row" key={item.id}><MediaThumbnail value={item.thumbnailUrl} label={item.title} kind="listing" /><div><strong>{item.title}{item.badge && <span>{item.badge}</span>}</strong><small>{item.url}</small><p>{item.description || "暂无说明"}</p>{isSponsor && <div className="gateway-feature-tags">{item.modelTags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}{item.pricingClaims && <b>{item.pricingClaims}</b>}</div>}</div><span className={item.active ? "source-state active" : "source-state manual"}>{item.active ? "展示中" : "已停用"}</span><div className="admin-listing-actions"><button className="icon-button" type="button" title="编辑" aria-label={`编辑 ${item.title}`} onClick={() => edit(item)}><Pencil /></button>{isSponsor && <GatewayProbeConfig managedListingId={item.id} managedListingName={item.title} request={request} />}<button className="icon-button danger" type="button" title={item.active ? "停用" : "启用"} onClick={() => void act(`listing-toggle-${item.id}`, () => request(`/listings/${item.id}/toggle`, { method: "POST" }), `${title}已${item.active ? "停用" : "启用"}`)}>{item.active ? <EyeSlash /> : <Eye />}</button></div></article>)}</div>
    </section>
  </div>;
}

function useObjectPreview(file: File | null, current: string | null) {
  const [preview, setPreview] = useState(current);
  useEffect(() => {
    if (!file) { setPreview(current); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, current]);
  return preview;
}

function toDatetimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatTime(value: string) { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value)); }
function numberFromUnknown(value: unknown) { return Number.isFinite(Number(value)) ? Number(value).toLocaleString("zh-CN") : "0"; }
