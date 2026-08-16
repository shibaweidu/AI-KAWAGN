import "./load-env";
import { GatewayDirectoryService } from "./gateway-directory.service";
import { PrismaService } from "./prisma.service";

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const result = await new GatewayDirectoryService(prisma).sync();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
