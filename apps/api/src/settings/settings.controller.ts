import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { activityTypeSchema, PERMISSIONS, type Pagination } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { CurrentUser, Public, RequirePermissions, type AuthUser } from '../common/auth.decorators';
import { Z } from '../common/zod';
import { PageQuery, pageArgs, paged } from '../common/pagination';
import { BadRequest, NotFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';

const specialitySchema = z.object({ name: z.string().trim().min(2).max(255), description: z.string().optional().nullable() });
const categorySchema = z.object({
  name: z.string().trim().min(2).max(255),
  prefixLetter: z.string().trim().toUpperCase().regex(/^[A-Z]$/, 'One letter A-Z'),
  minimumLength: z.coerce.number().int().min(1).max(9),
});
const settingSchema = z.object({ value: z.any() });

/** Editable regulator settings (key → allowed values). */
const SETTING_KEYS: Record<string, z.ZodTypeAny> = {
  'compliance.multiSpecialityMode': z.enum(['primary', 'strictest']),
  'claims.quickClaimEnforceExpiry': z.boolean(),
  'claims.enforceTypeCaps': z.boolean(),
};

/** Settings (spec 5.11): specializations, activity types, user categories + reference data. */
@ApiTags('settings')
@Controller()
export class SettingsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // ── public reference data for forms ──
  @Public()
  @Get('reference')
  async reference() {
    const [specialities, categories, titles, countries, qualifications, activityTypes] = await Promise.all([
      this.prisma.speciality.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.userCategory.findMany({ where: { deletedAt: null, archived: false }, orderBy: { prefixLetter: 'asc' }, select: { id: true, name: true, prefixLetter: true, minimumLength: true } }),
      this.prisma.title.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' }, select: { id: true, name: true } }),
      this.prisma.country.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } }),
      this.prisma.academicQualification.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
      this.prisma.activityType.findMany({ where: { deletedAt: null, archived: false }, orderBy: { name: 'asc' } }),
    ]);
    return { specialities, categories, titles, countries, qualifications, activityTypes };
  }

  @Public()
  @Get('reference/facilities')
  facilities(@Query('search') search?: string) {
    return this.prisma.facility.findMany({
      where: { deletedAt: null, ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}) },
      take: 30,
      orderBy: { name: 'asc' },
    });
  }

  @Public()
  @Get('reference/medical-schools')
  schools(@Query('search') search?: string) {
    return this.prisma.medicalSchool.findMany({
      where: { deletedAt: null, ...(search ? { name: { contains: search, mode: 'insensitive' as const } } : {}) },
      take: 30,
      orderBy: { name: 'asc' },
    });
  }

  // ── specialities ──
  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Get('settings/specialities')
  async specialities(@Query(PageQuery()) q: Pagination) {
    const where: any = { deletedAt: null, ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.speciality.findMany({ where, ...pageArgs(q), orderBy: { name: 'asc' } }),
      this.prisma.speciality.count({ where }),
    ]);
    return paged(rows, total, q);
  }

  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Post('settings/specialities')
  async createSpeciality(@CurrentUser() u: AuthUser, @Body(Z(specialitySchema)) b: z.infer<typeof specialitySchema>) {
    const row = await this.prisma.speciality.create({ data: { ...b, createdBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'settings', event: 'speciality-created', subjectType: 'speciality', subjectId: row.id, properties: b });
    return row;
  }

  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Put('settings/specialities/:id')
  async updateSpeciality(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(specialitySchema)) b: z.infer<typeof specialitySchema>) {
    const row = await this.prisma.speciality.update({ where: { id: Number(id) }, data: { ...b, updatedBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'settings', event: 'speciality-updated', subjectType: 'speciality', subjectId: row.id, properties: b });
    return row;
  }

  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Delete('settings/specialities/:id')
  async deleteSpeciality(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.speciality.update({ where: { id: Number(id) }, data: { deletedAt: new Date(), deletedBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'settings', event: 'speciality-deleted', subjectType: 'speciality', subjectId: id });
    return { ok: true };
  }

  // ── activity types ──
  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Get('settings/activity-types')
  async activityTypes(@Query(PageQuery()) q: Pagination & { archived?: string }) {
    const where: any = { deletedAt: null, archived: q.archived === 'true', ...(q.search ? { name: { contains: q.search, mode: 'insensitive' } } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.activityType.findMany({ where, ...pageArgs(q), orderBy: { name: 'asc' } }),
      this.prisma.activityType.count({ where }),
    ]);
    return paged(rows, total, q);
  }

  /** "GET activity-type details" used by the activity form (non-archived only). */
  @Get('activity-types/:id')
  async activityType(@Param('id') id: string) {
    const t = await this.prisma.activityType.findFirst({ where: { id: Number(id), deletedAt: null } });
    if (!t) throw NotFound('Activity type');
    return t;
  }

  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Post('settings/activity-types')
  async createType(@CurrentUser() u: AuthUser, @Body(Z(activityTypeSchema)) b: z.infer<typeof activityTypeSchema>) {
    const row = await this.prisma.activityType.create({ data: { ...b, createdBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'settings', event: 'activity-type-created', subjectType: 'activity_type', subjectId: row.id, properties: b });
    return row;
  }

  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Put('settings/activity-types/:id')
  async updateType(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(activityTypeSchema)) b: z.infer<typeof activityTypeSchema>) {
    const row = await this.prisma.activityType.update({ where: { id: Number(id) }, data: { ...b, updatedBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'settings', event: 'activity-type-updated', subjectType: 'activity_type', subjectId: row.id, properties: b });
    return row;
  }

  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Post('settings/activity-types/:id/archive')
  async archiveType(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(z.object({ archived: z.boolean() }))) b: { archived: boolean }) {
    await this.prisma.activityType.update({ where: { id: Number(id) }, data: { archived: b.archived, updatedBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'settings', event: b.archived ? 'activity-type-archived' : 'activity-type-restored', subjectType: 'activity_type', subjectId: id });
    return { ok: true };
  }

  // ── user categories ──
  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Get('settings/user-categories')
  async categories(@Query('archived') archived?: string) {
    return this.prisma.userCategory.findMany({ where: { deletedAt: null, archived: archived === 'true' }, orderBy: { prefixLetter: 'asc' } });
  }

  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Post('settings/user-categories')
  async createCategory(@CurrentUser() u: AuthUser, @Body(Z(categorySchema)) b: z.infer<typeof categorySchema>) {
    await this.ensureUniquePrefix(b.prefixLetter);
    const row = await this.prisma.userCategory.create({ data: { ...b, createdBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'settings', event: 'user-category-created', subjectType: 'user_category', subjectId: row.id, properties: b });
    return row;
  }

  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Put('settings/user-categories/:id')
  async updateCategory(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(categorySchema)) b: z.infer<typeof categorySchema>) {
    await this.ensureUniquePrefix(b.prefixLetter, Number(id));
    const row = await this.prisma.userCategory.update({ where: { id: Number(id) }, data: { ...b, updatedBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'settings', event: 'user-category-updated', subjectType: 'user_category', subjectId: row.id, properties: b });
    return row;
  }

  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Post('settings/user-categories/:id/archive')
  async archiveCategory(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(z.object({ archived: z.boolean() }))) b: { archived: boolean }) {
    await this.prisma.userCategory.update({ where: { id: Number(id) }, data: { archived: b.archived, updatedBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'settings', event: b.archived ? 'user-category-archived' : 'user-category-restored', subjectType: 'user_category', subjectId: id });
    return { ok: true };
  }

  private async ensureUniquePrefix(prefixLetter: string, exceptId?: number) {
    const clash = await this.prisma.userCategory.findFirst({ where: { prefixLetter, deletedAt: null, archived: false, ...(exceptId ? { id: { not: exceptId } } : {}) } });
    if (clash) throw BadRequest(`Prefix ${prefixLetter} is already used by ${clash.name}.`);
  }

  // ── key/value settings ──
  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Get('settings/general')
  async general() {
    const rows = await this.prisma.setting.findMany({ where: { key: { in: Object.keys(SETTING_KEYS) } } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  @RequirePermissions(PERMISSIONS.MANAGE_SETTINGS)
  @Put('settings/general/:key')
  async setGeneral(@CurrentUser() u: AuthUser, @Param('key') key: string, @Body(Z(settingSchema)) b: { value: unknown }) {
    const schema = SETTING_KEYS[key];
    if (!schema) throw NotFound('Setting');
    const parsed = schema.safeParse(b.value);
    if (!parsed.success) throw BadRequest('Invalid value for this setting');
    await this.prisma.setting.upsert({ where: { key }, create: { key, value: parsed.data, updatedBy: u.id }, update: { value: parsed.data, updatedBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'settings', event: 'setting-changed', subjectType: 'setting', subjectId: key, properties: { value: parsed.data } });
    return { ok: true };
  }
}
