import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { BotInternalGuard } from "./bot-internal.guard";
import { BotService } from "./bot.service";

@Controller("internal/bots")
@UseGuards(BotInternalGuard)
export class BotInternalController {
  constructor(private readonly bots: BotService) {}

  @Get(":platform/config") config(@Param("platform") platform: string) { return this.bots.internalConfig(platform); }
  @Get(":platform/chats/:chatId") chat(@Param("platform") platform: string, @Param("chatId") chatId: string) { return this.bots.isChatAllowed(platform, chatId); }
  @Post(":platform/heartbeat") heartbeat(@Param("platform") platform: string, @Body() body: unknown) { return this.bots.heartbeat(platform, body); }
  @Post(":platform/metrics") metric(@Param("platform") platform: string, @Body() body: unknown) { return this.bots.recordMetric(platform, body); }
}
