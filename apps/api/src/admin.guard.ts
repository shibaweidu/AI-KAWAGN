import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "./auth.service";

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const expectedOrigin = process.env.WEB_ORIGIN || "http://localhost:3000";
    if (request.method !== "GET" && request.headers.origin && request.headers.origin !== expectedOrigin) throw new ForbiddenException("Invalid request origin");
    await this.auth.requireOperator(request.cookies?.ai_card_session);
    return true;
  }
}
