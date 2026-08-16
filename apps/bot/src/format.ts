import type { SearchAdPage } from "@ai-card/contracts";

export function commandQuery(text: string, command: "price" | "search") {
  const match = text.match(new RegExp(`^/${command}(?:@[A-Za-z0-9_]+)?(?:\\s+([\\s\\S]*))?$`, "i"));
  return match?.[1]?.trim() || "";
}

export function validateQuery(query: string) {
  if (!query) return "请输入商品关键词，例如：/price Plus 成品号";
  if (query.length < 2) return "关键词至少需要 2 个字符";
  if (query.length > 100) return "关键词不能超过 100 个字符";
  return null;
}

export function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function formatSearchReply(result: SearchAdPage, query: string, siteUrl: string) {
  if (!result.items.length) return `没有找到“${escapeHtml(query)}”相关商品。\n请尝试缩短关键词或更换商品名称。`;
  const lines = [`查到“${escapeHtml(query)}”相关商品组 ${result.total} 个：`, ""];
  for (const [index, item] of result.items.entries()) {
    const number = (result.page - 1) * result.pageSize + index + 1;
    const url = new URL(`/products/${encodeURIComponent(item.productSlug)}`, normalizedSiteUrl(siteUrl)).toString();
    lines.push(`${number}. <b>${escapeHtml(item.productName)}</b>`);
    lines.push(`最低 ¥${formatPrice(item.lowestPrice)}｜${item.offerCount} 家报价｜${item.inStockOfferCount} 家有货`);
    lines.push(`<a href="${escapeHtml(url)}">查看全部报价</a>`, "");
  }
  if (result.totalPages > 1) lines.push(`第 ${result.page}/${result.totalPages} 页`);
  const text = lines.join("\n").trim();
  return text.length <= 3500 ? text : `${text.slice(0, 3440)}\n\n结果较多，请打开站内详情查看。`;
}

function normalizedSiteUrl(value: string) {
  const url = new URL(value || "http://localhost:3000");
  if (process.env.NODE_ENV === "production" && url.protocol !== "https:") throw new Error("PUBLIC_SITE_URL must use HTTPS in production");
  return url;
}

function formatPrice(value: number) {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
