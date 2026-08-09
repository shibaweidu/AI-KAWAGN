"use client";

import { useState } from "react";
import { Bell, BellRinging } from "@phosphor-icons/react";

export function FollowButton({ shopId }: { shopId: string }) {
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(false);
  async function toggle() {
    if (following) { setFollowing(false); return; }
    setLoading(true);
    try { const response = await fetch(`/api/v1/follows/${shopId}`, { method: "POST", credentials: "include" }); if (response.ok) setFollowing(true); }
    finally { setLoading(false); }
  }
  return <button className={following ? "button followed" : "button dark"} onClick={toggle} disabled={loading} aria-pressed={following}>{following ? <BellRinging weight="fill" /> : <Bell />}{loading ? "处理中..." : following ? "已关注" : "关注店铺"}</button>;
}
