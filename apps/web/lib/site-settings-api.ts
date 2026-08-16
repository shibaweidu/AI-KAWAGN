"use client";

import { useCallback, useEffect, useState } from "react";
import { siteSettingsSchema, type SiteSettings } from "@ai-card/contracts";

export const defaultSiteSettings: SiteSettings = {
  siteName: "AI卡网",
  slogan: "AICardHub",
  description: "聚合授权店铺的公开报价，让数字商品检索与比价更清晰。",
  seoTitle: "全网数字商品货源比价",
  seoDescription: "聚合已授权数字商店的公开商品与价格，快速比较同款货源。",
  seoKeywords: [],
  logoUrl: null,
  updatedAt: new Date(0).toISOString(),
  gatewayNotice: {
    title: "使用前请独立核验",
    description: "建议少额充值，并避免通过第三方服务传输敏感信息。",
    enabled: true,
  },
  announcement: null,
};

export async function getSiteSettings(signal?: AbortSignal) {
  const response = await fetch("/api/v1/site-settings", { signal, cache: "no-store" });
  if (!response.ok) throw new Error("网站设置加载失败");
  return siteSettingsSchema.parse(await response.json());
}

export function useSiteSettings() {
  const [settings, setSettings] = useState(defaultSiteSettings);
  const refresh = useCallback(() => {
    const controller = new AbortController();
    getSiteSettings(controller.signal).then(setSettings).catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    let cleanup = refresh();
    const reload = () => { cleanup(); cleanup = refresh(); };
    window.addEventListener("ai-card-site-settings-changed", reload);
    return () => { cleanup(); window.removeEventListener("ai-card-site-settings-changed", reload); };
  }, [refresh]);
  return settings;
}
