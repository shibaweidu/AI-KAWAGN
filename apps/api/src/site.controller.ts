import { Controller, Get, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { SiteSettingsService } from "./site-settings.service";
import { IngestionService } from "./ingestion.service";
import { PlacementService } from "./placement.service";

@Controller()
export class SiteController {
  constructor(private readonly settings: SiteSettingsService, private readonly ingestion: IngestionService, private readonly placements: PlacementService) {}

  @Get("site-settings") settingsPublic() { return this.settings.getPublicSettings(); }

  @Get("assets/:asset")
  async asset(@Param("asset") asset: string, @Res() response: Response) {
    const file = await this.settings.getAsset(asset);
    response.setHeader("Content-Type", file.contentType);
    response.setHeader("Cache-Control", "public, max-age=300");
    if (file.etag) response.setHeader("ETag", file.etag);
    response.send(file.body);
  }

  @Get("assets/listings/:id")
  async listingAsset(@Param("id") id: string, @Res() response: Response) {
    const file = await this.ingestion.getManagedListingAsset(id);
    response.setHeader("Content-Type", file.contentType);
    response.setHeader("Cache-Control", "public, max-age=300");
    if (file.etag) response.setHeader("ETag", file.etag);
    response.send(file.body);
  }

  @Get("assets/side-ads/:slot")
  async sideAdAsset(@Param("slot") slot: string, @Res() response: Response) {
    const file = await this.settings.getSideAdAsset(slot);
    response.setHeader("Content-Type", file.contentType);
    response.setHeader("Cache-Control", "public, max-age=300");
    if (file.etag) response.setHeader("ETag", file.etag);
    response.send(file.body);
  }

  @Get("assets/search-ads/:id/:kind")
  async searchAdAsset(@Param("id") id: string, @Param("kind") kind: string, @Res() response: Response) {
    const file = await this.ingestion.getSearchAdAsset(id, kind);
    response.setHeader("Content-Type", file.contentType);
    response.setHeader("Cache-Control", "public, max-age=300");
    if (file.etag) response.setHeader("ETag", file.etag);
    response.send(file.body);
  }

  @Get("assets/placements/:id")
  async placementAsset(@Param("id") id: string, @Res() response: Response) {
    const file = await this.placements.asset(id);
    response.setHeader("Content-Type", file.contentType);
    response.setHeader("Cache-Control", "public, max-age=300");
    if (file.etag) response.setHeader("ETag", file.etag);
    response.send(file.body);
  }
}
