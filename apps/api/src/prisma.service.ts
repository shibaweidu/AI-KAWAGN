import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly slowQueryMs = Math.max(0, Number(process.env.SLOW_QUERY_MS || 300));

  constructor() {
    super({ log: [{ emit: "event", level: "query" }, { emit: "stdout", level: "error" }] });
    const client = this as unknown as { $on(eventType: "query", callback: (event: Prisma.QueryEvent) => void): void };
    client.$on("query", (event) => {
      if (event.duration < this.slowQueryMs) return;
      const shape = event.query.replace(/\s+/g, " ").trim().slice(0, 500);
      this.logger.warn(`slow query ${event.duration}ms: ${shape}`);
    });
  }

  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
