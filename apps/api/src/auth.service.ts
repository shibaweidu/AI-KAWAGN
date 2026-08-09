import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import * as argon2 from "argon2";
import { authSchema } from "@ai-card/contracts";
import { PrismaService } from "./prisma.service";

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
    if (!user || !(await argon2.verify(user.passwordHash, data.password))) throw new UnauthorizedException("Invalid credentials");
    return { user: this.publicUser(user), token: await this.createSession(user.id) };
  }

  async logout(token?: string) {
    if (!token) return;
    await this.prisma.session.updateMany({ where: { tokenHash: this.hash(token), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async verify(token?: string) {
    if (!token) return null;
    const session = await this.prisma.session.findUnique({ where: { tokenHash: this.hash(token) }, include: { user: true } });
    if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
    return this.publicUser(session.user);
  }

  async requireOperator(token?: string) {
    const user = await this.verify(token);
    if (!user || !["moderator", "admin"].includes(user.role)) throw new UnauthorizedException("Operator access required");
    return user;
  }

  private async createSession(userId: string) {
    const token = randomBytes(32).toString("base64url");
    await this.prisma.session.create({ data: { tokenHash: this.hash(token), userId, expiresAt: new Date(Date.now() + 7 * 86400_000) } });
    return token;
  }

  private hash(token: string) { return createHash("sha256").update(token).digest("hex"); }
  private publicUser(user: { id: string; email: string; role: string; verifiedAt: Date | null }) {
    return { id: user.id, email: user.email, role: user.role.toLowerCase(), verified: Boolean(user.verifiedAt) };
  }
}
