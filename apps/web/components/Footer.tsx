"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ShieldCheck } from "@phosphor-icons/react";
import { getHome } from "@/lib/home-api";
import { Brand } from "./Brand";
import { useSiteSettings } from "@/lib/site-settings-api";

export function Footer() {
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const settings = useSiteSettings();
  useEffect(() => { const controller = new AbortController(); getHome(controller.signal).then((home) => setLastSyncedAt(home.stats.lastSyncedAt)).catch(() => undefined); return () => controller.abort(); }, []);
  return <footer className="site-footer"><div className="shell footer-grid">
    <div className="footer-brand"><Brand /><p>{settings.description}</p><span className="footer-safety"><ShieldCheck />平台不参与支付、订单与商品交付，请在原店确认交易规则。</span></div>
    <div><strong>平台导航</strong><Link href="/categories">商品分类</Link><Link href="/shops">全部店铺</Link><Link href="/gateways">中转站目录</Link><Link href="/projects">热门项目</Link></div>
    <div><strong>商家服务</strong><Link href="/submit">提交收录</Link><Link href="/shops">店铺认领</Link><Link href="/messages">反馈问题</Link></div>
    <div><strong>帮助与规则</strong><Link href="/changelog">更新日志</Link><Link href="/privacy">隐私条款</Link><Link href="/privacy#collection">收录规则</Link></div>
    <div><strong>联系我们</strong><a href="mailto:support@example.com">平台支持</a><Link href="/messages">留言中心</Link><span>工作日 09:00–18:00</span></div>
  </div><div className="shell footer-bottom"><span>© {new Date().getFullYear()} {settings.siteName}</span><span>{lastSyncedAt ? `最近数据更新：${new Date(lastSyncedAt).toLocaleString("zh-CN")}` : "最近数据更新：暂无已发布数据"}</span></div></footer>;
}
