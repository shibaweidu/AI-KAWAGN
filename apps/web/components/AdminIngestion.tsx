"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowsClockwise, ArrowDown, ArrowUp, CheckCircle, Database, Eye, EyeSlash, Fire,
  Gauge, Gear, ImageSquare, MagnifyingGlass, Play, Plus, ShieldCheck, SidebarSimple, Storefront, Tag, Timer,
  UploadSimple, WarningCircle, XCircle, ArrowsLeftRight,
} from "@phosphor-icons/react";
import type { AdminHomeBanner, SearchAd, SiteSettings } from "@ai-card/contracts";
import { MediaThumbnail } from "./MediaThumbnail";

type SectionKey = "overview" | "site" | "banner" | "source" | "candidates" | "searches" | "ads" | "gateways" | "projects";
type Candidate = { id: string; externalId: string; name: string; directoryUrl: string; homepageUrl: string | null; logoUrl: string | null; firstSeenAt: string; sourceSyncedAt: string | null; reviewStatus: string; dataSource: { key: string; name: string }; _count: { offerCandidates: number } };
type CandidatePage = { items: Candidate[]; total: number; offerTotal: number; page: number; pageSize: number; totalPages: number };
type Source = { id: string; key: string; name: string; kind: string; enabled: boolean; pollIntervalSeconds: number; lastCheckedAt: string | null; lastSuccessAt: string | null; lastSnapshotId: string | null; nextRunAt: string | null };
type Run = { id: string; kind: string; status: string; createdAt: string; counts: Record<string, unknown> | null; dataSource: { name: string } };
type DiscoveryResult = { runId: string; pages: number; totalPages: number; totalShops: number; uniqueShops: number; created: number; updated: number; unchanged: number; pageDuplicates: number; caseVariantSkipped: number; productShopsRequested?: number; productShopsSucceeded?: number; productShopsFailed?: number; productsUpserted?: number; offersPromoted?: number; categoriesSynced?: number; sampleCreated: Array<{ token: string; name: string }> };
type ProductBackfillStatus = { totalShops: number; syncedShops: number; remainingShops: number; activeRun: { id: string; status: string; counts: Record<string, unknown> | null; createdAt: string } | null };
type HotSearch = { id: string; term: string; position: number; active: boolean };
type Listing = { id: string; title: string; description: string; url: string; thumbnailUrl: string | null; badge: string | null; active: boolean; position: number };
type ListingDraft = { title: string; description: string; url: string; thumbnailUrl: string; badge: string };
type SearchAdDraft = { title: string; description: string; url: string; imageUrl: string; label: string; keywords: string; global: boolean; startsAt: string; endsAt: string; active: boolean };
type AdminRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

const sections = [
  { key: "overview" as const, label: "数据概览", Icon: Gauge },
  { key: "site" as const, label: "网站设置", Icon: Gear },
  { key: "banner" as const, label: "首页广告", Icon: ImageSquare },
  { key: "source" as const, label: "链动小店采集", Icon: Database },
  { key: "candidates" as const, label: "候选审核", Icon: ShieldCheck },
  { key: "searches" as const, label: "热门搜索词", Icon: MagnifyingGlass },
  { key: "ads" as const, label: "搜索广告", Icon: Tag },
  { key: "gateways" as const, label: "中转站展示", Icon: ArrowsLeftRight },
  { key: "projects" as const, label: "热门项目展示", Icon: Fire },
];

const emptyListingDraft: ListingDraft = { title: "", description: "", url: "", thumbnailUrl: "", badge: "" };
const emptySearchAdDraft: SearchAdDraft = { title: "", description: "", url: "", imageUrl: "", label: "广告", keywords: "", global: false, startsAt: "", endsAt: "", active: true };

