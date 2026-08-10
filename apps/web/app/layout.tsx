import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./directory-views.css";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { MobileNav } from "@/components/MobileNav";
import { AiAssistant } from "@/components/AiAssistant";

const fallbackSettings = { siteName: "AI卡网", seoTitle: "全网数字商品货源比价", seoDescription: "聚合已授权数字商店的公开商品与价格，快速比较同款货源。", seoKeywords: [] as string[], logoUrl: null as string | null };

export async function generateMetadata(): Promise<Metadata> {
  let settings = fallbackSettings;
  // Do not make the image build depend on a running API. Runtime requests can still use live settings.
  if (process.env.NEXT_PHASE !== "phase-production-build") try {
    const origin = process.env.API_ORIGIN || "http://localhost:4000";
    const response = await fetch(`${origin}/v1/site-settings`, { next: { revalidate: 60 } });
    if (response.ok) settings = { ...settings, ...await response.json() };
  } catch { /* Keep metadata available while the API is starting. */ }
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return {
    title: { default: `${settings.siteName} - ${settings.seoTitle}`, template: `%s | ${settings.siteName}` },
    description: settings.seoDescription,
    keywords: settings.seoKeywords,
    metadataBase: new URL(siteUrl),
    icons: settings.logoUrl ? { icon: settings.logoUrl } : undefined,
    openGraph: { title: settings.siteName, description: settings.seoDescription, type: "website" },
  };
}
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };

export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="zh-CN" data-scroll-behavior="smooth"><body><Header /><main id="main-content">{children}</main><Footer /><MobileNav /><AiAssistant /></body></html>; }
