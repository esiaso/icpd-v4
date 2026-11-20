import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  evaluateCompliance,
  nairobiYear,
  pickFramework,
  previewCapWarning,
  round2,
  summarizeByType,
  type ComplianceEntry,
  type ComplianceEvaluation,
  type ComplianceFramework,
  type PractitionerProfileForCompliance,
} from '@icpd/shared';
import { PrismaService, num } from '../common/prisma.service';
import { config } from '../common/config';
import { SettingsService } from '../settings/settings.service';
import { JobsService } from '../jobs/jobs.service';

type DbFramework = Awaited<ReturnType<ComplianceService['loadFrameworks']>>[number];

export function toFramework(f: any): ComplianceFramework {
  return {
    id: f.id ?? null,
    name: f.name,
    scope: f.scope,
    specialityId: f.specialityId ?? null,
    userCategoryId: f.userCategoryId ?? null,
    totalRequiredPoints: num(f.totalRequiredPoints),
    cpdYearFrom: f.cpdYearFrom,
    cpdYearTo: f.cpdYearTo ?? null,
    active: f.active ?? true,
    buckets: (f.buckets ?? []).map((b: any) => ({
      id: b.id,
      name: b.name,
      source: b.source,
      minPoints: num(b.minPoints),
      maxCountablePoints: b.maxCountablePoints === null || b.maxCountablePoints === undefined ? null : num(b.maxCountablePoints),
      minDistinctActivityTypes: b.minDistinctActivityTypes ?? 0,
      maxPointsPerActivityType: b.maxPointsPerActivityType === null || b.maxPointsPerActivityType === undefined ? null : num(b.maxPointsPerActivityType),
      allowOverflowTo: b.allowOverflowTo ?? null,
      sortOrder: b.sortOrder ?? 0,
    })),
    typeCaps: (f.typeCaps ?? []).map((c: any) => ({
      bucketId: c.bucketId ?? null,
      activityTypeId: c.activityTypeId,
      maxPoints: num(c.maxPoints),
      minPoints: c.minPoints === null || c.minPoints === undefined ? null : num(c.minPoints),
    })),
  };
}

export interface PractitionerCompliance {
  year: number;
  framework: ComplianceFramework;
  evaluation: ComplianceEvaluation;
  exemption: { reason: string; dateExempted: Date } | null;
  typeNames: Record<number, string>;
  entries: (ComplianceEntry & { claimId: bigint })[];
}