export function AdminIngestion() {
  const [active, setActive] = useState<SectionKey>("overview");
  const [candidates, setCandidates] = useState<CandidatePage | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [hotSearches, setHotSearches] = useState<HotSearch[]>([]);
  const [searchAds, setSearchAds] = useState<SearchAd[]>([]);
  const [gateways, setGateways] = useState<Listing[]>([]);
  const [projects, setProjects] = useState<Listing[]>([]);
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);
  const [homeBanner, setHomeBanner] = useState<AdminHomeBanner | null>(null);
  const [productBackfill, setProductBackfill] = useState<ProductBackfillStatus | null>(null);
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
      const [candidatePage, sourceList, runList, hotList, searchAdList, gatewayList, projectList, settings, banner, backfill] = await Promise.all([
        request<CandidatePage>(`/candidates?status=pending&source=ldxp&pageSize=50&page=${page}`),
        request<Source[]>("/sources"), request<Run[]>("/runs"), request<HotSearch[]>("/hot-searches"),
        request<SearchAd[]>("/search-ads"),
        request<Listing[]>("/listings?type=gateway"), request<Listing[]>("/listings?type=project"),
        request<SiteSettings>("/site-settings"), request<AdminHomeBanner>("/home-banner"), request<ProductBackfillStatus>("/sources/ldxp/product-backfill"),
      ]);
      setCandidates(candidatePage); setSources(sourceList); setRuns(runList); setHotSearches(hotList); setSearchAds(searchAdList); setGateways(gatewayList); setProjects(projectList); setSiteSettings(settings); setHomeBanner(banner); setProductBackfill(backfill); setUnauthorized(false); setError("");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "加载失败"); }
  }, [page, request]);

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
      <nav>{sections.map(({ key, label, Icon }) => <button type="button" key={key} className={active === key ? "is-active" : ""} aria-current={active === key ? "page" : undefined} onClick={() => setActive(key)}><Icon />{label}</button>)}</nav>
      <div className="admin-sidebar-foot"><span className="source-state active">链动小店</span><small>唯一采集来源</small></div>
    </aside>

    <section className="admin-workspace">
      <header className="admin-workspace-head"><div><span className="kicker">运营控制台</span><h1>{sections.find((item) => item.key === active)?.label}</h1></div><button className="button ghost" type="button" disabled={Boolean(busy)} onClick={() => void refresh()}><ArrowsClockwise />刷新数据</button></header>
      <div className="admin-status" aria-live="polite">{message && <p className="admin-success"><CheckCircle />{message}</p>}{error && <p className="admin-error"><WarningCircle />{error}</p>}</div>

      {active === "overview" && <Overview candidates={candidates} pendingOffers={pendingOffers} runs={runs} sources={sources} />}
      {active === "site" && <SiteSettingsPanel settings={siteSettings} busy={busy} request={request} act={act} />}
      {active === "banner" && <HomeBannerPanel banner={homeBanner} busy={busy} request={request} act={act} />}
      {active === "source" && <SourcePanel sources={sources} runs={runs} productBackfill={productBackfill} busy={busy} request={request} act={act} />}
      {active === "candidates" && <CandidatesPanel candidates={candidates} selected={selected} setSelected={setSelected} page={page} setPage={setPage} busy={busy} request={request} act={act} />}
      {active === "searches" && <HotSearchPanel items={hotSearches} newTerm={newHotSearch} setNewTerm={setNewHotSearch} busy={busy} request={request} act={act} />}
      {active === "ads" && <SearchAdPanel items={searchAds} busy={busy} request={request} act={act} />}
      {active === "gateways" && <ListingPanel type="gateway" title="中转站" items={gateways} busy={busy} request={request} act={act} />}
      {active === "projects" && <ListingPanel type="project" title="热门项目" items={projects} busy={busy} request={request} act={act} />}
    </section>
  </main>;
}

function Overview({ candidates, pendingOffers, runs, sources }: { candidates: CandidatePage | null; pendingOffers: number; runs: Run[]; sources: Source[] }) {
  return <div className="admin-module"><section className="admin-metrics" aria-label="数据概览"><div><Storefront /><span>待审店铺<strong>{candidates?.total ?? "—"}</strong></span></div><div><Database /><span>候选报价<strong>{pendingOffers}</strong></span></div><div><ShieldCheck /><span>采集来源<strong>{sources.length}</strong></span></div><div><ArrowsClockwise /><span>最近批次<strong>{runs[0]?.status || "暂无"}</strong></span></div></section><section className="admin-panel"><div className="admin-section-head"><div><span className="kicker">最近任务</span><h2>导入记录</h2></div></div><div className="admin-run-list">{runs.slice(0, 10).map((run) => <div key={run.id}><span className={`run-state ${run.status.toLowerCase()}`}>{run.status}</span><strong>{run.kind}</strong><small>{run.dataSource.name} · {formatTime(run.createdAt)}</small></div>)}{!runs.length && <div className="admin-empty compact"><Database /><strong>暂无导入记录</strong></div>}</div></section></div>;
}

