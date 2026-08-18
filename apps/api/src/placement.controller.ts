import { Body, Controller, Get, Param, Post, Query, Req, Res, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { PlacementService } from "./placement.service";

@Controller()
export class PlacementController {
  constructor(private readonly placements: PlacementService, private readonly auth: AuthService) {}

  @Get("placements/slots") slots(@Query("kind") kind?: string) { return this.placements.slots(kind || "gateway"); }
  @Post("placements/orders/quote") quote(@Body() body: unknown) { return this.placements.quote(body); }
  @Post("placements/orders")
  @UseInterceptors(FileInterceptor("image", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  async create(@Body() body: unknown, @UploadedFile() image: Express.Multer.File | undefined, @Req() request: Request) { const user = await this.auth.requireUser(request.cookies?.ai_card_session); return this.placements.createOrder(user.id, body, image); }
  @Get("placements/orders") async orders(@Req() request: Request) { const user = await this.auth.requireUser(request.cookies?.ai_card_session); return this.placements.listOrders(user.id); }
  @Get("placements/orders/:id") async order(@Param("id") id: string, @Req() request: Request) { const user = await this.auth.requireUser(request.cookies?.ai_card_session); return this.placements.getOrder(user.id, id); }
  @Post("placements/orders/:id/pay") async continuePayment(@Param("id") id: string, @Req() request: Request) { const user = await this.auth.requireUser(request.cookies?.ai_card_session); return this.placements.continuePayment(user.id, id); }
  @Get("account/overview") async overview(@Req() request: Request) { const user = await this.auth.requireUser(request.cookies?.ai_card_session); return this.placements.accountOverview(user.id); }

  @Post("payment/yipay/notify") async notify(@Body() body: Record<string, unknown>) { return this.placements.notifyPayment(body); }
  @Get("payment/yipay/return") async paymentReturn(@Query("out_trade_no") orderNo: string | undefined, @Res() response: Response) { return response.redirect(302, `${process.env.WEB_ORIGIN || "http://localhost:3000"}/account/placements${orderNo ? `?order=${encodeURIComponent(orderNo)}` : ""}`); }
}
