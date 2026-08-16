import { Module } from "@nestjs/common";
import { MarketController } from "./market.controller";
import { MarketService } from "./market.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { PrismaModule } from "./prisma.service";
import { ObjectStoreService } from "./object-store.service";
import { IngestionService } from "./ingestion.service";
import { AdminController } from "./admin.controller";
import { AdminGuard } from "./admin.guard";
import { SiteController } from "./site.controller";
import { SiteSettingsService } from "./site-settings.service";
import { GatewayDirectoryService } from "./gateway-directory.service";
import { GatewayProbeService } from "./gateway-probe.service";
import { SubmissionService } from "./submission.service";
import { BotService } from "./bot.service";
import { BotInternalController } from "./bot-internal.controller";
import { BotInternalGuard } from "./bot-internal.guard";

@Module({ imports: [PrismaModule], controllers: [MarketController, AuthController, AdminController, SiteController, BotInternalController], providers: [MarketService, AuthService, ObjectStoreService, IngestionService, SiteSettingsService, GatewayDirectoryService, GatewayProbeService, SubmissionService, BotService, AdminGuard, BotInternalGuard] })
export class AppModule {}
