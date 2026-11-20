import { Injectable } from '@nestjs/common';
import { checkTypeCaps, dateOnly, parseDateOnly, type NonTokenClaimInput } from '@icpd/shared';
import { PrismaService, num } from '../common/prisma.service';
import { BadRequest, Conflict, NotFound, Unprocessable } from '../common/errors';
import { config } from '../common/config';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService, type UploadedFile } from '../storage/storage.service';
import { ComplianceService } from '../compliance/compliance.service';

/** Non-token claims with evidence (spec 5.6 "Non-token claim"). */
@Injectable()
export class NonTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    private readonly compliance: ComplianceService,
  ) {}

  private async validate(practitionerId: bigint, input: NonTokenClaimInput, exceptId?: bigint) {
    const type = await this.prisma.activityType.findFirst({ where: { id: input.activityTypeId, deletedAt: null, archived: false } });
    if (!type) throw Unprocessable('Pick an activity type that is currently available.', { fields: { activityTypeId: 'Not available' } }, 'VALIDATION');
    const dup = await this.prisma.nonTokenClaim.findFirst({
      where: {
        practitionerId,
        activityTypeId: input.activityTypeId,
        activityName: { equals: input.activityName, mode: 'insensitive' },
        beginDate: parseDateOnly(input.beginDate),
        deletedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (dup) throw Conflict('You have already submitted this claim.');
    // Defect #9: parameterised and scoped to "once" types only.
    if (type.claimCondition === 'once') {
      const year = Number(input.endDate.slice(0, 4));
      const similar = await this.prisma.nonTokenClaim.findFirst({
        where: {
          practitionerId,
          deletedAt: null,
          status: { notIn: ['Rejected', 'No'] },
          activityType: { claimCondition: 'once' },
          endDate: { gte: parseDateOnly(`${year}-01-01`), lte: parseDateOnly(`${year}-12-31`) },
          ...(exceptId ? { id: { not: exceptId } } : {}),
        },
      });
      if (similar) throw Unprocessable('You have made a similar type of claim for the same period');
    }
    const allowed = await this.allowedSpecialities(practitionerId);
    const bad = input.specialityIds.filter((s) => !allowed.includes(s));
    if (bad.length) throw Unprocessable('Pick one of your specialities, or General / other.', { fields: { specialityIds: 'Not one of your specialities' } }, 'VALIDATION');
    return type;
  }

  async allowedSpecialities(practitionerId: bigint): Promise<number[]> {
    const p = await this.prisma.practitioner.findUniqueOrThrow({ where: { id: practitionerId }, include: { specialities: true } });
    return [...new Set([p.specializationId, ...p.specialities.map((s) => s.specialityId)].filter((x): x is number => x !== null))];
  }

  async create(practitionerId: bigint, input: NonTokenClaimInput, file: UploadedFile | undefined, actorId: bigint) {
    this.storage.validate(file, 'pdf', config.maxUploadBytes);
    const type = await this.validate(practitionerId, input);
    const key = await this.storage.put('evidence', file!);
    const c = await this.prisma.nonTokenClaim.create({
      data: {
        practitionerId,
        activityTypeId: type.id,
        activityName: input.activityName,
        description: input.description,
        beginDate: parseDateOnly(input.beginDate),
        endDate: parseDateOnly(input.endDate),
        place: input.place,
        specialityIds: input.specialityIds,
        evidenceUrl: key,
        status: 'Pending',
        createdBy: actorId,
      },
    });
    await this.audit.practitionerLog(practitionerId, 'nontoken_submitted', `Non-token claim #${c.id}: ${c.activityName}`, actorId);
    return c;
  }

  /** Defect #10: the new evidence file is saved before the record is updated. Editing resets to Pending. */
  async update(practitionerId: bigint, id: bigint, input: NonTokenClaimInput, file: UploadedFile | undefined, actorId: bigint) {
    const c = await this.prisma.nonTokenClaim.findFirst({ where: { id, practitionerId, deletedAt: null } });
    if (!c) throw NotFound('Claim');
    if (c.status === 'Yes') throw BadRequest('Approved claims cannot be edited.');
    await this.validate(practitionerId, input, id);
    let evidenceUrl = c.evidenceUrl;
    if (file) {
      this.storage.validate(file, 'pdf', config.maxUploadBytes);
      evidenceUrl = await this.storage.put('evidence', file);
    }
    const updated = await this.prisma.nonTokenClaim.update({
      where: { id },
      data: {
        activityTypeId: input.activityTypeId,
        activityName: input.activityName,
        description: input.description,
        beginDate: parseDateOnly(input.beginDate),
        endDate: parseDateOnly(input.endDate),
        place: input.place,
        specialityIds: input.specialityIds,
        evidenceUrl,
        status: 'Pending',
        rejectedAt: null,
        rejectedBy: null,
        updatedBy: actorId,
      },
    });
    await this.audit.practitionerLog(practitionerId, 'nontoken_edited', `Non-token claim #${id} edited`, actorId);
    return updated;
  }

  async remove(practitionerId: bigint, id: bigint, actorId: bigint) {
    const c = await this.prisma.nonTokenClaim.findFirst({ where: { id, practitionerId, deletedAt: null } });
    if (!c) throw NotFound('Claim');
    if (c.status === 'Yes') throw BadRequest('Approved claims cannot be deleted.');
    await this.prisma.nonTokenClaim.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: actorId } });
  }

  /** Regulator award: creates the diary entry (method nontoken), classified for compliance. */
  async award(id: bigint, input: { points: number; specialityIds?: number[] }, actorId: bigint) {
    const c = await this.prisma.nonTokenClaim.findFirst({ where: { id, deletedAt: null }, include: { activityType: true } });
    if (!c) throw NotFound('Claim');
    if (c.status === 'Yes') throw BadRequest('This claim has already been approved.');
    const calYear = Number(dateOnly(c.endDate).slice(0, 4));
    if (await this.settings.enforceTypeCaps()) {
      const ytd = await this.prisma.cpdClaimEntry.aggregate({
        where: { calYear, activityTypeId: c.activityTypeId, claim: { practitionerId: c.practitionerId, deletedAt: null, method: 'nontoken' } },
        _sum: { points: true },
      });
      const check = checkTypeCaps({
        requestedPoints: input.points,
        maxSessionPoints: c.activityType.maxSessionPoints ? num(c.activityType.maxSessionPoints) : null,
        maxActivityPoints: c.activityType.maxActivityPoints ? num(c.activityType.maxActivityPoints) : null,
        maxYearlyPoints: c.activityType.maxYearlyPoints ? num(c.activityType.maxYearlyPoints) : null,
        yearToDatePointsOfType: num(ytd._sum.points),
      });
      if (!check.ok) throw Unprocessable(check.error, { fields: { points: check.error } }, 'TYPE_CAP');
    } else if (!(input.points > 0)) {
      throw Unprocessable('Points must be greater than zero.');
    }
    const specialityIds = input.specialityIds ?? ((c.specialityIds as number[]) ?? []);
    await this.prisma.$transaction(async (tx) => {
      const claim = await tx.cpdClaim.create({
        data: {
          practitionerId: c.practitionerId,
          nonTokenClaimId: c.id,
          method: 'nontoken',
          methodSource: 'nonTokenUserInitiated',
          tokenTrail: 'nontoken',
          cpdPoints: input.points,
          calYear,
          claimedAt: c.claimDate,
          createdBy: actorId,
        },
      });
      await tx.cpdClaimEntry.create({
        data: { claimId: claim.id, kind: 'base', source: 'nontoken', points: input.points, activityTypeId: c.activityTypeId, specialityIds, calYear, createdBy: actorId },
      });
      await tx.nonTokenClaim.update({ where: { id }, data: { status: 'Yes', approvedAt: new Date(), approvedBy: actorId, specialityIds, updatedBy: actorId } });
    });
    await this.audit.log({ actorId, logName: 'claims', event: 'nontoken-awarded', subjectType: 'non_token_claim', subjectId: id, properties: input });
    await this.audit.practitionerLog(c.practitionerId, 'claim_success', `Non-token claim #${id} approved: ${input.points} points`, actorId);
    await this.compliance.recompute(c.practitionerId, calYear).catch(() => undefined);
  }

  async reject(id: bigint, reason: string, actorId: bigint) {
    const c = await this.prisma.nonTokenClaim.findFirst({ where: { id, deletedAt: null }, include: { practitioner: true } });
    if (!c) throw NotFound('Claim');
    if (c.status === 'Yes') throw BadRequest('Approved claims cannot be rejected.');
    await this.prisma.$transaction([
      this.prisma.comment.create({ data: { profilePractitionerId: c.practitionerId, authorUserId: actorId, comment: reason, type: 'Non-Token Claim', itemId: id } }),
      this.prisma.nonTokenClaim.update({ where: { id }, data: { status: 'Rejected', rejectedAt: new Date(), rejectedBy: actorId, updatedBy: actorId } }),
    ]);
    await this.mail.send(c.practitioner.email, 'NotifyClaimRejection', {
      name: c.practitioner.firstName,
      activityName: c.activityName,
      claimDate: dateOnly(c.claimDate),
      reason,
    });
    await this.audit.log({ actorId, logName: 'claims', event: 'nontoken-rejected', subjectType: 'non_token_claim', subjectId: id, properties: { reason } });
  }
}
