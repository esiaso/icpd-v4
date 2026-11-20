import { Body, Controller, Delete, Get, Module, Param, Post, Put, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS, PROVIDER_STATUSES, type Pagination } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/auth.decorators';
import { Z } from '../common/zod';
import { PageQuery, pageArgs, paged, parseId, sortBy } from '../common/pagination';
import { NotFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { StorageService, type UploadedFile as UFile } from '../storage/storage.service';
import { ProvidersService } from './providers.service';
import { ProviderMemberGuard } from './provider-member.guard';

const req = (m = 'Required') => z.string().trim().min(1, m);
const providerSchema = z.object({
  name: req().max(255),
  regNo: req(),
  specialities: z.array(z.coerce.number().int()).min(1, 'Pick at least one speciality'),
  contactName: z.string().optional().nullable(),
  physicalAddress: req(),
  street: z.string().optional().nullable(),
  building: z.string().optional().nullable(),
  postalAddress: req(),
  postalCode: req(),
  town: req(),
  phone: req(),
  fixedLine: z.string().optional().nullable(),
  email: z.string().trim().toLowerCase().email(),
  website: z.string().trim().url('Enter a full URL (https://…)'),
  facebook: z.string().optional().nullable(),
  twitter: z.string().optional().nullable(),
  linkedin: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
});
/** Coordinators may edit contact details only. */
const profileSchema = providerSchema.pick({
  contactName: true, physicalAddress: true, street: true, building: true, postalAddress: true, postalCode: true,
  town: true, phone: true, fixedLine: true, email: true, website: true, facebook: true, twitter: true, linkedin: true, location: true,
});
const statusSchema = z.object({
  status: z.enum(PROVIDER_STATUSES),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional().nullable(),
});
const userSchema = z.object({ name: z.string().trim().min(2), email: z.string().trim().email() });

async function withLogo(storage: StorageService, p: any) {
  return { ...p, logoSignedUrl: await storage.signedUrl(p.logoUrl, 3600) };
}

/** Regulator provider management (spec 5.9). */
@ApiTags('regulator: providers')
@RequirePermissions(PERMISSIONS.READ_ADMIN_PANEL, PERMISSIONS.MANAGE_PROVIDERS)
@Controller('regulator/providers')
export class RegulatorProvidersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly providers: ProvidersService,
  ) {}

  @Get()
  async list(@Query(PageQuery()) q: Pagination & { status?: string }) {
    const where: any = { deletedAt: null };
    if (q.status) where.status = q.status;
    if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { regNo: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }];
    const [rows, total] = await Promise.all([
      this.prisma.provider.findMany({
        where,
        ...pageArgs(q),
        orderBy: sortBy(q, ['name', 'status', 'createdAt'], { name: 'asc' }),
        include: { _count: { select: { activities: { where: { deletedAt: null } }, users: { where: { deletedAt: null, status: 'Active' } } } } },
      }),
      this.prisma.provider.count({ where }),
    ]);
    return paged(rows, total, q);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const p = await this.prisma.provider.findFirst({ where: { id: parseId(id), deletedAt: null } });
    if (!p) throw NotFound('Provider');
    return withLogo(this.storage, p);
  }

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body(Z(providerSchema)) b: z.infer<typeof providerSchema>) {
    const p = await this.prisma.provider.create({ data: { ...b, status: 'active', addedBy: u.id, createdBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'providers', event: 'created', subjectType: 'provider', subjectId: p.id, properties: b });
    return p;
  }

  @Put(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(providerSchema)) b: z.infer<typeof providerSchema>) {
    const p = await this.prisma.provider.update({ where: { id: parseId(id) }, data: { ...b, updatedBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'providers', event: 'updated', subjectType: 'provider', subjectId: p.id, properties: b });
    return p;
  }

  @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.provider.update({ where: { id: parseId(id) }, data: { deletedAt: new Date(), deletedBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'providers', event: 'deleted', subjectType: 'provider', subjectId: id });
    return { ok: true };
  }

  @Post(':id/logo')
  @UseInterceptors(FileInterceptor('file'))
  async logo(@CurrentUser() u: AuthUser, @Param('id') id: string, @UploadedFile() file: UFile) {
    this.storage.validate(file, 'image', 2 * 1024 * 1024);
    const key = await this.storage.put('provider-logos', file);
    await this.prisma.provider.update({ where: { id: parseId(id) }, data: { logoUrl: key, updatedBy: u.id } });
    return { ok: true };
  }

  @Get(':id/users')
  async users(@Param('id') id: string) {
    return this.prisma.providerUser.findMany({
      where: { providerId: parseId(id), deletedAt: null },
      include: { user: { select: { id: true, name: true, email: true, lastLoginAt: true, emailVerifiedAt: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Post(':id/users')
  async addUser(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(userSchema)) b: z.infer<typeof userSchema>) {
    const user = await this.providers.addUser(parseId(id), b, u.id);
    return { ok: true, userId: user.id };
  }

  @Delete(':id/users/:providerUserId')
  async removeUser(@CurrentUser() u: AuthUser, @Param('id') id: string, @Param('providerUserId') puid: string) {
    await this.providers.removeUser(parseId(id), parseId(puid), u.id);
    return { ok: true };
  }

  @Get(':id/status-history')
  async history(@Param('id') id: string) {
    return this.prisma.providerStatusHistory.findMany({ where: { providerId: parseId(id) }, orderBy: [{ effectiveDate: 'desc' }, { id: 'desc' }] });
  }

  @Post(':id/status')
  async status(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(statusSchema)) b: z.infer<typeof statusSchema>) {
    await this.providers.changeStatus(parseId(id), b, u.id);
    return { ok: true };
  }

  @Get(':id/activities')
  async activities(@Param('id') id: string, @Query(PageQuery()) q: Pagination) {
    const where: any = { providerId: parseId(id), deletedAt: null, ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.activity.findMany({ where, ...pageArgs(q), orderBy: sortBy(q, ['name', 'releaseDate', 'published'], { releaseDate: 'desc' }), include: { type: { select: { name: true } } } }),
      this.prisma.activity.count({ where }),
    ]);
    return paged(rows, total, q);
  }

  @Post('jobs/yearly-reset')
  async runYearly(@CurrentUser() u: AuthUser) {
    await this.audit.log({ actorId: u.id, logName: 'providers', event: 'yearly-reset-manual' });
    return this.providers.yearlyReset();
  }
}

/** Coordinator workspace (spec 5.9): picker, dashboard, profile. */
@ApiTags('provider workspace')
@RequirePermissions(PERMISSIONS.READ_PROVIDER_PANEL)
@Controller('providers')
export class WorkspaceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: ProvidersService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** Provider picker: if one, the web app goes straight to its dashboard. */
  @Get('mine')
  mine(@CurrentUser() u: AuthUser) {
    return this.providers.myProviders(u.id);
  }

  @UseGuards(ProviderMemberGuard)
  @Get(':providerId/dashboard')
  async dashboard(@Param('providerId') id: string) {
    const pid = parseId(id);
    const p = await this.prisma.provider.findUniqueOrThrow({ where: { id: pid }, select: { id: true, name: true, status: true, effectiveDate: true } });
    return { provider: p, ...(await this.providers.dashboard(pid)) };
  }

  @UseGuards(ProviderMemberGuard)
  @Get(':providerId/profile')
  async profile(@Param('providerId') id: string) {
    return withLogo(this.storage, await this.prisma.provider.findUniqueOrThrow({ where: { id: parseId(id) } }));
  }

  @UseGuards(ProviderMemberGuard)
  @Put(':providerId/profile')
  async updateProfile(@CurrentUser() u: AuthUser, @Param('providerId') id: string, @Body(Z(profileSchema)) b: z.infer<typeof profileSchema>) {
    const p = await this.prisma.provider.update({ where: { id: parseId(id) }, data: { ...b, updatedBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'providers', event: 'profile-updated-by-coordinator', subjectType: 'provider', subjectId: p.id, properties: b });
    return p;
  }

  @UseGuards(ProviderMemberGuard)
  @Get(':providerId/users')
  async users(@Param('providerId') id: string) {
    const rows = await this.prisma.providerUser.findMany({
      where: { providerId: parseId(id), deletedAt: null, status: 'Active' },
      include: { user: { select: { name: true, email: true } } },
    });
    return rows.map((r) => ({ id: r.id, name: r.user.name, email: r.user.email }));
  }
}

@Module({
  controllers: [RegulatorProvidersController, WorkspaceController],
  providers: [ProvidersService, ProviderMemberGuard],
  exports: [ProvidersService, ProviderMemberGuard],
})
export class ProvidersModule {}
