import type { ManagedListingItem } from "./ManagedListingGrid";
import { SponsorCard } from "./SponsorCard";

export function GatewaySponsorCard({ item }: { item: ManagedListingItem }) {
  return <SponsorCard item={item} />;
}

export function GatewaySponsorGrid({ items, className = "" }: { items: ManagedListingItem[]; className?: string }) {
  if (!items.length) return null;

  return <div className={`gateway-sponsor-grid${className ? ` ${className}` : ""}`}>
    {items.map((item) => <GatewaySponsorCard item={item} key={item.id} />)}
  </div>;
}
