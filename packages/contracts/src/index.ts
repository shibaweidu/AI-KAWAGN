import { z } from "zod";

export const roleSchema = z.enum(["buyer", "merchant", "moderator", "admin"]);
export const shopStatusSchema = z.enum(["pending", "active", "paused", "rejected"]);
export const sourceModeSchema = z.enum(["public_feed", "public_directory", "authorized_direct", "manual"]);

export const shopSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  logo: z.string(),
  productCount: z.number().int(),
  lowestPrice: z.number(),
  highestPrice: z.number().optional(),
  aggregateStock: z.number().int().nullable().optional(),
  categories: z.array(z.string()).default([]),
  dataLevel: z.enum(["offers", "directory", "profile"]).default("offers"),
  syncedAt: z.string(),
  verified: z.boolean(),
  publishedAt: z.string().nullable().optional(),
  dataFreshness: z.string().optional(),
  sourceName: z.string().optional(),
});

export const offerSchema = z.object({
  id: z.string(),
  shopId: z.string(),
  shopName: z.string(),
  price: z.number(),
  stock: z.number().int().nullable(),
  syncedAt: z.string(),
  sourceName: z.string().default("授权店铺直采"),
  sourceMode: sourceModeSchema.default("authorized_direct"),
  sourceObservedAt: z.string().optional(),
});

export const productSchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  category: z.string(),
  thumbnailUrl: z.string().url().nullable().optional(),
  tags: z.array(z.string()),
  lowestPrice: z.number(),
  highestPrice: z.number(),
  offerCount: z.number().int(),
  offers: z.array(offerSchema),
});

export const searchQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
  category: z.string().optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  sort: z.enum(["relevance", "price_asc", "price_desc", "newest"]).default("price_asc"),
  page: z.coerce.number().int().min(1).default(1),
});

export const stockStatusSchema = z.enum(["in_stock", "low_stock", "out_of_stock"]);
export const offerSortSchema = z.enum(["newest", "price_asc", "stock_desc"]);

const optionalQueryString = z.preprocess(
  (value) => value === "" || value === null ? undefined : value,
  z.string().trim().max(120).optional(),
);

const optionalQueryNumber = z.preprocess(
  (value) => value === "" || value === null ? undefined : value,
  z.coerce.number().min(0).optional(),
);

export const offerSearchQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
  category: optionalQueryString,
  minPrice: optionalQueryNumber,
  maxPrice: optionalQueryNumber,
  stock: z.preprocess((value) => value === "" || value === null ? undefined : value, stockStatusSchema.optional()),
  sort: offerSortSchema.default("price_asc"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).refine(
  (value) => value.minPrice === undefined || value.maxPrice === undefined || value.minPrice <= value.maxPrice,
  { message: "Minimum price cannot exceed maximum price", path: ["maxPrice"] },
);

export const homeBannerSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  buttonLabel: z.string(),
  targetUrl: z.string().refine((value) => !value || (() => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  })(), "Only credential-free HTTPS URLs are accepted"),
  imageDesktop: z.string(),
  imageMobile: z.string(),
  label: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
});

export const gatewayNoticeSchema = z.object({
  title: z.string(),
  description: z.string(),
  enabled: z.boolean(),
});

export const gatewayNoticeInputSchema = z.object({
  title: z.string().trim().min(1).max(40),
  description: z.string().trim().min(1).max(300),
  enabled: z.boolean().default(true),
});

export const siteSettingsSchema = z.object({
  siteName: z.string(),
  slogan: z.string(),
  description: z.string(),
  seoTitle: z.string(),
  seoDescription: z.string(),
  seoKeywords: z.array(z.string()),
  logoUrl: z.string().nullable(),
  updatedAt: z.string(),
  gatewayNotice: gatewayNoticeSchema,
  announcement: z.lazy(() => announcementSchema).nullable().default(null),
});

export const announcementColorSchema = z.enum(["default", "blue", "orange", "green", "red"]);

const safeAnnouncementHref = z.string().trim().max(500).nullable().default(null).refine((value) => {
  if (!value) return true;
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}, "链接仅允许站内路径或无账号密码的 HTTPS 地址");

export const announcementSegmentSchema = z.object({
  text: z.string().min(1).max(200).refine((value) => value.trim().length > 0, "文字不能为空"),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  color: announcementColorSchema.default("default"),
  href: safeAnnouncementHref,
});

