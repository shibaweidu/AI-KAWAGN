import type { Metadata } from "next";
import { AccountEntry } from "@/components/AccountDashboard";

export const metadata: Metadata = { title: "用户中心" };
export default async function AccountPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) { const { mode } = await searchParams; return <AccountEntry initialMode={mode === "register" ? "register" : "login"} />; }
