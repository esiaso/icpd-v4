import { Injectable, OnModuleInit } from '@nestjs/common';
import { parseDateOnly, nairobiToday, type RoleName } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { config } from '../common/config';
import { BadRequest, Conflict, NotFound } from '../common/errors';
import { randomToken } from '../common/crypto';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { IdentityService } from '../auth/identity.service';
import { AuthService } from '../auth/auth.service';
import { JobsService } from '../jobs/jobs.service';

const SYNCABLE: RoleName[] = ['Provider Coordinator', 'Practitioner', 'Public User'];

@Injectable()
export class ProvidersService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly identity: IdentityService,
    private readonly auth: AuthService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register('providers.yearly-reset', () => this.yearlyReset());
    // 1 January 00:00 Nairobi
    this.jobs.schedule('providers.yearly-reset', '0 0 1 1 *');
  }

  /**
   * Add a user to a provider (spec 3):
   * - existing user with only Provider Coordinator / Practitioner / Public User roles →
   *   sync to Practitioner + Provider Coordinator;
   * - existing user with any other role → refuse;
   * - new email → create user with Provider Coordinator, random password and a set-password email.
   */
  async addUser(providerId: bigint, input: { name: string; email: string }, actorId: bigint) {
    const provider = await this.prisma.provider.findFirst({ where: { id: providerId, deletedAt: null } });
    if (!provider) throw NotFound('Provider');
    const email = input.email.trim().toLowerCase();
    let user = await this.prisma.user.findFirst({ where: { email, deletedAt: null } });
    let setPasswordUrl: string | undefined;

    if (user) {
      const roles = await this.identity.roleNames(user.id);
      if (roles.some((r) => !SYNCABLE.includes(r))) throw Conflict('User exists with a different role');
      await this.identity.syncRoles(user.id, ['Practitioner', 'Provider Coordinator']);
    } else {
      user = await this.prisma.user.create({
        data: { name: input.name, email, passwordHash: await this.auth.hash(randomToken(24)), createdBy: actorId },
      });
      await this.identity.syncRoles(user.id, ['Provider Coordinator']);
      const token = await this.auth.createPasswordToken(user.id, 72);
      setPasswordUrl = `${config.appUrl}/reset-password/${token}`;
    }

    const existing = await this.prisma.providerUser.findFirst({ where: { providerId, userId: user.id, deletedAt: null } });
    if (existing) {
      if (existing.status === 'Active') throw Conflict('This user already belongs to the provider.');
      await this.prisma.providerUser.update({ where: { id: existing.id }, data: { status: 'Active', updatedBy: actorId } });
    } else {
      await this.prisma.providerUser.create({ data: { providerId, userId: user.id, status: 'Active', createdBy: actorId } });
    }
    await this.mail.send(user.email, 'NotifyProviderUser', {
      name: user.name,
      providerName: provider.name,
      setPasswordUrl,
      url: `${config.appUrl}/providers`,
    });
    await this.audit.log({ actorId, logName: 'providers', event: 'user-added', subjectType: 'provider', subjectId: providerId, properties: { userId: user.id, email } });
    return user;
  }

  async removeUser(providerId: bigint, providerUserId: bigint, actorId: bigint) {
    const row = await this.prisma.providerUser.findFirst({ where: { id: providerUserId, providerId, deletedAt: null } });
    if (!row) throw NotFound('Provider user');
    await this.prisma.providerUser.update({ where: { id: row.id }, data: { status: 'Inactive', deletedAt: new Date(), deletedBy: actorId } });
    // Drop the coordinator role when the user no longer coordinates any provider.
    const still = await this.prisma.providerUser.count({ where: { userId: row.userId, status: 'Active', deletedAt: null } });
    if (!still) await this.identity.removeRole(row.userId, 'Provider Coordinator');
    await this.audit.log({ actorId, logName: 'providers', event: 'user-removed', subjectType: 'provider', subjectId: providerId, properties: { userId: row.userId } });
  }

  async changeStatus(providerId: bigint, input: { status: string; effectiveDate: string; notes?: string | null }, actorId: bigint | null) {
    const effectiveDate = parseDateOnly(input.effectiveDate);
    await this.prisma.$transaction([
      this.prisma.providerStatusHistory.create({ data: { providerId, status: input.status, notes: input.notes ?? null, effectiveDate, createdBy: actorId } }),
      this.prisma.provider.update({ where: { id: providerId }, data: { status: input.status, effectiveDate, updatedBy: actorId } }),
    ]);
    await this.audit.log({ actorId, logName: 'providers', event: 'status-changed', subjectType: 'provider', subjectId: providerId, properties: input });
  }

  /** 1 January: every provider becomes inactive until re-accredited (spec 5.9). */
  async yearlyReset() {
    const providers = await this.prisma.provider.findMany({ where: { deletedAt: null, status: { not: 'inactive' } }, select: { id: true } });
    const today = nairobiToday();
    for (const p of providers) {
      await this.changeStatus(p.id, { status: 'inactive', effectiveDate: today, notes: 'Reset end of year' }, null);
    }
    return { deactivated: providers.length };
  }

  async myProviders(userId: bigint) {
    const rows = await this.prisma.providerUser.findMany({
      where: { userId, status: 'Active', deletedAt: null, provider: { deletedAt: null } },
      include: { provider: { select: { id: true, name: true, status: true, logoUrl: true, town: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => r.provider);
  }

  async dashboard(providerId: bigint) {
    const [activities, published, archived, tokens, claimed, claims, points, pendingImports] = await Promise.all([
      this.prisma.activity.count({ where: { providerId, deletedAt: null } }),
      this.prisma.activity.count({ where: { providerId, deletedAt: null, published: true } }),
      this.prisma.activity.count({ where: { providerId, deletedAt: null, archived: true } }),
      this.prisma.activityToken.count({ where: { activity: { providerId }, deletedAt: null } }),
      this.prisma.activityToken.count({ where: { activity: { providerId }, deletedAt: null, status: 'claimed' } }),
      this.prisma.cpdClaim.count({ where: { activity: { providerId }, deletedAt: null } }),
      this.prisma.cpdClaim.aggregate({ where: { activity: { providerId }, deletedAt: null }, _sum: { cpdPoints: true } }),
      this.prisma.attendeeImport.count({ where: { activity: { providerId }, deletedAt: null, status: 'unprocessed' } }),
    ]);
    const recent = await this.prisma.activity.findMany({
      where: { providerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, name: true, published: true, releaseDate: true, expiryDate: true, _count: { select: { tokens: true, claims: true } } },
    });
    return {
      activities,
      published,
      archived,
      tokens,
      claimedTokens: claimed,
      unclaimedTokens: tokens - claimed,
      claims,
      pointsAwarded: points._sum.cpdPoints ?? 0,
      pendingImports,
      recent,
    };
  }

  validateStatus(status: string) {
    if (!['active', 'inactive', 'suspended'].includes(status)) throw BadRequest('Unknown status');
  }
}
