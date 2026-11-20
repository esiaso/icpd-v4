import { Injectable } from '@nestjs/common';
import { normalizeRegNo } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { Conflict, NotFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { DiaryService } from './diary.service';
import { ComplianceService } from '../compliance/compliance.service';

export const EXEMPTED_MSG = 'This practitioner/dentist has been Exempted for the specified year.';

/** Exemptions (spec 5.7): one per practitioner and year, with a points snapshot. */
@Injectable()
export class ExemptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly diary: DiaryService,
    private readonly compliance: ComplianceService,
  ) {}

  async create(input: { practitionerId?: bigint; regNo?: string; cpdYear: number; reason: string }, actorId: bigint | null, meta: { postType: 'FORM' | 'API'; ip?: string }) {
    const p = input.practitionerId
      ? await this.prisma.practitioner.findFirst({ where: { id: input.practitionerId, deletedAt: null } })
      : await this.prisma.practitioner.findFirst({ where: { regNo: normalizeRegNo(input.regNo), deletedAt: null } });
    if (!p) throw NotFound('Practitioner');
    const existing = await this.prisma.exemption.findFirst({ where: { practitionerId: p.id, cpdYear: input.cpdYear, deletedAt: null } });
    if (existing) {
      await this.audit.log({ actorId, logName: 'practitioner-excemption', event: 'exemption-attempt', subjectType: 'practitioner', subjectId: p.id, description: EXEMPTED_MSG, properties: { cpdYear: input.cpdYear } });
      throw Conflict(EXEMPTED_MSG);
    }
    const pointsAttained = await this.diary.points(p.id, input.cpdYear);
    const e = await this.prisma.exemption.create({
      data: { practitionerId: p.id, regNo: p.regNo, cpdYear: input.cpdYear, reason: input.reason, exemptedBy: actorId, pointsAttained, postType: meta.postType, ip: meta.ip, createdBy: actorId },
    });
    await this.audit.log({ actorId, logName: 'practitioner-excemption', event: 'exempted', subjectType: 'practitioner', subjectId: p.id, properties: { cpdYear: input.cpdYear, reason: input.reason, pointsAttained } });
    await this.compliance.recompute(p.id, input.cpdYear).catch(() => undefined);
    return e;
  }

  async remove(id: bigint, actorId: bigint) {
    const e = await this.prisma.exemption.findFirst({ where: { id, deletedAt: null } });
    if (!e) throw NotFound('Exemption');
    // Free the (practitioner, year) unique key so a corrected exemption can be recorded.
    await this.prisma.exemption.delete({ where: { id } });
    await this.audit.log({ actorId, logName: 'practitioner-excemption', event: 'exemption-removed', subjectType: 'practitioner', subjectId: e.practitionerId, properties: { cpdYear: e.cpdYear, reason: e.reason } });
    await this.compliance.recompute(e.practitionerId, e.cpdYear).catch(() => undefined);
  }

  /** API/council rule: exempted with < required points is reported as 50.00 points. */
  async reportedPoints(practitionerId: bigint, year: number, points: number, required = 50) {
    const ex = await this.prisma.exemption.findFirst({ where: { practitionerId, cpdYear: year, deletedAt: null } });
    if (ex && points < required) return { exempted: true, points: required };
    return { exempted: !!ex, points };
  }
}
