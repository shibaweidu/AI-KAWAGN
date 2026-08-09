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

@Module({ imports: [PrismaModule], controllers: [MarketController, AuthController, AdminController, SiteController], providers: [MarketService, AuthService, ObjectStoreService, IngestionService, SiteSettingsService, AdminGuard] })
export class AppModule {}
