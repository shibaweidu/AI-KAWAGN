import "./load-env";
import { GatewayProbeService } from "./gateway-probe.service";
import { PrismaService } from "./prisma.service";

async function main() {
  const configId = process.argv.find((value) => value.startsWith("--config-id="))?.split("=")[1];
  const cleanup = process.argv.includes("--cleanup");
  if (!configId && !cleanup) throw new Error("--config-id is required");
  const prisma = new PrismaService(); await prisma.$connect();
  try { const service = new GatewayProbeService(prisma); const result = cleanup ? await service.cleanup() : await service.executeConfig(configId!); process.stdout.write(`${JSON.stringify(result)}\n`); }
  finally { await prisma.$disconnect(); }
}
main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`); process.exitCode = 1; });
