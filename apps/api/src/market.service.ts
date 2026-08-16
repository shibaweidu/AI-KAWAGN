import { Injectable, NotFoundException, Optional } from "@nestjs/common";
import { CandidateReviewStatus, CollectionMode, ManagedListingType, Prisma, ShopStatus } from "@prisma/client";
import {
  announcementSegmentSchema, categoryBrowseQuerySchema, demandSchema, feedbackSchema, offerFeedbackSchema, offerSearchQuerySchema, searchQuerySchema,
  shopDetailQuerySchema, shopListQuerySchema, type CategoryBrowseItem, type CategoryGroupId, type OfferListItem, type StockStatus,
} from "@ai-card/contracts";
import { PrismaService } from "./prisma.service";
import { SiteSettingsService } from "./site-settings.service";

export function getStockStatus(stock: number | null): StockStatus {
  if (stock === 0) return "out_of_stock";
  if (stock !== null && stock <= 10) return "low_stock";
  return "in_stock";
}

const BLOCKED_PRODUCT_TERMS = [
  "流量卡",
  "物联卡",
  "物联网卡",
  "上网卡",
  "流量套餐",
  "流量包",
  "电话卡",
  "手机卡",
  "esim",
  "随身wifi",
  "随身 wi-fi",
  "sim卡",
  "sim card",
  "data card",
  "traffic card",
];

/** Returns true for telecom/data-card products that should stay out of the public marketplace. */
export function isBlockedProduct(title: string, category = "") {
  const value = `${title} ${category}`.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s_-]+/g, "");
  if (BLOCKED_PRODUCT_TERMS.some((term) => value.includes(term.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s_-]+/g, "")))) return true;
  if (/流量.{0,3}卡/.test(value)) return true;
  return /\d+(?:\.\d+)?[gG](?:b)?[^\n]{0,80}(?:分钟|通用|定向|语音)/i.test(value);
}

const blockedProductWhere: Prisma.CanonicalProductWhereInput = {
  OR: BLOCKED_PRODUCT_TERMS.flatMap((term) => [
    { title: { contains: term, mode: "insensitive" as const } },
    { category: { is: { name: { contains: term, mode: "insensitive" as const } } } },
  ]),
};
const publicProductWhere: Prisma.CanonicalProductWhereInput = { NOT: blockedProductWhere };

@Injectable()
export class MarketService {
  private feedbackRateLimits = new Map<string, number[]>();
  constructor(private readonly prisma: PrismaService, @Optional() private readonly settings?: SiteSettingsService) {}

  async stats() {
    const activeShopWhere = { status: ShopStatus.ACTIVE, publishedAt: { not: null } } as const;
    const activeOfferWhere: Prisma.OfferWhereInput = { active: true, price: { gt: 0 }, shop: activeShopWhere, canonicalProduct: { is: publicProductWhere } };
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const [shops, offerCount, verifiedShops, updatedOffersToday, latestOffer, directoryCandidates] = await this.prisma.$transaction([
      this.prisma.shop.count({ where: activeShopWhere }),
      this.prisma.offer.count({ where: activeOfferWhere }),
      this.prisma.shop.count({ where: activeShopWhere }),
      this.prisma.offer.count({ where: { ...activeOfferWhere, syncedAt: { gte: since } } }),
      this.prisma.offer.findFirst({ where: activeOfferWhere, orderBy: { syncedAt: "desc" }, select: { syncedAt: true } }),
      this.prisma.shopCandidate.findMany({
        where: {
          reviewStatus: CandidateReviewStatus.APPROVED,
          dataSource: { key: "ldxp" },
          approvedShop: { is: { ...activeShopWhere, offers: { none: { active: true } } } },
        },
        select: { rawMetadata: true, sourceSyncedAt: true },
      }),
    ]);
    const directoryProducts = directoryCandidates.reduce((sum, candidate) => sum + (directorySummary([candidate])?.productCount || 0), 0);
    const directoryUpdatedToday = directoryCandidates
      .filter((candidate) => candidate.sourceSyncedAt && candidate.sourceSyncedAt >= since)
      .reduce((sum, candidate) => sum + (directorySummary([candidate])?.productCount || 0), 0);
    const latestDirectory = directoryCandidates.reduce<Date | null>((latest, candidate) => !candidate.sourceSyncedAt || latest && latest >= candidate.sourceSyncedAt ? latest : candidate.sourceSyncedAt, null);
    const latest = [latestOffer?.syncedAt || null, latestDirectory].filter((value): value is Date => Boolean(value)).sort((a, b) => b.getTime() - a.getTime())[0] || null;
    return { shops, products: offerCount + directoryProducts, verifiedShops, updatedToday: updatedOffersToday + directoryUpdatedToday, lastSyncedAt: latest?.toISOString() || null };
  }

  async categories() {
    const categories = await this.prisma.category.findMany({
      include: { products: { where: { ...publicProductWhere, offers: { some: { active: true, price: { gt: 0 }, shop: { status: ShopStatus.ACTIVE, publishedAt: { not: null } } } } }, select: { id: true } } },
      orderBy: { name: "asc" },
    });
    return categories.map((category) => ({ slug: category.slug, name: category.name, count: category.products.length }));
  }

