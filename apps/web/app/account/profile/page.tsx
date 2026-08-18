import type { Metadata } from "next";
import { AccountProfile } from "@/components/AccountDashboard";

export const metadata: Metadata = { title: "账户资料" };
export default function ProfilePage() { return <AccountProfile />; }
