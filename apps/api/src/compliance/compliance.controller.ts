import { Body, Controller, Delete, Get, Module, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import { complianceFrameworkSchema, nairobiYear, PERMISSIONS, type ComplianceFrameworkInput } from '@icpd/shared';
import { PrismaService, num } from '../common/prisma.service';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/auth.decorators';
import { Z } from '../common/zod';
import { AppError, BadRequest, NotFound } from '../common/errors';
import { MIME, sendFile, toCsv } from '../common/files';
import { AuditService } from '../audit/audit.service';
import { JobsService } from '../jobs/jobs.service';
import { ClaimsModule } from '../claims/claims.controller';
import { ComplianceService, toFramework } from './compliance.service';

const saveSchema = complianceFrameworkSchema.extend({ confirm: z.boolean().optional() });
const reportQ = z.object({
  year: z.coerce.number().int().optional(),
  specialityId: z.coerce.number().int().optional(),
  categoryId: z.coerce.number().int().optional(),
  providerId: z.coerce.bigint().optional(),
  status: z.enum(['compliant', 'not_compliant', 'exempted']).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  format: z.enum(['json', 'csv', 'xlsx']).default('json'),
});

function validate(b: ComplianceFrameworkInput) {
  if (b.scope === 'speciality' && !b.specialityId) throw BadRequest('Choose the speciality this framework applies to.');
  if (b.scope === 'category' && !b.userCategoryId) throw BadRequest('Choose the user category this framework applies to.');
  if (b.cpdYearTo && b.cpdYearTo < b.cpdYearFrom) throw BadRequest('The end year must be on or after the start year.');
  if (b.scope !== 'speciality' && b.buckets.some((x) => x.source !== 'any')) {
    throw BadRequest('Speciality-related / other buckets only make sense for a speciality framework; use "any".');
  }
  b.buckets.forEach((x, i) => {
    if (x.allowOverflowToIndex !== null && x.allowOverflowToIndex !== undefined && (x.allowOverflowToIndex === i || !b.buckets[x.allowOverflowToIndex])) {
      throw BadRequest(`Bucket "${x.name}" overflows to an invalid bucket.`);
    }
  });
}

/** Draft (unsaved) framework → engine shape, using bucket indexes as temporary ids. */
function draftFramework(b: ComplianceFrameworkInput, id: number | null = null) {
  return toFramework({
    id,
    ...b,
    buckets: b.buckets.map((x, i) => ({ ...x, id: i + 1, allowOverflowTo: x.allowOverflowToIndex === null || x.allowOverflowToIndex === undefined ? null : x.allowOverflowToIndex + 1, sortOrder: x.sortOrder ?? i })),
    typeCaps: b.typeCaps.map((c) => ({ ...c, bucketId: c.bucketIndex === null || c.bucketIndex === undefined ? null : c.bucketIndex + 1 })),
  });
}

function serialize(f: any) {
  const idx = new Map<number, number>(f.buckets.sort((a: any, b: any) => a.sortOrder - b.sortOrder || a.id - b.id).map((b: any, i: number) => [b.id, i]));
  return {
    ...f,
    totalRequiredPoints: num(f.totalRequiredPoints),
    buckets: f.buckets.map((b: any) => ({
      ...b,
      minPoints: num(b.minPoints),
      maxCountablePoints: b.maxCountablePoints === null ? null : num(b.maxCountablePoints),
      maxPointsPerActivityType: b.maxPointsPerActivityType === null ? null : num(b.maxPointsPerActivityType),
      allowOverflowToIndex: b.allowOverflowTo === null ? null : idx.get(b.allowOverflowTo) ?? null,
    })),
    typeCaps: f.typeCaps.map((c: any) => ({ ...c, maxPoints: num(c.maxPoints), minPoints: c.minPoints === null ? null : num(c.minPoints), bucketIndex: c.bucketId === null ? null : idx.get(c.bucketId) ?? null })),
  };
}

/** Regulator compliance rules (frameworks, buckets, type caps), preview, reports (spec 5.7.1/5.7.2). */
@ApiTags('regulator: compliance')
@RequirePermissions(PERMISSIONS.READ_ADMIN_PANEL)
@Controller('regulator')
export class ComplianceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly compliance: ComplianceService,
    private readonly audit: AuditService,
    private readonly jobs: JobsService,
  ) {}

  @Get('compliance/frameworks')
  async list() {
    const rows = await this.prisma.complianceFramework.findMany({ where: { deletedAt: null }, include: { buckets: true, typeCaps: true }, orderBy: [{ scope: 'asc' }, { cpdYearFrom: 'desc' }] });
    return rows.map(serialize);
  }

  @Get('compliance/frameworks/:id')
  async get(@Param('id') id: string) {
    const f = await this.prisma.complianceFramework.findFirst({ where: { id: Number(id), deletedAt: null }, include: { buckets: true, typeCaps: true } });
    if (!f) throw NotFound('Framework');
    return serialize(f);
  }

  /** Run a draft against a sample of practitioners before saving. */
  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Post('compliance/frameworks/preview')
  async preview(@Body(Z(saveSchema.extend({ year: z.coerce.number().int().optional() }))) b: any) {
    validate(b);
    return this.compliance.preview(draftFramework(b), b.year ?? nairobiYear());
  }

  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Post('compliance/frameworks')
  async create(@CurrentUser() u: AuthUser, @Body(Z(saveSchema)) b: z.infer<typeof saveSchema>) {
    validate(b);
    await this.guardYearStarted(b, null);
    await this.ensureUniqueActive(b, null);
    const f = await this.persist(null, b, u.id);
    await this.afterChange(u, 'framework-created', f.id, b);
    return this.get(String(f.id));
  }

  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Put('compliance/frameworks/:id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(saveSchema)) b: z.infer<typeof saveSchema>) {
    validate(b);
    const existing = await this.prisma.complianceFramework.findFirst({ where: { id: Number(id), deletedAt: null } });
    if (!existing) throw NotFound('Framework');
    await this.guardYearStarted(b, existing.id);
    await this.ensureUniqueActive(b, existing.id);
    await this.persist(existing.id, b, u.id);
    await this.afterChange(u, 'framework-updated', existing.id, b);
    return this.get(id);
  }

  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Delete('compliance/frameworks/:id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.complianceFramework.update({ where: { id: Number(id) }, data: { deletedAt: new Date(), deletedBy: u.id, active: false } });
    await this.afterChange(u, 'framework-deleted', Number(id), {});
    return { ok: true };
  }

  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Post('compliance/recompute')
  recompute(@CurrentUser() u: AuthUser, @Query('year') year?: string) {
    return this.jobs.enqueue('compliance.recompute-all', { year: year ? Number(year) : nairobiYear() }, u.id);
  }

  /** Changing rules for a year that has started needs confirmation with the impact shown. */
  private async guardYearStarted(b: z.infer<typeof saveSchema>, id: number | null) {
    const year = nairobiYear();
    const affectsCurrent = b.cpdYearFrom <= year && (!b.cpdYearTo || b.cpdYearTo >= year);
    if (!affectsCurrent || b.confirm) return;
    const impact = await this.compliance.preview(draftFramework(b, id), year, 500);
    throw new AppError('CONFIRMATION_REQUIRED', `This changes the rules for ${year}, which has already started. ${impact.changed} of ${impact.sampled} practitioners checked would change status. Confirm to save.`, 409, impact);
  }

  private async ensureUniqueActive(b: ComplianceFrameworkInput, id: number | null) {
    if (!b.active) return;
    const clash = await this.prisma.complianceFramework.findFirst({
      where: {
        deletedAt: null,
        active: true,
        scope: b.scope,
        specialityId: b.scope === 'speciality' ? b.specialityId : null,
        userCategoryId: b.scope === 'category' ? b.userCategoryId : null,
        ...(id ? { id: { not: id } } : {}),
        cpdYearFrom: { lte: b.cpdYearTo ?? 9999 },
        OR: [{ cpdYearTo: null }, { cpdYearTo: { gte: b.cpdYearFrom } }],
      },
    });
    if (clash) {
      throw BadRequest(`"${clash.name}" already applies to the same target for overlapping years (${clash.cpdYearFrom}–${clash.cpdYearTo ?? 'open'}). Close it first by setting its end year; past years keep their own rules.`);
    }
  }

  private async persist(id: number | null, b: z.infer<typeof saveSchema>, actorId: bigint) {
    return this.prisma.$transaction(async (tx) => {
      const data = {
        name: b.name,
        cpdYearFrom: b.cpdYearFrom,
        cpdYearTo: b.cpdYearTo ?? null,
        scope: b.scope,
        specialityId: b.scope === 'speciality' ? b.specialityId ?? null : null,
        userCategoryId: b.scope === 'category' ? b.userCategoryId ?? null : null,
        totalRequiredPoints: b.totalRequiredPoints,
        active: b.active,
        notes: b.notes ?? null,
      };
      const f = id
        ? await tx.complianceFramework.update({ where: { id }, data: { ...data, updatedBy: actorId } })
        : await tx.complianceFramework.create({ data: { ...data, createdBy: actorId } });
      await tx.complianceTypeCap.deleteMany({ where: { frameworkId: f.id } });
      await tx.complianceBucket.deleteMany({ where: { frameworkId: f.id } });
      const ids: number[] = [];
      for (const [i, x] of b.buckets.entries()) {
        const row = await tx.complianceBucket.create({
          data: {
            frameworkId: f.id,
            name: x.name,
            source: x.source,
            minPoints: x.minPoints,
            maxCountablePoints: x.maxCountablePoints ?? null,
            minDistinctActivityTypes: x.minDistinctActivityTypes,
            maxPointsPerActivityType: x.maxPointsPerActivityType ?? null,
            sortOrder: x.sortOrder ?? i,
          },
        });
        ids.push(row.id);
      }
      for (const [i, x] of b.buckets.entries()) {
        if (x.allowOverflowToIndex !== null && x.allowOverflowToIndex !== undefined) {
          await tx.complianceBucket.update({ where: { id: ids[i] }, data: { allowOverflowTo: ids[x.allowOverflowToIndex] } });
        }
      }
      for (const c of b.typeCaps) {
        await tx.complianceTypeCap.create({
          data: {
            frameworkId: f.id,
            bucketId: c.bucketIndex === null || c.bucketIndex === undefined ? null : ids[c.bucketIndex],
            activityTypeId: c.activityTypeId,
            maxPoints: c.maxPoints,
            minPoints: c.minPoints ?? null,
          },
        });
      }
      return f;
    });
  }

  private async afterChange(u: AuthUser, event: string, id: number, props: object) {
    await this.audit.log({ actorId: u.id, logName: 'compliance', event, subjectType: 'compliance_framework', subjectId: id, properties: props as any });
    await this.jobs.enqueue('compliance.recompute-all', { year: nairobiYear() }, u.id);
  }

  // ── reports ──
  /** Compliant / not compliant / exempted per year, with failing reasons (spec 5.7.2). */
  @RequirePermissions(PERMISSIONS.MANAGE_PRACTITIONERS)
  @Get('compliance/report')
  async report(@Query(Z(reportQ)) q: z.infer<typeof reportQ>, @Res() res: Response) {
    const year = q.year ?? nairobiYear();
    const where: any = { cpdYear: year, practitioner: { deletedAt: null } };
    if (q.status === 'compliant') Object.assign(where, { compliant: true, exempted: false });
    if (q.status === 'not_compliant') where.compliant = false;
    if (q.status === 'exempted') where.exempted = true;
    if (q.specialityId) where.practitioner.OR = [{ specializationId: q.specialityId }, { specialities: { some: { specialityId: q.specialityId } } }];
    if (q.categoryId) where.practitioner.categoryId = q.categoryId;
    if (q.search) where.practitioner.AND = [{ OR: [{ regNo: { contains: q.search.replace(/\s+/g, ''), mode: 'insensitive' } }, { lastName: { contains: q.search, mode: 'insensitive' } }] }];
    const exporting = q.format !== 'json';
    const [rows, total, counts] = await Promise.all([
      this.prisma.complianceResult.findMany({
        where,
        include: { practitioner: { select: { id: true, regNo: true, firstName: true, lastName: true, specialization: { select: { name: true } }, category: { select: { name: true } } } } },
        orderBy: [{ compliant: 'asc' }, { countablePoints: 'asc' }],
        ...(exporting ? {} : { skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      }),
      this.prisma.complianceResult.count({ where }),
      this.prisma.complianceResult.groupBy({ by: ['compliant', 'exempted'], where: { ...where, compliant: undefined, exempted: undefined }, _count: true }),
    ]);
    const frameworks = new Map((await this.prisma.complianceFramework.findMany({ select: { id: true, name: true } })).map((f) => [f.id, f.name]));
    const data = rows.map((r) => ({
      practitionerId: r.practitioner.id,
      regNo: r.practitioner.regNo,
      name: `${r.practitioner.firstName} ${r.practitioner.lastName}`,
      speciality: r.practitioner.specialization?.name ?? null,
      category: r.practitioner.category?.name ?? null,
      framework: r.frameworkId ? frameworks.get(r.frameworkId) ?? null : 'Default',
      rawPoints: num(r.rawPoints),
      countablePoints: num(r.countablePoints),
      status: r.exempted ? 'exempted' : r.compliant ? 'compliant' : 'not compliant',
      reasons: (r.reasons as string[]) ?? [],
      computedAt: r.computedAt,
    }));
    const summary = {
      compliant: counts.filter((c) => c.compliant && !c.exempted).reduce((s, c) => s + c._count, 0),
      notCompliant: counts.filter((c) => !c.compliant).reduce((s, c) => s + c._count, 0),
      exempted: counts.filter((c) => c.exempted).reduce((s, c) => s + c._count, 0),
    };
    if (exporting) {
      const table = [
        ['Reg. no.', 'Name', 'Speciality', 'Category', 'Framework', 'Points', 'Countable', 'Status', 'Reasons'],
        ...data.map((d) => [d.regNo, d.name, d.speciality, d.category, d.framework, d.rawPoints, d.countablePoints, d.status, d.reasons.join(' | ')]),
      ];
      return this.export(res, table, `compliance-${year}`, q.format as 'csv' | 'xlsx');
    }
    res.json({ year, summary, data, total, page: q.page, pageSize: q.pageSize });
  }

  /** Points by activity type across practitioners (spec 5.7.1 regulator report). */
  @RequirePermissions(PERMISSIONS.MANAGE_PRACTITIONERS)
  @Get('reports/points-by-type')
  async pointsByType(@Query(Z(reportQ)) q: z.infer<typeof reportQ>, @Res() res: Response) {
    const year = q.year ?? nairobiYear();
    const conds: string[] = ['e."calYear" = $1', 'c."deletedAt" IS NULL', 'p."deletedAt" IS NULL'];
    const params: any[] = [year];
    if (q.specialityId) {
      params.push(q.specialityId);
      conds.push(`(p."specializationId" = $${params.length} OR EXISTS (SELECT 1 FROM practitioner_specialities ps WHERE ps."practitionerId" = p.id AND ps."specialityId" = $${params.length}))`);
    }
    if (q.categoryId) {
      params.push(q.categoryId);
      conds.push(`p."categoryId" = $${params.length}`);
    }
    if (q.providerId) {
      params.push(q.providerId);
      conds.push(`a."providerId" = $${params.length}`);
    }
    const rows = await this.prisma.$queryRawUnsafe<{ activityTypeId: number; name: string; claims: bigint; practitioners: bigint; points: string }[]>(
      `SELECT e."activityTypeId", t.name, COUNT(DISTINCT c.id) AS claims, COUNT(DISTINCT c."practitionerId") AS practitioners, COALESCE(SUM(e.points),0)::text AS points
       FROM cpd_claim_entries e
       JOIN cpd_claims c ON c.id = e."claimId"
       JOIN practitioners p ON p.id = c."practitionerId"
       LEFT JOIN activities a ON a.id = c."activityId"
       JOIN activity_types t ON t.id = e."activityTypeId"
       WHERE ${conds.join(' AND ')}
       GROUP BY e."activityTypeId", t.name
       ORDER BY SUM(e.points) DESC`,
      ...params,
    );
    const total = rows.reduce((s, r) => s + Number(r.points), 0);
    const data = rows.map((r) => ({
      activityTypeId: r.activityTypeId,
      activityTypeName: r.name,
      claims: Number(r.claims),
      practitioners: Number(r.practitioners),
      points: Number(r.points),
      share: total ? Math.round((Number(r.points) / total) * 10000) / 100 : 0,
    }));
    if (q.format !== 'json') {
      return this.export(res, [['Activity type', 'Claims', 'Practitioners', 'Points', 'Share %'], ...data.map((d) => [d.activityTypeName, d.claims, d.practitioners, d.points, d.share])], `points-by-type-${year}`, q.format as 'csv' | 'xlsx');
    }
    res.json({ year, total, data });
  }

  private async export(res: Response, table: any[][], name: string, format: 'csv' | 'xlsx') {
    if (format === 'csv') {
      sendFile(res, toCsv(table), MIME.csv, `${name}.csv`);
      return;
    }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Report');
    table.forEach((r, i) => {
      const row = ws.addRow(r);
      if (i === 0) row.font = { bold: true };
    });
    ws.columns.forEach((c) => (c.width = 20));
    sendFile(res, Buffer.from(await wb.xlsx.writeBuffer()), MIME.xlsx, `${name}.xlsx`);
  }
}

@Module({ imports: [ClaimsModule], controllers: [ComplianceController] })
export class ComplianceModule {}
