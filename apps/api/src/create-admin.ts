import "./load-env";
import "reflect-metadata";
import * as argon2 from "argon2";
import { PrismaClient, Role } from "@prisma/client";

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12) throw new Error("Set ADMIN_EMAIL and an ADMIN_PASSWORD with at least 12 characters");
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, passwordHash: await argon2.hash(password, { type: argon2.argon2id }), role: Role.ADMIN, verifiedAt: new Date() },
      update: { passwordHash: await argon2.hash(password, { type: argon2.argon2id }), role: Role.ADMIN, verifiedAt: new Date() },
    });
    process.stdout.write(`Admin ready: ${user.email}\n`);
  } finally { await prisma.$disconnect(); }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; });
