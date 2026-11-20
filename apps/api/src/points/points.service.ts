import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type Activity, type ActivityType, type Practitioner } from '@prisma/client';
import {
  canStillEarn,
  claimCalYear,
  computeAward,
  isExpired,
  normalizeRegNo,
  type ActivityPointsInput,
  type RoleState,
} from '@icpd/shared';
import { PrismaService, num, type Tx } from '../common/prisma.service';
import { AppError } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { ComplianceService } from '../compliance/compliance.service';

export const MSG = {
  INVALID_TOKEN: 'Invalid Token',
  MAX_TOKEN_CLAIMS: 'You have made maximum allowed claims with tokens for this activity!!',
  TOKEN_CLAIMED: 'The token submitted is had been claimed',
  TOKEN_EXPIRED: 'The token submitted is expired!',
  NOT_PUBLISHED: 'Token invalid, contact the provider',
  MAX_POINTS: 'You have claimed maximum points for this activity.',
  REGNO_NOT_FOUND: 'Registration Number provided does not exist. Please confirm and try again or register on the portal.',
  MAX_CLAIMS_MADE: 'Max claims made',
} as const;

/** Claim-flow failure with a stable code; HTTP 422. */
export class ClaimError extends AppError {
  constructor(code: string, message: string) {
    super(code, message, 422);
  }
}

type ActivityWithType = Activity & { type: ActivityType };

export interface AwardResult {
  claimId: bigint;
  points: number;
  base: number;
  totalForActivity: number;
  calYear: number;
  markers: string[];
}

/**
 * The single points engine (spec 5.6). Pure rules live in @icpd/shared (computeAward,
 * canStillEarn, claimCalYear); this service adds locking, persistence, logs and compliance refresh.
 */
