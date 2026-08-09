import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { AuthService } from "./auth.service";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post("register") async register(@Body() body: unknown, @Res({ passthrough: true }) response: Response) { const result = await this.auth.register(body); this.cookie(response, result.token); return { user: result.user, verificationRequired: result.verificationRequired }; }
  @Post("login") async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) { const result = await this.auth.login(body); this.cookie(response, result.token); return { user: result.user }; }
  @Post("logout") async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) { await this.auth.logout(request.cookies?.ai_card_session); response.clearCookie("ai_card_session", { path: "/" }); return { ok: true }; }
  @Get("me") async me(@Req() request: Request) { return { user: await this.auth.verify(request.cookies?.ai_card_session) }; }
  private cookie(response: Response, token: string) { response.cookie("ai_card_session", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 7 * 86400_000, path: "/" }); }
}
