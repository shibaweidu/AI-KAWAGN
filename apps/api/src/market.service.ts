import { Injectable, NotFoundException, Optional } from "@nestjs/common";
import { CandidateReviewStatus, CollectionMode, ManagedListingType, Prisma, ShopStatus } from "@prisma/client";
import {
  demandSchema, feedbackSchema, offerFeedbackSchema, offerSearchQuerySchema, searchQuerySchema,
  shopDetailQuerySchema, shopListQuerySchema, submissionSchema, type OfferListItem, type StockStatus,
} from "@ai-card/contracts";
import { PrismaService } from "./prisma.service";
import { SiteSettingsService } from "./site-settings.service";

export function getStockStatus(stock: number | null): StockStatus {
  if (stock === 0) return "out_of_stock";
  if (stock !== null && stock <= 10) return "low_stock";
  return "in_stock";
}

@Injectable()
export class MarketService {
  private feedbackRateLimits = new Map<string, number[]>();
  constructor(private readonly prisma: PrismaService, @Optional() private readonly settings?: SiteSettingsService) {}

  async stats() {
    const activeShopWhere = { status: ShopStatus.ACTIVE, publishedAt: { not: null } } as const;
    const activeOfferWhere = { active: true, shop: activeShopWhere } as const;
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const [shops, offerProducts, verifiedShops, updatedOffersToday, latestOffer, directoryCandidates] = await this.prisma.$transaction([
      this.prisma.shop.count({ where: activeShopWhere }),
      this.prisma.canonicalProduct.count({ where: { offers: { some: activeOfferWhere } } }),
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
    return { shops, products: offerProducts + directoryProducts, verifiedShops, updatedToday: updatedOffersToday + directoryUpdatedToday, lastSyncedAt: latest?.toISOString() || null };
  }

  async categories() {
    const categories = await this.prisma.category.findMany({
      include: { products: { where: { offers: { some: { active: true, shop: { status: ShopStatus.ACTIVE, publishedAt: { not: null } } } } }, select: { id: true } } },
      orderBy: { name: "asc" },
    });
    return categories.map((category) => ({ slug: category.slug, name: category.name, count: category.products.length }));
  }

  async shops(raw: Record<string, unknown> = {}) {
    const query = shopListQuerySchema.parse(raw);
    const where: Prisma.ShopWhereInput = { status: ShopStatus.ACTIVE, publishedAt: { not: null } };
    const orderBy: Prisma.ShopOrderByWithRelationInput[] = query.sort === "newest" ? [{ publishedAt: "desc" }] : [{ offers: { _count: "desc" } }];
    const include = {
      offers: { where: { active: true }, select: { price: true, canonicalProductId: true, canonicalProduct: { select: { category: { select: { name: true } } } } } },
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
      where: { shopId: shop.id, active: true },
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
    const product = await this.prisma.canonicalProduct.findUnique({
      where: { slug }, include: { category: true, offers: { where: { active: true, shop: { status: ShopStatus.ACTIVE, publishedAt: { not: null } } }, include: { shop: true, dataSource: true }, orderBy: { price: "asc" } } },
    });
    if (!product || !product.offers.length) throw new NotFoundException("Product not found");
    const offers = selectPreferredOffers(product.offers).sort((a, b) => a.price.comparedTo(b.price));
    return {
      id: product.id, slug: product.slug, title: product.title, summary: product.summary, category: product.category.name, thumbnailUrl: product.thumbnailUrl,
      lowestPrice: offers[0].price.toNumber(), highestPrice: offers.at(-1)!.price.toNumber(), offerCount: offers.length,
      offers: offers.map((offer) => ({ id: offer.id, shopId: offer.shopId, shopName: offer.shop.name, shopLogo: offer.shop.logoUrl || offer.shop.name.slice(0, 1), price: offer.price.toNumber(), stock: offer.stock, syncedAt: offer.syncedAt.toISOString(), sourceName: offer.dataSource.name, sourceMode: collectionMode(offer.collectionMode), sourceObservedAt: offer.sourceObservedAt.toISOString() })),
    };
  }

  async hot() {
    const products = await this.prisma.canonicalProduct.findMany({ where: { offers: { some: { active: true, shop: { status: ShopStatus.ACTIVE, publishedAt: { not: null } } } } }, include: { category: true, offers: { where: { active: true, shop: { status: ShopStatus.ACTIVE, publishedAt: { not: null } } }, include: { shop: true }, orderBy: { price: "asc" } } }, take: 50 });
    return products.map((product) => ({ product, offers: selectPreferredOffers(product.offers).sort((a, b) => a.price.comparedTo(b.price)) })).filter(({ offers }) => offers.length).sort((a, b) => b.offers.length - a.offers.length).map(({ product, offers }) => ({ id: product.id, slug: product.slug, title: product.title, summary: product.summary, category: product.category.name, thumbnailUrl: product.thumbnailUrl, lowestPrice: offers[0].price.toNumber(), highestPrice: offers.at(-1)!.price.toNumber(), offerCount: offers.length }));
  }

  async activity() {
    const [shops, prices] = await this.prisma.$transaction([
      this.prisma.shop.findMany({ where: { status: ShopStatus.ACTIVE, publishedAt: { not: null } }, orderBy: { publishedAt: "desc" }, take: 5, select: { id: true, name: true, publishedAt: true } }),
      this.prisma.priceHistory.findMany({ orderBy: { capturedAt: "desc" }, take: 10, include: { offer: { include: { canonicalProduct: true } } } }),
    ]);
    return [
      ...shops.map((shop) => ({ id: `shop-${shop.id}`, kind: "new", text: `${shop.name} 已通过审核并发布`, createdAt: shop.publishedAt!.toISOString() })),
      ...prices.map((history) => ({ id: `price-${history.id}`, kind: "price", text: `${history.offer.canonicalProduct.title} 更新报价 ¥${history.price.toFixed(2)}`, createdAt: history.capturedAt.toISOString() })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 10);
  }

  async home() {
    const [stats, categories, offers, hotSearches, directoryShops, banner] = await Promise.all([
      this.stats(), this.categories(), this.offers({ sort: "price_asc", page: 1, pageSize: 20 }), this.hotSearches(), this.shops({ sort: "products", page: 1, pageSize: 20 }),
      this.settings?.getActiveBanner() ?? null,
    ]);
    return { isDemo: false, banner, stats, hotSearches, categories, offers, directoryShops: directoryShops.items.filter((shop) => shop.dataLevel === "directory") };
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
      price: query.minPrice !== undefined || query.maxPrice !== undefined ? { gte: query.minPrice, lte: query.maxPrice } : undefined,
      stock: query.stock === "out_of_stock" ? 0 : query.stock === "low_stock" ? { gte: 1, lte: 10 } : query.stock === "in_stock" ? { gt: 10 } : undefined,
      canonicalProduct: {
        title: query.q ? { contains: query.q, mode: "insensitive" } : undefined,
        category: query.category ? { OR: [{ slug: query.category }, { name: query.category }] } : undefined,
      },
    };
    const records = await this.prisma.offer.findMany({ where, include: { shop: true, dataSource: true, canonicalProduct: { include: { category: true } }, sourceProduct: true }, orderBy: { syncedAt: "desc" } });
    const preferred = new Map<string, typeof records[number]>();
    for (const offer of records) {
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
    const records = await this.prisma.canonicalProduct.findMany({ where: { title: query.trim() ? { contains: query.trim(), mode: "insensitive" } : undefined, offers: { some: { active: true, shop: { status: ShopStatus.ACTIVE, publishedAt: { not: null } } } } }, select: { title: true }, take: 8, orderBy: { title: "asc" } });
    return { suggestions: records.map((record) => record.title) };
  }

  async addOfferFeedback(offerId: string, body: unknown, clientKey: string) {
    if (!await this.prisma.offer.findFirst({ where: { id: offerId, active: true } })) throw new NotFoundException("Offer not found");
    const now = Date.now(); const recent = (this.feedbackRateLimits.get(clientKey) || []).filter((time) => time > now - 60 * 60_000);
    if (recent.length >= 5) return { accepted: false, reason: "rate_limited" as const };
    const data = offerFeedbackSchema.parse(body); const ticket = randomTicket();
    await this.prisma.feedback.create({ data: { ticket, contact: `offer:${offerId}`, message: JSON.stringify(data) } });
    recent.push(now); this.feedbackRateLimits.set(clientKey, recent); return { accepted: true, ticket };
  }

  async search(raw: Record<string, unknown>) { const query = searchQuerySchema.parse(raw); return this.offers({ q: query.q, category: query.category, minPrice: query.minPrice, maxPrice: query.maxPrice, sort: query.sort === "newest" ? "newest" : "price_asc", page: query.page, pageSize: 20 }); }
  async submit(body: unknown) { const data = submissionSchema.parse(body); const record = await this.prisma.shopSubmission.create({ data: { url: data.url, contactEmail: data.contactEmail, authorizationConfirmed: true } }); return { accepted: true, id: record.id }; }
  async demand(body: unknown) { const data = demandSchema.parse(body); const record = await this.prisma.demand.create({ data: { title: data.title, description: data.description, budget: data.budget } }); return { accepted: true, id: record.id }; }
  async listDemands() { return this.prisma.demand.findMany({ where: { status: "open" }, orderBy: { createdAt: "desc" } }); }
  async addFeedback(body: unknown) { const data = feedbackSchema.parse(body); const ticket = randomTicket(); await this.prisma.feedback.create({ data: { ticket, contact: data.contact, message: data.message } }); return { accepted: true, ticket }; }
  async follow(shopId: string) { if (!await this.prisma.shop.findFirst({ where: { id: shopId, status: ShopStatus.ACTIVE, publishedAt: { not: null } } })) throw new NotFoundException("Shop not found"); return { following: true }; }
  async listings(type: "gateway" | "project") {
    const records = await this.prisma.managedListing.findMany({
      where: { type: type === "gateway" ? ManagedListingType.GATEWAY : ManagedListingType.PROJECT, active: true },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }],
    });
    return records.map((item) => ({ ...item, type, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() }));
  }

  async shopTarget(id: string) { const shop = await this.prisma.shop.findFirst({ where: { id, status: ShopStatus.ACTIVE, publishedAt: { not: null } } }); if (!shop) throw new NotFoundException("Shop not found"); return safeApprovedUrl(shop.homepageUrl); }
  async offerTarget(id: string) { const offer = await this.prisma.offer.findFirst({ where: { id, active: true, shop: { status: ShopStatus.ACTIVE, publishedAt: { not: null } } } }); if (!offer) throw new NotFoundException("Offer not found"); return safeApprovedUrl(offer.sourceUrl); }
  async bannerTarget(id: string) { if (!this.settings) throw new NotFoundException("Banner not found"); return this.settings.bannerTarget(id); }
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

function toPublicShop(shop: { id: string; slug: string; name: string; description: string; logoUrl: string | null; verifiedAt: Date | null; publishedAt: Date | null; lastSyncedAt: Date | null; offers: Array<{ price: Prisma.Decimal; canonicalProductId: string; canonicalProduct?: { category: { name: string } } }>; sourceMappings: Array<{ dataSource: { name: string; attributionUrl: string } }>; approvedCandidates: Array<{ rawMetadata: Prisma.JsonValue; sourceSyncedAt: Date | null }> }) {
  const aggregate = directorySummary(shop.approvedCandidates || []);
  const offerPrices = shop.offers.map((offer) => offer.price.toNumber());
  const offerCategoryCounts = new Map<string, number>();
  for (const offer of shop.offers) {
    const category = offer.canonicalProduct?.category.name?.trim();
    if (category) offerCategoryCounts.set(category, (offerCategoryCounts.get(category) || 0) + 1);
  }
  const offerCategories = [...offerCategoryCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN")).map(([name]) => name);
  const syncedAt = shop.lastSyncedAt || shop.approvedCandidates?.[0]?.sourceSyncedAt || shop.publishedAt || new Date(0);
  return {
    id: shop.id, slug: shop.slug, name: shop.name, description: shop.description, logo: shop.logoUrl || shop.name.slice(0, 1),
    productCount: shop.offers.length ? new Set(shop.offers.map((offer) => offer.canonicalProductId)).size : aggregate?.productCount || 0,
    lowestPrice: offerPrices.length ? Math.min(...offerPrices) : aggregate?.minPrice || 0,
    highestPrice: offerPrices.length ? Math.max(...offerPrices) : aggregate?.maxPrice || 0,
    aggregateStock: shop.offers.length ? null : aggregate?.stock ?? null,
    categories: offerCategories.length ? offerCategories : aggregate?.categories || [], dataLevel: shop.offers.length ? "offers" as const : aggregate ? "directory" as const : "profile" as const,
    syncedAt: syncedAt.toISOString(), verified: true, publishedAt: shop.publishedAt?.toISOString() || null, dataFreshness: syncedAt.toISOString(), sourceName: shop.sourceMappings[0]?.dataSource.name,
  };
}

function directorySummary(candidates: Array<{ rawMetadata: Prisma.JsonValue }>) {
  for (const candidate of candidates) {
    if (!candidate.rawMetadata || typeof candidate.rawMetadata !== "object" || Array.isArray(candidate.rawMetadata)) continue;
    const metadata = candidate.rawMetadata as Record<string, Prisma.JsonValue>;
    const productCount = numericMetadata(metadata.productCount);
    const minPrice = numericMetadata(metadata.minPrice);
    const maxPrice = numericMetadata(metadata.maxPrice);
    const stock = numericMetadata(metadata.stock);
    if (productCount === null || minPrice === null || maxPrice === null) continue;
    const categories = Array.isArray(metadata.categories) ? metadata.categories.filter((value): value is string => typeof value === "string") : [];
    return { productCount: Math.max(0, Math.trunc(productCount)), minPrice: Math.max(0, minPrice), maxPrice: Math.max(0, maxPrice), stock: stock === null ? null : Math.max(0, Math.trunc(stock)), categories };
  }
  return null;
}

function numericMetadata(value: Prisma.JsonValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toOfferListItem(offer: { id: string; price: Prisma.Decimal; stock: number | null; syncedAt: Date; sourceObservedAt: Date; collectionMode: CollectionMode; canonicalProduct: { id: string; slug: string; title: string; summary: string; thumbnailUrl: string | null; category: { name: string } }; sourceProduct: { description: string; thumbnailUrl: string | null }; shop: { id: string; slug: string; name: string; logoUrl: string | null; verifiedAt: Date | null }; dataSource: { name: string } }): OfferListItem {
  return { id: offer.id, productId: offer.canonicalProduct.id, productSlug: offer.canonicalProduct.slug, productName: offer.canonicalProduct.title, productThumbnailUrl: offer.canonicalProduct.thumbnailUrl || offer.sourceProduct.thumbnailUrl, category: offer.canonicalProduct.category.name, specification: offer.sourceProduct.description || offer.canonicalProduct.summary, shopId: offer.shop.id, shopSlug: offer.shop.slug, shopName: offer.shop.name, shopLogo: offer.shop.logoUrl || offer.shop.name.slice(0, 1), shopVerified: true, price: offer.price.toNumber(), isLowestPrice: false, stock: offer.stock, stockStatus: getStockStatus(offer.stock), syncedAt: offer.syncedAt.toISOString(), sourceName: offer.dataSource.name, sourceMode: collectionMode(offer.collectionMode), sourceObservedAt: offer.sourceObservedAt.toISOString() };
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
function randomTicket() { return `AI-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`; }
function normalizeAdText(value: string) { return value.normalize("NFKC").toLocaleLowerCase("zh-CN").trim(); }
function keywordMatches(context: string, keyword: string) {
  const normalized = normalizeAdText(keyword);
  return Boolean(normalized) && (context.includes(normalized) || normalized.includes(context) && context.length >= 2);
}
function serializeSearchAd(ad: {
  id: string; title: string; description: string; url: string; imageUrl: string | null; label: string; keywords: string[]; global: boolean;
  active: boolean; position: number; startsAt: Date | null; endsAt: Date | null; impressionCount: number; clickCount: number; createdAt: Date; updatedAt: Date;
}) {
  return {
    ...ad,
    startsAt: ad.startsAt?.toISOString() || null,
    endsAt: ad.endsAt?.toISOString() || null,
    createdAt: ad.createdAt.toISOString(),
    updatedAt: ad.updatedAt.toISOString(),
  };
}
