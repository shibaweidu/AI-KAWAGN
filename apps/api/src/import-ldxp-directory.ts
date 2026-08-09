import "./load-env";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DataSourceKind, Prisma, PrismaClient, SyncStatus } from "@prisma/client";
import { parse as parseCsv } from "csv-parse/sync";
import { z } from "zod";
import { ObjectStoreService } from "./object-store.service";

const rowSchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.string().url(),
  productCount: z.coerce.number().int().min(0),
  stock: z.coerce.number().int().min(0),
  minPrice: z.coerce.number().min(0),
  maxPrice: z.coerce.number().min(0),
  lastSeen: z.coerce.date(),
  categories: z.string().default(""),
}).superRefine((row, context) => {
  const url = new URL(row.url);
  if (url.protocol !== "https:" || url.hostname !== "pay.ldxp.cn" || !/^\/shop\/[^/]+\/?$/.test(url.pathname)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Expected an HTTPS pay.ldxp.cn shop URL", path: ["url"] });
  }
  if (row.minPrice > row.maxPrice) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "minPrice cannot exceed maxPrice", path: ["minPrice"] });
  }
});

type DirectoryRow = z.infer<typeof rowSchema>;

export function parseLdxpDirectory(raw: string) {
  const values = parseCsv(raw, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as unknown[];
  if (!values.length) throw new Error("The LDXP directory is empty");
  if (values.length > 10_000) throw new Error("The LDXP directory exceeds 10,000 rows");

  const rows: DirectoryRow[] = [];
  const errors: Array<{ row: number; issues: string[] }> = [];
  values.forEach((value, index) => {
    const parsed = rowSchema.safeParse(value);
    if (parsed.success) rows.push(parsed.data);
    else errors.push({ row: index + 2, issues: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`) });
  });
  const duplicateUrls = rows.map((row) => row.url).filter((url, index, all) => all.indexOf(url) !== index);
  if (duplicateUrls.length) errors.push({ row: 0, issues: [`Duplicate shop URLs: ${[...new Set(duplicateUrls)].join(", ")}`] });
  return { total: values.length, valid: rows.length, invalid: errors.length, rows, errors };
}

function externalShopId(url: string) {
  return decodeURIComponent(new URL(url).pathname.replace(/^\/shop\//, "").replace(/\/$/, ""));
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const fileArg = process.argv.find((argument) => argument.startsWith("--file="))?.slice("--file=".length);
  const filePath = resolve(fileArg || resolve(process.cwd(), "../../ldxp-shop-directory/shops.csv"));
  const raw = await readFile(filePath, "utf-8");
  const parsed = parseLdxpDirectory(raw);
  if (parsed.errors.length) {
    throw new Error(`LDXP validation failed (${parsed.invalid}/${parsed.total}): ${JSON.stringify(parsed.errors.slice(0, 20))}`);
  }
  if (dryRun) {
    process.stdout.write(`${JSON.stringify({ filePath, total: parsed.total, valid: parsed.valid }, null, 2)}\n`);
    return;
  }

  const prisma = new PrismaClient();
  const objects = new ObjectStoreService();
  let runId: string | null = null;
  try {
    const checksum = createHash("sha256").update(raw).digest("hex");
    const source = await prisma.dataSource.upsert({
      where: { key: "ldxp" },
      create: {
        key: "ldxp", name: "链动小店目录（本地导入）", kind: DataSourceKind.MANUAL_IMPORT,
        baseUrl: "https://pay.ldxp.cn", attributionUrl: "https://pay.ldxp.cn", enabled: false,
        pollIntervalSeconds: 6 * 60 * 60, robotsReviewedAt: new Date(),
      },
      update: { name: "链动小店目录（本地导入）", kind: DataSourceKind.MANUAL_IMPORT, baseUrl: "https://pay.ldxp.cn", attributionUrl: "https://pay.ldxp.cn" },
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rawSnapshotKey = await objects.put(`imports/ldxp-directory-${stamp}.csv`, raw, "text/csv; charset=utf-8");
    const run = await prisma.ingestionRun.create({
      data: { dataSourceId: source.id, kind: "ldxp-directory-import", status: SyncStatus.RUNNING, checksum, rawSnapshotKey, startedAt: new Date() },
    });
    runId = run.id;

    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.shopCandidate.findMany({ where: { dataSourceId: source.id }, select: { id: true, externalId: true, name: true, directoryUrl: true, homepageUrl: true, sourceSyncedAt: true, rawMetadata: true } });
      const existingByExternalId = new Map(existing.map((candidate) => [candidate.externalId, candidate]));
      let created = 0;
      let updated = 0;

      for (const row of parsed.rows) {
        const externalId = externalShopId(row.url);
        const before = existingByExternalId.get(externalId);
        const categories = row.categories.split("|").map((value) => value.trim()).filter(Boolean);
        const metadata = {
          importedSource: "ldxp-shop-directory",
          sourceFile: "shops.csv",
          productCount: row.productCount,
          stock: row.stock,
          minPrice: row.minPrice,
          maxPrice: row.maxPrice,
          categories,
        };
        const candidate = await tx.shopCandidate.upsert({
          where: { dataSourceId_externalId: { dataSourceId: source.id, externalId } },
          create: {
            dataSourceId: source.id, externalId, name: row.name, directoryUrl: row.url, homepageUrl: row.url,
            sourceSyncedAt: row.lastSeen, lastSeenAt: row.lastSeen, rawMetadata: metadata,
          },
          update: {
            name: row.name, directoryUrl: row.url, homepageUrl: row.url,
            sourceSyncedAt: row.lastSeen, lastSeenAt: row.lastSeen, missingCount: 0, rawMetadata: metadata,
          },
        });
        before ? updated++ : created++;
        await tx.importChange.create({
          data: {
            ingestionRunId: run.id, entityType: "SHOP_CANDIDATE", entityId: candidate.id, action: before ? "UPDATE" : "CREATE",
            before: before ? { name: before.name, directoryUrl: before.directoryUrl, homepageUrl: before.homepageUrl, sourceSyncedAt: before.sourceSyncedAt?.toISOString() ?? null, rawMetadata: before.rawMetadata } : Prisma.JsonNull,
            after: { name: row.name, directoryUrl: row.url, homepageUrl: row.url, sourceSyncedAt: row.lastSeen.toISOString(), rawMetadata: metadata },
          },
        });
      }

      const finishedAt = new Date();
      await tx.dataSource.update({ where: { id: source.id }, data: { lastCheckedAt: finishedAt, lastSuccessAt: finishedAt, lastSnapshotId: checksum } });
      await tx.ingestionRun.update({
        where: { id: run.id },
        data: {
          status: SyncStatus.SUCCEEDED,
          finishedAt,
          snapshotId: checksum,
          counts: { total: parsed.total, created, updated },
        },
      });
      return { runId: run.id, total: parsed.total, created, updated, rawSnapshotKey };
    }, { timeout: 120_000 });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    if (runId) await prisma.ingestionRun.update({ where: { id: runId }, data: { status: SyncStatus.FAILED, errorCode: error instanceof Error ? error.name : "UnknownError", errorMessage: String(error instanceof Error ? error.message : error).slice(0, 2000), finishedAt: new Date() } }).catch(() => undefined);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : error}\n`);
    process.exitCode = 1;
  });
}