export const announcementSchema = z.object({
  id: z.string(),
  label: z.string(),
  content: z.array(announcementSegmentSchema).max(50),
  enabled: z.boolean(),
  dismissible: z.boolean(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  updatedAt: z.string(),
});

const optionalDateInput = z.preprocess(
  (value) => value === "" || value === null || value === undefined ? null : value,
  z.coerce.date().nullable(),
);

export const siteSettingsInputSchema = z.object({
  siteName: z.string().trim().min(1).max(40),
  slogan: z.string().trim().max(80).default(""),
  description: z.string().trim().min(1).max(500),
  seoTitle: z.string().trim().min(1).max(100),
  seoDescription: z.string().trim().min(1).max(300),
  seoKeywords: z.preprocess(
    (value) => typeof value === "string" ? value.split(/[，,]/).map((item) => item.trim()).filter(Boolean) : value,
    z.array(z.string().trim().min(1).max(40)).max(20),
  ),
});

export const announcementInputSchema = z.object({
  label: z.string().trim().min(1).max(20).default("公告"),
  content: z.array(announcementSegmentSchema).max(50).default([]),
  enabled: z.boolean().default(false),
  dismissible: z.boolean().default(true),
  startsAt: optionalDateInput,
  endsAt: optionalDateInput,
}).refine((value) => !value.startsAt || !value.endsAt || value.startsAt < value.endsAt, { message: "结束时间必须晚于开始时间", path: ["endsAt"] })
  .refine((value) => !value.enabled || value.content.length > 0, { message: "启用公告前请填写内容", path: ["content"] });

export const homeBannerInputSchema = z.object({
  title: z.string().trim().max(80).default(""),
  summary: z.string().trim().max(200).default(""),
  buttonLabel: z.string().trim().max(20).default(""),
  targetUrl: z.string().trim().max(500).refine((value) => !value || (() => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  })(), "Only credential-free HTTPS URLs are accepted"),
  label: z.string().trim().max(20).default("广告"),
  startsAt: optionalDateInput,
  endsAt: optionalDateInput,
  active: z.preprocess((value) => value === true || value === "true" || value === "1", z.boolean()),
}).refine(
  (value) => !value.startsAt || !value.endsAt || value.startsAt < value.endsAt,
  { message: "结束时间必须晚于开始时间", path: ["endsAt"] },
);

export const sideAdSlotSchema = z.enum(["left", "right"]);
const sideAdImageUrlSchema = z.string().refine((value) => value.startsWith("/api/v1/assets/side-ads/") || (() => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
})(), "Only side-ad asset paths or credential-free HTTPS URLs are accepted");
export const sideAdInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  url: z.string().trim().url().refine((value) => {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  }, "Only credential-free HTTPS URLs are accepted"),
  imageUrl: z.preprocess(
    (value) => value === "" || value === undefined ? null : value,
    z.string().trim().url().refine((value) => value.startsWith("https://"), "Only HTTPS image URLs are accepted").nullable(),
  ).default(null),
  label: z.string().trim().min(1).max(20).default("广告"),
  active: z.preprocess((value) => value === true || value === "true" || value === "1", z.boolean()),
  clearImage: z.preprocess((value) => value === true || value === "true" || value === "1", z.boolean().default(false)),
});

export const sideAdSchema = z.object({
  id: z.string(),
  slot: sideAdSlotSchema,
  title: z.string(),
  url: z.string().url(),
  imageUrl: sideAdImageUrlSchema,
  label: z.string(),
});

export const adminSideAdSchema = sideAdSchema.extend({
  imageUrl: sideAdImageUrlSchema.nullable(),
  active: z.boolean(),
  impressionCount: z.number().int().min(0),
  clickCount: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const adminHomeBannerSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  buttonLabel: z.string(),
  targetUrl: z.string(),
  label: z.string(),
  imageDesktop: z.string().nullable(),
  imageMobile: z.string().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  active: z.boolean(),
  updatedAt: z.string(),
});

export const homeStatsSchema = z.object({
  shops: z.number().int().min(0),
  products: z.number().int().min(0),
  verifiedShops: z.number().int().min(0),
  updatedToday: z.number().int().min(0),
  lastSyncedAt: z.string().nullable(),
});