function SiteSettingsPanel({ settings, busy, request, act }: { settings: SiteSettings | null; busy: string | null; request: AdminRequest; act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [draft, setDraft] = useState({ siteName: "", slogan: "", description: "", seoTitle: "", seoDescription: "", seoKeywords: "" });
  const [logo, setLogo] = useState<File | null>(null);
  const preview = useObjectPreview(logo, settings?.logoUrl || null);
  useEffect(() => {
    if (!settings) return;
    setDraft({ siteName: settings.siteName, slogan: settings.slogan, description: settings.description, seoTitle: settings.seoTitle, seoDescription: settings.seoDescription, seoKeywords: settings.seoKeywords.join("，") });
  }, [settings]);
  function update(field: keyof typeof draft, value: string) { setDraft((current) => ({ ...current, [field]: value })); }
  function submit(event: FormEvent) {
    event.preventDefault();
    const form = new FormData();
    Object.entries(draft).forEach(([key, value]) => form.append(key, value));
    if (logo) form.append("logo", logo);
    void act("site-settings", async () => {
      await request("/site-settings", { method: "POST", body: form });
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

function HomeBannerPanel({ banner, busy, request, act }: { banner: AdminHomeBanner | null; busy: string | null; request: AdminRequest; act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void> }) {
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
          <label><span>广告标题 <b>*</b></span><input required maxLength={80} value={draft.title} onChange={(event) => update("title", event.target.value)} /></label>
          <label><span>广告标识</span><input required maxLength={20} value={draft.label} onChange={(event) => update("label", event.target.value)} /></label>
          <label className="full"><span>广告摘要</span><textarea rows={3} maxLength={200} value={draft.summary} onChange={(event) => update("summary", event.target.value)} /></label>
          <label><span>按钮文案 <b>*</b></span><input required maxLength={20} value={draft.buttonLabel} onChange={(event) => update("buttonLabel", event.target.value)} /></label>
          <label><span>目标链接 <b>*</b></span><input required type="url" pattern="https://.*" value={draft.targetUrl} onChange={(event) => update("targetUrl", event.target.value)} placeholder="https://example.com" /><small>只允许无账号密码的 HTTPS 地址。</small></label>
          <label><span>开始时间</span><input type="datetime-local" value={draft.startsAt} onChange={(event) => update("startsAt", event.target.value)} /></label>
          <label><span>结束时间</span><input type="datetime-local" value={draft.endsAt} onChange={(event) => update("endsAt", event.target.value)} /></label>
        </div>
        <label className="banner-active-toggle"><input type="checkbox" checked={draft.active} onChange={(event) => update("active", event.target.checked)} /><span aria-hidden="true" /><strong>启用首页广告</strong><small>仅在有效时间内展示；关闭后首页广告区域自动收起。</small></label>
        <div className="settings-submit"><button className="button dark" type="submit" disabled={!banner || Boolean(busy)}>{busy === "home-banner" ? <ArrowsClockwise className="spin" /> : <CheckCircle />}保存首页广告</button></div>
      </form>
    </section>
  </div>;
}

function SourcePanel({ sources, runs, productBackfill, busy, request, act }: { sources: Source[]; runs: Run[]; productBackfill: ProductBackfillStatus | null; busy: string | null; request: AdminRequest; act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const source = sources[0];
  const [enabled, setEnabled] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState("360");
  const [discoveryPages, setDiscoveryPages] = useState("20");
  const [backfillBatchSize, setBackfillBatchSize] = useState("25");
  const [discoveryResult, setDiscoveryResult] = useState<DiscoveryResult | null>(null);
  useEffect(() => {
    if (!source) return;
    setEnabled(source.enabled);
    setIntervalMinutes(String(Math.max(30, Math.round(source.pollIntervalSeconds / 60) || 360)));
  }, [source]);
  const latestRun = runs.find((run) => run.dataSource.name.includes("链动"));
  return <div className="admin-module">
    <section className="admin-panel source-focus"><div className="source-focus-icon"><Database /></div><div><span className="kicker">唯一数据来源</span><h2>{source?.name || "链动小店"}</h2><p>从已收录链动店铺的公开商品列表更新价格、库存、店铺 Logo 与商品主图；新店铺可以先从 211b 公开目录发现，再进入候选审核。</p><dl><div><dt>来源域名</dt><dd>pay.ldxp.cn</dd></div><div><dt>发现入口</dt><dd>211b.site/shops</dd></div><div><dt>最近成功</dt><dd>{source?.lastSuccessAt ? formatTime(source.lastSuccessAt) : "等待首次同步"}</dd></div><div><dt>最近批次</dt><dd>{latestRun?.status || "暂无"}</dd></div></dl></div></section>
    <section className="admin-panel source-discovery-panel"><div className="admin-section-head"><div><span className="kicker"><MagnifyingGlass />店铺发现</span><h2>扫描 211b 店铺目录</h2></div><small className="admin-muted">只采集店铺 token，不抓商品详情</small></div>
      <form className="source-discovery-form" onSubmit={(event) => { event.preventDefault(); void act("source-discover-211b", async () => {
        const result = await request<DiscoveryResult>("/sources/ldxp/discover-211b", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ maxPages: Number(discoveryPages), syncProducts: false }) });
        setDiscoveryResult(result);
      }, "211b 店铺目录扫描完成，新增店铺已进入候选审核"); }}>
        <label><span>最多扫描页数</span><select value={discoveryPages} onChange={(event) => setDiscoveryPages(event.target.value)}><option value="1">1 页</option><option value="3">3 页</option><option value="5">5 页</option><option value="14">14 页</option><option value="20">20 页</option><option value="50">50 页</option></select></label>
        <div className="source-discovery-note"><strong>扫描范围</strong><small>这里只更新店铺 token；商品目录和链接请在下方单独启动补全任务。</small></div>
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
      </div>
      <form className="source-backfill-form" onSubmit={(event) => { event.preventDefault(); void act("source-product-backfill", () => request("/sources/ldxp/product-backfill", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchSize: Number(backfillBatchSize) }) }), "商品补全任务已启动，Worker 将分批处理全部剩余店铺"); }}>
        <label><span>每批店铺数</span><select value={backfillBatchSize} onChange={(event) => setBackfillBatchSize(event.target.value)} disabled={Boolean(productBackfill?.activeRun)}><option value="10">10 家</option><option value="25">25 家</option><option value="50">50 家</option><option value="100">100 家</option></select></label>
        <div><strong>{productBackfill?.activeRun ? `任务 ${productBackfill.activeRun.status}` : "自动续跑"}</strong><small>分类、商品链接、价格、库存和图片将按店铺唯一标识更新。</small></div>
        <button className="button dark" type="submit" disabled={Boolean(busy) || Boolean(productBackfill?.activeRun) || !productBackfill?.remainingShops}>{busy === "source-product-backfill" || productBackfill?.activeRun ? <ArrowsClockwise className="spin" /> : <Play />}{productBackfill?.activeRun ? "正在补全" : productBackfill?.remainingShops ? "补全全部剩余商品" : "商品已补全"}</button>
      </form>
    </section>
    <section className="admin-panel source-schedule-panel"><div className="admin-section-head"><div><span className="kicker"><Timer />自动更新</span><h2>采集计划</h2></div><span className={source?.enabled ? "source-state active" : "source-state manual"}>{source?.enabled ? "运行中" : "已停用"}</span></div>
      <form className="source-schedule-form" onSubmit={(event) => { event.preventDefault(); void act("source-schedule", () => request("/sources/ldxp/schedule", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled, intervalMinutes: Number(intervalMinutes) }) }), enabled ? "自动采集计划已保存" : "自动采集已停用"); }}>
        <label className="source-schedule-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span aria-hidden="true" /><strong>启用自动采集</strong><small>Worker 每分钟检查一次，到达设定间隔后执行更新。</small></label>
        <label><span>采集间隔</span><select value={intervalMinutes} onChange={(event) => setIntervalMinutes(event.target.value)} disabled={!enabled}><option value="30">30 分钟</option><option value="60">1 小时</option><option value="180">3 小时</option><option value="360">6 小时</option><option value="720">12 小时</option><option value="1440">24 小时</option></select></label>
        <div className="source-next-run"><span>下一次计划运行</span><strong>{source?.enabled && source.nextRunAt ? formatTime(source.nextRunAt) : "未安排"}</strong><small>{source?.lastCheckedAt ? `最近检查 ${formatTime(source.lastCheckedAt)}` : "尚未执行"}</small></div>
        <div className="source-schedule-actions"><button className="button dark" type="submit" disabled={Boolean(busy)}>保存设置</button><button className="button ghost" type="button" disabled={Boolean(busy)} onClick={() => void act("source-sync-now", () => request("/sources/ldxp/sync", { method: "POST" }), "同步任务已进入队列，Worker 将在一分钟内开始执行")}><Play />立即同步</button></div>
      </form>
      <p className="source-schedule-note"><WarningCircle />完整同步会按固定速率逐店读取，不会并发轰炸源站。发现新店铺后，先在候选审核中批准，再执行同步即可拉取商品。</p>
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
  return <div className="admin-module"><section className="admin-panel"><div className="admin-section-head"><div><span className="kicker">链动小店</span><h2>待审核店铺</h2></div><div className="candidate-bulk"><span>已选 {selected.size} 家</span><button className="button ghost compact" disabled={!pageIds.length || Boolean(busy)} type="button" onClick={toggleCurrentPage}>{allSelectedOnPage ? "取消本页" : "全选本页"}</button><button className="button dark compact" disabled={!selected.size || Boolean(busy)} type="button" onClick={() => void act("batch-approve", () => request("/candidates/batch-decision", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [...selected], action: "approve" }) }), "批量批准完成")}>批量批准</button></div></div><div className="candidate-list">{candidates?.items.map((candidate) => <article className="candidate-row simple" key={candidate.id}><label className="candidate-check"><input type="checkbox" checked={selected.has(candidate.id)} onChange={(event) => { const next = new Set(selected); event.target.checked ? next.add(candidate.id) : next.delete(candidate.id); setSelected(next); }} /><span className="visually-hidden">选择 {candidate.name}</span></label><MediaThumbnail value={candidate.logoUrl} label={candidate.name} kind="shop" /><div className="candidate-main"><strong>{candidate.name}</strong><small>{candidate._count.offerCandidates} 条候选报价 · 首次发现 {formatTime(candidate.firstSeenAt)}</small><a href={candidate.directoryUrl} target="_blank" rel="noreferrer">查看链动店铺 <Eye /></a></div><div className="candidate-actions"><button className="button dark compact" type="button" disabled={Boolean(busy)} onClick={() => void act(`approve-${candidate.id}`, () => decide(candidate.id, "approve"), `${candidate.name} 已批准并认证`)}><CheckCircle />批准</button><button className="icon-button danger" type="button" disabled={Boolean(busy)} aria-label={`拒绝 ${candidate.name}`} title="拒绝候选" onClick={() => void act(`reject-${candidate.id}`, () => decide(candidate.id, "reject"), `${candidate.name} 已拒绝`)}><XCircle /></button></div></article>)}{candidates && !candidates.items.length && <div className="admin-empty"><CheckCircle /><strong>没有待审候选</strong><span>当前链动小店候选已处理完成。</span></div>}</div>{candidates && candidates.totalPages > 1 && <nav className="admin-pagination" aria-label="候选店铺分页"><button className="button ghost compact" type="button" disabled={page <= 1 || Boolean(busy)} onClick={() => setPage((current) => Math.max(1, current - 1))}>上一页</button><span>第 {candidates.page} / {candidates.totalPages} 页</span><button className="button ghost compact" type="button" disabled={page >= candidates.totalPages || Boolean(busy)} onClick={() => setPage((current) => current + 1)}>下一页</button></nav>}</section></div>;
}

