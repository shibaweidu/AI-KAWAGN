import "./load-env";
import { DataSourceKind, PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  try {
    const ldxp = await prisma.dataSource.upsert({
      where: { key: "ldxp" },
      create: {
        key: "ldxp", name: "链动小店", kind: DataSourceKind.MANUAL_IMPORT,
        baseUrl: "https://pay.ldxp.cn", attributionUrl: "https://pay.ldxp.cn",
        enabled: false, pollIntervalSeconds: 0, robotsReviewedAt: new Date(),
      },
      update: {
        name: "链动小店", kind: DataSourceKind.MANUAL_IMPORT,
        baseUrl: "https://pay.ldxp.cn", attributionUrl: "https://pay.ldxp.cn",
        enabled: false, pollIntervalSeconds: 0,
      },
    });

    const legacySources = await prisma.dataSource.findMany({ where: { id: { not: ldxp.id } }, select: { id: true, key: true } });
    const legacyIds = legacySources.map((source) => source.id);
    const counts = await prisma.$transaction(async (tx) => {
      const offers = legacyIds.length ? (await tx.offer.deleteMany({ where: { dataSourceId: { in: legacyIds } } })).count : 0;
      const sourceProducts = legacyIds.length ? (await tx.sourceProduct.deleteMany({ where: { dataSourceId: { in: legacyIds } } })).count : 0;
      const mappings = legacyIds.length ? (await tx.shopSource.deleteMany({ where: { dataSourceId: { in: legacyIds } } })).count : 0;
      const candidates = legacyIds.length ? (await tx.shopCandidate.deleteMany({ where: { dataSourceId: { in: legacyIds } } })).count : 0;
      const sources = legacyIds.length ? (await tx.dataSource.deleteMany({ where: { id: { in: legacyIds } } })).count : 0;
      const shops = (await tx.shop.deleteMany({
        where: {
          sourceMappings: { none: { dataSourceId: ldxp.id } },
          offers: { none: { dataSourceId: ldxp.id } },
        },
      })).count;
      const verified = (await tx.shop.updateMany({
        where: { status: "ACTIVE", publishedAt: { not: null }, verifiedAt: null },
        data: { verifiedAt: new Date() },
      })).count;
      return { offers, sourceProducts, mappings, candidates, sources, shops, verified };
    }, { timeout: 120_000 });

    process.stdout.write(`${JSON.stringify({ retainedSource: "ldxp", removedSources: legacySources.map((source) => source.key), ...counts }, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : error}\n`);
  process.exitCode = 1;
});
