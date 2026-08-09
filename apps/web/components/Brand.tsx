"use client";

import Link from "next/link";
import { CardsThree } from "@phosphor-icons/react/dist/ssr";
import { useSiteSettings } from "@/lib/site-settings-api";

export function Brand() {
  const settings = useSiteSettings();
  return <Link href="/" className="brand" aria-label={`${settings.siteName}首页`}><span className={settings.logoUrl ? "brand-mark has-upload" : "brand-mark"}>{settings.logoUrl ? <img src={settings.logoUrl} alt="" /> : <CardsThree weight="fill" />}</span><span><strong>{settings.siteName}</strong>{settings.slogan && <small>{settings.slogan}</small>}</span></Link>;
}
