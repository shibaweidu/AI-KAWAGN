"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ChartBar, CheckCircle, Clock, CreditCard, Gauge, LockKey, Megaphone, Receipt, ShieldCheck, SignOut, Storefront, UserCircle, WarningCircle } from "@phosphor-icons/react";
import { AccountForm } from "./Forms";

export type AccountUser = { id: string; email: string; role: "buyer" | "merchant" | "moderator" | "admin"; verified: boolean; active: boolean; createdAt: string };
type AccountSection = "overview" | "placements" | "shop-placements" | "orders" | "profile";
type Order = { id: string; orderNo: string; status: string; totalAmount: number; createdAt: string; expiresAt: string | null; canContinuePayment: boolean; reviewedAt: string | null; reviewNote: string | null; sponsorAd?: { title: string; kind?: "gateway" | "shop" }; items: Array<{ key: string; name?: string; kind?: "gateway" | "shop"; days: number; startsAt: string | null; endsAt: string | null }> };
type Overview = { metrics: { ads: number; pendingPayment: number; pendingReview: number; activeCampaigns: number; finished: number }; recentOrders: Order[] };

const statusLabels: Record<string, string> = { pending_payment: "待付款", payment_processing: "支付处理中", paid_pending_review: "待管理员审核", approved: "已通过", rejected: "已拒绝", refund_pending: "待退款", refunded: "已退款", cancelled: "已取消" };
const roleLabels: Record<string, string> = { buyer: "普通用户", merchant: "商家", moderator: "运营人员", admin: "超级管理员" };
const slotLabels: Record<string, string> = { gateway: "中转站目录", home_left: "首页左侧", home_right: "首页右侧", home_bottom: "首页底部" };
const navigation = [
  { key: "overview" as const, href: "/account", label: "账户概览", Icon: Gauge },
  { key: "placements" as const, href: "/account/placements", label: "中转广告", Icon: Megaphone },
  { key: "shop-placements" as const, href: "/account/shop-placements", label: "店铺广告", Icon: Storefront },
  { key: "orders" as const, href: "/account/orders", label: "我的订单", Icon: Receipt },
  { key: "profile" as const, href: "/account/profile", label: "账户资料", Icon: UserCircle },
];
const accountFeatures = [
  { Icon: Megaphone, text: "按位置和天数购买广告" },
  { Icon: Receipt, text: "订单与审核状态集中查看" },
  { Icon: ChartBar, text: "投放数据与到期时间" },
  { Icon: ShieldCheck, text: "安全会话与密码管理" },
];
const overviewMetrics = [
  { Icon: Megaphone, label: "广告内容", key: "ads" as const },
  { Icon: CreditCard, label: "待付款", key: "pendingPayment" as const },
  { Icon: Clock, label: "待审核", key: "pendingReview" as const },
  { Icon: CheckCircle, label: "投放中", key: "activeCampaigns" as const },
  { Icon: Receipt, label: "已结束", key: "finished" as const },
];

export function useAccountUser(redirect = true) {
  const router = useRouter();
  const [user, setUser] = useState<AccountUser | null | undefined>(undefined);
  useEffect(() => {
    let active = true;
    let requestId = 0;
    const load = async () => {
      const currentRequest = ++requestId;
      try {
        const response = await fetch("/api/v1/auth/me", { credentials: "include", cache: "no-store" });
        const body = await response.json();
        if (!active || currentRequest !== requestId) return;
        const next = body?.user || null;
        setUser(next);
        if (!next && redirect) router.replace("/account");
      } catch {
        if (!active || currentRequest !== requestId) return;
        setUser(null);
        if (redirect) router.replace("/account");
      }
    };
    void load();
    window.addEventListener("ai-card-auth-changed", load);
    return () => { active = false; window.removeEventListener("ai-card-auth-changed", load); };
  }, [redirect, router]);
  return user;
}

