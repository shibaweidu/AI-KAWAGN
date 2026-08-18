import type { Metadata } from "next";
import { PlacementCenter } from "@/components/PlacementCenter";

export const metadata: Metadata = { title: "店铺广告投放" };
export default function ShopPlacementsPage() { return <PlacementCenter kind="shop" />; }