/** Compliance rules engine wiring (spec 5.7.2). The rules themselves are pure, in @icpd/shared. */
@Injectable()
export class ComplianceService implements OnModuleInit {
  private readonly logger = new Logger('Compliance');
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly jobs: JobsService,
  ) {}

  onModuleInit() {
    this.jobs.register('compliance.recompute-all', (d, progress) => this.recomputeAll(d.year ?? nairobiYear(), progress));
    // Nightly at 01:30 Nairobi
    this.jobs.schedule('compliance.recompute-all', '30 1 * * *');
  }

  loadFrameworks() {
    return this.prisma.complianceFramework.findMany({
      where: { deletedAt: null },
      include: { buckets: true, typeCaps: true },
      orderBy: { cpdYearFrom: 'desc' },
    });
  }

  async typeNames(): Promise<Record<number, string>> {
    const types = await this.prisma.activityType.findMany({ select: { id: true, name: true } });
    return Object.fromEntries(types.map((t) => [t.id, t.name]));
  }

  async profile(practitionerId: bigint): Promise<PractitionerProfileForCompliance> {
    const p = await this.prisma.practitioner.findUniqueOrThrow({
      where: { id: practitionerId },
      include: { specialities: { select: { specialityId: true, isPrimary: true } } },
    });
    const primary = p.specializationId ?? p.specialities.find((s) => s.isPrimary)?.specialityId ?? null;
    return { primarySpecialityId: primary, specialityIds: p.specialities.map((s) => s.specialityId), userCategoryId: p.categoryId };
  }

  async entries(practitionerId: bigint, year: number) {
    const rows = await this.prisma.cpdClaimEntry.findMany({
      where: { calYear: year, claim: { practitionerId, deletedAt: null } },
      select: { id: true, claimId: true, activityTypeId: true, specialityIds: true, points: true, awardedAt: true },
      orderBy: { awardedAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id.toString(),
      claimId: r.claimId,
      activityTypeId: r.activityTypeId,
      specialityIds: ((r.specialityIds as number[]) ?? []).map(Number),
      points: num(r.points),
      date: r.awardedAt.toISOString(),
    }));
  }

  async frameworkFor(practitionerId: bigint, year: number, frameworks?: DbFramework[]): Promise<ComplianceFramework> {
    const all = (frameworks ?? (await this.loadFrameworks())).map(toFramework);
    return pickFramework(all, await this.profile(practitionerId), year, {
      multiSpecialityMode: await this.settings.multiSpecialityMode(),
      defaultRequired: config.annualRequirement,
    });
  }

  async evaluate(practitionerId: bigint, year: number, frameworks?: DbFramework[], typeNames?: Record<number, string>): Promise<PractitionerCompliance> {
    const [framework, entries, exemption, names] = await Promise.all([
      this.frameworkFor(practitionerId, year, frameworks),
      this.entries(practitionerId, year),
      this.prisma.exemption.findFirst({ where: { practitionerId, cpdYear: year, deletedAt: null }, select: { reason: true, dateExempted: true } }),
      typeNames ? Promise.resolve(typeNames) : this.typeNames(),
    ]);
    const evaluation = evaluateCompliance(framework, entries, { exempted: !!exemption, typeNames: names });
    return { year, framework, evaluation, exemption, typeNames: names, entries };
  }

  async recompute(practitionerId: bigint, year: number, frameworks?: DbFramework[], typeNames?: Record<number, string>) {
    const { evaluation: e } = await this.evaluate(practitionerId, year, frameworks, typeNames);
    const data = {
      frameworkId: e.frameworkId,
      rawPoints: e.rawPoints,
      countablePoints: e.countablePoints,
      buckets: e.buckets as any,
      compliant: e.compliant,
      exempted: e.exempted,
      reasons: e.reasons,
      computedAt: new Date(),
    };
    await this.prisma.complianceResult.upsert({
      where: { practitionerId_cpdYear: { practitionerId, cpdYear: year } },
      create: { practitionerId, cpdYear: year, ...data },
      update: data,
    });
    return e;
  }

  /** Nightly / after a rule change: recompute everyone with claims or an exemption in the year. */
  async recomputeAll(year: number, progress?: (done: number, total: number) => Promise<void>) {
    const ids = await this.practitionersInYear(year);
    const frameworks = await this.loadFrameworks();
    const names = await this.typeNames();
    let done = 0;
    for (const id of ids) {
      await this.recompute(id, year, frameworks, names);
      if (++done % 50 === 0) await progress?.(done, ids.length);
    }
    await progress?.(done, ids.length);
    return { year, recomputed: done, message: `Recomputed compliance for ${done} practitioners` };
  }

  async practitionersInYear(year: number): Promise<bigint[]> {
    const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
      SELECT DISTINCT c."practitionerId" AS id FROM cpd_claims c WHERE c."calYear" = ${year} AND c."deletedAt" IS NULL
      UNION SELECT e."practitionerId" FROM exemptions e WHERE e."cpdYear" = ${year} AND e."deletedAt" IS NULL`;
    return rows.map((r) => r.id);
  }

  /** Points grouped by activity type (spec 5.7.1) with the speciality split when a framework applies. */
  async summary(practitionerId: bigint, year: number) {
    const c = await this.evaluate(practitionerId, year);
    const rows = summarizeByType(c.entries, c.evaluation.allocations, (id) => c.entries.find((e) => e.id === id)?.claimId.toString() ?? id);
    const alloc = new Map(c.evaluation.allocations.map((a) => [a.entryId, a]));
    const split =
      c.framework.specialityId !== null
        ? c.entries.reduce(
            (s, e) => {
              const related = e.specialityIds.includes(c.framework.specialityId!);
              const k = related ? 'specialityRelated' : 'other';
              s[k].raw = round2(s[k].raw + e.points);
              s[k].countable = round2(s[k].countable + (alloc.get(e.id)?.countablePoints ?? 0));
              return s;
            },
            { specialityRelated: { raw: 0, countable: 0 }, other: { raw: 0, countable: 0 } },
          )
        : null;
    return {
      year,
      framework: { id: c.framework.id, name: c.framework.name, scope: c.framework.scope, totalRequiredPoints: c.framework.totalRequiredPoints },
      totalRaw: c.evaluation.rawPoints,
      totalCountable: c.evaluation.countablePoints,
      byType: rows.map((r) => ({ ...r, activityTypeName: c.typeNames[r.activityTypeId] ?? `#${r.activityTypeId}` })),
      split,
    };
  }

  /** Warning shown when claiming: would these points be above a cap? */
  async capWarning(practitionerId: bigint, year: number, candidate: { activityTypeId: number; specialityIds: number[]; points: number }) {
    const [framework, entries, names] = await Promise.all([this.frameworkFor(practitionerId, year), this.entries(practitionerId, year), this.typeNames()]);
    return previewCapWarning(framework, entries, { id: 'candidate', date: new Date().toISOString(), ...candidate }, names);
  }

  /** After an award: did the newest entries of this claim land above a cap? */
  async claimWarning(practitionerId: bigint, year: number, claimId: bigint): Promise<string | null> {
    const c = await this.evaluate(practitionerId, year);
    const mine = c.entries.filter((e) => e.claimId === claimId);
    if (!mine.length) return null;
    const latest = mine[mine.length - 1].date;
    const ids = new Set(mine.filter((e) => e.date === latest).map((e) => e.id));
    const allocs = c.evaluation.allocations.filter((a) => ids.has(String(a.entryId)));
    const above = round2(allocs.reduce((s, a) => s + a.aboveCapPoints, 0));
    if (above <= 0) return null;
    const total = round2(allocs.reduce((s, a) => s + a.rawPoints, 0));
    const typeId = allocs[0].activityTypeId;
    const bucket = c.framework.buckets.find((b) => b.id === allocs[0].bucketId);
    const where = bucket ? ` in ${bucket.name}` : '';
    return above >= total
      ? `These points were recorded but won't count towards compliance: you have reached the cap for ${c.typeNames[typeId] ?? 'this activity type'}${where}.`
      : `${above} of these ${total} points are above the cap for ${c.typeNames[typeId] ?? 'this activity type'}${where} and won't count towards compliance.`;
  }

  /**
   * Run a draft framework against practitioners it would apply to and report status changes
   * (rules UI "preview" and the confirm-before-change prompt).
   */
  async preview(draft: ComplianceFramework, year: number, limit = 200) {
    const where: any = { deletedAt: null, status: { in: ['registered', 'approved'] } };
    if (draft.scope === 'speciality' && draft.specialityId) {
      where.OR = [{ specializationId: draft.specialityId }, { specialities: { some: { specialityId: draft.specialityId } } }];
    }
    if (draft.scope === 'category' && draft.userCategoryId) where.categoryId = draft.userCategoryId;
    const total = await this.prisma.practitioner.count({ where });
    const sample = await this.prisma.practitioner.findMany({ where, select: { id: true, regNo: true, firstName: true, lastName: true }, take: limit, orderBy: { id: 'asc' } });
    const names = await this.typeNames();
    let changed = 0;
    let compliantAfter = 0;
    const rows = [];
    for (const p of sample) {
      const [entries, exemption, before] = await Promise.all([
        this.entries(p.id, year),
        this.prisma.exemption.findFirst({ where: { practitionerId: p.id, cpdYear: year, deletedAt: null } }),
        this.evaluate(p.id, year, undefined, names),
      ]);
      const after = evaluateCompliance(draft, entries, { exempted: !!exemption, typeNames: names });
      if (after.compliant) compliantAfter++;
      if (after.compliant !== before.evaluation.compliant) changed++;
      rows.push({
        practitionerId: p.id,
        regNo: p.regNo,
        name: `${p.firstName} ${p.lastName}`,
        before: { compliant: before.evaluation.compliant, countablePoints: before.evaluation.countablePoints },
        after: { compliant: after.compliant, countablePoints: after.countablePoints, reasons: after.reasons },
      });
    }
    return { year, applicable: total, sampled: sample.length, changed, compliantAfter, rows };
  }
}
