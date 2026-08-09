import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CheckCircle, Clock, ShieldCheck, Storefront } from "@phosphor-icons/react/dist/ssr";
import { MediaThumbnail } from "@/components/MediaThumbnail";
import { serverApi } from "@/lib/server-api";

export const dynamic = "force-dynamic";

type ProductDetail = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  thumbnailUrl?: string | null;
  lowestPrice: number;
  highestPrice: number;
  offerCount: number;
  offers: Array<{
    id: string;
    shopId: string;
    shopName: string;
    shopLogo?: string | null;
    price: number;
    stock: number | null;
    syncedAt: string;
    sourceName: string;
    sourceObservedAt?: string;
  }>;
};

async function load(slug: string) {
  try {
    return await serverApi<ProductDetail>(`/products/${encodeURIComponent(slug)}`);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await load(slug);
  return { title: product?.title || "商品比价" };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await load(slug);
  if (!product) notFound();

  return <>
    <section className="product-hero">
      <div className="shell">
        <Link className="back-link" href="/search"><ArrowLeft />返回搜索结果</Link>
        <div className="product-title">
          <div className="product-heading">
            <MediaThumbnail value={product.thumbnailUrl} label={product.title} kind="product" className="product-detail-thumb" />
            <div>
              <span className="category-label">{product.category}</span>
              <h1>{product.title}</h1>
              <p>{product.summary || "已审核公开报价聚合，最终价格与库存以原店页面为准。"}</p>
            </div>
          </div>
          <div className="product-best"><span>当前最低</span><strong><i>¥</i>{product.lowestPrice.toFixed(2)}</strong><small>价格区间 ¥{product.lowestPrice.toFixed(2)} – ¥{product.highestPrice.toFixed(2)}</small></div>
        </div>
      </div>
    </section>
    <section className="shell page-section">
      <div className="trust-strip"><span><ShieldCheck />人工审核</span><span><Clock />来源观测时间</span><span><CheckCircle />价格可追溯</span><span><Storefront />{product.offerCount} 家报价</span></div>
      <div className="section-title"><div><span className="kicker"><Storefront />同款比价</span><h2>全部店铺报价</h2></div><span>链动小店采集报价</span></div>
      <div className="offers-table panel">
        <div className="offer-head"><span>店铺与来源</span><span>观测时间</span><span>库存</span><span>价格</span><span /></div>
        {product.offers.map((offer, index) => <div className={index === 0 ? "offer-row best" : "offer-row"} key={offer.id}>
          <div><MediaThumbnail value={offer.shopLogo} label={offer.shopName} kind="shop" className="offer-shop-logo" /><span><strong>{offer.shopName}</strong></span></div>
          <span>{formatTime(offer.sourceObservedAt || offer.syncedAt)}</span>
          <span>{offer.stock ?? "未提供"}</span>
          <strong className="price">¥{offer.price.toFixed(2)}{index === 0 && <small>当前最低</small>}</strong>
          <a className="button dark compact" href={`/api/v1/go/offer/${offer.id}`} target="_blank" rel="noreferrer">前往购买 <ArrowUpRight /></a>
        </div>)}
      </div>
      <div className="compare-note"><ShieldCheck /><p><strong>安全提示</strong>购买将在原店铺完成，平台不参与支付、订单或交付。</p></div>
    </section>
  </>;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value));
}