export function AccountShell({ active, children, user: providedUser }: { active: AccountSection; children: ReactNode | ((user: AccountUser) => ReactNode); user?: AccountUser }) {
  const loadedUser = useAccountUser(providedUser === undefined);
  const user = providedUser || loadedUser;
  const router = useRouter();
  async function logout() { await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" }); window.dispatchEvent(new Event("ai-card-auth-changed")); router.replace("/account"); router.refresh(); }
  if (!user) return <section className="account-dashboard-loading"><ShieldCheck /><strong>{user === undefined ? "正在读取账户信息" : "请先登录"}</strong></section>;
  return <section className="account-console"><div className="shell account-console-layout"><aside className="account-console-sidebar"><div><span className="kicker">ACCOUNT CENTER</span><h1>赞助广告管理</h1><p>{user.email}</p></div><nav aria-label="账户后台导航">{navigation.map(({ key, href, label, Icon }) => <Link key={key} href={href} className={active === key ? "is-active" : ""} aria-current={active === key ? "page" : undefined}><Icon /><span>{label}</span></Link>)}</nav><div className="account-console-user"><span>{roleLabels[user.role] || user.role}</span><button type="button" onClick={() => void logout()}><SignOut />退出登录</button></div></aside><section className="account-console-workspace">{typeof children === "function" ? children(user) : children}</section></div></section>;
}

export function AccountEntry({ initialMode }: { initialMode: "login" | "register" }) {
  const user = useAccountUser(false);
  if (user === undefined) return <section className="account-dashboard-loading"><ShieldCheck /><strong>正在读取账户信息</strong></section>;
  if (!user) return <section className="account-page"><div className="shell account-layout"><aside className="account-aside"><span className="kicker light">PLATFORM ACCOUNT</span><h1>管理你的赞助广告</h1><p>创建中转广告、查看付款与审核状态，并跟踪当前投放。</p>{accountFeatures.map(({ Icon, text }) => <div className="account-feature" key={text}><Icon /><span>{text}</span></div>)}</aside><AccountForm initialMode={initialMode} /></div></section>;
  return <AccountHome user={user} />;
}

function AccountHome({ user }: { user: AccountUser }) {
  const [data, setData] = useState<Overview | null>(null); const [error, setError] = useState("");
  const load = useCallback(async () => { try { const response = await fetch("/api/v1/account/overview", { credentials: "include" }); const body = await response.json(); if (!response.ok) throw new Error(body?.message || "账户概览加载失败"); setData(body); setError(""); } catch (reason) { setError(reason instanceof Error ? reason.message : "账户概览加载失败"); } }, []);
  useEffect(() => { void load(); }, [load]);
  const metrics = data?.metrics;
  return <AccountShell active="overview" user={user}><header className="account-workspace-head"><div><span className="kicker">OVERVIEW</span><h2>账户概览</h2><p>查看广告订单和当前投放状态。</p></div><Link className="button dark compact" href="/account/placements"><Megaphone />发布中转广告</Link></header>{error && <p className="placement-alert error"><WarningCircle />{error}</p>}<section className="account-metric-grid">{overviewMetrics.map(({ Icon, label, key }) => <article key={label}><Icon /><span>{label}</span><strong>{metrics?.[key] === undefined ? "—" : String(metrics[key])}</strong></article>)}</section><section className="account-panel"><div className="account-panel-head"><div><span className="kicker">RECENT ORDERS</span><h3>最近订单</h3></div><Link href="/account/orders">查看全部</Link></div><OrderList orders={data?.recentOrders || []} compact /></section></AccountShell>;
}

export function AccountOrders() {
  const [orders, setOrders] = useState<Order[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => { void fetch("/api/v1/placements/orders", { credentials: "include" }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body?.message || "订单加载失败"); setOrders(body); }).catch((reason) => setError(reason instanceof Error ? reason.message : "订单加载失败")).finally(() => setLoading(false)); }, []);
  return <AccountShell active="orders"><header className="account-workspace-head"><div><span className="kicker">MY ORDERS</span><h2>我的订单</h2><p>查看付款、审核、退款和实际投放时间。</p></div><Link className="button dark compact" href="/account/placements"><Megaphone />新建广告</Link></header>{error && <p className="placement-alert error"><WarningCircle />{error}</p>}<section className="account-panel"><div className="account-panel-head"><div><h3>全部订单</h3><span>{loading ? "加载中" : `${orders.length} 条记录`}</span></div></div><OrderList orders={orders} /></section></AccountShell>;
}

