import { Injectable } from '@nestjs/common';
import { nairobiYear, normalizeRegNo, parseDateOnly } from '@icpd/shared';
import { Prisma } from '@prisma/client';
import { PrismaService, num } from '../common/prisma.service';
import { BadRequest, NotFound } from '../common/errors';
import { sha1, randomToken } from '../common/crypto';
import { AuditService } from '../audit/audit.service';
import { ComplianceService } from '../compliance/compliance.service';
import { SettingsService } from '../settings/settings.service';

/** Regulator practitioner records, duplicates and merge (spec 5.8). */
@Injectable()
export class PractitionersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly compliance: ComplianceService,
    private readonly settings: SettingsService,
  ) {}

  async detail(id: bigint, includeDeleted = false) {
    const p = await this.prisma.practitioner.findFirst({
      where: { id, ...(includeDeleted ? {} : { deletedAt: null }) },
      include: {
        user: { select: { id: true, email: true, lastLoginAt: true, emailVerifiedAt: true } },
        category: true,
        specialization: { select: { id: true, name: true } },
        specialities: { include: { speciality: { select: { id: true, name: true } } } },
        academics: { where: { deletedAt: null } },
        facilities: { where: { deletedAt: null } },
        exemptions: { where: { deletedAt: null }, orderBy: { cpdYear: 'desc' } },
      },
    });
    if (!p) throw NotFound('Practitioner');
    const [pointsByYear, legacy, logs] = await Promise.all([
      this.prisma.cpdClaim.groupBy({ by: ['calYear'], where: { practitionerId: id, deletedAt: null }, _sum: { cpdPoints: true }, _count: true, orderBy: { calYear: 'desc' } }),
      this.prisma.legacyCredential.findUnique({ where: { practitionerId: id }, select: { usedAt: true } }),
      this.prisma.practitionerLog.findMany({ where: { practitionerId: id }, orderBy: { logDate: 'desc' }, take: 30 }),
    ]);
    return {
      ...p,
      pointsByYear: pointsByYear.map((r) => ({ year: r.calYear, points: num(r._sum.cpdPoints), claims: r._count })),
      hasLegacyCredential: !!legacy && !legacy.usedAt,
      logs,
    };
  }

  async update(id: bigint, input: Record<string, any>, actorId: bigint) {
    const before = await this.prisma.practitioner.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw NotFound('Practitioner');
    let regNo = before.regNo;
    if (input.regNo !== undefined && normalizeRegNo(input.regNo) !== before.regNo) {
      const check = await this.settings.checkRegNo(input.regNo);
      if (!check.valid) throw BadRequest(check.error!);
      const clash = await this.prisma.practitioner.findFirst({ where: { regNo: check.normalized, deletedAt: null, id: { not: id } } });
      if (clash) throw BadRequest('Registration number already exist!');
      regNo = check.normalized;
    }
    const data: Prisma.PractitionerUncheckedUpdateInput = { ...input, regNo, dob: input.dob ? parseDateOnly(input.dob) : input.dob === null ? null : undefined, updatedBy: actorId };
    const p = await this.prisma.practitioner.update({ where: { id }, data });
    const changed = Object.fromEntries(Object.entries(input).filter(([k, v]) => String((before as any)[k] ?? '') !== String(v ?? '')).map(([k, v]) => [k, { from: (before as any)[k], to: v }]));
    await this.audit.log({ actorId, logName: 'practitioners', event: 'updated', subjectType: 'practitioner', subjectId: id, properties: changed });
    if ('specializationId' in input || 'categoryId' in input) await this.compliance.recompute(id, nairobiYear()).catch(() => undefined);
    return p;
  }

  async softDelete(id: bigint, actorId: bigint) {
    await this.prisma.practitioner.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: actorId } });
    await this.audit.log({ actorId, logName: 'practitioners', event: 'deleted', subjectType: 'practitioner', subjectId: id });
  }

  async restore(id: bigint, actorId: bigint) {
    const p = await this.prisma.practitioner.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!p) throw NotFound('Deleted practitioner');
    if (p.regNo && (await this.prisma.practitioner.findFirst({ where: { regNo: p.regNo, deletedAt: null } }))) {
      throw BadRequest('Another live practitioner uses this registration number; merge instead of restoring.');
    }
    await this.prisma.practitioner.update({ where: { id }, data: { deletedAt: null, deletedBy: null, updatedBy: actorId } });
    await this.audit.log({ actorId, logName: 'practitioners', event: 'restored', subjectType: 'practitioner', subjectId: id });
  }

  /** Permanent delete only for trashed records without CPD history. */
  async destroy(id: bigint, actorId: bigint) {
    const p = await this.prisma.practitioner.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!p) throw BadRequest('Move the practitioner to the trash first.');
    const history = await this.prisma.cpdClaim.count({ where: { practitionerId: id } }) + (await this.prisma.nonTokenClaim.count({ where: { practitionerId: id } }));
    if (history) throw BadRequest('This record has CPD history and cannot be permanently deleted. Merge it into the correct record instead.');
    await this.prisma.$transaction([
      this.prisma.activityToken.updateMany({ where: { claimedBy: id }, data: { claimedBy: null } }),
      this.prisma.exemption.deleteMany({ where: { practitionerId: id } }),
      this.prisma.legacyCredential.deleteMany({ where: { practitionerId: id } }),
      this.prisma.practitioner.delete({ where: { id } }),
    ]);
    await this.audit.log({ actorId, logName: 'practitioners', event: 'permanently-deleted', subjectType: 'practitioner', subjectId: id, properties: { regNo: p.regNo, name: `${p.firstName} ${p.lastName}` } });
  }

  async duplicates(page: number, pageSize: number, search?: string) {
    const like = search ? `%${normalizeRegNo(search)}%` : '%';
    const rows = await this.prisma.$queryRaw<{ regNo: string; count: bigint }[]>`
      SELECT "regNo", COUNT(*) AS count FROM practitioners
      WHERE "deletedAt" IS NULL AND "regNo" IS NOT NULL AND "regNo" <> '' AND "regNo" ILIKE ${like}
      GROUP BY "regNo" HAVING COUNT(*) > 1 ORDER BY COUNT(*) DESC, "regNo" LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    const [{ total }] = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(*) AS total FROM (SELECT 1 FROM practitioners WHERE "deletedAt" IS NULL AND "regNo" IS NOT NULL AND "regNo" <> '' AND "regNo" ILIKE ${like} GROUP BY "regNo" HAVING COUNT(*) > 1) t`;
    const groups = await Promise.all(
      rows.map(async (r) => ({
        regNo: r.regNo,
        count: Number(r.count),
        records: await this.prisma.practitioner.findMany({
          where: { regNo: r.regNo, deletedAt: null },
          select: { id: true, firstName: true, lastName: true, email: true, nationalId: true, status: true, userId: true, dateRegistered: true, _count: { select: { claims: { where: { deletedAt: null } }, nonTokenClaims: { where: { deletedAt: null } } } } },
          orderBy: { id: 'asc' },
        }),
      })),
    );
    return { data: groups, total: Number(total), page, pageSize };
  }

  /**
   * Merge duplicates into a target (spec 5.8): move token claimedBy, non-token claims and
   * cpd_claims; claims for the same activity are combined into one row (fix); the others lose
   * their reg. no. and are soft-deleted. One transaction, audited.
   */
  async merge(targetId: bigint, sourceIds: bigint[], actorId: bigint) {
    const sources = sourceIds.filter((s) => s !== targetId);
    if (!sources.length) throw BadRequest('Choose at least one other record to merge.');
    const target = await this.prisma.practitioner.findFirst({ where: { id: targetId, deletedAt: null } });
    if (!target) throw NotFound('Target practitioner');
    const found = await this.prisma.practitioner.findMany({ where: { id: { in: sources }, deletedAt: null } });
    if (found.length !== sources.length) throw NotFound('Practitioner to merge');
    // If both have login accounts, the target's account keeps the practitioner link.
    const years = new Set<number>();
    const summary = await this.prisma.$transaction(async (tx) => {
      let combined = 0;
      let moved = 0;
      await tx.activityToken.updateMany({ where: { claimedBy: { in: sources } }, data: { claimedBy: targetId } });
      await tx.nonTokenClaim.updateMany({ where: { practitionerId: { in: sources } }, data: { practitionerId: targetId } });
      const claims = await tx.cpdClaim.findMany({ where: { practitionerId: { in: sources }, deletedAt: null } });
      for (const c of claims) {
        years.add(c.calYear);
        const same = c.activityId ? await tx.cpdClaim.findFirst({ where: { practitionerId: targetId, activityId: c.activityId, deletedAt: null } }) : null;
        if (same) {
          await tx.cpdClaimEntry.updateMany({ where: { claimId: c.id }, data: { claimId: same.id } });
          await tx.cpdClaim.update({
            where: { id: same.id },
            data: { cpdPoints: { increment: c.cpdPoints }, tokenTrail: [same.tokenTrail, c.tokenTrail].filter(Boolean).join(' '), calYear: Math.min(same.calYear, c.calYear), updatedBy: actorId },
          });
          await tx.cpdClaim.update({ where: { id: c.id }, data: { deletedAt: new Date(), deletedBy: actorId, cpdPoints: 0 } });
          combined++;
        } else {
          await tx.cpdClaim.update({ where: { id: c.id }, data: { practitionerId: targetId, updatedBy: actorId } });
          moved++;
        }
      }
      for (const e of await tx.exemption.findMany({ where: { practitionerId: { in: sources }, deletedAt: null } })) {
        const clash = await tx.exemption.findFirst({ where: { practitionerId: targetId, cpdYear: e.cpdYear } });
        if (clash) await tx.exemption.delete({ where: { id: e.id } });
        else await tx.exemption.update({ where: { id: e.id }, data: { practitionerId: targetId } });
        years.add(e.cpdYear);
      }
      await tx.practitionerLog.updateMany({ where: { practitionerId: { in: sources } }, data: { practitionerId: targetId } });
      const sourceUser = found.find((s) => s.userId)?.userId ?? null;
      await tx.practitioner.updateMany({ where: { id: { in: sources } }, data: { regNo: null, deletedAt: new Date(), deletedBy: actorId, userId: null } });
      if (!target.userId && sourceUser) await tx.practitioner.update({ where: { id: targetId }, data: { userId: sourceUser } });
      return { moved, combined };
    });
    await this.audit.log({ actorId, logName: 'practitioners', event: 'merged', subjectType: 'practitioner', subjectId: targetId, properties: { sources: sources.map(String), ...summary } });
    for (const y of years) await this.compliance.recompute(targetId, y).catch(() => undefined);
    return { ...summary, merged: sources.length };
  }

  /**
   * Reset a legacy (pre-2021) password: store a new temporary sha1 credential the practitioner
   * uses once on /migrate, where it is replaced by a modern hash.
   */
  async resetLegacyPassword(id: bigint, actorId: bigint) {
    const p = await this.prisma.practitioner.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw NotFound('Practitioner');
    if (p.userId) throw BadRequest('This practitioner already has a modern account; use "forgot password" instead.');
    const temp = randomToken(5);
    await this.prisma.legacyCredential.upsert({
      where: { practitionerId: id },
      create: { practitionerId: id, sha1Hash: sha1(temp), legacyRoleId: 3 },
      update: { sha1Hash: sha1(temp), usedAt: null },
    });
    await this.audit.log({ actorId, logName: 'practitioners', event: 'legacy-password-reset', subjectType: 'practitioner', subjectId: id });
    return { temporaryPassword: temp };
  }
}
