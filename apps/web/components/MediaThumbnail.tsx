type MediaThumbnailProps = {
  value?: string | null;
  label: string;
  kind?: "shop" | "product" | "listing";
  className?: string;
};

export function MediaThumbnail({ value, label, kind = "product", className = "" }: MediaThumbnailProps) {
  const isImage = Boolean(value && /^https:\/\//i.test(value));
  return <span className={`media-thumbnail ${kind} ${className}`.trim()} aria-hidden="true">
    {isImage ? <img src={value!} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{initial(label)}</span>}
  </span>;
}

function initial(value: string) {
  return Array.from(value.trim())[0]?.toLocaleUpperCase("zh-CN") || "AI";
}
