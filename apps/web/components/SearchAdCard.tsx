import { ArrowSquareOut, Tag } from "@phosphor-icons/react/dist/ssr";
import type { SearchAd } from "@ai-card/contracts";

export function SearchAdCard({ ad, standalone = false }: { ad: SearchAd; standalone?: boolean }) {
  const background = ad.backgroundImageUrl || ad.imageUrl;
  const content = ad.content?.length ? ad.content : ad.description ? [{ text: ad.description, bold: false, italic: false, underline: false, color: "default" as const, href: null }] : [];
  return <article className={standalone ? "search-ad-card standalone" : "search-ad-card"} aria-label={`推广：${ad.title}`}>
    {background ? <img className="search-ad-background" src={background} alt="" loading="lazy" /> : <div className="search-ad-background search-ad-placeholder"><Tag /></div>}
    <div className="search-ad-overlay" aria-hidden="true" />
    <div className="search-ad-logo">{ad.logoUrl ? <img src={ad.logoUrl} alt="" /> : <Tag />}</div>
    <div className="search-ad-copy"><span className="ad-label">{ad.label}</span><h2>{ad.title}</h2><p>{content.length ? content.map((segment, index) => {
      const className = `announcement-segment color-${segment.color}${segment.bold ? " is-bold" : ""}${segment.italic ? " is-italic" : ""}${segment.underline ? " is-underlined" : ""}`;
      return segment.href ? <a className={className} href={segment.href} key={index} target={segment.href.startsWith("https://") ? "_blank" : undefined} rel={segment.href.startsWith("https://") ? "noopener noreferrer" : undefined}>{segment.text}</a> : <span className={className} key={index}>{segment.text}</span>;
    }) : "平台运营置顶展示，访问前请自行核对服务内容与交易条款。"}</p></div>
    <a className="button dark compact search-ad-action" href={`/api/v1/go/search-ad/${ad.id}`} target="_blank" rel="noreferrer sponsored">查看推广 <ArrowSquareOut /></a>
  </article>;
}
