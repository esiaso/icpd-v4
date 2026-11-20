import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import type { RegisterInput } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { config } from '../common/config';
import { AppError, BadRequest, Conflict, Unauthorized } from '../common/errors';
import { randomToken, sha256 } from '../common/crypto';
import { MailService } from '../mail/mail.service';
import { AuditService } from '../audit/audit.service';
import { IdentityService } from './identity.service';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
}

const HOUR = 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly identity: IdentityService,
  ) {}

  hash(password: string) {
    return bcrypt.hash(password, 12);
  }

  async register(input: RegisterInput) {
    const exists = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw Conflict('The email has already been taken.');
    const user = await this.prisma.user.create({
      data: { name: input.name, email: input.email, passwordHash: await this.hash(input.password) },
    });
    await this.identity.assignRole(user.id, 'Public User');
    await this.sendVerification(user.id);
    await this.audit.log({ actorId: user.id, logName: 'auth', event: 'registered', subjectType: 'user', subjectId: user.id });
    return user;
  }

  async sendVerification(userId: bigint) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) return;
    const token = randomToken();
    await this.prisma.emailVerificationToken.create({
      data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + HOUR) },
    });
    await this.mail.send(user.email, 'VerifyEmail', {
      name: user.name,
      url: `${config.appUrl}/verify-email?token=${token}`,
    });
    return token;
  }

  async verifyEmail(token: string) {
    const row = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw BadRequest('This verification link is invalid or has expired.');
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } }),
    ]);
  }

  async validateCredentials(email: string, password: string, client: ClientInfo) {
    const user = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    const ok = !!user?.passwordHash && (await bcrypt.compare(password, user.passwordHash));
    await this.prisma.authLog.create({
      data: { userId: user?.id ?? null, email, ip: client.ip, userAgent: client.userAgent, loginSuccessful: ok },
    });
    if (!ok || !user) throw Unauthorized('These credentials do not match our records.');
    return user;
  }

  /** Issue a new session (access + refresh family) and notify on a new device. */
  async startSession(userId: bigint, client: ClientInfo): Promise<SessionTokens> {
    const known = await this.prisma.authLog.count({
      where: { userId, loginSuccessful: true, ip: client.ip ?? null, userAgent: client.userAgent ?? null },
    });
    const user = await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    // `known` includes this login's own log row when called after validateCredentials.
    const previous = await this.prisma.authLog.count({ where: { userId, loginSuccessful: true } });
    if (known <= 1 && previous > 1) {
      await this.mail.send(user.email, 'NewDeviceLogin', {
        name: user.name,
        ip: client.ip,
        userAgent: client.userAgent,
        time: new Date().toISOString(),
      });
    }
    return this.issue(userId, randomUUID(), client);
  }

  private async issue(userId: bigint, familyId: string, client: ClientInfo): Promise<SessionTokens> {
    // Roles/permissions are copied into the token only so the Next.js middleware can route
    // without a round trip; the API always re-loads them from the database.
    const me = await this.identity.load(userId);
    const accessToken = await this.jwt.signAsync(
      { sub: userId.toString(), typ: 'access', roles: me?.roles ?? [], perms: me?.permissions ?? [] },
      { secret: config.jwtAccessSecret, expiresIn: config.accessTtlSeconds },
    );
    const refreshToken = randomToken(48);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + config.refreshTtlSeconds * 1000),
        ip: client.ip,
        userAgent: client.userAgent,
      },
    });
    return { accessToken, refreshToken, csrfToken: randomToken(16) };
  }

  /** Rotating refresh tokens with reuse detection: replaying a used token revokes the family. */
  async refresh(refreshToken: string | undefined, client: ClientInfo): Promise<SessionTokens> {
    if (!refreshToken) throw Unauthorized('No session');
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (!row) throw Unauthorized('No session');
    if (row.revokedAt) {
      await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log({ actorId: row.userId, logName: 'auth', event: 'refresh-token-reuse', subjectType: 'user', subjectId: row.userId });
      throw Unauthorized('Session revoked');
    }
    if (row.expiresAt < new Date()) throw Unauthorized('Session expired');
    const user = await this.prisma.user.findFirst({ where: { id: row.userId, deletedAt: null } });
    if (!user) throw Unauthorized('No session');
    const next = await this.issue(row.userId, row.familyId, client);
    const nextRow = await this.prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256(next.refreshToken) } });
    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date(), replacedBy: nextRow.id } });
    return next;
  }

  async logout(refreshToken: string | undefined, userId?: bigint) {
    if (refreshToken) {
      const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
      if (row) await this.prisma.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    if (userId) {
      const last = await this.prisma.authLog.findFirst({ where: { userId, loginSuccessful: true, logoutAt: null }, orderBy: { loginAt: 'desc' } });
      if (last) await this.prisma.authLog.update({ where: { id: last.id }, data: { logoutAt: new Date() } });
    }
  }

  async forgotPassword(email: string) {
    const user = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    // Same response whether or not the account exists.
    if (!user) return;
    const token = randomToken();
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + HOUR) },
    });
    await this.mail.send(user.email, 'PasswordReset', { name: user.name, url: `${config.appUrl}/reset-password/${token}` });
    return token;
  }

  /** Also used by the "set password" link for newly added provider users. */
  async createPasswordToken(userId: bigint, hours = 72) {
    const token = randomToken();
    await this.prisma.passwordResetToken.create({
      data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + hours * HOUR) },
    });
    return token;
  }

  async resetPassword(token: string, password: string) {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.usedAt || row.expiresAt < new Date()) throw BadRequest('This password reset link is invalid or has expired.');
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      // A working reset link proves control of the mailbox.
      this.prisma.user.update({
        where: { id: row.userId },
        data: { passwordHash: await this.hash(password), emailVerifiedAt: new Date() },
      }),
      this.prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await this.audit.log({ actorId: row.userId, logName: 'auth', event: 'password-reset', subjectType: 'user', subjectId: row.userId });
  }

  async changePassword(userId: bigint, current: string, password: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await bcrypt.compare(current, user.passwordHash))) {
      throw new AppError('VALIDATION', 'The current password is incorrect.', 422, { fields: { currentPassword: 'The current password is incorrect.' } });
    }
    await this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await this.hash(password) } });
    await this.audit.log({ actorId: userId, logName: 'auth', event: 'password-changed', subjectType: 'user', subjectId: userId });
  }

  async confirmPassword(userId: bigint, password: string): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) throw Unauthorized('The provided password is incorrect.');
    return this.jwt.signAsync({ sub: userId.toString(), typ: 'confirm' }, { secret: config.jwtAccessSecret, expiresIn: 3 * 60 * 60 });
  }

  async isRecentlyConfirmed(userId: bigint, token: string | undefined): Promise<boolean> {
    if (!token) return false;
    try {
      const p = await this.jwt.verifyAsync<{ sub: string; typ: string }>(token, { secret: config.jwtAccessSecret });
      return p.typ === 'confirm' && p.sub === userId.toString();
    } catch {
      return false;
    }
  }
}