export function AccountProfile() {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget); try { const response = await fetch("/api/v1/auth/password", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: form.get("currentPassword"), newPassword: form.get("newPassword") }) }); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body?.message || "密码修改失败"); setMessage("密码已修改，请重新登录。"); window.dispatchEvent(new Event("ai-card-auth-changed")); window.setTimeout(() => { router.replace("/account"); router.refresh(); }, 900); } catch (reason) { setError(reason instanceof Error ? reason.message : "密码修改失败"); } finally { setBusy(false); } }
  return <AccountShell active="profile">{(user) => <><header className="account-workspace-head"><div><span className="kicker">PROFILE</span><h2>账户资料</h2><p>邮箱作为登录标识，当前不可修改。</p></div></header>{error && <p className="placement-alert error"><WarningCircle />{error}</p>}{message && <p className="placement-alert success"><CheckCircle />{message}</p>}<div className="account-profile-grid"><section className="account-panel account-profile-summary"><div className="profile-avatar"><UserCircle /></div><div><span>登录邮箱</span><strong>{user.email}</strong></div><div><span>账户角色</span><strong>{roleLabels[user.role] || user.role}</strong></div><div><span>注册时间</span><strong>{new Date(user.createdAt).toLocaleString("zh-CN")}</strong></div><div><span>账户状态</span><strong className="is-active">正常使用</strong></div></section><section className="account-panel"><div className="account-panel-head"><div><h3>修改密码</h3><span>修改成功后全部设备需要重新登录</span></div><LockKey /></div><form className="account-password-form" onSubmit={submit}><label><span>当前密码</span><input required minLength={8} maxLength={200} type="password" name="currentPassword" autoComplete="current-password" /></label><label><span>新密码</span><input required minLength={8} maxLength={200} type="password" name="newPassword" autoComplete="new-password" /></label><button className="button dark" type="submit" disabled={busy}><LockKey />{busy ? "正在修改" : "修改密码"}</button></form></section></div></>}</AccountShell>;
}

function OrderList({ orders, compact = false }: { orders: Order[]; compact?: boolean }) {
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState("");
  const [expiredIds, setExpiredIds] = useState<Set<string>>(new Set());
  async function continuePayment(order: Order) {
    setBusyOrderId(order.id); setPaymentError("");
    try {
      const response = await fetch(`/api/v1/placements/orders/${encodeURIComponent(order.id)}/pay`, { method: "POST", credentials: "include" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof body?.message === "string" ? body.message : "无法继续付款");
      if (!body.paymentUrl) throw new Error("支付地址生成失败，请联系管理员");
      window.location.assign(body.paymentUrl);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "无法继续付款";
      setPaymentError(message);
      if (message.includes("超过付款时间") || message.includes("已取消")) setExpiredIds((current) => new Set(current).add(order.id));
    } finally { setBusyOrderId(null); }
  }
  if (!orders.length) return <div className="placement-empty"><Receipt /><strong>还没有订单</strong><span>发布广告后，付款和审核状态会显示在这里。</span></div>;
  return <><div className={`account-order-list${compact ? " is-compact" : ""}`}>{orders.map((order) => { const canPay = order.canContinuePayment && !expiredIds.has(order.id); return <article key={order.id}><div><span className={`placement-status ${expiredIds.has(order.id) ? "cancelled" : order.status}`}>{expiredIds.has(order.id) ? "已取消" : statusLabels[order.status] || statusLabels[order.status.replace(/-/g, "_")] || order.status}</span><strong>{order.sponsorAd?.title || order.orderNo}</strong><small>{order.sponsorAd?.kind === "shop" ? "店铺广告" : "中转广告"} · {order.orderNo} · {new Date(order.createdAt).toLocaleString("zh-CN")}</small></div><div className="account-order-slots">{order.items.map((item) => <small key={item.key}>{item.name || slotLabels[item.key] || item.key} · {item.days} 天{item.startsAt ? ` · ${new Date(item.startsAt).toLocaleDateString("zh-CN")}` : ""}{item.endsAt ? ` 至 ${new Date(item.endsAt).toLocaleDateString("zh-CN")}` : ""}</small>)}{order.reviewNote && <small className="placement-review">审核说明：{order.reviewNote}</small>}{canPay && order.expiresAt && <small className="account-order-expiry">付款截止：{new Date(order.expiresAt).toLocaleString("zh-CN", { hour12: false })}</small>}</div><div className="account-order-actions"><b>¥{Number(order.totalAmount).toFixed(2)}</b>{canPay && <button className="button dark compact" type="button" disabled={busyOrderId === order.id} onClick={() => void continuePayment(order)}><CreditCard />{busyOrderId === order.id ? "正在跳转" : "继续付款"}</button>}</div></article>; })}</div>{paymentError && <p className="placement-alert error"><WarningCircle />{paymentError}</p>}</>;
}
