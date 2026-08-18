import { BadRequestException, Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { MarketService } from "./market.service";
import { GatewayDirectoryService } from "./gateway-directory.service";
import { GatewayProbeService } from "./gateway-probe.service";
import { SubmissionService } from "./submission.service";
import { CacheService } from "./cache.service";

@Controller()
export class MarketController {
  constructor(private readonly market: MarketService, private readonly gatewayDirectory: GatewayDirectoryService, private readonly gatewayProbe: GatewayProbeService, private readonly submissions: SubmissionService, private readonly cache: CacheService) {}
  @Get("health") health() { return { status: "ok", service: "ai-card-api", time: new Date().toISOString() }; }
  @Get("stats") stats() { return this.market.stats(); }
  @Get("categories") categories() { return this.market.categories(); }
  @Get("categories/browse") categoryBrowse(@Query() query: Record<string, unknown>) { return this.wrap(() => this.market.categoryBrowse(query)); }
  @Get("hot") hot() { return this.market.hot(); }
  @Get("gateways") gateways() { return this.market.listings("gateway"); }
  @Get("gateway-directory") gatewayDirectoryList(@Query() query: Record<string, unknown>) { return this.wrap(() => this.gatewayDirectory.listPublic(query)); }
  @Get("gateway-directory-grouped") gatewayDirectoryGrouped(@Query() query: Record<string, unknown>) { return this.wrap(() => this.gatewayDirectory.listGroupedPublic(query)); }
  @Get("gateway-directory/featured") featuredGateways(@Query("take") take?: string) { return this.gatewayDirectory.featured(Number(take) || 8); }
  @Get("gateway-directory/:slug/checks") gatewayDirectoryChecks(@Param("slug") slug: string) { return this.gatewayDirectory.monitorHistory(slug); }
  @Get("gateway-directory/:slug/model-availability") gatewayModelAvailability(@Param("slug") slug: string) { return this.gatewayProbe.publicAvailability(slug); }
  @Get("gateway-directory/:slug") gatewayDirectoryDetail(@Param("slug") slug: string) { return this.gatewayDirectory.detail(slug); }
  @Get("listings/:id/probe") async managedListingProbe(@Param("id") id: string) {
    const [listing, availability] = await Promise.all([this.market.managedGatewayListing(id), this.gatewayProbe.publicAvailabilityForListing(id)]);
    return { listing, availability };
  }
  @Get("projects") projects() { return this.market.listings("project"); }
  @Get("shops") async shops(@Query() query: Record<string, unknown>, @Req() request: Request) { await this.protectSearch(request, "shops"); return this.wrap(() => this.market.shops(query)); }
  @Get("shops/:slug") shop(@Param("slug") slug: string, @Query() query: Record<string, unknown>) { return this.wrap(() => this.market.shop(slug, query)); }
  @Get("products/:slug") product(@Param("slug") slug: string) { return this.market.product(slug); }
  @Get("activity") activity() { return this.market.activity(); }
  @Get("home") home() { return this.market.home(); }
  @Get("search/hot") async hotSearches() { return { hotSearches: await this.market.hotSearches() }; }
  @Get("offers") async offers(@Query() query: Record<string, unknown>, @Req() request: Request) { await this.protectSearch(request, "offers"); return this.wrap(() => this.market.offers(query)); }
  @Get("search/suggestions") async suggestions(@Query("q") query = "", @Req() request: Request) { await this.protectSearch(request, "suggestions"); return this.market.suggestions(query); }
  @Post("feedback/offers/:offerId") async offerFeedback(@Param("offerId") offerId: string, @Body() body: unknown, @Req() request: Request) {
    const clientKey = request.ip || request.socket.remoteAddress || "anonymous";
    const result = await this.wrap(() => this.market.addOfferFeedback(offerId, body, clientKey));
    if (!result.accepted) throw new HttpException({ message: "提交过于频繁，请稍后再试" }, HttpStatus.TOO_MANY_REQUESTS);
    return result;
  }
  @Get("demands") demands() { return this.market.listDemands(); }
  @Get("search") async search(@Query() query: Record<string, unknown>, @Req() request: Request) { await this.protectSearch(request, "search"); return this.wrap(() => this.market.search(query)); }
  @Post("submissions") submit(@Body() body: unknown, @Req() request: Request) { return this.wrap(() => this.submissions.submit(body, request.ip || request.socket.remoteAddress || "unknown")); }
  @Post("demands") demand(@Body() body: unknown) { return this.wrap(() => this.market.demand(body)); }
  @Post("feedback") feedback(@Body() body: unknown) { return this.wrap(() => this.market.addFeedback(body)); }
  @Post("follows/:shopId") follow(@Param("shopId") shopId: string) { return this.market.follow(shopId); }
  @Post("assistant/chat") assistant(@Body() body: { message?: string }, @Res() response: Response) {
    const question = String(body.message || "").slice(0, 500);
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache");
    response.write(`data: ${JSON.stringify({ type: "source", href: "/search?q=" + encodeURIComponent(question), title: "站内搜索" })}\n\n`);
    response.write(`data: ${JSON.stringify({ type: "text", text: "我可以帮你比较公开商品与店铺信息。已为你生成相关搜索入口。" })}\n\n`);
    response.end();
  }
  @Get("go/shop/:id") async redirectShop(@Param("id") id: string, @Res() response: Response) { return response.redirect(302, await this.market.shopTarget(id)); }
  @Get("go/shop-sponsor/:id") async redirectShopSponsor(@Param("id") id: string, @Res() response: Response) { return response.redirect(302, await this.market.shopSponsorTarget(id)); }
  @Get("go/offer/:id") async redirectOffer(@Param("id") id: string, @Res() response: Response) { return response.redirect(302, await this.market.offerTarget(id)); }
  @Get("go/listing/:id") async redirectListing(@Param("id") id: string, @Res() response: Response) { return response.redirect(302, await this.market.listingTarget(id)); }
  @Get("go/banner/:id") async redirectBanner(@Param("id") id: string, @Res() response: Response) { return response.redirect(302, await this.market.bannerTarget(id)); }
  @Get("go/side-ad/:slot") async redirectSideAd(@Param("slot") slot: string, @Res() response: Response) { return response.redirect(302, await this.market.sideAdTarget(slot)); }
  @Get("go/search-ad/:id") async redirectSearchAd(@Param("id") id: string, @Res() response: Response) { return response.redirect(302, await this.market.searchAdTarget(id)); }
  @Get("go/gateway/:id") async redirectGateway(@Param("id") id: string, @Res() response: Response) { return response.redirect(302, await this.gatewayDirectory.target(id)); }
  private async protectSearch(request: Request, scope: string) {
    const client = request.ip || request.socket.remoteAddress || "anonymous";
    const result = await this.cache.consumeRateLimit(CacheService.key(`rate:${scope}`, client), Number(process.env.SEARCH_RATE_LIMIT || 120), 60);
    if (!result.allowed) throw new HttpException({ message: "请求过于频繁，请稍后再试" }, HttpStatus.TOO_MANY_REQUESTS);
  }
  private async wrap<T>(action: () => T | Promise<T>): Promise<T> { try { return await action(); } catch (error) { if (error instanceof ZodError) throw new BadRequestException(error.flatten()); throw error; } }
}
