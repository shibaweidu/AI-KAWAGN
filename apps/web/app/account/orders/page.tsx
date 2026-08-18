import type { Metadata } from "next";
import { AccountOrders } from "@/components/AccountDashboard";

export const metadata: Metadata = { title: "我的广告订单" };
export default function OrdersPage() { return <AccountOrders />; }
