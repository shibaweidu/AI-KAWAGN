import type { Metadata } from "next";
import { GlobeHemisphereEast, LinkSimple, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { SubmitShopForm } from "@/components/Forms";

export const metadata: Metadata = { title: "提交店铺" };

export default function SubmitPage() {
  const steps = [
    ["01", "链接安全检查", "验证 HTTPS、DNS 与授权声明"],
    ["02", "店铺所有权验证", "使用 DNS TXT 或首页令牌认领"],
    ["03", "首次采集与归并", "解析商品，低置信度结果人工复核"],
    ["04", "持续同步", "通过后每 60–90 分钟更新公开价格"],
  ];
  return <><section className="page-hero"><div className="shell"><span className="kicker"><GlobeHemisphereEast />商家入驻</span><h1>让好商品更容易被找到</h1><p>店铺通过安全检查和授权审核后，将进入自动同步与比价流程。</p></div></section><section className="shell page-section submit-layout"><div><span className="kicker"><LinkSimple />提交链接</span><h2>提交店铺或标准 API</h2><SubmitShopForm /></div><aside className="panel process-panel"><h2>收录流程</h2>{steps.map(([n,t,d]) => <div className="process-step" key={n}><b>{n}</b><span><strong>{t}</strong><small>{d}</small></span></div>)}<div className="process-note"><ShieldCheck /><span><strong>授权优先</strong><small>平台不采集未授权店铺，也不存储购买者的订单与凭证。</small></span></div></aside></section></>;
}
