import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Query, Req, UploadedFile, UploadedFiles, UseGuards, UseInterceptors } from "@nestjs/common";
import type { Request } from "express";
import { FileFieldsInterceptor, FileInterceptor } from "@nestjs/platform-express";
import { AdminGuard } from "./admin.guard";
import { IngestionService } from "./ingestion.service";
import { SiteSettingsService } from "./site-settings.service";
import { GatewayDirectoryService } from "./gateway-directory.service";
import { GatewayProbeService } from "./gateway-probe.service";
import { AuthService } from "./auth.service";
import { SubmissionService } from "./submission.service";
import { BotService } from "./bot.service";
import { PlacementService } from "./placement.service";
import { UserAdminService } from "./user-admin.service";

@Controller("admin")
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly settings: SiteSettingsService,
    private readonly gatewayDirectory: GatewayDirectoryService,
    private readonly gatewayProbe: GatewayProbeService,
    private readonly submissions: SubmissionService,
    private readonly auth: AuthService,
    private readonly bots: BotService,
    private readonly placements: PlacementService,
    private readonly users: UserAdminService,
  ) {}

  @Get("bots") botsOverview() { return this.bots.overview(); }
  @Get("users") async usersList(@Query() query: Record<string, unknown>, @Req() request: Request) { await this.auth.requireAdmin(request.cookies?.ai_card_session); return this.users.list(query); }
  @Get("users/:id") async userDetail(@Param("id") id: string, @Req() request: Request) { await this.auth.requireAdmin(request.cookies?.ai_card_session); return this.users.detail(id); }
  @Post("users/:id/status") async updateUserStatus(@Param("id") id: string, @Body() body: unknown, @Req() request: Request) { await this.auth.requireAdmin(request.cookies?.ai_card_session); return this.users.changeStatus(id, body); }
  @Post("users/:id/role") async updateUserRole(@Param("id") id: string, @Body() body: unknown, @Req() request: Request) { await this.auth.requireAdmin(request.cookies?.ai_card_session); return this.users.changeRole(id, body); }
  @Get("placements/config") placementConfig() { return this.placements.adminConfig(); }
  @Get("placements/payment-config") placementPaymentConfig() { return this.placements.paymentConfig(); }
  @Post("placements/payment-config") async savePlacementPaymentConfig(@Body() body: unknown, @Req() request: Request) { await this.auth.requireAdmin(request.cookies?.ai_card_session); return this.placements.savePaymentConfig(body); }
  @Post("placements/config") async savePlacementConfig(@Body() body: unknown, @Req() request: Request) { const user = await this.auth.requireOperator(request.cookies?.ai_card_session); if (user.role !== "admin") throw new ForbiddenException("仅管理员可以修改投放价格"); return this.placements.saveAdminConfig(body); }
  @Get("placements/orders") placementOrders() { return this.placements.adminOrders(); }
  @Post("placements/orders/:id/approve") async approvePlacementOrder(@Param("id") id: string, @Body() body: { note?: string }, @Req() request: Request) { const user = await this.auth.requireOperator(request.cookies?.ai_card_session); return this.placements.approve(id, user.id, body?.note); }
  @Post("placements/orders/:id/reject") async rejectPlacementOrder(@Param("id") id: string, @Body() body: { reason?: string }, @Req() request: Request) { const user = await this.auth.requireOperator(request.cookies?.ai_card_session); return this.placements.reject(id, user.id, String(body?.reason || "")); }
  @Post("placements/orders/:id/refund") async refundPlacementOrder(@Param("id") id: string, @Req() request: Request) { const user = await this.auth.requireOperator(request.cookies?.ai_card_session); return this.placements.refund(id, user.id); }
  @Get("placements/stats") async placementStats() { const orders = await this.placements.adminOrders(); return { total: orders.length, pendingReview: orders.filter((order: any) => order.status === "paid_pending_review").length, paid: orders.filter((order: any) => ["paid_pending_review", "approved"].includes(order.status)).length }; }
  @Post("bots/preview") botPreview(@Body() body: unknown) { return this.bots.preview(body); }
  @Post("bots/:platform") updateBot(@Param("platform") platform: string, @Body() body: unknown) { return this.bots.updateIntegration(platform, body); }
  @Get("bots/:platform/chats") botChats(@Param("platform") platform: string) { return this.bots.chats(platform); }
  @Post("bots/:platform/chats") saveBotChat(@Param("platform") platform: string, @Body() body: unknown) { return this.bots.saveChat(platform, body); }
  @Delete("bots/:platform/chats/:id") deleteBotChat(@Param("platform") platform: string, @Param("id") id: string) { return this.bots.deleteChat(platform, id); }

  @Get("site-settings") siteSettings() { return this.settings.getPublicSettings(); }
  @Post("site-settings")
  @UseInterceptors(FileInterceptor("logo", { limits: { fileSize: 2 * 1024 * 1024, files: 1 } }))
  updateSiteSettings(@Body() body: unknown, @UploadedFile() logo?: Express.Multer.File) { return this.settings.updateSettings(body, logo); }

  @Post("gateway-notice")
  updateGatewayNotice(@Body() body: unknown) { return this.settings.updateGatewayNotice(body); }

  @Get("announcement") announcement() { return this.settings.getAdminAnnouncement(); }
  @Post("announcement") updateAnnouncement(@Body() body: unknown) { return this.settings.updateAnnouncement(body); }

  @Get("home-banner") homeBanner() { return this.settings.getAdminBanner(); }
  @Get("side-ads") sideAds() { return this.settings.getAdminSideAds(); }
  @Post("side-ads/:slot")
  @UseInterceptors(FileInterceptor("image", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  updateSideAd(@Param("slot") slot: string, @Body() body: unknown, @UploadedFile() image?: Express.Multer.File) { return this.settings.updateSideAd(slot, body, image); }
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
  @Get("submissions") submissionsList(@Query() query: Record<string, unknown>) { return this.submissions.listAdmin(query); }
  @Post("submissions/:id/decision") decideSubmission(@Param("id") id: string, @Body() body: unknown) { return this.submissions.decide(id, body); }
  @Delete("submissions/:id") deleteSubmission(@Param("id") id: string) { return this.submissions.remove(id); }
  @Get("listings") listings(@Query() query: Record<string, unknown>) { return this.ingestion.listManagedListings(query); }
  @Post("listings")
  @UseInterceptors(FileInterceptor("thumbnail", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  addListing(@Body() body: unknown, @UploadedFile() thumbnail?: Express.Multer.File) { return this.ingestion.addManagedListing(body, thumbnail); }
  @Post("listings/reorder") reorderListings(@Body() body: unknown) { return this.ingestion.reorderManagedListings(body); }
  @Post("listings/:id")
  @UseInterceptors(FileInterceptor("thumbnail", { limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  updateListing(@Param("id") id: string, @Body() body: unknown, @UploadedFile() thumbnail?: Express.Multer.File) { return this.ingestion.updateManagedListing(id, body, thumbnail); }
  @Post("listings/:id/toggle") toggleListing(@Param("id") id: string) { return this.ingestion.toggleManagedListing(id); }
  @Get("gateway-directory") gatewayEntries(@Query() query: Record<string, unknown>) { return this.gatewayDirectory.listAdmin(query); }
  @Post("gateway-directory/sync") syncGatewayEntries() { return this.gatewayDirectory.sync(); }
  @Post("gateway-directory/schedule") scheduleGatewayEntries(@Body() body: unknown) { return this.gatewayDirectory.setSchedule(body); }
  @Post("gateway-directory/decision") decideGatewayEntries(@Body() body: unknown) { return this.gatewayDirectory.decide(body); }
  @Post("gateway-directory/group-assignment") assignGatewayGroup(@Body() body: unknown) { return this.gatewayDirectory.assignDisplayGroup(body); }
  @Post("gateway-directory/groups") createGatewayGroup(@Body() body: unknown) { return this.gatewayDirectory.createDisplayGroup(body); }
  @Post("gateway-directory/groups/reorder") reorderGatewayGroups(@Body() body: unknown) { return this.gatewayDirectory.reorderDisplayGroups(body); }
  @Post("gateway-directory/groups/:id") updateGatewayGroup(@Param("id") id: string, @Body() body: unknown) { return this.gatewayDirectory.updateDisplayGroup(id, body); }
  @Post("gateway-directory/manual") addManualGateway(@Body() body: unknown) { return this.gatewayDirectory.createManualGateway(body); }
  @Post("gateway-directory/:id/featured") toggleGatewayFeatured(@Param("id") id: string) { return this.gatewayDirectory.toggleFeatured(id); }
  @Get("gateway-directory/:id/probe") async gatewayProbeConfig(@Param("id") id: string, @Req() request: Request) { const user = await this.auth.requireOperator(request.cookies?.ai_card_session); return this.gatewayProbe.adminView(id, user.role); }
  @Post("gateway-directory/:id/probe") async saveGatewayProbeConfig(@Param("id") id: string, @Body() body: unknown, @Req() request: Request) { const user = await this.auth.requireOperator(request.cookies?.ai_card_session); return this.gatewayProbe.saveConfig(id, body, user.role); }
  @Post("gateway-directory/:id/probe/key") async replaceGatewayProbeKey(@Param("id") id: string, @Body() body: { apiKey?: unknown }, @Req() request: Request) { const user = await this.auth.requireOperator(request.cookies?.ai_card_session); return this.gatewayProbe.replaceKey(id, body?.apiKey, user.role); }
  @Delete("gateway-directory/:id/probe/key") async clearGatewayProbeKey(@Param("id") id: string, @Req() request: Request) { const user = await this.auth.requireOperator(request.cookies?.ai_card_session); return this.gatewayProbe.clearKey(id, user.role); }
  @Post("gateway-directory/:id/probe/models") async saveGatewayProbeModels(@Param("id") id: string, @Body() body: unknown, @Req() request: Request) { const user = await this.auth.requireOperator(request.cookies?.ai_card_session); return this.gatewayProbe.saveModels(id, body, user.role); }
  @Post("gateway-directory/:id/probe/run/:kind") runGatewayProbe(@Param("id") id: string, @Param("kind") kind: string) {
    if (kind !== "models" && kind !== "inference") throw new BadRequestException("探测类型无效");
    return this.gatewayProbe.requestRun(id, kind);
  }
  @Post("gateway-directory/:id/probe/resume") async resumeGatewayProbe(@Param("id") id: string, @Req() request: Request) { const user = await this.auth.requireOperator(request.cookies?.ai_card_session); return this.gatewayProbe.resume(id, user.role); }
  @Get("listings/:id/probe") async listingProbeConfig(@Param("id") id: string, @Req() request: Request) { const user = await this.auth.requireOperator(request.cookies?.ai_card_session); return this.gatewayProbe.adminViewForListing(id, user.role); }
  @Post("listings/:id/probe") async saveListingProbeConfig(@Param("id") id: string, @Body() body: unknown, @Req() request: Request) { const user = await this.auth.requireOperator(request.cookies?.ai_card_session); return this.gatewayProbe.saveConfigForListing(id, body, user.role); }
  @Post("listings/:id/probe/key") async replaceListingProbeKey(@Param("id") id: string, @Body() body: { apiKey?: unknown }, @Req() request: Request) { const user = await this.auth.requireOperator(request.cookies?.ai_card_session); return this.gatewayProbe.replaceKeyForListing(id, body?.apiKey, user.role); }
  @Delete("listings/:id/probe/key") async clearListingProbeKey(@Param("id") id: string, @Req() request: Request) { const user = await this.auth.requireOperator(request.cookies?.ai_card_session); return this.gatewayProbe.clearKeyForListing(id, user.role); }
  @Post("listings/:id/probe/models") async saveListingProbeModels(@Param("id") id: string, @Body() body: unknown, @Req() request: Request) { const user = await this.auth.requireOperator(request.cookies?.ai_card_session); return this.gatewayProbe.saveModelsForListing(id, body, user.role); }
  @Post("listings/:id/probe/run/:kind") runListingProbe(@Param("id") id: string, @Param("kind") kind: string) {
    if (kind !== "models" && kind !== "inference") throw new BadRequestException("探测类型无效");
    return this.gatewayProbe.requestRunForListing(id, kind);
  }
  @Post("listings/:id/probe/resume") async resumeListingProbe(@Param("id") id: string, @Req() request: Request) { const user = await this.auth.requireOperator(request.cookies?.ai_card_session); return this.gatewayProbe.resumeForListing(id, user.role); }
  @Get("search-ads") searchAds() { return this.ingestion.listSearchAds(); }
  @Post("search-ads")
  @UseInterceptors(FileFieldsInterceptor([
    { name: "backgroundImage", maxCount: 1 },
    { name: "logo", maxCount: 1 },
  ], { limits: { fileSize: 5 * 1024 * 1024, files: 2 } }))
  addSearchAd(@Body() body: unknown, @UploadedFiles() files: { backgroundImage?: Express.Multer.File[]; logo?: Express.Multer.File[] }) { return this.ingestion.addSearchAd(body, files || {}); }
  @Post("search-ads/reorder") reorderSearchAds(@Body() body: unknown) { return this.ingestion.reorderSearchAds(body); }
  @Post("search-ads/:id")
  @UseInterceptors(FileFieldsInterceptor([
    { name: "backgroundImage", maxCount: 1 },
    { name: "logo", maxCount: 1 },
  ], { limits: { fileSize: 5 * 1024 * 1024, files: 2 } }))
  updateSearchAd(@Param("id") id: string, @Body() body: unknown, @UploadedFiles() files: { backgroundImage?: Express.Multer.File[]; logo?: Express.Multer.File[] }) { return this.ingestion.updateSearchAd(id, body, files || {}); }
  @Post("search-ads/:id/toggle") toggleSearchAd(@Param("id") id: string) { return this.ingestion.toggleSearchAd(id); }

  @Post("candidates/:id/decision") decide(@Param("id") id: string, @Body() body: unknown) { return this.ingestion.decideCandidate(id, body); }
  @Post("candidates/batch-decision") decideBatch(@Body() body: unknown) { return this.ingestion.decideCandidates(body); }
  @Post("runs/:id/rollback") rollback(@Param("id") id: string) { return this.ingestion.rollbackRun(id); }

  @Post("imports/preview")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  preview(@UploadedFile() file: Express.Multer.File) { return this.ingestion.previewImport(file); }

  @Post("imports/:token/stage") stage(@Param("token") token: string) { return this.ingestion.stageImport(token); }
}
