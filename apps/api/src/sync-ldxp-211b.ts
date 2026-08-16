import "./load-env";
import { IngestionService } from "./ingestion.service";
import { ObjectStoreService } from "./object-store.service";
import { PrismaService } from "./prisma.service";

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const service = new IngestionService(prisma, new ObjectStoreService());
  try {
    await service.onModuleInit();
    const maxPages = boundedInteger(process.env.SOURCE_211B_MAX_PAGES, 50, 1, 50);
    const batchSize = boundedInteger(process.env.SOURCE_211B_BATCH_SIZE, 5, 1, 100);
    const discovery = await service.discoverLdxpFrom211b("ldxp", { maxPages, syncProducts: false, maxProductShops: 0 });
    const status = await service.ldxpProductBackfillStatus("ldxp");
    const catalog = await service.requestLdxpProductBackfill("ldxp", { batchSize, refreshAll: status.remainingShops === 0 });
    process.stdout.write(`${JSON.stringify({ discovery, catalog })}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
