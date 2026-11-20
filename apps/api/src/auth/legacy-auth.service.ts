import { Injectable, Logger } from '@nestjs/common';
import type { RoleName } from '@icpd/shared';
import { normalizeRegNo } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { config } from '../common/config';
import { AppError, Conflict, Unauthorized } from '../common/errors';
import { safeEqualHex, sha1 } from '../common/crypto';
import { AuditService } from '../audit/audit.service';
import { AuthService, type ClientInfo } from './auth.service';
import { IdentityService } from './identity.service';

/** Legacy role id → v4 roles, and whether the practitioner row should be removed (spec 6). */
export function rolesForLegacy(roleId: number | null | undefined): { roles: RoleName[]; dropPractitioner: boolean } {
  switch (roleId) {
    case 3:
    case 4:
      return { roles: ['Practitioner'], dropPractitioner: false };
    case 5:
      return { roles: ['Practitioner', 'Provider Coordinator'], dropPractitioner: false };
    case 10:
      return { roles: ['Provider Coordinator'], dropPractitioner: true };
    case 12:
      return { roles: ['Regulator CPD Officer'], dropPractitioner: true };
    default:
      return { roles: ['Public User'], dropPractitioner: false };
  }
}

export interface SsoProfile {
  email?: string;
  reg_no?: string;
  regNo?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
}