function HotSearchPanel({ items, newTerm, setNewTerm, busy, request, act }: { items: HotSearch[]; newTerm: string; setNewTerm: (value: string) => void; busy: string | null; request: AdminRequest; act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const reorder = (index: number, delta: number) => { const ids = items.map((item) => item.id); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; return request("/hot-searches/reorder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }); };
  return <div className="admin-module"><section className="admin-panel"><div className="admin-section-head"><div><span className="kicker">首页运营</span><h2>热门搜索词</h2></div><small className="admin-muted">启用后立即出现在首页</small></div><form className="hot-search-admin-add" onSubmit={(event) => { event.preventDefault(); if (!newTerm.trim()) return; void act("hot-add", async () => { await request("/hot-searches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ term: newTerm }) }); setNewTerm(""); }, "热门搜索词已添加"); }}><input value={newTerm} onChange={(event) => setNewTerm(event.target.value)} maxLength={40} placeholder="例如 Gemini" aria-label="新热门搜索词"/><button className="button dark compact" type="submit" disabled={Boolean(busy)}><Plus />添加</button></form><div className="hot-search-admin-list">{items.map((item, index) => <div className={item.active ? "hot-search-admin-row" : "hot-search-admin-row is-disabled"} key={item.id}><span className="hot-search-admin-index">{index + 1}</span><strong>{item.term}</strong><span className="hot-search-admin-state">{item.active ? "首页展示" : "已停用"}</span><div className="hot-search-admin-actions"><button className="icon-button" type="button" aria-label={`上移 ${item.term}`} disabled={index === 0 || Boolean(busy)} onClick={() => void act(`hot-up-${item.id}`, () => reorder(index, -1), "顺序已更新")}><ArrowUp /></button><button className="icon-button" type="button" aria-label={`下移 ${item.term}`} disabled={index === items.length - 1 || Boolean(busy)} onClick={() => void act(`hot-down-${item.id}`, () => reorder(index, 1), "顺序已更新")}><ArrowDown /></button><button className="icon-button danger" type="button" aria-label={`${item.active ? "停用" : "启用"} ${item.term}`} disabled={Boolean(busy)} onClick={() => void act(`hot-toggle-${item.id}`, () => request(`/hot-searches/${item.id}/toggle`, { method: "POST" }), `搜索词已${item.active ? "停用" : "启用"}`)}>{item.active ? <EyeSlash /> : <Eye />}</button></div></div>)}</div></section></div>;
}

function SearchAdPanel({ items, busy, request, act }: { items: SearchAd[]; busy: string | null; request: AdminRequest; act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [draft, setDraft] = useState<SearchAdDraft>(emptySearchAdDraft);
  function update(field: keyof SearchAdDraft, value: string | boolean) { setDraft((current) => ({ ...current, [field]: value })); }
  function submit(event: FormEvent) {
    event.preventDefault();
    void act("search-ad-add", async () => {
      await request("/search-ads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      setDraft(emptySearchAdDraft);
    }, draft.active ? "搜索广告已添加并启用" : "搜索广告已保存，当前未启用");
  }
  const reorder = (index: number, delta: number) => { const ids = items.map((item) => item.id); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; return request("/search-ads/reorder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }); };
  return <div className="admin-module"><section className="admin-panel"><div className="admin-section-head"><div><span className="kicker">搜索结果</span><h2>添加置顶广告</h2></div><small className="admin-muted">命中关键词或全局展示时，结果顶部只显示第一条启用广告</small></div><form className="search-ad-admin-form" onSubmit={submit}>
    <label><span>广告标题 <b>*</b></span><input required maxLength={100} value={draft.title} onChange={(event) => update("title", event.target.value)} placeholder="例如 Claude Pro 稳定货源" /></label>
    <label><span>广告标识</span><input required maxLength={20} value={draft.label} onChange={(event) => update("label", event.target.value)} /></label>
    <label className="wide"><span>目标链接 <b>*</b></span><input required type="url" pattern="https://.*" value={draft.url} onChange={(event) => update("url", event.target.value)} placeholder="https://example.com" /></label>
    <label className="wide"><span>图片 URL</span><input type="url" pattern="https://.*" value={draft.imageUrl} onChange={(event) => update("imageUrl", event.target.value)} placeholder="https://example.com/ad.webp" /></label>
    <label className="wide"><span>关键词</span><input maxLength={500} value={draft.keywords} onChange={(event) => update("keywords", event.target.value)} placeholder="Claude, Pro, plus" /><small>多个关键词用中文或英文逗号分隔。</small></label>
    <label className="full"><span>广告描述</span><textarea rows={3} maxLength={300} value={draft.description} onChange={(event) => update("description", event.target.value)} placeholder="一句话说明推广内容" /></label>
    <label><span>开始时间</span><input type="datetime-local" value={draft.startsAt} onChange={(event) => update("startsAt", event.target.value)} /></label>
    <label><span>结束时间</span><input type="datetime-local" value={draft.endsAt} onChange={(event) => update("endsAt", event.target.value)} /></label>
    <label className="search-ad-toggle"><input type="checkbox" checked={draft.global} onChange={(event) => update("global", event.target.checked)} /><span aria-hidden="true" /><strong>全局展示</strong><small>没有关键词命中时也可展示。</small></label>
    <label className="search-ad-toggle"><input type="checkbox" checked={draft.active} onChange={(event) => update("active", event.target.checked)} /><span aria-hidden="true" /><strong>立即启用</strong><small>关闭后仅保存到列表。</small></label>
    <button className="button dark" type="submit" disabled={Boolean(busy)}><Plus />添加搜索广告</button>
  </form></section><section className="admin-panel"><div className="admin-section-head"><div><span className="kicker">展示顺序</span><h2>已添加搜索广告</h2></div><span className="result-summary">{items.filter((item) => item.active).length} 个启用</span></div><div className="search-ad-admin-list">{items.map((item, index) => <article className={item.active ? "search-ad-admin-row" : "search-ad-admin-row is-disabled"} key={item.id}>{item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span className="search-ad-admin-thumb"><Tag /></span>}<div><strong>{item.title}<span>{item.label}</span></strong><small>{item.global ? "全局展示" : item.keywords.join("，")}</small><p>{item.description || item.url}</p><dl><div><dt>曝光</dt><dd>{item.impressionCount}</dd></div><div><dt>点击</dt><dd>{item.clickCount}</dd></div><div><dt>有效期</dt><dd>{item.startsAt || item.endsAt ? `${item.startsAt ? formatTime(item.startsAt) : "立即"} - ${item.endsAt ? formatTime(item.endsAt) : "长期"}` : "长期"}</dd></div></dl></div><span className={item.active ? "source-state active" : "source-state manual"}>{item.active ? "展示中" : "已停用"}</span><div className="admin-listing-actions"><button className="icon-button" type="button" aria-label={`上移 ${item.title}`} disabled={index === 0 || Boolean(busy)} onClick={() => void act(`search-ad-up-${item.id}`, () => reorder(index, -1), "广告顺序已更新")}><ArrowUp /></button><button className="icon-button" type="button" aria-label={`下移 ${item.title}`} disabled={index === items.length - 1 || Boolean(busy)} onClick={() => void act(`search-ad-down-${item.id}`, () => reorder(index, 1), "广告顺序已更新")}><ArrowDown /></button><button className="icon-button danger" type="button" aria-label={`${item.active ? "停用" : "启用"} ${item.title}`} disabled={Boolean(busy)} onClick={() => void act(`search-ad-toggle-${item.id}`, () => request(`/search-ads/${item.id}/toggle`, { method: "POST" }), `搜索广告已${item.active ? "停用" : "启用"}`)}>{item.active ? <EyeSlash /> : <Eye />}</button></div></article>)}{!items.length && <div className="admin-empty compact"><Tag /><strong>尚未添加搜索广告</strong><span>添加后会根据关键词或全局规则出现在搜索结果顶部。</span></div>}</div></section></div>;
}

function ListingPanel({ type, title, items, busy, request, act }: { type: "gateway" | "project"; title: string; items: Listing[]; busy: string | null; request: AdminRequest; act: (key: string, action: () => Promise<unknown>, success: string) => Promise<void> }) {
  const [draft, setDraft] = useState<ListingDraft>(emptyListingDraft);
  function update(field: keyof ListingDraft, value: string) { setDraft((current) => ({ ...current, [field]: value })); }
  function submit(event: FormEvent) { event.preventDefault(); void act(`listing-add-${type}`, async () => { await request("/listings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type, ...draft }) }); setDraft(emptyListingDraft); }, `${title}已添加`); }
  const reorder = (index: number, delta: number) => { const ids = items.map((item) => item.id); [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]]; return request("/listings/reorder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids }) }); };
  return <div className="admin-module"><section className="admin-panel"><div className="admin-section-head"><div><span className="kicker">前台展示</span><h2>添加{title}</h2></div><small className="admin-muted">仅接受 HTTPS 官网与图片链接</small></div><form className="listing-admin-form" onSubmit={submit}><label><span>名称</span><input required maxLength={100} value={draft.title} onChange={(event) => update("title", event.target.value)} placeholder={`${title}名称`} /></label><label><span>标签</span><input maxLength={30} value={draft.badge} onChange={(event) => update("badge", event.target.value)} placeholder="推荐 / 热门" /></label><label className="wide"><span>官网链接</span><input required type="url" value={draft.url} onChange={(event) => update("url", event.target.value)} placeholder="https://example.com" /></label><label className="wide"><span>缩略图 URL</span><input type="url" value={draft.thumbnailUrl} onChange={(event) => update("thumbnailUrl", event.target.value)} placeholder="https://example.com/cover.webp" /></label><label className="full"><span>展示说明</span><textarea maxLength={500} rows={3} value={draft.description} onChange={(event) => update("description", event.target.value)} placeholder="简要说明服务特点和适用场景" /></label><button className="button dark" type="submit" disabled={Boolean(busy)}><Plus />添加到展示</button></form></section><section className="admin-panel"><div className="admin-section-head"><div><span className="kicker">展示顺序</span><h2>已添加{title}</h2></div><span className="result-summary">{items.filter((item) => item.active).length} 个启用</span></div><div className="admin-listing-list">{items.map((item, index) => <article className={item.active ? "admin-listing-row" : "admin-listing-row is-disabled"} key={item.id}><MediaThumbnail value={item.thumbnailUrl} label={item.title} kind="listing" /><div><strong>{item.title}{item.badge && <span>{item.badge}</span>}</strong><small>{item.url}</small><p>{item.description || "暂无说明"}</p></div><span className={item.active ? "source-state active" : "source-state manual"}>{item.active ? "展示中" : "已停用"}</span><div className="admin-listing-actions"><button className="icon-button" type="button" aria-label={`上移 ${item.title}`} disabled={index === 0 || Boolean(busy)} onClick={() => void act(`listing-up-${item.id}`, () => reorder(index, -1), "展示顺序已更新")}><ArrowUp /></button><button className="icon-button" type="button" aria-label={`下移 ${item.title}`} disabled={index === items.length - 1 || Boolean(busy)} onClick={() => void act(`listing-down-${item.id}`, () => reorder(index, 1), "展示顺序已更新")}><ArrowDown /></button><button className="icon-button danger" type="button" aria-label={`${item.active ? "停用" : "启用"} ${item.title}`} disabled={Boolean(busy)} onClick={() => void act(`listing-toggle-${item.id}`, () => request(`/listings/${item.id}/toggle`, { method: "POST" }), `${title}已${item.active ? "停用" : "启用"}`)}>{item.active ? <EyeSlash /> : <Eye />}</button></div></article>)}{!items.length && <div className="admin-empty compact"><Tag /><strong>尚未添加{title}</strong><span>填写上方表单后会进入展示列表。</span></div>}</div></section></div>;
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
