import type { Metadata } from "next";
import { AdminIngestion } from "@/components/AdminIngestion";

export const metadata: Metadata = { title: "真实数据运营" };
export default function AdminPage() { return <AdminIngestion />; }