export const offerListItemSchema = z.object({
  id: z.string(),
  productId: z.string(),
  productSlug: z.string(),
  productName: z.string(),
  productThumbnailUrl: z.string().url().nullable(),
  category: z.string(),
  specification: z.string(),
  shopId: z.string(),
  shopSlug: z.string(),
  shopName: z.string(),
  shopLogo: z.string(),
  shopVerified: z.boolean(),
  price: z.number().min(0),
  isLowestPrice: z.boolean(),
  stock: z.number().int().nullable(),
  stockStatus: stockStatusSchema,
  syncedAt: z.string(),
  sourceName: z.string(),
  sourceMode: sourceModeSchema,
  sourceAttributionUrl: z.string().url().nullable(),
  sourceObservedAt: z.string(),
});

export const productOfferGroupSchema = z.object({
  productId: z.string(),
  productSlug: z.string(),
  productName: z.string(),
  productThumbnailUrl: z.string().url().nullable(),
  category: z.string(),
  specification: z.string(),
  offerCount: z.number().int().min(1),
  inStockOfferCount: z.number().int().min(0),
  verifiedShopCount: z.number().int().min(0),
  lowestPrice: z.number().min(0),
  highestPrice: z.number().min(0),
  latestSyncedAt: z.string(),
  offers: z.array(offerListItemSchema).min(1),
});

export const offerPageSchema = z.object({
  items: z.array(productOfferGroupSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0),
});

const searchAdAssetUrlSchema = z.string().refine((value) => value.startsWith("/api/v1/assets/search-ads/") || (() => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
})(), "Only search-ad asset paths or credential-free HTTPS URLs are accepted");

const optionalHttpsImageSchema = z.preprocess(
  (value) => value === "" || value === null ? undefined : value,
  z.string().url().refine((value) => value.startsWith("https://"), "Only HTTPS image URLs are accepted").optional(),
);

function parseRichTextInput(value: unknown) {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); }
  catch { return value; }
}

export const searchAdSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  content: z.array(announcementSegmentSchema).max(50).default([]),
  url: z.string().url(),
  imageUrl: searchAdAssetUrlSchema.nullable(),
  backgroundImageUrl: searchAdAssetUrlSchema.nullable(),
  logoUrl: searchAdAssetUrlSchema.nullable(),
  label: z.string(),
  keywords: z.array(z.string()),
  global: z.boolean(),
  active: z.boolean(),
  position: z.number().int(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  impressionCount: z.number().int().min(0),
  clickCount: z.number().int().min(0),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const searchAdInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(300).default(""),
  content: z.preprocess(parseRichTextInput, z.array(announcementSegmentSchema).max(50).default([])),
  url: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Only credential-free HTTPS URLs are accepted"),
  imageUrl: optionalHttpsImageSchema,
  backgroundImageUrl: optionalHttpsImageSchema,
  logoUrl: optionalHttpsImageSchema,
  clearBackgroundImage: z.preprocess((value) => value === true || value === "true" || value === "1", z.boolean().default(false)),
  clearLogo: z.preprocess((value) => value === true || value === "true" || value === "1", z.boolean().default(false)),
  label: z.string().trim().min(1).max(20).default("广告"),
  keywords: z.preprocess(
    (value) => typeof value === "string" ? value.split(/[，,]/).map((item) => item.trim()).filter(Boolean) : value,
    z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  ),
  global: z.preprocess((value) => value === true || value === "true" || value === "1", z.boolean().default(false)),
  startsAt: optionalDateInput,
  endsAt: optionalDateInput,
  active: z.preprocess((value) => value === undefined ? true : value === true || value === "true" || value === "1", z.boolean()),
}).refine(
  (value) => value.global || value.keywords.length > 0,
  { message: "请至少设置关键词，或开启全局展示", path: ["keywords"] },
).refine(
  (value) => !value.startsAt || !value.endsAt || value.startsAt < value.endsAt,
  { message: "结束时间必须晚于开始时间", path: ["endsAt"] },
);

export const searchAdPageSchema = offerPageSchema.extend({ ad: searchAdSchema.nullable() });

export const homeResponseSchema = z.object({
  isDemo: z.boolean(),
  banner: homeBannerSchema.nullable(),
  stats: homeStatsSchema,
  hotSearches: z.array(z.string()),
  categories: z.array(z.object({ slug: z.string(), name: z.string(), count: z.number().int().min(0) })),
  offers: offerPageSchema,
  directoryShops: z.array(shopSchema).default([]),
  sideAds: z.array(sideAdSchema).default([]),
});

