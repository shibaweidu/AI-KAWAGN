"use client";

import Link from "next/link";
import { Megaphone, X } from "@phosphor-icons/react";
import { useState } from "react";
import { useSiteSettings } from "@/lib/site-settings-api";

export function AnnouncementBar() {
  const { announcement } = useSiteSettings();
  const version = announcement ? `${announcement.id}:${announcement.updatedAt}` : "";
  const [dismissedVersion, setDismissedVersion] = useState("");

  if (!announcement || !announcement.content.length || dismissedVersion === version) return null;
  const plainText = `${announcement.label}：${announcement.content.map((segment) => segment.text).join("")}`;

  return <aside className="announcement" aria-label="网站公告">
    <div className="shell announcement-inner">
      <span className="announcement-label"><Megaphone aria-hidden="true" />{announcement.label}</span>
      <p className="announcement-content" title={plainText}>
        {announcement.content.map((segment, index) => {
          const className = `announcement-segment color-${segment.color}${segment.bold ? " is-bold" : ""}${segment.italic ? " is-italic" : ""}${segment.underline ? " is-underlined" : ""}`;
          if (!segment.href) return <span className={className} key={index}>{segment.text}</span>;
          const external = segment.href.startsWith("https://");
          return external
            ? <a className={className} href={segment.href} key={index} target="_blank" rel="noopener noreferrer">{segment.text}</a>
            : <Link className={className} href={segment.href} key={index}>{segment.text}</Link>;
        })}
      </p>
      {announcement.dismissible && <button className="announcement-close" type="button" aria-label="关闭公告" title="关闭公告" onClick={() => setDismissedVersion(version)}><X /></button>}
    </div>
  </aside>;
}
