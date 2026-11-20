import { Body, Controller, Delete, Get, Module, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { nairobiYear, PERMISSIONS, type Pagination } from '@icpd/shared';
import { PrismaService, num } from '../common/prisma.service';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/auth.decorators';
import { Z } from '../common/zod';
import { PageQuery, pageArgs, paged, parseId, sortBy } from '../common/pagination';
import { RequirePasswordConfirm } from '../auth/confirm.guard';
import { StorageService } from '../storage/storage.service';
import { ClaimsModule } from '../claims/claims.controller';
import { PractitionersService } from './practitioners.service';

const opt = z.string().trim().optional().nullable();
const editSchema = z.object({
  titleId: z.coerce.number().int().optional().nullable(),
  firstName: z.string().trim().min(1),
  otherNames: opt,
  lastName: z.string().trim().min(1),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable().or(z.literal('').transform(() => null)),
  email: z.string().trim().toLowerCase().email().optional().nullable(),
  mobile1: opt,
  mobile2: opt,
  nationality: opt,
  nationalId: opt,
  physicalAddress: opt,
  postalAddress: opt,
  postalCode: opt,
  city: opt,
  regNo: z.string().trim().min(2),
  categoryId: z.coerce.number().int().optional().nullable(),
  specializationId: z.coerce.number().int().optional().nullable(),
  status: z.enum(['presubmission', 'submitted', 'screening', 'returned', 'approved', 'registered', 'incomplete']).optional(),
});

/** Regulator practitioner records (spec 5.8). */
@ApiTags('regulator: practitioners')
@RequirePermissions(PERMISSIONS.READ_ADMIN_PANEL, PERMISSIONS.MANAGE_PRACTITIONERS)
@Controller('regulator/practitioners')
export class PractitionersController {
  constructor(private readonly prisma: PrismaService, private readonly svc: PractitionersService, private readonly storage: StorageService) {}

  /** list=all | incomplete | trashed */
  @Get()
  async list(@Query(PageQuery()) q: Pagination & { list?: string; status?: string; categoryId?: string; specialityId?: string }) {
    const where: any = {};
    if (q.list === 'trashed') where.deletedAt = { not: null };
    else where.deletedAt = null;
    if (q.list === 'incomplete') where.status = { in: ['incomplete', 'presubmission'] };
    if (q.status) where.status = q.status;
    if (q.categoryId) where.categoryId = Number(q.categoryId);
    if (q.specialityId) where.specializationId = Number(q.specialityId);
    if (q.search) {
      const s = q.search.trim();
      where.OR = [
        { regNo: { contains: s.replace(/\s+/g, ''), mode: 'insensitive' } },
        { firstName: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { nationalId: { contains: s, mode: 'insensitive' } },
        { applicationNo: { contains: s, mode: 'insensitive' } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.practitioner.findMany({
        where,
        ...pageArgs(q),
        orderBy: sortBy(q, ['regNo', 'lastName', 'status', 'dateRegistered', 'createdAt'], { id: 'desc' }),
        select: {
          id: true, regNo: true, firstName: true, otherNames: true, lastName: true, email: true, mobile1: true, status: true, dateRegistered: true, deletedAt: true, userId: true,
          category: { select: { name: true } }, specialization: { select: { name: true } },
        },
      }),
      this.prisma.practitioner.count({ where }),
    ]);
    return paged(rows, total, q);
  }

  @Get('duplicates')
  duplicates(@Query(PageQuery()) q: Pagination) {
    return this.svc.duplicates(q.page, q.pageSize, q.search);
  }

  @RequirePermissions(PERMISSIONS.EDIT_PRACTITIONER)
  @Post('merge')
  merge(@CurrentUser() u: AuthUser, @Body(Z(z.object({ targetId: z.coerce.bigint(), sourceIds: z.array(z.coerce.bigint()).min(1) }))) b: { targetId: bigint; sourceIds: bigint[] }) {
    return this.svc.merge(b.targetId, b.sourceIds, u.id);
  }

  @Get(':id')
  async detail(@Param('id') id: string) {
    const p = await this.svc.detail(parseId(id), true);
    return { ...p, photoSignedUrl: await this.storage.signedUrl(p.photoUrl) };
  }

  @Get(':id/points')
  async points(@Param('id') id: string, @Query('year') year?: string) {
    const y = year ? Number(year) : nairobiYear();
    const r = await this.prisma.cpdClaim.aggregate({ where: { practitionerId: parseId(id), calYear: y, deletedAt: null }, _sum: { cpdPoints: true }, _count: true });
    return { year: y, points: num(r._sum.cpdPoints), claims: r._count };
  }

  @RequirePermissions(PERMISSIONS.EDIT_PRACTITIONER)
  @Put(':id')
  update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(editSchema)) b: z.infer<typeof editSchema>) {
    return this.svc.update(parseId(id), b, u.id);
  }

  @RequirePermissions(PERMISSIONS.EDIT_PRACTITIONER)
  @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.svc.softDelete(parseId(id), u.id);
    return { ok: true };
  }

  @RequirePermissions(PERMISSIONS.EDIT_PRACTITIONER)
  @Post(':id/restore')
  async restore(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.svc.restore(parseId(id), u.id);
    return { ok: true };
  }

  @RequirePermissions(PERMISSIONS.EDIT_PRACTITIONER)
  @RequirePasswordConfirm()
  @Delete(':id/permanent')
  async destroy(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.svc.destroy(parseId(id), u.id);
    return { ok: true };
  }

  @RequirePermissions(PERMISSIONS.EDIT_PRACTITIONER)
  @Post(':id/reset-legacy-password')
  reset(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.svc.resetLegacyPassword(parseId(id), u.id);
  }
}