@Injectable()
export class PointsService {
  private readonly logger = new Logger('Points');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly compliance: ComplianceService,
  ) {}

  input(a: ActivityWithType): ActivityPointsInput {
    return {
      basePoints: num(a.type.cpdPoints),
      presenterPoints: num(a.type.presenterPoints),
      moderatorPoints: num(a.type.moderatorPoints),
      numSessions: a.numSessions,
      expiryDate: a.expiryDate,
    };
  }

  async roles(db: Tx | PrismaService, activityId: bigint, regNo: string | null): Promise<RoleState & { presenterIds: bigint[]; moderatorIds: bigint[] }> {
    if (!regNo) return { unawardedPresenter: false, unawardedModerator: false, presenterIds: [], moderatorIds: [] };
    const r = normalizeRegNo(regNo);
    const [p, m] = await Promise.all([
      db.activityPresenter.findMany({ where: { activityId, regNo: r, deletedAt: null, pointsAwarded: false }, select: { id: true } }),
      db.activityModerator.findMany({ where: { activityId, regNo: r, deletedAt: null, pointsAwarded: false }, select: { id: true } }),
    ]);
    return { unawardedPresenter: p.length > 0, unawardedModerator: m.length > 0, presenterIds: p.map((x) => x.id), moderatorIds: m.map((x) => x.id) };
  }

  async existingPoints(db: Tx | PrismaService, practitionerId: bigint, activityId: bigint): Promise<number | null> {
    const c = await db.cpdClaim.findFirst({ where: { practitionerId, activityId, deletedAt: null }, select: { cpdPoints: true } });
    return c ? num(c.cpdPoints) : null;
  }

  async canStillEarn(db: Tx | PrismaService, p: Practitioner, a: ActivityWithType) {
    const roles = await this.roles(db, a.id, p.regNo);
    return canStillEarn(await this.existingPoints(db, p.id, a.id), this.input(a), roles);
  }

  /**
   * Award one event for (P, A) inside a transaction. Serialises per (P, A) with an advisory lock
   * so concurrent claims can't both pass the max-points check.
   */
  async awardInTx(
    tx: Tx,
    p: Practitioner,
    a: ActivityWithType,
    o: { method: 'token' | 'attendance' | 'API'; token?: string; includeRoleBonus: boolean; actorId?: bigint | null; apiClaimId?: string },
  ): Promise<AwardResult> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`claim:${p.id}:${a.id}`}))`;
    const input = this.input(a);
    const roles = await this.roles(tx, a.id, p.regNo);
    const existing = await tx.cpdClaim.findFirst({ where: { practitionerId: p.id, activityId: a.id, deletedAt: null } });
    const effectiveRoles = o.includeRoleBonus ? roles : { ...roles, unawardedPresenter: false, unawardedModerator: false };
    const maxed = () => new ClaimError('MAX_POINTS', o.method === 'attendance' ? MSG.MAX_CLAIMS_MADE : MSG.MAX_POINTS);
    if (!canStillEarn(existing ? num(existing.cpdPoints) : null, input, effectiveRoles)) throw maxed();
    const existingBonus = existing
      ? num((await tx.cpdClaimEntry.aggregate({ where: { claimId: existing.id, kind: { in: ['presenter', 'moderator'] } }, _sum: { points: true } }))._sum.points)
      : 0;
    const marker = o.method === 'token' ? o.token! : o.method;
    const award = computeAward(input, effectiveRoles, { baseMarker: marker, includeRoleBonus: o.includeRoleBonus, existingPoints: existing ? num(existing.cpdPoints) : 0, existingBonus });
    if (award.total <= 0 && !award.markPresenterAwarded && !award.markModeratorAwarded) throw maxed();
    const calYear = claimCalYear(input);
    const markers = award.parts.map((x) => x.marker);
    const claim = existing
      ? await tx.cpdClaim.update({
          where: { id: existing.id },
          data: {
            cpdPoints: { increment: award.total },
            tokenTrail: [existing.tokenTrail, ...markers].filter(Boolean).join(' '),
            method: o.method,
            calYear,
            updatedBy: o.actorId ?? null,
          },
        })
      : await tx.cpdClaim.create({
          data: {
            practitionerId: p.id,
            activityId: a.id,
            method: o.method,
            methodSource: o.method === 'API' ? 'api' : o.method === 'attendance' ? 'attendeeImport' : 'portal',
            tokenTrail: markers.join(' '),
            cpdPoints: award.total,
            calYear,
            apiClaimId: o.apiClaimId,
            apiActivityName: o.method === 'API' ? a.name : null,
            createdBy: o.actorId ?? null,
          },
        });
    const specialityIds = (a.specializationAreas as number[]) ?? [];
    // The token is recorded on the base entry, or on the first entry when only a bonus was due.
    for (const [i, part] of award.parts.entries()) {
      await tx.cpdClaimEntry.create({
        data: {
          claimId: claim.id,
          kind: part.kind,
          source: o.method,
          token: i === 0 && o.method === 'token' ? o.token : null,
          points: part.points,
          activityTypeId: a.activityTypeId,
          specialityIds,
          calYear,
          createdBy: o.actorId ?? null,
        },
      });
    }
    const now = new Date();
    if (award.markPresenterAwarded && roles.presenterIds.length) {
      await tx.activityPresenter.updateMany({ where: { id: { in: roles.presenterIds } }, data: { pointsAwarded: true, dateProcessed: now } });
    }
    if (award.markModeratorAwarded && roles.moderatorIds.length) {
      await tx.activityModerator.updateMany({ where: { id: { in: roles.moderatorIds } }, data: { pointsAwarded: true, dateProcessed: now } });
    }
    return { claimId: claim.id, points: award.total, base: input.basePoints, totalForActivity: num(claim.cpdPoints), calYear, markers };
  }

  /** Recompute the cached compliance result after an award (never fails the award). */
  async afterAward(practitionerId: bigint, calYear: number) {
    try {
      await this.compliance.recompute(practitionerId, calYear);
    } catch (e: any) {
      this.logger.warn(`compliance recompute failed: ${e.message}`);
    }
  }

  private async log(practitionerId: bigint, type: 'claim_success' | 'claim_attempt', notes: string, actorId?: bigint | null) {
    await this.audit.practitionerLog(practitionerId, type, notes, actorId ?? null);
  }

  /**
   * Token claim (spec 5.6 steps 1-9). Used by the portal and, with `quick`, by the public QR page.
   */
  async claimToken(p: Practitioner, rawToken: string, o: { actorId?: bigint | null; quick?: boolean; activityId?: bigint } = {}) {
    const token = rawToken.replace(/\s+/g, '');
    const fail = async (code: string, message: string): Promise<never> => {
      await this.log(p.id, 'claim_attempt', `${o.quick ? 'Quick claim' : 'Token claim'} ${token}: ${message}`, o.actorId);
      throw new ClaimError(code, message);
    };
    const t = await this.prisma.activityToken.findFirst({
      where: { token, deletedAt: null, ...(o.activityId ? { activityId: o.activityId } : {}) },
      include: { activity: { include: { type: true } } },
    });
    if (!t || t.activity.deletedAt) return fail('INVALID_TOKEN', MSG.INVALID_TOKEN);
    const a = t.activity;
    const used = await this.prisma.activityToken.count({ where: { activityId: a.id, claimedBy: p.id, status: 'claimed' } });
    if (used >= Math.max(1, a.numSessions)) return fail('MAX_TOKEN_CLAIMS', MSG.MAX_TOKEN_CLAIMS);
    if (t.status === 'claimed') return fail('TOKEN_CLAIMED', MSG.TOKEN_CLAIMED);
    const enforceExpiry = o.quick ? await this.settings.quickClaimEnforceExpiry() : true;
    if (enforceExpiry && isExpired(t.expiryDate)) return fail('TOKEN_EXPIRED', MSG.TOKEN_EXPIRED);
    if (!a.published) return fail('NOT_PUBLISHED', MSG.NOT_PUBLISHED);
    if (!(await this.canStillEarn(this.prisma, p, a))) return fail('MAX_POINTS', MSG.MAX_POINTS);
    const spent = await this.prisma.cpdClaimEntry.findUnique({ where: { token } });
    if (spent) return fail('TOKEN_CLAIMED', MSG.TOKEN_CLAIMED);

    let result: AwardResult;
    try {
      result = await this.prisma.$transaction(async (tx) => {
        // Defect #8: lock the token row so two people can't claim it at once.
        const locked = await tx.$queryRaw<{ status: string }[]>`SELECT status::text AS status FROM activity_tokens WHERE id = ${t.id} FOR UPDATE`;
        if (locked[0]?.status !== 'unclaimed') throw new ClaimError('TOKEN_CLAIMED', MSG.TOKEN_CLAIMED);
        await tx.activityToken.update({ where: { id: t.id }, data: { status: 'claimed', claimedBy: p.id, claimedAt: new Date(), issued: true } });
        return this.awardInTx(tx, p, a, { method: 'token', token, includeRoleBonus: true, actorId: o.actorId });
      });
    } catch (e) {
      if (e instanceof ClaimError) return fail(e.code, e.message);
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return fail('TOKEN_CLAIMED', MSG.TOKEN_CLAIMED);
      throw e;
    }
    await this.log(p.id, 'claim_success', `${o.quick ? 'Quick claim' : 'Token claim'} ${token}: ${result.points} points for activity #${a.id} (${result.markers.join(' ')})`, o.actorId);
    await this.afterAward(p.id, result.calYear);
    return {
      ...result,
      activityId: a.id,
      activityName: a.name,
      message: `You have successfully claimed ${result.base} points for activity #${a.id}`,
    };
  }

  /** Attendance claim from an imported attendee row (spec 5.6). */
  async claimAttendance(p: Practitioner, a: ActivityWithType, actorId?: bigint | null) {
    try {
      const r = await this.prisma.$transaction((tx) => this.awardInTx(tx, p, a, { method: 'attendance', includeRoleBonus: true, actorId }));
      await this.log(p.id, 'claim_success', `Attendance: ${r.points} points for activity #${a.id}`, actorId);
      await this.afterAward(p.id, r.calYear);
      return r;
    } catch (e) {
      if (e instanceof ClaimError) await this.log(p.id, 'claim_attempt', `Attendance for activity #${a.id}: ${e.message}`, actorId);
      throw e;
    }
  }

  /** API claim by a provider system (spec 5.6/7): base points only, no role bonus. */
  async claimApi(p: Practitioner, a: ActivityWithType, apiClaimId?: string) {
    const r = await this.prisma.$transaction((tx) => this.awardInTx(tx, p, a, { method: 'API', includeRoleBonus: false, apiClaimId }));
    await this.log(p.id, 'claim_success', `API: ${r.points} points for activity #${a.id}`);
    await this.afterAward(p.id, r.calYear);
    return r;
  }
}
