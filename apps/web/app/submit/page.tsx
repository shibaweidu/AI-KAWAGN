import type { Metadata } from "next";
import { GlobeHemisphereEast, LinkSimple, ShieldCheck } from "@phosphor-icons/react/dist/ssr";
import { SubmitShopForm } from "@/components/Forms";

export const metadata: Metadata = { title: "提交收录" };

export default function SubmitPage() {
  const steps = [
    ["01", "基础信息校验", "验证 HTTPS 链接、联系信息与授权声明"],
    ["02", "人工审核", "核对重复收录与公开展示条件"],
    ["03", "补全资料发布", "店铺或中转站通过审核后再公开展示"],
    ["04", "后续同步配置", "商品与报价同步需另行配置授权数据来源"],
  ];
  return <><section className="page-hero"><div className="shell"><span className="kicker"><GlobeHemisphereEast />提交收录</span><h1>让好店铺与中转站更容易被找到</h1><p>无需登录即可提交。运营审核并补全公开资料后，才会进入对应目录。</p></div></section><section className="shell page-section submit-layout"><div><span className="kicker"><LinkSimple />提交链接</span><h2>提交店铺或中转站</h2><SubmitShopForm /></div><aside className="panel process-panel"><h2>收录流程</h2>{steps.map(([n,t,d]) => <div className="process-step" key={n}><b>{n}</b><span><strong>{t}</strong><small>{d}</small></span></div>)}<div className="process-note"><ShieldCheck /><span><strong>授权优先</strong><small>平台不采集未授权数据，也不接收 API Key、订单或购买凭证。</small></span></div></aside></section></>;
}
