import type { Metadata } from "next";

export const metadata: Metadata = { title: "隐私与收录规则", description: "平台隐私、授权收录和安全跳转规则。" };

export default function PrivacyPage() {
  return <><section className="page-hero compact"><div className="shell"><span className="kicker">平台规则</span><h1>隐私与收录规则</h1><p>说明平台处理公开报价、匿名点击与用户反馈的基本边界。</p></div></section><section className="shell page-section policy-content"><article id="collection"><h2>授权收录</h2><p>平台只同步主动提交或明确授权的公开店铺信息，并按照来源站点允许的频率更新。</p></article><article><h2>交易边界</h2><p>平台提供检索、比较和安全跳转，不处理支付、订单、退款或商品交付。</p></article><article><h2>最少数据原则</h2><p>匿名点击和纠错反馈只保留完成安全审计与限流所需的信息，不用于构建个人交易画像。</p></article></section></>;
}
