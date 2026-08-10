import { Body, Controller, Get, Param, Post, Query, UploadedFile, UploadedFiles, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileFieldsInterceptor, FileInterceptor } from "@nestjs/platform-express";
import { AdminGuard } from "./admin.guard";
import { IngestionService } from "./ingestion.service";
import { SiteSettingsService } from "./site-settings.service";

@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly ingestion: IngestionService, private readonly settings: SiteSettingsService) {}

  @Get("site-settings") siteSettings() { return this.settings.getPublicSettings(); }
  @Post("site-settings")
  @UseInterceptors(FileInterceptor("logo", { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  updateSiteSettings(@Body() body: unknown, @UploadedFile() logo?: Express.Multer.File) { return this.settings.updateSettings(body, logo); }

  @Get("home-banner") homeBanner() { return this.settings.getAdminBanner(); }
  @Post("home-banner")
  @UseInterceptors(FileFieldsInterceptor([
    { name: "desktopImage", maxCount: 1 },
    { name: "mobileImage", maxCount: 1 },
  ], { limits: { fileSize: 5 * 1024 * 1024, files: 2 } }))
  updateHomeBanner(
    @Body() body: unknown,
    @UploadedFiles() files: { desktopImage?: Express.Multer.File[]; mobileImage?: Express.Multer.File[] },
  ) { return this.settings.updateBanner(body, files || {}); }

  @Get("sources") sources() { return this.ingestion.ensureSources(); }
  @Post("sources/:key/schedule") scheduleSource(@Param("key") key: string, @Body() body: unknown) { return this.ingestion.setSourceSchedule(key, body); }
  @Post("sources/:key/sync") syncSource(@Param("key") key: string) { return this.ingestion.requestSourceSync(key); }
  @Post("sources/:key/discover-211b") discover211b(@Param("key") key: string, @Body() body: unknown) { return this.ingestion.discoverLdxpFrom211b(key, body); }
  @Get("sources/:key/product-backfill") productBackfillStatus(@Param("key") key: string) { return this.ingestion.ldxpProductBackfillStatus(key); }
  @Post("sources/:key/product-backfill") productBackfill(@Param("key") key: string, @Body() body: unknown) { return this.ingestion.requestLdxpProductBackfill(key, body); }
  @Get("runs") runs() { return this.ingestion.listRuns(); }
  @Get("hot-searches") hotSearches() { return this.ingestion.listHotSearches(); }
  @Post("hot-searches") addHotSearch(@Body() body: unknown) { return this.ingestion.addHotSearch(body); }
  @Post("hot-searches/reorder") reorderHotSearches(@Body() body: unknown) { return this.ingestion.reorderHotSearches(body); }
  @Post("hot-searches/:id/toggle") toggleHotSearch(@Param("id") id: string) { return this.ingestion.toggleHotSearch(id); }
  @Get("candidates") candidates(@Query() query: Record<string, unknown>) { return this.ingestion.listCandidates(query); }
  @Get("listings") listings(@Query() query: Record<string, unknown>) { return this.ingestion.listManagedListings(query); }
  @Post("listings") addListing(@Body() body: unknown) { return this.ingestion.addManagedListing(body); }
  @Post("listings/reorder") reorderListings(@Body() body: unknown) { return this.ingestion.reorderManagedListings(body); }
  @Post("listings/:id/toggle") toggleListing(@Param("id") id: string) { return this.ingestion.toggleManagedListing(id); }
  @Get("search-ads") searchAds() { return this.ingestion.listSearchAds(); }
  @Post("search-ads") addSearchAd(@Body() body: unknown) { return this.ingestion.addSearchAd(body); }
  @Post("search-ads/reorder") reorderSearchAds(@Body() body: unknown) { return this.ingestion.reorderSearchAds(body); }
  @Post("search-ads/:id/toggle") toggleSearchAd(@Param("id") id: string) { return this.ingestion.toggleSearchAd(id); }

  @Post("candidates/:id/decision") decide(@Param("id") id: string, @Body() body: unknown) { return this.ingestion.decideCandidate(id, body); }
  @Post("candidates/batch-decision") decideBatch(@Body() body: unknown) { return this.ingestion.decideCandidates(body); }
  @Post("runs/:id/rollback") rollback(@Param("id") id: string) { return this.ingestion.rollbackRun(id); }

  @Post("imports/preview")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  preview(@UploadedFile() file: Express.Multer.File) { return this.ingestion.previewImport(file); }

  @Post("imports/:token/stage") stage(@Param("token") token: string) { return this.ingestion.stageImport(token); }
}