/** Regulator dashboard: totals and monthly trends for the current year (spec 5.12). */
@ApiTags('regulator: dashboard')
@RequirePermissions(PERMISSIONS.READ_ADMIN_PANEL)
@Controller('regulator/dashboard')
export class DashboardController {
  constructor(private readonly prisma: PrismaService) {}

  private async monthly(sql: Prisma.Sql) {
    const rows = await this.prisma.$queryRaw<{ m: number; n: bigint }[]>(sql);
    const out = Array(12).fill(0);
    for (const r of rows) out[Number(r.m) - 1] = Number(r.n);
    return out;
  }

  @Get()
  async get(@Query('year') y?: string) {
    const year = y ? Number(y) : nairobiYear();
    const tz = 'Africa/Nairobi';
    const [practitioners, providers, activities, users, claims, pendingApplications, pendingNonToken] = await Promise.all([
      this.prisma.practitioner.count({ where: { deletedAt: null, status: 'registered' } }),
      this.prisma.provider.count({ where: { deletedAt: null } }),
      this.prisma.activity.count({ where: { deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.cpdClaim.count({ where: { deletedAt: null, calYear: year } }),
      this.prisma.practitioner.count({ where: { deletedAt: null, status: { in: ['submitted', 'screening'] } } }),
      this.prisma.nonTokenClaim.count({ where: { deletedAt: null, status: 'Pending' } }),
    ]);
    const [registrations, acts, claimTrend, nonToken, applications] = await Promise.all([
      this.monthly(Prisma.sql`SELECT EXTRACT(MONTH FROM "dateRegistered")::int AS m, COUNT(*) AS n FROM practitioners WHERE "deletedAt" IS NULL AND EXTRACT(YEAR FROM "dateRegistered") = ${year} GROUP BY 1`),
      this.monthly(Prisma.sql`SELECT EXTRACT(MONTH FROM "releaseDate")::int AS m, COUNT(*) AS n FROM activities WHERE "deletedAt" IS NULL AND EXTRACT(YEAR FROM "releaseDate") = ${year} GROUP BY 1`),
      this.monthly(Prisma.sql`SELECT EXTRACT(MONTH FROM ("claimedAt" AT TIME ZONE ${tz}))::int AS m, COUNT(*) AS n FROM cpd_claims WHERE "deletedAt" IS NULL AND EXTRACT(YEAR FROM ("claimedAt" AT TIME ZONE ${tz})) = ${year} GROUP BY 1`),
      this.monthly(Prisma.sql`SELECT EXTRACT(MONTH FROM ("claimDate" AT TIME ZONE ${tz}))::int AS m, COUNT(*) AS n FROM non_token_claims WHERE "deletedAt" IS NULL AND EXTRACT(YEAR FROM ("claimDate" AT TIME ZONE ${tz})) = ${year} GROUP BY 1`),
      this.monthly(Prisma.sql`SELECT EXTRACT(MONTH FROM ("dateOfApplication" AT TIME ZONE ${tz}))::int AS m, COUNT(*) AS n FROM practitioners WHERE "deletedAt" IS NULL AND EXTRACT(YEAR FROM ("dateOfApplication" AT TIME ZONE ${tz})) = ${year} GROUP BY 1`),
    ]);
    return {
      year,
      totals: { practitioners, providers, activities, users, claims, pendingApplications, pendingNonToken },
      monthly: { registrations, activities: acts, claims: claimTrend, nonToken, applications },
    };
  }
}


@Module({ imports: [ClaimsModule], controllers: [PractitionersController, DashboardController], providers: [PractitionersService] })
export class PractitionersModule {}
