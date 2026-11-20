import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { normalizeRegNo, parseDateOnly, type ActivityInput } from '@icpd/shared';
import { PrismaService, num } from '../common/prisma.service';
import { BadRequest, NotFound, Unprocessable } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';

export function sessionsOf(numSessions: number) {
  return Array.from({ length: Math.max(1, numSessions) }, (_, i) => ({
    sessionNo: i + 1,
    label: numSessions <= 1 ? 'Session 1 (Default)' : `Session ${i + 1}`,
  }));
}

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private async activeType(id: number) {
    const t = await this.prisma.activityType.findFirst({ where: { id, deletedAt: null, archived: false } });
    if (!t) throw Unprocessable('Pick an activity type that is currently available.', { fields: { activityTypeId: 'Not available' } }, 'VALIDATION');
    return t;
  }

  /** Spec 5.4: snapshot cpdPoints from the type, maxPoints = cpdPoints × numSessions. */
  snapshot(cpdPoints: Prisma.Decimal | number, numSessions: number) {
    const cpd = num(cpdPoints);
    return { cpdPoints: cpd, maxPoints: Math.round(cpd * Math.max(1, numSessions) * 100) / 100, multiSessions: numSessions > 1 };
  }

  async create(providerId: bigint, input: ActivityInput & Record<string, any>, actorId: bigint | null, extra: Record<string, any> = {}) {
    const type = await this.activeType(input.activityTypeId);
    const a = await this.prisma.activity.create({
      data: {
        providerId,
        activityTypeId: type.id,
        name: input.name,
        shortTitle: input.shortTitle ?? null,
        numSessions: input.numSessions,
        releaseDate: parseDateOnly(input.releaseDate),
        expiryDate: parseDateOnly(input.expiryDate),
        endTime: input.endTime ?? null,
        deliveryMode: input.deliveryMode,
        venue: input.venue ?? null,
        venueOnline: input.venueOnline || null,
        city: input.city ?? null,
        specializationAreas: input.specializationAreas ?? [],
        ...this.snapshot(type.cpdPoints, input.numSessions),
        createdBy: actorId,
        ...extra,
      },
    });
    const activityNo = `CPD-${input.releaseDate.slice(0, 4)}-${a.id.toString().padStart(6, '0')}`;
    await this.prisma.activity.update({ where: { id: a.id }, data: { activityNo } });
    await this.audit.log({ actorId, logName: 'activities', event: 'created', subjectType: 'activity', subjectId: a.id, properties: { providerId, ...input } });
    return { ...a, activityNo };
  }

  async update(activityId: bigint, input: ActivityInput & Record<string, any>, actorId: bigint | null, extra: Record<string, any> = {}) {
    const a = await this.prisma.activity.findFirstOrThrow({ where: { id: activityId, deletedAt: null } });
    const claims = await this.prisma.cpdClaim.count({ where: { activityId, deletedAt: null } });
    const typeChanged = a.activityTypeId !== input.activityTypeId;
    if (claims && (typeChanged || input.numSessions < a.numSessions)) {
      throw BadRequest('Points have already been claimed for this activity, so its type cannot change and sessions cannot be reduced.');
    }
    const type = typeChanged ? await this.activeType(input.activityTypeId) : await this.prisma.activityType.findUniqueOrThrow({ where: { id: a.activityTypeId } });
    const cpd = typeChanged ? type.cpdPoints : a.cpdPoints;
    const updated = await this.prisma.activity.update({
      where: { id: activityId },
      data: {
        activityTypeId: input.activityTypeId,
        name: input.name,
        shortTitle: input.shortTitle ?? null,
        numSessions: input.numSessions,
        releaseDate: parseDateOnly(input.releaseDate),
        expiryDate: parseDateOnly(input.expiryDate),
        endTime: input.endTime ?? null,
        deliveryMode: input.deliveryMode,
        venue: input.venue ?? null,
        venueOnline: input.venueOnline || null,
        city: input.city ?? null,
        specializationAreas: input.specializationAreas ?? [],
        ...this.snapshot(cpd, input.numSessions),
        updatedBy: actorId,
        ...extra,
      },
    });
    await this.audit.log({ actorId, logName: 'activities', event: 'updated', subjectType: 'activity', subjectId: activityId, properties: input });
    return updated;
  }

  async describe(activityId: bigint, input: Record<string, any>, actorId: bigint) {
    const a = await this.prisma.activity.update({ where: { id: activityId }, data: { ...input, updatedBy: actorId } });
    await this.audit.log({ actorId, logName: 'activities', event: 'description-updated', subjectType: 'activity', subjectId: activityId });
    return a;
  }

  /** Publish/unpublish with audit entries for both success and failed attempts (spec 5.4). */
  async setPublished(activityId: bigint, publish: boolean, actorId: bigint | null, via: 'web' | 'API' = 'web') {
    const event = publish ? 'publish' : 'unpublish';
    const a = await this.prisma.activity.findFirst({ where: { id: activityId, deletedAt: null }, include: { provider: true } });
    const fail = async (reason: string) => {
      await this.audit.log({ actorId, logName: 'activity-publishing', event: `${event}-attempt`, subjectType: 'activity', subjectId: activityId, description: reason, properties: { via, success: false } });
      throw BadRequest(reason);
    };
    if (!a) return fail('Activity not found');
    if (publish && a.archived) return fail('Archived activities cannot be published.');
    if (publish && a.provider.status !== 'active') return fail('The provider is not active, so its activities cannot be published.');
    if (publish === a.published) return fail(publish ? 'The activity is already published.' : 'The activity is not published.');
    const updated = await this.prisma.activity.update({
      where: { id: activityId },
      data: { published: publish, datePublished: publish ? new Date() : null, updatedBy: actorId },
    });
    await this.audit.log({ actorId, logName: 'activity-publishing', event, subjectType: 'activity', subjectId: activityId, properties: { via, success: true } });
    return updated;
  }

  async setArchived(activityId: bigint, archived: boolean, actorId: bigint) {
    const a = await this.prisma.activity.update({
      where: { id: activityId },
      data: { archived, dateArchived: archived ? new Date() : null, ...(archived ? { published: false, datePublished: null } : {}), updatedBy: actorId },
    });
    await this.audit.log({ actorId, logName: 'activities', event: archived ? 'archived' : 'unarchived', subjectType: 'activity', subjectId: activityId });
    return a;
  }

  async softDelete(activityId: bigint, actorId: bigint | null) {
    await this.prisma.activity.update({ where: { id: activityId }, data: { deletedAt: new Date(), deletedBy: actorId, published: false } });
    await this.audit.log({ actorId, logName: 'activities', event: 'deleted', subjectType: 'activity', subjectId: activityId });
  }

  async detail(activityId: bigint) {
    const a = await this.prisma.activity.findFirst({
      where: { id: activityId, deletedAt: null },
      include: { type: true, provider: { select: { id: true, name: true, status: true } } },
    });
    if (!a) throw NotFound('Activity');
    const [tokens, claimed, claims, imports] = await Promise.all([
      this.prisma.activityToken.count({ where: { activityId, deletedAt: null } }),
      this.prisma.activityToken.count({ where: { activityId, deletedAt: null, status: 'claimed' } }),
      this.prisma.cpdClaim.count({ where: { activityId, deletedAt: null } }),
      this.prisma.attendeeImport.groupBy({ by: ['status'], where: { activityId, deletedAt: null }, _count: true }),
    ]);
    return {
      ...a,
      sessions: sessionsOf(a.numSessions),
      stats: { tokens, claimedTokens: claimed, unclaimedTokens: tokens - claimed, claims, imports: Object.fromEntries(imports.map((i) => [i.status, i._count])) },
    };
  }

  // ── presenters & moderators ──
  async regNoOrFail(regNo: string) {
    const check = await this.settings.checkRegNo(regNo);
    if (!check.valid) throw Unprocessable(check.error!, { fields: { regNo: check.error } }, 'VALIDATION');
    return check.normalized;
  }

  /** Reg. no. is optional; when given it must be valid. Without one, no role bonus can be awarded. */
  private async optionalRegNo(regNo: string | null | undefined) {
    return regNo && regNo.trim() ? this.regNoOrFail(regNo) : null;
  }

  async lookupPractitioners(q: string) {
    const term = q.trim();
    if (term.length < 2) return [];
    const reg = normalizeRegNo(term);
    const words = term.split(/\s+/).filter(Boolean);
    const rows = await this.prisma.practitioner.findMany({
      where: {
        deletedAt: null,
        regNo: { not: null },
        OR: [
          { regNo: { startsWith: reg } },
          ...(words.length ? [{ AND: words.map((w) => ({ OR: [{ firstName: { contains: w, mode: 'insensitive' as const } }, { lastName: { contains: w, mode: 'insensitive' as const } }, { otherNames: { contains: w, mode: 'insensitive' as const } }] })) }] : []),
        ],
      },
      select: { id: true, regNo: true, titleId: true, firstName: true, otherNames: true, lastName: true, workplaceInstitution: true, status: true, specialization: { select: { name: true } } },
      orderBy: [{ regNo: 'asc' }],
      take: 10,
    });
    return rows.map((r) => ({ ...r, speciality: r.specialization?.name ?? null, specialization: undefined }));
  }

  async addPerson(kind: 'presenter' | 'moderator', activityId: bigint, input: Record<string, any>, actorId: bigint) {
    const regNo = await this.optionalRegNo(input.regNo);
    const model: any = kind === 'presenter' ? this.prisma.activityPresenter : this.prisma.activityModerator;
    if (regNo) {
      const dup = await model.findFirst({ where: { activityId, regNo, deletedAt: null } });
      if (dup) throw BadRequest(`This ${kind} is already on the activity.`);
    }
    const row = await model.create({ data: { ...input, regNo, activityId, createdBy: actorId } });
    await this.audit.log({ actorId, logName: 'activities', event: `${kind}-added`, subjectType: 'activity', subjectId: activityId, properties: { regNo } });
    return row;
  }

  async updatePerson(kind: 'presenter' | 'moderator', activityId: bigint, id: bigint, input: Record<string, any>, actorId: bigint) {
    const regNo = await this.optionalRegNo(input.regNo);
    const model: any = kind === 'presenter' ? this.prisma.activityPresenter : this.prisma.activityModerator;
    const row = await model.findFirst({ where: { id, activityId, deletedAt: null } });
    if (!row) throw NotFound(kind);
    if (row.pointsAwarded && row.regNo !== regNo) throw BadRequest(`Bonus points were already awarded to this ${kind}; the registration number cannot change.`);
    return model.update({ where: { id }, data: { ...input, regNo, updatedBy: actorId } });
  }

  async removePerson(kind: 'presenter' | 'moderator', activityId: bigint, id: bigint, actorId: bigint) {
    const model: any = kind === 'presenter' ? this.prisma.activityPresenter : this.prisma.activityModerator;
    const row = await model.findFirst({ where: { id, activityId, deletedAt: null } });
    if (!row) throw NotFound(kind);
    await model.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: actorId } });
    await this.audit.log({ actorId, logName: 'activities', event: `${kind}-removed`, subjectType: 'activity', subjectId: activityId, properties: { regNo: row.regNo } });
  }

  normalize(regNo: string) {
    return normalizeRegNo(regNo);
  }
}
