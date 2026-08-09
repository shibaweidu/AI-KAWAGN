import { Suspense } from "react";
import { HomeMarketplace } from "@/components/HomeMarketplace";

export default function Home() {
  return <Suspense fallback={<div className="shell home-page-fallback" aria-label="首页加载中" />}><HomeMarketplace /></Suspense>;
}
