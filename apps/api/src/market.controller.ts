import { BadRequestException, Body, Controller, Get, HttpException, HttpStatus, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { ZodError } from "zod";
import { MarketService } from "./market.service";

@Controller()
export class MarketController {
  constructor(private readonly market: MarketService) {}
  @Get("health") health() { return { status: "ok", service: "ai-card-api", time: new Date().toISOString() }; }
  @Get("stats") stats() { return this.market.stats(); }
  @Get("categories") categories() { return this.market.categories(); }
  @Get("hot") hot() { return this.market.hot(); }
  @Get("gateways") gateways() { return this.market.listings("gateway"); }
  @Get("projects") projects() { return this.market.listings("project"); }
  @Get("shops") shops(@Query() query: Record<string, unknown>) { return this.wrap(() => this.market.shops(query)); }
  @Get("shops/:slug") shop(@Param("slug") slug: string, @Query() query: Record<string, unknown>) { return this.wrap(() => this.market.shop(slug, query)); }
  @Get("products/:slug") product(@Param("slug") slug: string) { return this.market.product(slug); }
  @Get("activity") activity() { return this.market.activity(); }
  @Get("home") home() { return this.market.home(); }
  @Get("search/hot") async hotSearches() { return { hotSearches: await this.market.hotSearches() }; }
  @Get("offers") offers(@Query() query: Record<string, unknown>) { return this.wrap(() => this.market.offers(query)); }
  @Get("search/suggestions") suggestions(@Query("q") query = "") { return this.market.suggestions(query); }
  @Post("feedback/offers/:offerId") async offerFeedback(@Param("offerId") offerId: string, @Body() body: unknown, @Req() request: Request) {
    const clientKey = request.ip || request.socket.remoteAddress || "anonymous";
    const result = await this.wrap(() => this.market.addOfferFeedback(offerId, body, clientKey));
    if (!result.accepted) throw new HttpException({ message: "提交过于频繁，请稍后再试" }, HttpStatus.TOO_MANY_REQUESTS);
    return result;
  }
  @Get("demands") demands() { return this.market.listDemands(); }
  @Get("search") search(@Query() query: Record<string, unknown>) { return this.wrap(() => this.market.search(query)); }
  @Post("submissions") submit(@Body() body: unknown) { return this.wrap(() => this.market.submit(body)); }
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
  @Get("go/offer/:id") async redirectOffer(@Param("id") id: string, @Res() response: Response) { return response.redirect(302, await this.market.offerTarget(id)); }
  @Get("go/banner/:id") async redirectBanner(@Param("id") id: string, @Res() response: Response) { return response.redirect(302, await this.market.bannerTarget(id)); }
  @Get("go/search-ad/:id") async redirectSearchAd(@Param("id") id: string, @Res() response: Response) { return response.redirect(302, await this.market.searchAdTarget(id)); }
  private async wrap<T>(action: () => T | Promise<T>): Promise<T> { try { return await action(); } catch (error) { if (error instanceof ZodError) throw new BadRequestException(error.flatten()); throw error; } }
}
