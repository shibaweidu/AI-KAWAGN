import { BadRequestException, ConflictException, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { authSchema } from "@ai-card/contracts";
import { PrismaService } from "./prisma.service";
import { z } from "zod";

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(8).max(200),
  newPassword: z.string().min(8).max(200),
}).refine((value) => value.currentPassword !== value.newPassword, { message: "新密码不能与旧密码相同", path: ["newPassword"] });

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async register(input: unknown) {
    const data = authSchema.parse(input);
    const email = data.email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email } })) throw new ConflictException("Email already registered");
    const user = await this.prisma.user.create({ data: { email, passwordHash: await argon2.hash(data.password, { type: argon2.argon2id }), verifiedAt: new Date() } });
    return { user: this.publicUser(user), verificationRequired: false, token: await this.createSession(user.id) };
  }

  async login(input: unknown) {
    const data = authSchema.parse(input);
    const user = await this.prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
    if (!user || user.disabledAt || !(await argon2.verify(user.passwordHash, data.password))) throw new UnauthorizedException("Invalid credentials");
    return { user: this.publicUser(user), token: await this.createSession(user.id) };
  }

  async logout(token?: string) {
    if (!token) return;
    await this.prisma.session.updateMany({ where: { tokenHash: this.hash(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async verify(token?: string) {
    if (!token) return null;
    const session = await this.prisma.session.findUnique({ where: { tokenHash: this.hash(token) }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.disabledAt) return null;
    return this.publicUser(session.user);
  }

  async changePassword(token: string | undefined, input: unknown) {
    const sessionUser = await this.requireUser(token);
    const data = passwordChangeSchema.parse(input);
    const user = await this.prisma.user.findUnique({ where: { id: sessionUser.id } });
    if (!user || !(await argon2.verify(user.passwordHash, data.currentPassword))) throw new BadRequestException("当前密码不正确");
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await argon2.hash(data.newPassword, { type: argon2.argon2id }) } }),
      this.prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } }),
    ]);
    return { ok: true };
  }

  async requireOperator(token?: string) {
    const user = await this.verify(token);
    if (!user || !["moderator", "admin"].includes(user.role)) throw new UnauthorizedException("Operator access required");
    return user;
  }

  async requireAdmin(token?: string) {
    const user = await this.verify(token);
    if (!user) throw new UnauthorizedException("Administrator access required");
    if (user.role !== "admin") throw new ForbiddenException("Administrator access required");
    return user;
  }

  async requireUser(token?: string) {
    const user = await this.verify(token);
    if (!user) throw new UnauthorizedException("Login required");
    return user;
  }

  private async createSession(userId: string) {
    const token = randomBytes(32).toString("base64url");
    await this.prisma.session.create({ data: { tokenHash: this.hash(token), userId, expiresAt: new Date(Date.now() + 7 * 86400_000) } });
    return token;
  }

  private hash(token: string) { return createHash("sha256").update(token).digest("hex"); }
  private publicUser(user: { id: string; email: string; role: string; verifiedAt: Date | null; disabledAt: Date | null; createdAt: Date }) {
    return { id: user.id, email: user.email, role: user.role.toLowerCase(), verified: Boolean(user.verifiedAt), active: !user.disabledAt, createdAt: user.createdAt.toISOString() };
  }
}