export const searchSuggestionsSchema = z.object({ suggestions: z.array(z.string()).max(8) });

export const offerFeedbackTypeSchema = z.enum(["price_error", "stock_error", "broken_link", "other"]);
export const offerFeedbackSchema = z.object({
  type: offerFeedbackTypeSchema,
  details: z.string().trim().max(500).optional(),
});

export const botPlatformSchema = z.enum(["telegram", "qq"]);
export const botRuntimeStatusSchema = z.enum(["disabled", "waiting_config", "starting", "running", "error"]);
export const botIntegrationSchema = z.object({
  platform: botPlatformSchema,
  enabled: z.boolean(),
  configured: z.boolean(),
  effectiveEnabled: z.boolean(),
  runtimeStatus: botRuntimeStatusSchema,
  botUsername: z.string().nullable(),
  lastHeartbeatAt: z.string().nullable(),
  lastError: z.string().nullable(),
  updatedAt: z.string(),
});
export const botIntegrationInputSchema = z.object({ enabled: z.boolean() });
export const botChatAllowlistSchema = z.object({
  id: z.string(),
  platform: botPlatformSchema,
  externalChatId: z.string(),
  label: z.string(),
  note: z.string(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const botChatAllowlistInputSchema = z.object({
  externalChatId: z.string().trim().regex(/^-?\d{1,30}$/, "群 ID 必须是数字"),
  label: z.string().trim().min(1).max(100),
  note: z.string().trim().max(500).default(""),
  active: z.boolean().default(true),
});
export const botPreviewInputSchema = z.object({
  q: z.string().trim().min(2, "请输入至少 2 个字符").max(100),
  page: z.coerce.number().int().min(1).default(1),
});
export const botPreviewItemSchema = productOfferGroupSchema.pick({
  productSlug: true,
  productName: true,
  lowestPrice: true,
  offerCount: true,
  inStockOfferCount: true,
});
export const botPreviewSchema = z.object({
  query: z.string(),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  totalPages: z.number().int().min(0),
  items: z.array(botPreviewItemSchema).max(10),
});
export const botAdminOverviewSchema = z.object({
  integrations: z.array(botIntegrationSchema),
  metrics: z.object({
    queryCount24h: z.number().int().min(0),
    successRate24h: z.number().min(0).max(100),
    averageDurationMs24h: z.number().int().min(0),
    topKeywords: z.array(z.object({ keyword: z.string(), count: z.number().int().min(1) })).max(10),
  }),
});
export const botHeartbeatSchema = z.object({
  configured: z.boolean(),
  runtimeStatus: botRuntimeStatusSchema,
  botUsername: z.string().trim().max(100).nullable().optional(),
  lastError: z.string().trim().max(1000).nullable().optional(),
});
export const botQueryMetricInputSchema = z.object({
  keyword: z.string().trim().min(2).max(100),
  resultCount: z.number().int().min(0),
  durationMs: z.number().int().min(0).max(60_000),
  status: z.enum(["success", "empty", "error", "rate_limited"]),
});

export const shopListQuerySchema = z.object({
  q: z.string().trim().max(120).default(""),
  sort: z.enum(["newest", "products"]).default("newest"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const shopDetailQuerySchema = z.object({
  category: z.preprocess((value) => value === "" || value === null ? undefined : value, z.string().trim().max(100).optional()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const categoryGroupIdSchema = z.enum([
  "all", "chatgpt", "claude", "gemini", "grok", "coding", "creative", "api", "communication", "accounts", "tools", "other",
]);

export const categoryBrowseQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  group: categoryGroupIdSchema.default("all"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(12).max(60).default(18),
});

export const categoryBrowseItemSchema = z.object({
  slug: z.string(),
  name: z.string(),
  count: z.number().int().min(0),
  group: categoryGroupIdSchema.exclude(["all"]),
});

export const categoryBrowsePageSchema = z.object({
  items: z.array(categoryBrowseItemSchema),
  popular: z.array(categoryBrowseItemSchema).max(12),
  groups: z.array(z.object({
    id: categoryGroupIdSchema,
    name: z.string(),
    categoryCount: z.number().int().min(0),
    productCount: z.number().int().min(0),
  })),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0),
});

export const shopPageSchema = z.object({
  items: z.array(shopSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0),
});

export const importRowSchema = z.object({
  source: z.string().trim().min(1).max(80),
  externalShopId: z.string().trim().min(1).max(200),
  shopName: z.string().trim().min(1).max(200),
  homepageUrl: z.string().url().refine((value) => value.startsWith("https://"), "Only HTTPS URLs are accepted").optional(),
  externalProductId: z.string().trim().min(1).max(200),
  productName: z.string().trim().min(1).max(500),
  specification: z.string().trim().max(500).default(""),
  category: z.string().trim().max(100).default("其他"),
  externalOfferId: z.string().trim().min(1).max(200),
  price: z.coerce.number().min(0).max(1_000_000),
  currency: z.string().trim().length(3).default("CNY"),
  stock: z.preprocess((value) => value === "" || value === null || value === undefined ? undefined : value, z.coerce.number().int().min(0).optional()),
  offerUrl: z.string().url().refine((value) => value.startsWith("https://"), "Only HTTPS URLs are accepted"),
  observedAt: z.coerce.date(),
});

export const candidateDecisionSchema = z.object({
  action: z.enum(["approve", "reject", "merge"]),
  note: z.string().trim().max(1000).optional(),
  mergeShopId: z.string().optional(),
  homepageUrl: z.string().url().refine((value) => value.startsWith("https://"), "Only HTTPS URLs are accepted").optional(),
  authorizationEvidence: z.string().trim().max(2000).optional(),
}).superRefine((value, context) => {
  if (value.action === "merge" && !value.mergeShopId) context.addIssue({ code: z.ZodIssueCode.custom, message: "mergeShopId is required", path: ["mergeShopId"] });
});

export const authorizedShopProductSchema = z.object({
  sourceId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  description: z.string().trim().max(2000).default(""),
  thumbnailUrl: z.string().url().optional(),
  price: z.number().min(0).max(1_000_000),
  stock: z.number().int().min(0).nullable(),
  url: z.string().url().refine((value) => value.startsWith("https://"), "Only HTTPS offer URLs are accepted"),
  category: z.string().trim().min(1).max(100).default("其他"),
});

export const managedListingTypeSchema = z.enum(["gateway", "project"]);
const managedListingModelTagsSchema = z.preprocess((value) => {
  if (typeof value === "string" || Array.isArray(value)) {
    const tags = (typeof value === "string" ? value.split(/[，,]/) : value).map((tag) => String(tag).trim()).filter(Boolean);
    return tags.filter((tag, index) => tags.findIndex((other) => other.toLocaleLowerCase("zh-CN") === tag.toLocaleLowerCase("zh-CN")) === index);
  }
  return value;
}, z.array(z.string().trim().min(1).max(40)).max(20).default([]));
export const managedListingSchema = z.object({
  id: z.string(),
  type: managedListingTypeSchema,
  title: z.string(),
  description: z.string(),
  url: z.string().url(),
  thumbnailUrl: z.string().refine((value) => value.startsWith("/api/v1/assets/listings/") || (() => {
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
    catch { return false; }
  })(), "Only listing asset paths or credential-free HTTPS URLs are accepted").nullable(),
  badge: z.string().nullable(),
  modelTags: z.array(z.string()),
  pricingClaims: z.string().nullable(),
  probe: z.object({
    configured: z.boolean(),
    status: z.enum(["online", "partial", "offline", "unconfigured"]),
    availableModels: z.number().int().min(0),
    totalModels: z.number().int().min(0),
    lastCheckedAt: z.string().nullable(),
  }).nullable().optional(),
  active: z.boolean(),
  position: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const managedListingInputSchema = z.object({
  type: managedListingTypeSchema,
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(4000).default(""),
  url: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Only credential-free HTTPS URLs are accepted"),
  thumbnailUrl: z.preprocess((value) => value === "" || value === null ? undefined : value, z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Only credential-free HTTPS image URLs are accepted").optional()),
  badge: z.preprocess((value) => value === "" || value === null ? undefined : value, z.string().trim().max(30).optional()),
  modelTags: managedListingModelTagsSchema,
  pricingClaims: z.preprocess((value) => value === "" || value === null ? undefined : value, z.string().trim().max(100).optional()),
  clearThumbnail: z.preprocess((value) => value === "true" ? true : value === "false" || value === "" || value === undefined ? false : value, z.boolean().default(false)),
});

export const gatewayReviewStatusSchema = z.enum(["pending", "approved", "rejected", "duplicate", "source_removed"]);
export const gatewaySortSchema = z.enum(["featured", "reputation", "availability", "newest"]);
export const gatewayDirectoryQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  section: z.string().trim().max(40).default(""),
  online: z.preprocess((value) => value === "true" ? true : value === "false" ? false : undefined, z.boolean().optional()),
  sort: gatewaySortSchema.default("featured"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export const gatewayDirectoryEntrySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  sourceSection: z.string(),
  sourcePosition: z.number().int().nullable(),
  sourceRedirectUrl: z.string().url(),
  providerType: z.string(),
  logoUrl: z.string().url().nullable(),
  sponsored: z.boolean(),
  online: z.boolean().nullable(),
  upVotes: z.number().int().min(0),
  downVotes: z.number().int().min(0),
  availability7d: z.number().min(0).max(100).nullable(),
  averageResponseMs: z.number().int().min(0).nullable(),
  modelTags: z.array(z.string()),
  pricingClaims: z.string().nullable(),
  featured: z.boolean(),
  monitoringAvailable: z.boolean(),
  displayGroup: z.object({ id: z.string(), key: z.string(), name: z.string(), position: z.number().int() }).nullable(),
  sourceUpdatedAt: z.string().nullable(),
  lastSeenAt: z.string(),
});

export const gatewayDisplayGroupSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  position: z.number().int(),
  active: z.boolean(),
  count: z.number().int().min(0).default(0),
  filteredCount: z.number().int().min(0).default(0),
});

export const gatewayGroupedDirectorySchema = z.object({
  groups: z.array(z.object({
    id: z.string(),
    key: z.string(),
    name: z.string(),
    position: z.number().int(),
    items: z.array(gatewayDirectoryEntrySchema),
  })),
  other: z.object({
    items: z.array(gatewayDirectoryEntrySchema),
    total: z.number().int().min(0),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    totalPages: z.number().int().min(0),
  }),
  total: z.number().int().min(0),
});

export const gatewayDirectoryPageSchema = z.object({
  items: z.array(gatewayDirectoryEntrySchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  totalPages: z.number().int().min(0),
  sections: z.array(z.object({ key: z.string(), label: z.string(), count: z.number().int().min(0) })),
});

export const gatewayMonitorHistorySchema = z.object({
  source: z.literal("zuiquanapi"),
  granularityMinutes: z.literal(60),
  buckets: z.array(z.object({
    startedAt: z.string().datetime(),
    checkedAt: z.string().datetime().nullable(),
    online: z.boolean().nullable(),
    responseMs: z.number().int().min(0).nullable(),
  })),
});

export const gatewayProbeErrorCategorySchema = z.enum([
  "timeout", "rate_limited", "authentication", "quota_exhausted", "model_unavailable", "upstream_error", "protocol_error", "network_error",
]);
export const gatewayProbeModelStatusSchema = z.enum(["untested", "available", "degraded", "unavailable", "protocol_unsupported"]);
export const gatewayProbeBucketSchema = z.object({
  startedAt: z.string().datetime(), attempts: z.number().int().min(0), successes: z.number().int().min(0),
  successRate: z.number().min(0).max(100).nullable(), averageResponseMs: z.number().int().min(0).nullable(),
});
export const gatewayModelAvailabilitySchema = z.object({
  configured: z.boolean(),
  granularityMinutes: z.number().int().min(1).optional(),
  lastInferenceAt: z.string().datetime().nullable().optional(),
  nextInferenceAt: z.string().datetime().nullable().optional(),
  models: z.array(z.object({
    id: z.string(), modelId: z.string(), displayName: z.string(), status: gatewayProbeModelStatusSchema,
    lastCheckedAt: z.string().nullable(), lastSuccessAt: z.string().nullable(), lastResponseMs: z.number().int().min(0).nullable(),
    errorCategory: gatewayProbeErrorCategorySchema.nullable(), buckets: z.array(gatewayProbeBucketSchema),
  })),
});
export const managedListingProbeDetailSchema = z.object({
  listing: managedListingSchema,
  availability: gatewayModelAvailabilitySchema,
});

export const gatewayDecisionSchema = z.object({
  ids: z.array(z.string()).min(1).max(100),
  action: z.enum(["approve", "reject", "duplicate", "source_removed"]),
});

export const authorizedShopSyncSchema = z.object({
  adapterKind: z.enum(["dujiaoka", "json-api"]),
  observedAt: z.coerce.date(),
  products: z.array(authorizedShopProductSchema).max(10_000),
});

export const priceAiPointerSchema = z.object({
  schema_version: z.literal("price-radar.v1"),
  snapshot_id: z.string().min(10),
  generated_at: z.string().datetime(),
  published_at: z.string().datetime(),
  stale: z.boolean(),
  snapshot_url: z.string().url().refine((value) => value.startsWith("https://data.priceai.cc/v1/snapshots/"), "Unexpected snapshot host"),
  product_count: z.number().int().min(0),
});

export const priceAiOfferSchema = z.object({
  id: z.string(),
  source_id: z.string().nullable().optional(),
  source_name: z.string(),
  source_store_name: z.string().nullable().optional(),
  title: z.string(),
  price: z.number().min(0),
  currency: z.string(),
  status: z.string(),
  url: z.string().url(),
});

export const priceAiSnapshotSchema = z.object({
  schema_version: z.literal("price-radar.v1"),
  snapshot_id: z.string().min(10),
  generated_at: z.string().datetime(),
  published_at: z.string().datetime(),
  stale: z.boolean(),
  product_count: z.number().int().min(0).optional(),
  products: z.array(z.object({
    id: z.string(), slug: z.string(), name: z.string(), platform: z.string(), product_type: z.string(),
    spec: z.string().optional(), summary: z.string().optional(), snapshot_generated_at: z.string().datetime({ offset: true }),
    top_offers: z.array(priceAiOfferSchema).max(5),
  })).max(5000),
});

export const submissionSchema = z.object({
  kind: z.enum(["shop", "gateway"]).default("shop"),
  name: z.string().trim().min(1).max(200),
  url: z.string().url().refine((value) => value.startsWith("https://"), "Only HTTPS URLs are accepted"),
  authorizationConfirmed: z.literal(true),
  contactEmail: z.string().email(),
  description: z.string().trim().max(1000).default(""),
  website: z.string().max(200).optional().default(""),
});

export const submissionDecisionSchema = z.object({
  action: z.enum(["publish", "edit", "reject"]),
  reviewNote: z.string().trim().max(1000).default(""),
  name: z.string().trim().min(1).max(200).optional(),
  url: z.string().url().refine((value) => value.startsWith("https://"), "Only HTTPS URLs are accepted").optional(),
  contactEmail: z.string().email().optional(),
  description: z.string().trim().max(4000).optional(),
  logoUrl: z.string().trim().url().refine((value) => value.startsWith("https://"), "Only HTTPS URLs are accepted").or(z.literal("")).optional(),
  modelTags: z.string().trim().max(500).optional(),
  pricingClaims: z.string().trim().max(100).optional(),
  displayGroupId: z.string().trim().max(100).or(z.literal("")).optional(),
});

export const demandSchema = z.object({
  title: z.string().trim().min(6).max(100),
  description: z.string().trim().min(20).max(1200),
  budget: z.coerce.number().min(0).max(100000).optional(),
});

export const feedbackSchema = z.object({
  contact: z.string().max(120).optional(),
  message: z.string().trim().min(10).max(2000),
});

export const authSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export type Shop = z.infer<typeof shopSchema>;
export type Product = z.infer<typeof productSchema>;
export type Offer = z.infer<typeof offerSchema>;
export type SearchQuery = z.infer<typeof searchQuerySchema>;
export type StockStatus = z.infer<typeof stockStatusSchema>;
export type OfferSort = z.infer<typeof offerSortSchema>;
export type OfferSearchQuery = z.infer<typeof offerSearchQuerySchema>;
export type HomeBanner = z.infer<typeof homeBannerSchema>;
export type SiteSettings = z.infer<typeof siteSettingsSchema>;
export type GatewayNotice = z.infer<typeof gatewayNoticeSchema>;
export type GatewayNoticeInput = z.infer<typeof gatewayNoticeInputSchema>;
export type AnnouncementColor = z.infer<typeof announcementColorSchema>;
export type AnnouncementSegment = z.infer<typeof announcementSegmentSchema>;
export type Announcement = z.infer<typeof announcementSchema>;
export type AnnouncementInput = z.infer<typeof announcementInputSchema>;
export type SiteSettingsInput = z.infer<typeof siteSettingsInputSchema>;
export type SubmissionInput = z.infer<typeof submissionSchema>;
export type SubmissionDecision = z.infer<typeof submissionDecisionSchema>;
export type HomeBannerInput = z.infer<typeof homeBannerInputSchema>;
export type SideAdSlot = z.infer<typeof sideAdSlotSchema>;
export type SideAd = z.infer<typeof sideAdSchema>;
export type AdminSideAd = z.infer<typeof adminSideAdSchema>;
export type SideAdInput = z.infer<typeof sideAdInputSchema>;
export type AdminHomeBanner = z.infer<typeof adminHomeBannerSchema>;
export type HomeStats = z.infer<typeof homeStatsSchema>;
export type OfferListItem = z.infer<typeof offerListItemSchema>;
export type ProductOfferGroup = z.infer<typeof productOfferGroupSchema>;
export type OfferPage = z.infer<typeof offerPageSchema>;
export type SearchAd = z.infer<typeof searchAdSchema>;
export type SearchAdInput = z.infer<typeof searchAdInputSchema>;
export type SearchAdPage = z.infer<typeof searchAdPageSchema>;
export type HomeResponse = z.infer<typeof homeResponseSchema>;
export type OfferFeedback = z.infer<typeof offerFeedbackSchema>;
export type BotPlatform = z.infer<typeof botPlatformSchema>;
export type BotRuntimeStatus = z.infer<typeof botRuntimeStatusSchema>;
export type BotIntegration = z.infer<typeof botIntegrationSchema>;
export type BotChatAllowlist = z.infer<typeof botChatAllowlistSchema>;
export type BotPreview = z.infer<typeof botPreviewSchema>;
export type BotAdminOverview = z.infer<typeof botAdminOverviewSchema>;
export type BotHeartbeat = z.infer<typeof botHeartbeatSchema>;
export type BotQueryMetricInput = z.infer<typeof botQueryMetricInputSchema>;
export type SourceMode = z.infer<typeof sourceModeSchema>;
export type ShopListQuery = z.infer<typeof shopListQuerySchema>;
export type ShopDetailQuery = z.infer<typeof shopDetailQuerySchema>;
export type CategoryGroupId = z.infer<typeof categoryGroupIdSchema>;
export type CategoryBrowseQuery = z.infer<typeof categoryBrowseQuerySchema>;
export type CategoryBrowseItem = z.infer<typeof categoryBrowseItemSchema>;
export type CategoryBrowsePage = z.infer<typeof categoryBrowsePageSchema>;
export type ImportRow = z.infer<typeof importRowSchema>;
export type CandidateDecision = z.infer<typeof candidateDecisionSchema>;
export type AuthorizedShopSync = z.infer<typeof authorizedShopSyncSchema>;
export type PriceAiPointer = z.infer<typeof priceAiPointerSchema>;
export type PriceAiSnapshot = z.infer<typeof priceAiSnapshotSchema>;
export type ManagedListing = z.infer<typeof managedListingSchema>;
export type ManagedListingInput = z.infer<typeof managedListingInputSchema>;
export type ManagedListingProbeDetail = z.infer<typeof managedListingProbeDetailSchema>;
export type GatewayReviewStatus = z.infer<typeof gatewayReviewStatusSchema>;
export type GatewaySort = z.infer<typeof gatewaySortSchema>;
export type GatewayDirectoryQuery = z.infer<typeof gatewayDirectoryQuerySchema>;
export type GatewayDirectoryEntry = z.infer<typeof gatewayDirectoryEntrySchema>;
export type GatewayDirectoryPage = z.infer<typeof gatewayDirectoryPageSchema>;
export type GatewayDisplayGroup = z.infer<typeof gatewayDisplayGroupSchema>;
export type GatewayGroupedDirectory = z.infer<typeof gatewayGroupedDirectorySchema>;
export type GatewayMonitorHistory = z.infer<typeof gatewayMonitorHistorySchema>;
export type GatewayProbeErrorCategory = z.infer<typeof gatewayProbeErrorCategorySchema>;
export type GatewayProbeModelStatus = z.infer<typeof gatewayProbeModelStatusSchema>;
export type GatewayModelAvailability = z.infer<typeof gatewayModelAvailabilitySchema>;
export type GatewayDecision = z.infer<typeof gatewayDecisionSchema>;
