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
  targetUrl: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Only credential-free HTTPS URLs are accepted"),
  imageDesktop: z.string(),
  imageMobile: z.string(),
  label: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
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
});

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

const optionalDateInput = z.preprocess(
  (value) => value === "" || value === null || value === undefined ? null : value,
  z.coerce.date().nullable(),
);

export const homeBannerInputSchema = z.object({
  title: z.string().trim().min(1).max(80),
  summary: z.string().trim().max(200).default(""),
  buttonLabel: z.string().trim().min(1).max(20),
  targetUrl: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Only credential-free HTTPS URLs are accepted"),
  label: z.string().trim().min(1).max(20).default("广告"),
  startsAt: optionalDateInput,
  endsAt: optionalDateInput,
  active: z.preprocess((value) => value === true || value === "true" || value === "1", z.boolean()),
}).refine(
  (value) => !value.startsAt || !value.endsAt || value.startsAt < value.endsAt,
  { message: "结束时间必须晚于开始时间", path: ["endsAt"] },
);

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

export const searchAdSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  url: z.string().url(),
  imageUrl: z.string().url().nullable(),
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
  url: z.string().url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Only credential-free HTTPS URLs are accepted"),
  imageUrl: z.preprocess((value) => value === "" || value === null ? undefined : value, z.string().url().refine((value) => value.startsWith("https://"), "Only HTTPS image URLs are accepted").optional()),
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
});

export const searchSuggestionsSchema = z.object({ suggestions: z.array(z.string()).max(8) });

export const offerFeedbackTypeSchema = z.enum(["price_error", "stock_error", "broken_link", "other"]);
export const offerFeedbackSchema = z.object({
  type: offerFeedbackTypeSchema,
  details: z.string().trim().max(500).optional(),
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
export const managedListingSchema = z.object({
  id: z.string(),
  type: managedListingTypeSchema,
  title: z.string(),
  description: z.string(),
  url: z.string().url(),
  thumbnailUrl: z.string().url().nullable(),
  badge: z.string().nullable(),
  active: z.boolean(),
  position: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const managedListingInputSchema = z.object({
  type: managedListingTypeSchema,
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).default(""),
  url: z.string().url().refine((value) => value.startsWith("https://"), "Only HTTPS URLs are accepted"),
  thumbnailUrl: z.preprocess((value) => value === "" || value === null ? undefined : value, z.string().url().refine((value) => value.startsWith("https://"), "Only HTTPS image URLs are accepted").optional()),
  badge: z.preprocess((value) => value === "" || value === null ? undefined : value, z.string().trim().max(30).optional()),
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
  url: z.string().url().refine((value) => value.startsWith("https://"), "Only HTTPS URLs are accepted"),
  authorizationConfirmed: z.literal(true),
  contactEmail: z.string().email(),
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
export type SiteSettingsInput = z.infer<typeof siteSettingsInputSchema>;
export type HomeBannerInput = z.infer<typeof homeBannerInputSchema>;
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
export type SourceMode = z.infer<typeof sourceModeSchema>;
export type ShopListQuery = z.infer<typeof shopListQuerySchema>;
export type ShopDetailQuery = z.infer<typeof shopDetailQuerySchema>;
export type ImportRow = z.infer<typeof importRowSchema>;
export type CandidateDecision = z.infer<typeof candidateDecisionSchema>;
export type AuthorizedShopSync = z.infer<typeof authorizedShopSyncSchema>;
export type PriceAiPointer = z.infer<typeof priceAiPointerSchema>;
export type PriceAiSnapshot = z.infer<typeof priceAiSnapshotSchema>;
export type ManagedListing = z.infer<typeof managedListingSchema>;
export type ManagedListingInput = z.infer<typeof managedListingInputSchema>;
