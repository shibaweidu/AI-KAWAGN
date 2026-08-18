import { SponsorCard, type SponsorCardItem } from "./SponsorCard";

export type ShopSponsor = SponsorCardItem & { shop: true; slots?: Array<{ key: string; name: string; position: number }> };

export function ShopSponsorGrid({ items }: { items: ShopSponsor[] }) {
  if (!items.length) return null;
  return <section className="shop-sponsors" aria-labelledby="shop-sponsors-title"><div className="shop-sponsor-head"><div><span className="kicker">合作推广</span><h2 id="shop-sponsors-title">店铺赞助</h2></div><span>付费展示</span></div><div className="shop-sponsor-grid">{items.map((item) => <SponsorCard item={item} key={item.id} />)}</div></section>;
}