@Injectable()
export class LegacyAuthService {
  private readonly logger = new Logger('LegacyAuth');
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly identity: IdentityService,
    private readonly audit: AuditService,
  ) {}

  /**
   * /migrate: pre-2021 users sign in with reg. no. or email + their old password (sha1).
   * On success a modern account is created (bcrypt), linked, verified, given roles by the legacy
   * role id, and the legacy hash is cleared (defect #3).
   */
  async migrate(identifier: string, password: string, client: ClientInfo) {
    const id = identifier.trim();
    const where = id.includes('@') ? { email: id.toLowerCase() } : { regNo: normalizeRegNo(id) };
    const candidates = await this.prisma.practitioner.findMany({ where: { ...where, deletedAt: null }, select: { id: true } });
    const creds = await this.prisma.legacyCredential.findMany({ where: { practitionerId: { in: candidates.map((c) => c.id) }, usedAt: null } });
    const presented = sha1(password);
    const match = creds.find((c) => safeEqualHex(presented, c.sha1Hash.toLowerCase()));
    await this.prisma.authLog.create({ data: { email: id, ip: client.ip, userAgent: client.userAgent, loginSuccessful: !!match, location: 'migrate' } });
    if (!match) throw Unauthorized('These credentials do not match our records.');

    const p = await this.prisma.practitioner.findUniqueOrThrow({ where: { id: match.practitionerId } });
    if (p.userId) throw Conflict('This record is already linked to an account. Log in normally or reset your password.');
    const email = (p.email ?? '').toLowerCase();
    if (!email) throw new AppError('NO_EMAIL', 'This record has no email address. Contact the regulator to add one before activating your account.', 422);
    const { roles, dropPractitioner } = rolesForLegacy(match.legacyRoleId);
    const passwordHash = await this.auth.hash(password);

    const user = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) {
        const linked = await tx.practitioner.findFirst({ where: { userId: existing.id, deletedAt: null } });
        if (linked) throw Conflict('An account with this email already exists. Log in normally or reset your password.');
      }
      const u = existing
        ? await tx.user.update({ where: { id: existing.id }, data: { passwordHash, emailVerifiedAt: existing.emailVerifiedAt ?? new Date() } })
        : await tx.user.create({ data: { name: `${p.firstName} ${p.lastName}`, email, passwordHash, emailVerifiedAt: new Date(), categoryId: p.categoryId } });
      await this.identity.syncRoles(u.id, roles, tx);
      if (dropPractitioner) await tx.practitioner.update({ where: { id: p.id }, data: { deletedAt: new Date(), regNo: null } });
      else await tx.practitioner.update({ where: { id: p.id }, data: { userId: u.id, status: p.status === 'presubmission' ? 'registered' : p.status } });
      await tx.legacyCredential.update({ where: { id: match.id }, data: { sha1Hash: '', usedAt: new Date() } });
      return u;
    });
    await this.audit.log({ actorId: user.id, logName: 'auth', event: 'legacy-migrated', subjectType: 'practitioner', subjectId: p.id, properties: { roles, legacyRoleId: match.legacyRoleId } });
    return user;
  }

  // ── OSP SSO (OAuth2 authorization code, defect #1) ──
  authorizeUrl(state: string) {
    const s = config.sso;
    if (!s.server || !s.clientId) throw new AppError('SSO_DISABLED', 'OSP single sign-on is not configured.', 503);
    const q = new URLSearchParams({ client_id: s.clientId, redirect_uri: s.redirectUri, response_type: 'code', scope: process.env.SSO_SCOPE ?? '', state });
    return `${s.server.replace(/\/$/, '')}/oauth/authorize?${q}`;
  }

  /** Exchange the code at the SSO server and read the profile from it; never trust request input. */
  async exchange(code: string): Promise<SsoProfile> {
    const s = config.sso;
    const base = s.server.replace(/\/$/, '');
    const tokenRes = await fetch(`${base}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: s.clientId, client_secret: s.clientSecret, redirect_uri: s.redirectUri, code }),
    });
    if (!tokenRes.ok) throw Unauthorized('The sign-in server rejected the authorization code.');
    const { access_token } = (await tokenRes.json()) as { access_token?: string };
    if (!access_token) throw Unauthorized('The sign-in server returned no access token.');
    const userRes = await fetch(`${base}${process.env.SSO_USER_PATH ?? '/api/user'}`, { headers: { authorization: `Bearer ${access_token}`, accept: 'application/json' } });
    if (!userRes.ok) throw Unauthorized('Could not read your profile from the sign-in server.');
    return (await userRes.json()) as SsoProfile;
  }

  /** Find the practitioner by email or reg. no.; create/link the user and practitioner. */
  async signInFromSso(profile: SsoProfile) {
    const email = profile.email?.trim().toLowerCase();
    const regNo = normalizeRegNo(profile.reg_no ?? profile.regNo);
    if (!email) throw Unauthorized('The sign-in server did not provide an email address.');
    let p = await this.prisma.practitioner.findFirst({ where: { deletedAt: null, OR: [{ email }, ...(regNo ? [{ regNo }] : [])] }, orderBy: { id: 'asc' } });
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      const name = profile.name ?? [profile.first_name, profile.last_name].filter(Boolean).join(' ') ?? email;
      user = await this.prisma.user.create({ data: { name: name || email, email, emailVerifiedAt: new Date() } });
    } else if (!user.emailVerifiedAt) {
      user = await this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    }
    if (p && p.userId && p.userId !== user.id) throw Conflict('This practitioner record is linked to a different account. Contact the regulator.');
    if (!p) {
      const [first, ...rest] = (profile.first_name ?? profile.name ?? email.split('@')[0]).split(' ');
      p = await this.prisma.practitioner.create({
        data: { userId: user.id, email, regNo: regNo || null, firstName: profile.first_name ?? first, lastName: profile.last_name ?? (rest.join(' ') || '-'), status: 'registered', applicationStep: 'preview', dateRegistered: new Date() },
      });
    } else if (!p.userId) {
      p = await this.prisma.practitioner.update({ where: { id: p.id }, data: { userId: user.id, status: 'registered' } });
    }
    const roles = await this.identity.roleNames(user.id);
    if (!roles.includes('Practitioner')) {
      await this.identity.syncRoles(user.id, [...roles.filter((r) => r !== 'Public User'), 'Practitioner']);
    }
    await this.audit.log({ actorId: user.id, logName: 'auth', event: 'osp-sso-login', subjectType: 'practitioner', subjectId: p.id });
    return user;
  }
}
