import { Controller, Get, Param, Res } from "@nestjs/common";
import type { Response } from "express";
import { SiteSettingsService } from "./site-settings.service";

@Controller()
export class SiteController {
  constructor(private readonly settings: SiteSettingsService) {}

  @Get("site-settings") settingsPublic() { return this.settings.getPublicSettings(); }

  @Get("assets/:asset")
  async asset(@Param("asset") asset: string, @Res() response: Response) {
    const file = await this.settings.getAsset(asset);
    response.setHeader("Content-Type", file.contentType);
    response.setHeader("Cache-Control", "public, max-age=300");
    if (file.etag) response.setHeader("ETag", file.etag);
    response.send(file.body);
  }
}
