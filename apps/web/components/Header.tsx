"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { SignIn, SignOut, Storefront, UserCircle, UserPlus } from "@phosphor-icons/react";
import { Brand } from "./Brand";

const links = [["/", "首页"], ["/categories", "商品分类"], ["/shops", "全部店铺"], ["/gateways", "中转站目录"], ["/projects", "热门项目"]];
type SessionUser = { email: string; role: "buyer" | "merchant" | "moderator" | "admin" };
export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const loadSession = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/auth/me", { credentials: "include" });
      const body = await response.json() as { user?: SessionUser | null };
      setUser(response.ok ? body.user || null : null);
    } catch { setUser(null); }
  }, []);
  useEffect(() => {
    void loadSession();
    window.addEventListener("ai-card-auth-changed", loadSession);
    return () => window.removeEventListener("ai-card-auth-changed", loadSession);
  }, [loadSession, pathname]);
  async function logout() {
    setLoggingOut(true);
    try { await fetch("/api/v1/auth/logout", { method: "POST", credentials: "include" }); }
    finally { setUser(null); setLoggingOut(false); router.replace("/"); router.refresh(); }
  }
  return <><a className="skip-link" href="#main-content">跳到主要内容</a><header className="site-header"><div className="shell header-inner"><Brand /><nav className="desktop-nav" aria-label="主导航">{links.map(([href, label]) => {
    const active = href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
    return <Link href={href} key={href} aria-current={active ? "page" : undefined}>{label}</Link>;
  })}</nav><div className="header-actions"><Link className="button merchant-button compact" href="/submit"><Storefront />提交收录</Link>{user ? <><Link className="button ghost compact" href={user.role === "admin" || user.role === "moderator" ? "/admin" : "/account"}><UserCircle />{user.role === "admin" || user.role === "moderator" ? "运营后台" : "账户中心"}</Link><button className="icon-button" type="button" aria-label="退出登录" title="退出登录" disabled={loggingOut} onClick={() => void logout()}><SignOut /></button></> : <><Link className="button ghost compact" href="/account"><SignIn />登录</Link><Link className="button dark compact" href="/account?mode=register"><UserPlus />注册</Link></>}</div></div></header></>;
}
