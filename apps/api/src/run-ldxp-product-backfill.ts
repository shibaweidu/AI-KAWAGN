import "./load-env";
import { IngestionService } from "./ingestion.service";
import { ObjectStoreService } from "./object-store.service";
import { PrismaService } from "./prisma.service";

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const service = new IngestionService(prisma, new ObjectStoreService());
  try {
    await service.onModuleInit();
    let runId = process.argv.find((value) => value.startsWith("--run-id="))?.slice(9);
    if (!runId) {
      const batchSize = process.argv.find((value) => value.startsWith("--batch-size="))?.slice(13);
      const requested = await service.requestLdxpProductBackfill("ldxp", { batchSize });
      runId = requested.runId || undefined;
      if (!runId) {
        process.stdout.write(`${JSON.stringify(requested)}\n`);
        return;
      }
    }
    let result = await service.processLdxpProductBackfill(runId);
    const runAll = process.argv.includes("--all");
    if (runAll) process.stdout.write(`${JSON.stringify(result)}\n`);
    while (runAll && result.status === "QUEUED") {
      result = await service.processLdxpProductBackfill(runId);
      process.stdout.write(`${JSON.stringify(result)}\n`);
    }
    if (!runAll) process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