  async categoryBrowse(raw: Record<string, unknown> = {}) {
    const query = categoryBrowseQuerySchema.parse(raw);
    const records = await this.prisma.category.findMany({
      select: {
        slug: true,
        name: true,
        _count: { select: { products: { where: { ...publicProductWhere, offers: { some: { active: true, price: { gt: 0 }, shop: { status: ShopStatus.ACTIVE, publishedAt: { not: null } } } } } } } },
      },
      orderBy: { name: "asc" },
    });
    const merged = new Map<string, CategoryBrowseItem>();
    for (const record of records) {
      if (!record._count.products) continue;
      const key = normalizeCategoryKey(record.name);
      const existing = merged.get(key);
      if (existing) {
        existing.count += record._count.products;
        continue;
      }
      const name = formatCategoryName(record.name);
      merged.set(key, { slug: record.slug, name, count: record._count.products, group: categoryGroupFor(name) });
    }
    const allItems = [...merged.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh-CN"));
    const needle = normalizeCategoryKey(query.q);
    const filtered = allItems.filter((item) => (query.group === "all" || item.group === query.group) && (!needle || normalizeCategoryKey(item.name).includes(needle)));
    const total = filtered.length;
    const totalPages = total ? Math.ceil(total / query.pageSize) : 0;
    const page = totalPages ? Math.min(query.page, totalPages) : 1;
    const start = (page - 1) * query.pageSize;
    return {
      items: filtered.slice(start, start + query.pageSize),
      popular: allItems.slice(0, 12),
      groups: CATEGORY_GROUPS.map((group) => {
        const items = group.id === "all" ? allItems : allItems.filter((item) => item.group === group.id);
        return { ...group, categoryCount: items.length, productCount: items.reduce((sum, item) => sum + item.count, 0) };
      }),
      total, page, pageSize: query.pageSize, totalPages,
    };
  }

  async shops(raw: Record<string, unknown> = {}) {
    const query = shopListQuerySchema.parse(raw);
    const where: Prisma.ShopWhereInput = { status: ShopStatus.ACTIVE, publishedAt: { not: null } };
    const orderBy: Prisma.ShopOrderByWithRelationInput[] = query.sort === "newest" ? [{ publishedAt: "desc" }] : [{ offers: { _count: "desc" } }];
    const include = {
      offers: { where: { active: true, price: { gt: 0 }, canonicalProduct: { is: publicProductWhere } }, select: { price: true, canonicalProductId: true, canonicalProduct: { select: { title: true, category: { select: { name: true } } } } } },
      sourceMappings: { include: { dataSource: true }, take: 1 },
      approvedCandidates: { where: { reviewStatus: CandidateReviewStatus.APPROVED }, select: { rawMetadata: true, sourceSyncedAt: true }, take: 1 },
    };
    if (query.sort === "products" || query.q) {
      const [records, total] = await this.prisma.$transaction([
        this.prisma.shop.findMany({ where, include, orderBy: [{ publishedAt: "desc" }] }),
        this.prisma.shop.count({ where }),
      ]);
      const needle = query.q.toLocaleLowerCase("zh-CN");
      const items = records.map(toPublicShop)
        .filter((shop) => !needle || `${shop.name} ${shop.categories.join(" ")}`.toLocaleLowerCase("zh-CN").includes(needle))
        .sort(query.sort === "newest" ? (a, b) => b.syncedAt.localeCompare(a.syncedAt) : (a, b) => b.productCount - a.productCount || b.syncedAt.localeCompare(a.syncedAt));
      const start = (query.page - 1) * query.pageSize;
      return { items: items.slice(start, start + query.pageSize), total: items.length, page: query.page, pageSize: query.pageSize, totalPages: items.length ? Math.ceil(items.length / query.pageSize) : 0 };
    }
    const [records, total] = await this.prisma.$transaction([
      this.prisma.shop.findMany({ where, include, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.shop.count({ where }),
    ]);
    return {
      items: records.map(toPublicShop), total, page: query.page, pageSize: query.pageSize,
      totalPages: total ? Math.ceil(total / query.pageSize) : 0,
    };
  }

  async shop(slug: string, raw: Record<string, unknown> = {}) {
    const query = shopDetailQuerySchema.parse(raw);
    const shop = await this.prisma.shop.findFirst({
      where: { slug, status: ShopStatus.ACTIVE, publishedAt: { not: null } },
      include: {
        sourceMappings: { include: { dataSource: true } },
        approvedCandidates: { where: { reviewStatus: CandidateReviewStatus.APPROVED }, select: { rawMetadata: true, sourceSyncedAt: true }, take: 1 },
      },
    });
    if (!shop) throw new NotFoundException("Shop not found");
    const offerSummaries = await this.prisma.offer.findMany({
      where: { shopId: shop.id, active: true, price: { gt: 0 }, canonicalProduct: { is: publicProductWhere } },
      select: {
        id: true, shopId: true, canonicalProductId: true, collectionMode: true, sourceObservedAt: true, price: true,
        canonicalProduct: { select: { title: true, category: { select: { name: true } } } },
      },
      orderBy: [{ price: "asc" }, { syncedAt: "desc" }],
    });
    const preferred = selectPreferredOffers(offerSummaries);
    const categoryCounts = new Map<string, number>();
    for (const offer of preferred) {
      const name = offer.canonicalProduct.category.name.trim();
      if (name) categoryCounts.set(name, (categoryCounts.get(name) || 0) + 1);
    }
    const selected = preferred
      .filter((offer) => !query.category || offer.canonicalProduct.category.name === query.category)
      .sort((a, b) => a.price.comparedTo(b.price) || a.canonicalProduct.title.localeCompare(b.canonicalProduct.title, "zh-CN"));
    const total = selected.length;
    const totalPages = total ? Math.ceil(total / query.pageSize) : 0;
    const page = totalPages ? Math.min(query.page, totalPages) : 1;
    const selectedIds = selected.slice((page - 1) * query.pageSize, page * query.pageSize).map((offer) => offer.id);
    const productOffers = selectedIds.length ? await this.prisma.offer.findMany({
      where: { id: { in: selectedIds } },
      include: { canonicalProduct: { include: { category: true } }, dataSource: true },
    }) : [];
    const productOfferMap = new Map(productOffers.map((offer) => [offer.id, offer]));
    const offers = selectedIds.map((id) => productOfferMap.get(id)).filter((offer): offer is NonNullable<typeof offer> => Boolean(offer));
    const publicShop = toPublicShop({ ...shop, offers: preferred });
    const categoryStats = categoryCounts.size
      ? [...categoryCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).map(([name, productCount]) => ({ name, productCount }))
      : publicShop.categories.map((name) => ({ name, productCount: null }));
    return {
      ...publicShop,
      description: shop.description,
      categoryStats,
      productPage: { page, pageSize: query.pageSize, total, totalPages, category: query.category || null },
      products: offers.map((offer) => ({ id: offer.canonicalProduct.id, slug: offer.canonicalProduct.slug, title: offer.canonicalProduct.title, summary: offer.canonicalProduct.summary, thumbnailUrl: offer.canonicalProduct.thumbnailUrl, category: offer.canonicalProduct.category.name, price: offer.price.toNumber(), stock: offer.stock, offerId: offer.id, sourceName: offer.dataSource.name })),
    };
  }

  async product(slug: string) {
    const product = await this.prisma.canonicalProduct.findFirst({
      where: { slug, ...publicProductWhere }, include: { category: true, offers: { where: { active: true, price: { gt: 0 }, shop: { status: ShopStatus.ACTIVE, publishedAt: { not: null } } }, include: { shop: true, dataSource: true }, orderBy: { price: "asc" } } },
    });
    if (!product || isBlockedProduct(product.title, product.category.name)) throw new NotFoundException("Product not found");
    const visibleOffers = product.offers.filter((offer) => !isBlockedProduct(product.title, product.category.name));
    if (!visibleOffers.length) throw new NotFoundException("Product not found");
    const offers = selectPreferredOffers(visibleOffers).sort((a, b) => a.price.comparedTo(b.price));
    return {
      id: product.id, slug: product.slug, title: product.title, summary: product.summary, category: product.category.name, thumbnailUrl: product.thumbnailUrl,
      lowestPrice: offers[0].price.toNumber(), highestPrice: offers.at(-1)!.price.toNumber(), offerCount: offers.length,
      offers: offers.map((offer) => ({ id: offer.id, shopId: offer.shopId, shopName: offer.shop.name, shopLogo: offer.shop.logoUrl || offer.shop.name.slice(0, 1), price: offer.price.toNumber(), stock: offer.stock, syncedAt: offer.syncedAt.toISOString(), sourceName: offer.dataSource.name, sourceMode: collectionMode(offer.collectionMode), sourceAttributionUrl: offer.sourceAttributionUrl, sourceObservedAt: offer.sourceObservedAt.toISOString() })),
    };
  }

  async hot() {
    const products = await this.prisma.canonicalProduct.findMany({ where: { ...publicProductWhere, offers: { some: { active: true, price: { gt: 0 }, shop: { status: ShopStatus.ACTIVE, publishedAt: { not: null } } } } }, include: { category: true, offers: { where: { active: true, price: { gt: 0 }, shop: { status: ShopStatus.ACTIVE, publishedAt: { not: null } } }, include: { shop: true }, orderBy: { price: "asc" } } }, take: 50 });
    return products.map((product) => ({ product, offers: selectPreferredOffers(product.offers).sort((a, b) => a.price.comparedTo(b.price)) })).filter(({ product, offers }) => !isBlockedProduct(product.title, product.category.name) && offers.length).sort((a, b) => b.offers.length - a.offers.length).map(({ product, offers }) => ({ id: product.id, slug: product.slug, title: product.title, summary: product.summary, category: product.category.name, thumbnailUrl: product.thumbnailUrl, lowestPrice: offers[0].price.toNumber(), highestPrice: offers.at(-1)!.price.toNumber(), offerCount: offers.length }));
  }

  async activity() {
    const [shops, prices] = await this.prisma.$transaction([
      this.prisma.shop.findMany({ where: { status: ShopStatus.ACTIVE, publishedAt: { not: null } }, orderBy: { publishedAt: "desc" }, take: 5, select: { id: true, name: true, publishedAt: true } }),
      this.prisma.priceHistory.findMany({ where: { offer: { canonicalProduct: { is: publicProductWhere } } }, orderBy: { capturedAt: "desc" }, take: 10, include: { offer: { include: { canonicalProduct: true } } } }),
    ]);
    return [
      ...shops.map((shop) => ({ id: `shop-${shop.id}`, kind: "new", text: `${shop.name} 已通过审核并发布`, createdAt: shop.publishedAt!.toISOString() })),
      ...prices.map((history) => ({ id: `price-${history.id}`, kind: "price", text: `${history.offer.canonicalProduct.title} 更新报价 ¥${history.price.toFixed(2)}`, createdAt: history.capturedAt.toISOString() })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
  }

  async home() {
    const [stats, categories, offers, hotSearches, directoryShops, banner, sideAds] = await Promise.all([
      this.stats(), this.categories(), this.offers({ sort: "price_asc", page: 1, pageSize: 20 }), this.hotSearches(), this.shops({ sort: "products", page: 1, pageSize: 20 }),
      this.settings?.getActiveBanner() ?? null,
      this.settings?.getActiveSideAds() ?? [],
    ]);
    return { isDemo: false, banner, sideAds, stats, hotSearches, categories, offers, directoryShops: directoryShops.items.filter((shop) => shop.dataLevel === "directory") };
  }

  async hotSearches() {
    const configuredTerms = await this.prisma.hotSearchTerm.findMany({ where: { active: true }, orderBy: [{ position: "asc" }, { term: "asc" }], take: 30 });
    const hotSearches = configuredTerms.length ? configuredTerms.map((item) => item.term) : (await this.hot()).slice(0, 5).map((product) => product.title);
    return hotSearches;
  }

  async offers(raw: Record<string, unknown>) {
    const query = offerSearchQuerySchema.parse(raw);
    const where: Prisma.OfferWhereInput = {
      active: true, shop: { status: ShopStatus.ACTIVE, publishedAt: { not: null } },
      price: { gt: 0, gte: query.minPrice, lte: query.maxPrice },
      stock: query.stock === "out_of_stock" ? 0 : query.stock === "low_stock" ? { gte: 1, lte: 10 } : query.stock === "in_stock" ? { gt: 10 } : undefined,
      canonicalProduct: { is: { ...publicProductWhere, title: query.q ? { contains: query.q, mode: "insensitive" } : undefined, category: query.category ? { OR: [{ slug: query.category }, { name: { equals: query.category, mode: "insensitive" } }] } : undefined } },
    };
    const records = await this.prisma.offer.findMany({ where, include: { shop: true, dataSource: true, canonicalProduct: { include: { category: true } }, sourceProduct: true }, orderBy: { syncedAt: "desc" } });
    const preferred = new Map<string, typeof records[number]>();
    for (const offer of records) {
      if (isBlockedProduct(offer.canonicalProduct.title, offer.canonicalProduct.category.name)) continue;
      const key = `${offer.shopId}:${offer.canonicalProductId}`;
      const current = preferred.get(key);
      const currentPriority = current ? offerPriority(current.collectionMode) : -1;
      const nextPriority = offerPriority(offer.collectionMode);
      if (!current || nextPriority > currentPriority || (nextPriority === currentPriority && offer.sourceObservedAt > current.sourceObservedAt)) preferred.set(key, offer);
    }
    const grouped = new Map<string, OfferListItem[]>();
    for (const offer of preferred.values()) {
      const item = toOfferListItem(offer);
      grouped.set(item.productId, [...(grouped.get(item.productId) || []), item]);
    }
    const result = Array.from(grouped.values()).map((items) => {
      const sorted = items.sort((a, b) => a.price - b.price || b.syncedAt.localeCompare(a.syncedAt));
      const product = sorted[0];
      return { productId: product.productId, productSlug: product.productSlug, productName: product.productName, productThumbnailUrl: product.productThumbnailUrl, category: product.category, specification: product.specification, offerCount: sorted.length, inStockOfferCount: sorted.filter((offer) => offer.stockStatus !== "out_of_stock").length, verifiedShopCount: sorted.length, lowestPrice: sorted[0].price, highestPrice: sorted.at(-1)!.price, latestSyncedAt: sorted.reduce((latest, offer) => offer.syncedAt > latest ? offer.syncedAt : latest, ""), offers: sorted.map((offer, index) => ({ ...offer, isLowestPrice: index === 0 })) };
    });
    if (query.sort === "price_asc") result.sort((a, b) => a.lowestPrice - b.lowestPrice || b.latestSyncedAt.localeCompare(a.latestSyncedAt));
    if (query.sort === "newest") result.sort((a, b) => b.latestSyncedAt.localeCompare(a.latestSyncedAt));
    if (query.sort === "stock_desc") result.sort((a, b) => b.inStockOfferCount - a.inStockOfferCount || b.offerCount - a.offerCount);
    const total = result.length;
    const start = (query.page - 1) * query.pageSize;
    const page = { items: result.slice(start, start + query.pageSize), total, page: query.page, pageSize: query.pageSize, totalPages: total ? Math.ceil(total / query.pageSize) : 0 };
    const ad = await this.searchAdFor([query.q, query.category].filter((value): value is string => Boolean(value)).join(" "));
    return { ...page, ad };
  }

  async suggestions(query = "") {
    const records = await this.prisma.canonicalProduct.findMany({ where: { ...publicProductWhere, title: query.trim() ? { contains: query.trim(), mode: "insensitive" } : undefined, offers: { some: { active: true, price: { gt: 0 }, shop: { status: ShopStatus.ACTIVE, publishedAt: { not: null } } } } }, select: { title: true, category: { select: { name: true } } }, take: 50, orderBy: { title: "asc" } });
    return { suggestions: records.filter((record) => !isBlockedProduct(record.title, record.category.name)).slice(0, 8).map((record) => record.title) };
  }

  async addOfferFeedback(offerId: string, body: unknown, clientKey: string) {
    if (!await this.prisma.offer.findFirst({ where: { id: offerId, active: true, price: { gt: 0 }, canonicalProduct: { is: publicProductWhere } } })) throw new NotFoundException("Offer not found");
    const now = Date.now(); const recent = (this.feedbackRateLimits.get(clientKey) || []).filter((time) => time > now - 60 * 60_000);
    if (recent.length >= 5) return { accepted: false, reason: "rate_limited" as const };
    const data = offerFeedbackSchema.parse(body); const ticket = randomTicket();
    await this.prisma.feedback.create({ data: { ticket, contact: `offer:${offerId}`, message: JSON.stringify(data) } });
    recent.push(now); this.feedbackRateLimits.set(clientKey, recent); return { accepted: true, ticket };
  }

  async search(raw: Record<string, unknown>) { const query = searchQuerySchema.parse(raw); return this.offers({ q: query.q, category: query.category, minPrice: query.minPrice, maxPrice: query.maxPrice, sort: query.sort === "newest" ? "newest" : "price_asc", page: query.page, pageSize: 20 }); }
  async demand(body: unknown) { const data = demandSchema.parse(body); const record = await this.prisma.demand.create({ data: { title: data.title, description: data.description, budget: data.budget } }); return { accepted: true, id: record.id }; }
  async listDemands() { return this.prisma.demand.findMany({ where: { status: "open" }, orderBy: { createdAt: "desc" } }); }
  async addFeedback(body: unknown) { const data = feedbackSchema.parse(body); const ticket = randomTicket(); await this.prisma.feedback.create({ data: { ticket, contact: data.contact, message: data.message } }); return { accepted: true, ticket }; }
  async follow(shopId: string) { if (!await this.prisma.shop.findFirst({ where: { id: shopId, status: ShopStatus.ACTIVE, publishedAt: { not: null } } })) throw new NotFoundException("Shop not found"); return { following: true }; }
  async listings(type: "gateway" | "project") {
    const records = await this.prisma.managedListing.findMany({
      where: { type: type === "gateway" ? ManagedListingType.GATEWAY : ManagedListingType.PROJECT, active: true },
      include: type === "gateway" ? { probeConfig: { include: { models: { where: { enabled: true }, select: { status: true, lastCheckedAt: true } } } } } : undefined,
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    });
    return records.map((item) => {
      const record = item as typeof item & { probeConfig?: { enabled: boolean; lastInferenceAt: Date | null; models: Array<{ status: string; lastCheckedAt: Date | null }> } | null };
      const { thumbnailObjectKey, probeConfig: _probeConfig, ...listing } = record;
      const probeConfig = type === "gateway" ? record.probeConfig : null;
      const probe = type === "gateway" ? summarizeListingProbe(probeConfig) : undefined;
      return {
        ...listing,
        type,
        ...(type === "gateway" ? { probe } : {}),
        thumbnailUrl: thumbnailObjectKey ? `/api/v1/assets/listings/${item.id}?v=${item.updatedAt.getTime()}` : item.thumbnailUrl,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      };
    });
  }

  async managedGatewayListing(id: string) {
    const item = await this.prisma.managedListing.findFirst({ where: { id, type: ManagedListingType.GATEWAY, active: true } });
    if (!item) throw new NotFoundException("Sponsor not found");
    const { thumbnailObjectKey, ...listing } = item;
    return {
      ...listing,
      type: "gateway" as const,
      thumbnailUrl: thumbnailObjectKey ? `/api/v1/assets/listings/${item.id}?v=${item.updatedAt.getTime()}` : item.thumbnailUrl,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  }

  async shopTarget(id: string) {
    const shop = await this.prisma.shop.findFirst({
      where: { id, status: ShopStatus.ACTIVE, publishedAt: { not: null } },
      include: { sourceMappings: { include: { dataSource: { select: { baseUrl: true } } } } },
    });
    if (!shop) throw new NotFoundException("Shop not found");
    const target = safeSourceDestination(shop.homepageUrl, shop.sourceMappings.map((mapping) => mapping.dataSource.baseUrl));
    await this.prisma.outboundClick.create({ data: { targetType: "shop", targetId: shop.id, destinationHost: new URL(target).hostname } });
    return target;
  }

  async offerTarget(id: string) {
    const offer = await this.prisma.offer.findFirst({
      where: { id, active: true, price: { gt: 0 }, canonicalProduct: { is: publicProductWhere }, shop: { status: ShopStatus.ACTIVE, publishedAt: { not: null } } },
      include: { dataSource: { select: { baseUrl: true } } },
    });
    if (!offer) throw new NotFoundException("Offer not found");
    const target = safeSourceDestination(offer.sourceUrl, [offer.dataSource.baseUrl]);
    await this.prisma.outboundClick.create({ data: { targetType: "offer", targetId: offer.id, destinationHost: new URL(target).hostname } });
    return target;
  }
  async listingTarget(id: string) {
    const listing = await this.prisma.managedListing.findFirst({ where: { id, active: true } });
    if (!listing) throw new NotFoundException("Listing not found");
    const target = safeApprovedUrl(listing.url);
    await this.prisma.outboundClick.create({ data: { targetType: "listing", targetId: listing.id, destinationHost: new URL(target).hostname } });
    return target;
  }
  async bannerTarget(id: string) { if (!this.settings) throw new NotFoundException("Banner not found"); return this.settings.bannerTarget(id); }
  async sideAdTarget(slot: string) { if (!this.settings) throw new NotFoundException("Side ad not found"); return this.settings.sideAdTarget(slot); }
  async searchAdTarget(id: string) {
    const now = new Date();
    const ad = await this.prisma.searchAd.findFirst({
      where: {
        id,
        active: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
    });
    if (!ad) throw new NotFoundException("Search ad not found");
    await this.prisma.searchAd.update({ where: { id }, data: { clickCount: { increment: 1 } } });
    return safeApprovedUrl(ad.url);
  }

  private async searchAdFor(rawContext: string) {
    const now = new Date();
    const records = await this.prisma.searchAd.findMany({
      where: {
        active: true,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
      },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    });
    const context = normalizeAdText(rawContext);
    const matched = records.find((ad) => ad.global || ad.keywords.some((keyword) => keywordMatches(context, keyword)));
    if (!matched) return null;
    const counted = await this.prisma.searchAd.update({ where: { id: matched.id }, data: { impressionCount: { increment: 1 } } }).catch(() => matched);
    return serializeSearchAd(counted);
  }
}

function summarizeListingProbe(config: { enabled: boolean; lastInferenceAt: Date | null; models: Array<{ status: string; lastCheckedAt: Date | null }> } | null | undefined) {
  if (!config?.enabled) return { configured: false, status: "unconfigured" as const, availableModels: 0, totalModels: 0, lastCheckedAt: null };
  const totalModels = config.models.length;
  const availableModels = config.models.filter((model) => model.status === "AVAILABLE").length;
  const status = totalModels > 0 && availableModels === totalModels ? "online" : availableModels > 0 ? "partial" : "offline";
  const latest = config.models.map((model) => model.lastCheckedAt?.getTime() || 0).concat(config.lastInferenceAt?.getTime() || 0).reduce((max, value) => Math.max(max, value), 0);
  return { configured: true, status: status as "online" | "partial" | "offline", availableModels, totalModels, lastCheckedAt: latest ? new Date(latest).toISOString() : null };
}

const CATEGORY_GROUPS: Array<{ id: CategoryGroupId; name: string }> = [
  { id: "all", name: "全部" },
  { id: "chatgpt", name: "ChatGPT" },
  { id: "claude", name: "Claude" },
  { id: "gemini", name: "Gemini" },
  { id: "grok", name: "Grok" },
  { id: "coding", name: "AI 编程" },
  { id: "creative", name: "图像视频" },
  { id: "api", name: "中转与 API" },
  { id: "communication", name: "邮箱与接码" },
  { id: "accounts", name: "账号与订阅" },
  { id: "tools", name: "软件与工具" },
  { id: "other", name: "其他" },
];

function normalizeCategoryKey(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}

function formatCategoryName(value: string) {
  const trimmed = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  const known = new Map([
    ["chatgpt", "ChatGPT"], ["gpt", "GPT"], ["claude", "Claude"], ["gemini", "Gemini"],
    ["grok", "Grok"], ["codex", "Codex"], ["cursor", "Cursor"], ["windsurf", "Windsurf"],
  ]);
  return known.get(trimmed.toLocaleLowerCase("zh-CN")) || trimmed;
}

export function categoryGroupFor(name: string): Exclude<CategoryGroupId, "all"> {
  const value = normalizeCategoryKey(name);
  if (/(chatgpt|openai|\bgpt\b)/i.test(value)) return "chatgpt";
  if (/(claude|anthropic)/i.test(value)) return "claude";
  if (/(gemini|google\s*ai|谷歌.*ai)/i.test(value)) return "gemini";
  if (/(grok|\bxai\b)/i.test(value)) return "grok";
  if (/(cursor|windsurf|codex|copilot|github|编程|代码|ide)/i.test(value)) return "coding";
  if (/(midjourney|sora|runway|可灵|绘图|图片|图像|视频|\bmj\b)/i.test(value)) return "creative";
  if (/(api|中转|令牌|token|\bkey\b|兑换码|额度)/i.test(value)) return "api";
  if (/(邮箱|邮件|接码|短信|mail|outlook|gmail)/i.test(value)) return "communication";
  if (/(账号|帐号|成品号|订阅|会员|充值|代充|激活|共享|独享|套餐)/i.test(value)) return "accounts";
  if (/(软件|工具|office|notion|canva|adobe|netflix|youtube)/i.test(value)) return "tools";
  return "other";
}

function toPublicShop(shop: { id: string; slug: string; name: string; description: string; logoUrl: string | null; verifiedAt: Date | null; publishedAt: Date | null; lastSyncedAt: Date | null; offers: Array<{ price: Prisma.Decimal; canonicalProductId: string; canonicalProduct?: { title?: string; category: { name: string } } }>; sourceMappings: Array<{ dataSource: { name: string; attributionUrl: string } }>; approvedCandidates: Array<{ rawMetadata: Prisma.JsonValue; sourceSyncedAt: Date | null }> }) {
  const aggregate = directorySummary(shop.approvedCandidates || []);
  const visibleOffers = shop.offers.filter((offer) => !isBlockedProduct(offer.canonicalProduct?.title || "", offer.canonicalProduct?.category.name || ""));
  const offerPrices = visibleOffers.map((offer) => offer.price.toNumber());
  const offerCategoryCounts = new Map<string, number>();
  for (const offer of visibleOffers) {
    const category = offer.canonicalProduct?.category.name?.trim();
    if (category) offerCategoryCounts.set(category, (offerCategoryCounts.get(category) || 0) + 1);
  }
  const offerCategories = [...offerCategoryCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).map(([name]) => name);
  const syncedAt = shop.lastSyncedAt || shop.approvedCandidates?.[0]?.sourceSyncedAt || shop.publishedAt || new Date(0);
  return {
    id: shop.id, slug: shop.slug, name: shop.name, description: shop.description, logo: shop.logoUrl || shop.name.slice(0, 1),
    productCount: shop.offers.length ? new Set(visibleOffers.map((offer) => offer.canonicalProductId)).size : aggregate?.productCount || 0,
    lowestPrice: offerPrices.length ? Math.min(...offerPrices) : shop.offers.length ? 0 : aggregate?.minPrice || 0,
    highestPrice: offerPrices.length ? Math.max(...offerPrices) : shop.offers.length ? 0 : aggregate?.maxPrice || 0,
    aggregateStock: shop.offers.length ? null : aggregate?.stock ?? null,
    categories: offerCategories.length ? offerCategories : shop.offers.length ? [] : aggregate?.categories || [], dataLevel: shop.offers.length ? "offers" as const : aggregate ? "directory" as const : "profile" as const,
    syncedAt: syncedAt.toISOString(), verified: true, publishedAt: shop.publishedAt?.toISOString() || null, dataFreshness: syncedAt.toISOString(), sourceName: shop.sourceMappings[0]?.dataSource.name,
  };
}

export function directorySummary(candidates: Array<{ rawMetadata: Prisma.JsonValue }>) {
  for (const candidate of candidates) {
    if (!candidate.rawMetadata || typeof candidate.rawMetadata !== "object" || Array.isArray(candidate.rawMetadata)) continue;
    const metadata = candidate.rawMetadata as Record<string, Prisma.JsonValue>;
    const productCount = numericMetadata(metadata.productCount);
    const minPrice = numericMetadata(metadata.minPrice);
    const maxPrice = numericMetadata(metadata.maxPrice);
    const stock = numericMetadata(metadata.stock);
    if (productCount === null || minPrice === null) continue;
    const categories = Array.isArray(metadata.categories) ? metadata.categories.filter((value): value is string => typeof value === "string") : [];
    return { productCount: Math.max(0, Math.trunc(productCount)), minPrice: Math.max(0, minPrice), maxPrice: Math.max(0, maxPrice ?? minPrice), stock: stock === null ? null : Math.max(0, Math.trunc(stock)), categories };
  }
  return null;
}

function numericMetadata(value: Prisma.JsonValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toOfferListItem(offer: { id: string; price: Prisma.Decimal; stock: number | null; syncedAt: Date; sourceObservedAt: Date; sourceAttributionUrl: string | null; collectionMode: CollectionMode; canonicalProduct: { id: string; slug: string; title: string; summary: string; thumbnailUrl: string | null; category: { name: string } }; sourceProduct: { description: string; thumbnailUrl: string | null }; shop: { id: string; slug: string; name: string; logoUrl: string | null; verifiedAt: Date | null }; dataSource: { name: string } }): OfferListItem {
  return { id: offer.id, productId: offer.canonicalProduct.id, productSlug: offer.canonicalProduct.slug, productName: offer.canonicalProduct.title, productThumbnailUrl: offer.canonicalProduct.thumbnailUrl || offer.sourceProduct.thumbnailUrl, category: offer.canonicalProduct.category.name, specification: offer.sourceProduct.description || offer.canonicalProduct.summary, shopId: offer.shop.id, shopSlug: offer.shop.slug, shopName: offer.shop.name, shopLogo: offer.shop.logoUrl || offer.shop.name.slice(0, 1), shopVerified: true, price: offer.price.toNumber(), isLowestPrice: false, stock: offer.stock, stockStatus: getStockStatus(offer.stock), syncedAt: offer.syncedAt.toISOString(), sourceName: offer.dataSource.name, sourceMode: collectionMode(offer.collectionMode), sourceAttributionUrl: offer.sourceAttributionUrl, sourceObservedAt: offer.sourceObservedAt.toISOString() };
}

function offerPriority(mode: CollectionMode) { return mode === CollectionMode.AUTHORIZED_DIRECT ? 3 : mode === CollectionMode.MANUAL ? 2 : 1; }
function selectPreferredOffers<T extends { shopId: string; canonicalProductId: string; collectionMode: CollectionMode; sourceObservedAt: Date }>(offers: T[]): T[] {
  const preferred = new Map<string, T>();
  for (const offer of offers) {
    const key = `${offer.shopId}:${offer.canonicalProductId}`;
    const current = preferred.get(key);
    const nextPriority = offerPriority(offer.collectionMode);
    const currentPriority = current ? offerPriority(current.collectionMode) : -1;
    if (!current || nextPriority > currentPriority || (nextPriority === currentPriority && offer.sourceObservedAt > current.sourceObservedAt)) preferred.set(key, offer);
  }
  return [...preferred.values()];
}
function collectionMode(mode: CollectionMode) { return mode === CollectionMode.PUBLIC_FEED ? "public_feed" as const : mode === CollectionMode.PUBLIC_DIRECTORY ? "public_directory" as const : mode === CollectionMode.AUTHORIZED_DIRECT ? "authorized_direct" as const : "manual" as const; }
function safeApprovedUrl(value: string) { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password) throw new NotFoundException("Unsafe destination"); return url.href; }
export function safeSourceDestination(value: string, approvedBaseUrls: string[]) {
  const destination = new URL(safeApprovedUrl(value));
  const approved = approvedBaseUrls.some((baseUrl) => {
    try {
      const base = new URL(baseUrl);
      return base.protocol === "https:" && base.hostname === destination.hostname && base.port === destination.port;
    } catch {
      return false;
    }
  });
  if (!approved) throw new NotFoundException("Unapproved destination host");
  return destination.href;
}
function randomTicket() { return `AI-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`; }
function normalizeAdText(value: string) { return value.normalize("NFKC").toLocaleLowerCase("zh-CN").trim(); }
function keywordMatches(context: string, keyword: string) {
  const normalized = normalizeAdText(keyword);
  return Boolean(normalized) && (context.includes(normalized) || normalized.includes(context) && context.length >= 2);
}
function serializeSearchAd(ad: {
  id: string; title: string; description: string; descriptionContent: Prisma.JsonValue | null; url: string; imageUrl: string | null; backgroundObjectKey: string | null; logoUrl: string | null; logoObjectKey: string | null; label: string; keywords: string[]; global: boolean;
  active: boolean; position: number; startsAt: Date | null; endsAt: Date | null; impressionCount: number; clickCount: number; createdAt: Date; updatedAt: Date;
}) {
  const content = Array.isArray(ad.descriptionContent) ? ad.descriptionContent.flatMap((segment) => {
    const parsed = announcementSegmentSchema.safeParse(segment);
    return parsed.success ? [parsed.data] : [];
  }) : [];
  const resolvedContent = content.length ? content : ad.description.trim() ? [{ text: ad.description.trim(), bold: false, italic: false, underline: false, color: "default" as const, href: null }] : [];
  const backgroundImageUrl = ad.backgroundObjectKey ? `/api/v1/assets/search-ads/${ad.id}/background?v=${ad.updatedAt.getTime()}` : ad.imageUrl;
  const logoUrl = ad.logoObjectKey ? `/api/v1/assets/search-ads/${ad.id}/logo?v=${ad.updatedAt.getTime()}` : ad.logoUrl;
  return {
    id: ad.id, title: ad.title, description: ad.description, url: ad.url, imageUrl: backgroundImageUrl, backgroundImageUrl, logoUrl,
    content: resolvedContent, label: ad.label, keywords: ad.keywords, global: ad.global, active: ad.active, position: ad.position,
    impressionCount: ad.impressionCount, clickCount: ad.clickCount,
    startsAt: ad.startsAt?.toISOString() || null,
    endsAt: ad.endsAt?.toISOString() || null,
    createdAt: ad.createdAt.toISOString(),
    updatedAt: ad.updatedAt.toISOString(),
  };
}
