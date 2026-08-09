import type { Metadata } from "next";
import Link from "next/link";
import { Fire } from "@phosphor-icons/react/dist/ssr";
import { serverApi } from "@/lib/server-api";

export const metadata: Metadata = { title: "热门货源" };
export const dynamic = "force-dynamic";
type HotProduct = { id: string; slug: string; title: string; category: string; offerCount: number; lowestPrice: number };
export default async function HotPage() { const products = await serverApi<HotProduct[]>("/hot"); return <><section className="page-hero"><div className="shell"><span className="kicker"><Fire />报价覆盖</span><h1>热门货源</h1><p>按当前有效店铺报价数量排序，不使用虚构浏览量或趋势。</p></div></section><section className="shell page-section"><div className="hot-table panel"><div className="table-head"><span>排名</span><span>商品</span><span>分类</span><span>店铺</span><span>最低价</span><span /></div>{products.map((product, index) => <div className="hot-row" key={product.id}><b className={index < 3 ? "hot-rank top" : "hot-rank"}>{index + 1}</b><div><strong>{product.title}</strong><small>真实有效报价</small></div><span>{product.category}</span><span>{product.offerCount} 家</span><strong className="price">¥{product.lowestPrice.toFixed(2)}</strong><Link className="button ghost compact" href={`/products/${product.slug}`}>查看比价</Link></div>)}{!products.length && <div className="empty-state"><Fire /><h2>暂无足够数据</h2><p>审核真实报价后才会生成热门排行。</p></div>}</div></section></>; }
