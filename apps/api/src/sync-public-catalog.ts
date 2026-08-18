import "./load-env";
import { IngestionService } from "./ingestion.service";
import { ObjectStoreService } from "./object-store.service";
import { PrismaService } from "./prisma.service";

const key = process.argv.find((value) => value.startsWith("--key="))?.slice("--key=".length) || "";
const runId = process.argv.find((value) => value.startsWith("--run-id="))?.slice("--run-id=".length);

async function main() {
  if (key !== "cardnav") throw new Error("--key must be cardnav");
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const service = new IngestionService(prisma, new ObjectStoreService());
    console.log(JSON.stringify(await service.syncPublicCatalog(key, runId)));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
