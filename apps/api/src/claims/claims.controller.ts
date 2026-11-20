import { Body, Controller, Delete, Get, Module, Param, Post, Put, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { hasPermission } from '../common/auth.decorators';
import { nairobiYear, nonTokenClaimSchema, PERMISSIONS, quickClaimSchema, tokenClaimSchema, type Pagination } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { CurrentUser, Public, RequirePermissions, type AuthUser } from '../common/auth.decorators';
import { Z } from '../common/zod';
import { PageQuery, pageArgs, paged, parseId, sortBy } from '../common/pagination';
import { Forbidden, NotFound, Unprocessable } from '../common/errors';
import { MIME, sendFile } from '../common/files';
import { StorageService, type UploadedFile as UFile } from '../storage/storage.service';
import { SettingsService } from '../settings/settings.service';
import { ProviderMemberGuard } from '../providers/provider-member.guard';
import { ProvidersModule } from '../providers/providers.controller';
import { JobsService } from '../jobs/jobs.service';
import { PointsService, ClaimError, MSG } from '../points/points.service';
import { ComplianceService } from '../compliance/compliance.service';
import { DiaryService } from './diary.service';
import { NonTokenService } from './non-token.service';
import { AttendeesService } from './attendees.service';
import { ExemptionsService } from './exemptions.service';

const yearQ = z.object({ year: z.coerce.number().int().min(1990).max(2100).optional(), activityTypeId: z.coerce.number().int().optional() });
const jsonIds = z.preprocess((v) => (typeof v === 'string' ? (v ? JSON.parse(v) : []) : v), z.array(z.coerce.number().int()));
const nonTokenForm = z.preprocess(
  (v: any) => ({ ...v, specialityIds: v?.specialityIds ?? [] }),
  nonTokenClaimSchema.innerType().extend({ specialityIds: jsonIds.default([]) }),
).refine((v: any) => v.endDate >= v.beginDate, { path: ['endDate'], message: 'End date must be on or after the begin date' });

async function myPractitioner(prisma: PrismaService, user: AuthUser) {
  if (!user.practitionerId) throw Forbidden('Complete your practitioner registration first.');
  const p = await prisma.practitioner.findFirst({ where: { id: user.practitionerId, deletedAt: null } });
  if (!p) throw Forbidden('Complete your practitioner registration first.');
  return p;
}

/** Practitioner portal: claims, diary, portfolio and documents for the signed-in practitioner only. */
@ApiTags('practitioner: portfolio')
@Controller('me')
export class MeClaimsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointsService,
    private readonly diary: DiaryService,
    private readonly nonToken: NonTokenService,
    private readonly compliance: ComplianceService,
    private readonly storage: StorageService,
  ) {}

  @Get('portfolio')
  async portfolio(@CurrentUser() u: AuthUser, @Query(Z(yearQ)) q: z.infer<typeof yearQ>) {
    const p = await myPractitioner(this.prisma, u);
    return this.diary.portfolio(p.id, q.year ?? nairobiYear());
  }

  @Get('diary')
  async diaryList(@CurrentUser() u: AuthUser, @Query(Z(yearQ)) q: z.infer<typeof yearQ>) {
    const p = await myPractitioner(this.prisma, u);
    return this.diary.diary(p.id, q.year ?? nairobiYear(), q.activityTypeId);
  }

  @Get('diary/summary')
  async summary(@CurrentUser() u: AuthUser, @Query(Z(yearQ)) q: z.infer<typeof yearQ>) {
    const p = await myPractitioner(this.prisma, u);
    return this.compliance.summary(p.id, q.year ?? nairobiYear());
  }

  @Get('compliance')
  async myCompliance(@CurrentUser() u: AuthUser, @Query(Z(yearQ)) q: z.infer<typeof yearQ>) {
    const p = await myPractitioner(this.prisma, u);
    const c = await this.compliance.evaluate(p.id, q.year ?? nairobiYear());
    return { year: c.year, framework: c.framework, exemption: c.exemption, ...c.evaluation, typeNames: c.typeNames };
  }

  @Get('diary/pdf')
  async diaryPdf(@CurrentUser() u: AuthUser, @Query(Z(yearQ)) q: z.infer<typeof yearQ>, @Res() res: Response) {
    const p = await myPractitioner(this.prisma, u);
    const year = q.year ?? nairobiYear();
    sendFile(res, await this.diary.diaryPdf(p.id, year), MIME.pdf, `cpd-diary-${year}.pdf`);
  }

  @Get('certificate/pdf')
  async certificate(@CurrentUser() u: AuthUser, @Query(Z(yearQ)) q: z.infer<typeof yearQ>, @Res() res: Response) {
    const p = await myPractitioner(this.prisma, u);
    const year = q.year ?? nairobiYear();
    sendFile(res, await this.diary.certificatePdf(p.id, year), MIME.pdf, `cpd-certificate-${year}.pdf`);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('claims/token')
  async claimToken(@CurrentUser() u: AuthUser, @Body(Z(tokenClaimSchema)) b: z.infer<typeof tokenClaimSchema>) {
    const p = await myPractitioner(this.prisma, u);
    const r = await this.points.claimToken(p, b.token, { actorId: u.id });
    const warning = await this.compliance.claimWarning(p.id, r.calYear, r.claimId).catch(() => null);
    return { ...r, warning };
  }

  @Post('claims/cap-warning')
  async capWarning(@CurrentUser() u: AuthUser, @Body(Z(z.object({ activityTypeId: z.coerce.number().int(), specialityIds: z.array(z.coerce.number().int()).default([]), points: z.coerce.number().positive(), year: z.coerce.number().int().optional() }))) b: any) {
    const p = await myPractitioner(this.prisma, u);
    return { warning: await this.compliance.capWarning(p.id, b.year ?? nairobiYear(), b) };
  }

  @Get('non-token-claims')
  async list(@CurrentUser() u: AuthUser, @Query(PageQuery()) q: Pagination & { status?: string }) {
    const p = await myPractitioner(this.prisma, u);
    const where: any = { practitionerId: p.id, deletedAt: null, ...(q.status ? { status: q.status } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.nonTokenClaim.findMany({ where, ...pageArgs(q), orderBy: { claimDate: 'desc' }, include: { activityType: { select: { name: true } } } }),
      this.prisma.nonTokenClaim.count({ where }),
    ]);
    return paged(rows, total, q);
  }

  @Get('non-token-claims/specialities')
  async specialityOptions(@CurrentUser() u: AuthUser) {
    const p = await myPractitioner(this.prisma, u);
    const ids = await this.nonToken.allowedSpecialities(p.id);
    return this.prisma.speciality.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  }

  @Get('non-token-claims/:id')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const p = await myPractitioner(this.prisma, u);
    const c = await this.prisma.nonTokenClaim.findFirst({ where: { id: parseId(id), practitionerId: p.id, deletedAt: null }, include: { activityType: true, cpdClaim: true } });
    if (!c) throw NotFound('Claim');
    const comments = await this.prisma.comment.findMany({ where: { type: 'Non-Token Claim', itemId: c.id }, orderBy: { date: 'desc' } });
    return { ...c, evidenceSignedUrl: await this.storage.signedUrl(c.evidenceUrl), comments };
  }

  @Post('non-token-claims')
  @UseInterceptors(FileInterceptor('evidence'))
  async create(@CurrentUser() u: AuthUser, @Body(Z(nonTokenForm)) b: any, @UploadedFile() file: UFile) {
    const p = await myPractitioner(this.prisma, u);
    return this.nonToken.create(p.id, b, file, u.id);
  }

  @Put('non-token-claims/:id')
  @UseInterceptors(FileInterceptor('evidence'))
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(nonTokenForm)) b: any, @UploadedFile() file?: UFile) {
    const p = await myPractitioner(this.prisma, u);
    return this.nonToken.update(p.id, parseId(id), b, file, u.id);
  }

  @Delete('non-token-claims/:id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const p = await myPractitioner(this.prisma, u);
    await this.nonToken.remove(p.id, parseId(id), u.id);
    return { ok: true };
  }
}

/** Public quick claim from a QR link (spec 5.6): reg. no. + token, no login. Defect #6 rewritten. */
@ApiTags('public')
@Public()
@Controller('public/claim')
export class QuickClaimController {
  constructor(private readonly prisma: PrismaService, private readonly points: PointsService, private readonly settings: SettingsService) {}

  @Get(':activityId')
  async activity(@Param('activityId') id: string) {
    const a = await this.prisma.activity.findFirst({
      where: { id: parseId(id), deletedAt: null },
      select: { id: true, name: true, published: true, releaseDate: true, expiryDate: true, numSessions: true, cpdPoints: true, provider: { select: { name: true } }, type: { select: { name: true } } },
    });
    if (!a) throw NotFound('Activity');
    return a;
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post(':activityId')
  async claim(@Param('activityId') id: string, @Body(Z(quickClaimSchema)) b: z.infer<typeof quickClaimSchema>) {
    const check = await this.settings.checkRegNo(b.regNo);
    if (!check.valid) throw Unprocessable(check.error!, { fields: { regNo: check.error } }, 'VALIDATION');
    const p = await this.prisma.practitioner.findFirst({ where: { regNo: check.normalized, deletedAt: null }, orderBy: { id: 'asc' } });
    if (!p) throw new ClaimError('REGNO_NOT_FOUND', MSG.REGNO_NOT_FOUND);
    const r = await this.points.claimToken(p, b.token, { quick: true, activityId: parseId(id) });
    return { message: r.message, points: r.points, activityName: r.activityName, name: p.firstName };
  }
}

/** Regulator: non-token review, exemptions and per-practitioner diary (spec 5.6/5.7/5.8). */
@ApiTags('regulator: claims')
@RequirePermissions(PERMISSIONS.READ_ADMIN_PANEL)
@Controller('regulator')
export class RegulatorClaimsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nonToken: NonTokenService,
    private readonly exemptions: ExemptionsService,
    private readonly diary: DiaryService,
    private readonly compliance: ComplianceService,
    private readonly attendees: AttendeesService,
    private readonly storage: StorageService,
  ) {}

  @RequirePermissions(PERMISSIONS.MANAGE_CLAIMS)
  @Get('claims/non-token')
  async list(@Query(PageQuery()) q: Pagination & { state?: 'pending' | 'processed'; status?: string }) {
    const where: any = { deletedAt: null };
    if (q.state === 'pending') where.status = 'Pending';
    if (q.state === 'processed') where.status = { in: ['Yes', 'Rejected', 'No'] };
    if (q.status) where.status = q.status;
    if (q.search) {
      where.OR = [
        { activityName: { contains: q.search, mode: 'insensitive' } },
        { practitioner: { regNo: { contains: q.search.replace(/\s+/g, ''), mode: 'insensitive' } } },
        { practitioner: { lastName: { contains: q.search, mode: 'insensitive' } } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.prisma.nonTokenClaim.findMany({
        where,
        ...pageArgs(q),
        orderBy: sortBy(q, ['claimDate', 'activityName', 'status'], { claimDate: q.state === 'pending' ? 'asc' : 'desc' }),
        include: { activityType: { select: { name: true } }, practitioner: { select: { id: true, regNo: true, firstName: true, lastName: true } }, cpdClaim: { select: { cpdPoints: true } } },
      }),
      this.prisma.nonTokenClaim.count({ where }),
    ]);
    return paged(rows, total, q);
  }

  @RequirePermissions(PERMISSIONS.MANAGE_CLAIMS)
  @Get('claims/non-token/:id')
  async get(@Param('id') id: string) {
    const c = await this.prisma.nonTokenClaim.findFirst({
      where: { id: parseId(id), deletedAt: null },
      include: { activityType: true, practitioner: { include: { specialization: true, specialities: { include: { speciality: true } } } }, cpdClaim: true },
    });
    if (!c) throw NotFound('Claim');
    const comments = await this.prisma.comment.findMany({ where: { type: 'Non-Token Claim', itemId: c.id }, orderBy: { date: 'desc' } });
    const year = Number(c.endDate.toISOString().slice(0, 4));
    const warning = await this.compliance
      .capWarning(c.practitionerId, year, { activityTypeId: c.activityTypeId, specialityIds: (c.specialityIds as number[]) ?? [], points: Number(c.activityType.cpdPoints) || 1 })
      .catch(() => null);
    return { ...c, evidenceSignedUrl: await this.storage.signedUrl(c.evidenceUrl), comments, capWarning: warning };
  }

  @RequirePermissions(PERMISSIONS.MANAGE_CLAIMS)
  @Post('claims/non-token/:id/award')
  async award(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(z.object({ points: z.coerce.number(), specialityIds: z.array(z.coerce.number().int()).optional() }))) b: { points: number; specialityIds?: number[] }) {
    await this.nonToken.award(parseId(id), b, u.id);
    return { ok: true, message: `Awarded ${b.points} points` };
  }

  @RequirePermissions(PERMISSIONS.MANAGE_CLAIMS)
  @Post('claims/non-token/:id/reject')
  async reject(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(z.object({ reason: z.string().trim().min(3, 'Give a reason') }))) b: { reason: string }) {
    await this.nonToken.reject(parseId(id), b.reason, u.id);
    return { ok: true, message: 'Claim rejected and the practitioner notified' };
  }

  // ── exemptions ──
  @RequirePermissions(PERMISSIONS.EXEMPT_PRACTITIONER)
  @Get('exemptions')
  async exemptionList(@Query(PageQuery()) q: Pagination & { year?: string }) {
    const where: any = { deletedAt: null, ...(q.year ? { cpdYear: Number(q.year) } : {}) };
    if (q.search) where.OR = [{ regNo: { contains: q.search.replace(/\s+/g, ''), mode: 'insensitive' } }, { practitioner: { lastName: { contains: q.search, mode: 'insensitive' } } }];
    const [rows, total] = await Promise.all([
      this.prisma.exemption.findMany({ where, ...pageArgs(q), orderBy: { dateExempted: 'desc' }, include: { practitioner: { select: { id: true, regNo: true, firstName: true, lastName: true } } } }),
      this.prisma.exemption.count({ where }),
    ]);
    return paged(rows, total, q);
  }

  @RequirePermissions(PERMISSIONS.EXEMPT_PRACTITIONER)
  @Post('exemptions')
  async exempt(@CurrentUser() u: AuthUser, @Req() req: Request, @Body(Z(z.object({ practitionerId: z.coerce.bigint().optional(), regNo: z.string().optional(), cpdYear: z.coerce.number().int().min(2000).max(2100), reason: z.string().trim().min(3) }))) b: any) {
    return this.exemptions.create(b, u.id, { postType: 'FORM', ip: req.ip });
  }

  @RequirePermissions(PERMISSIONS.EXEMPT_PRACTITIONER)
  @Delete('exemptions/:id')
  async unexempt(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.exemptions.remove(parseId(id), u.id);
    return { ok: true };
  }

  // ── a practitioner's diary as seen by the regulator ──
  @RequirePermissions(PERMISSIONS.MANAGE_PRACTITIONERS)
  @Get('practitioners/:id/portfolio')
  portfolio(@Param('id') id: string, @Query(Z(yearQ)) q: z.infer<typeof yearQ>) {
    return this.diary.portfolio(parseId(id), q.year ?? nairobiYear());
  }

  @RequirePermissions(PERMISSIONS.MANAGE_PRACTITIONERS)
  @Get('practitioners/:id/diary')
  diaryList(@Param('id') id: string, @Query(Z(yearQ)) q: z.infer<typeof yearQ>) {
    return this.diary.diary(parseId(id), q.year ?? nairobiYear(), q.activityTypeId);
  }

  @RequirePermissions(PERMISSIONS.MANAGE_PRACTITIONERS)
  @Get('practitioners/:id/diary/summary')
  summary(@Param('id') id: string, @Query(Z(yearQ)) q: z.infer<typeof yearQ>) {
    return this.compliance.summary(parseId(id), q.year ?? nairobiYear());
  }

  @RequirePermissions(PERMISSIONS.MANAGE_PRACTITIONERS)
  @Get('practitioners/:id/compliance')
  async practitionerCompliance(@Param('id') id: string, @Query(Z(yearQ)) q: z.infer<typeof yearQ>) {
    const c = await this.compliance.evaluate(parseId(id), q.year ?? nairobiYear());
    return { year: c.year, framework: c.framework, exemption: c.exemption, ...c.evaluation, typeNames: c.typeNames };
  }

  @RequirePermissions(PERMISSIONS.MANAGE_PRACTITIONERS)
  @Get('practitioners/:id/diary/pdf')
  async diaryPdf(@Param('id') id: string, @Query(Z(yearQ)) q: z.infer<typeof yearQ>, @Res() res: Response) {
    const year = q.year ?? nairobiYear();
    sendFile(res, await this.diary.diaryPdf(parseId(id), year), MIME.pdf, `cpd-diary-${id}-${year}.pdf`);
  }

  @RequirePermissions(PERMISSIONS.MANAGE_PRACTITIONERS)
  @Get('practitioners/:id/claims/:claimId')
  async claimPreview(@Param('id') id: string, @Param('claimId') claimId: string) {
    const c = await this.prisma.cpdClaim.findFirst({
      where: { id: parseId(claimId), practitionerId: parseId(id) },
      include: { entries: true, activity: { include: { provider: { select: { name: true } }, type: { select: { name: true } } } }, nonTokenClaim: true },
    });
    if (!c) throw NotFound('Claim');
    return c;
  }

  @RequirePermissions(PERMISSIONS.MANAGE_PRACTITIONERS)
  @Post('practitioners/:id/reprocess-attendance')
  async reprocess(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.attendees.reprocessForPractitioner(parseId(id), u.id);
  }
}

/** Attendee imports and claims per activity (provider workspace; regulator via oversight). */
@ApiTags('provider workspace: attendees')
@UseGuards(ProviderMemberGuard)
@Controller('providers/:providerId/activities/:activityId')
export class ActivityAttendeesController {
  constructor(private readonly prisma: PrismaService, private readonly attendees: AttendeesService, private readonly jobs: JobsService) {}

  @Get('claims')
  async claims(@Param('activityId') aid: string, @Query(PageQuery()) q: Pagination) {
    const where: any = { activityId: parseId(aid), deletedAt: null };
    if (q.search) where.practitioner = { OR: [{ regNo: { contains: q.search.replace(/\s+/g, ''), mode: 'insensitive' } }, { lastName: { contains: q.search, mode: 'insensitive' } }] };
    const [rows, total] = await Promise.all([
      this.prisma.cpdClaim.findMany({ where, ...pageArgs(q), orderBy: { claimedAt: 'desc' }, include: { practitioner: { select: { regNo: true, firstName: true, lastName: true } } } }),
      this.prisma.cpdClaim.count({ where }),
    ]);
    return paged(rows, total, q);
  }

  @Get('imports/template')
  async template(@Res() res: Response) {
    sendFile(res, await this.attendees.template(), MIME.xlsx, 'attendees-template.xlsx');
  }

  @Get('imports')
  async imports(@Param('activityId') aid: string, @Query(PageQuery()) q: Pagination & { status?: string }) {
    const where: any = { activityId: parseId(aid), deletedAt: null, ...(q.status ? { status: q.status } : {}) };
    if (q.search) where.OR = [{ regNo: { contains: q.search.replace(/\s+/g, ''), mode: 'insensitive' } }, { fullName: { contains: q.search, mode: 'insensitive' } }];
    const [rows, total] = await Promise.all([
      this.prisma.attendeeImport.findMany({ where, ...pageArgs(q), orderBy: { id: 'asc' } }),
      this.prisma.attendeeImport.count({ where }),
    ]);
    return paged(rows, total, q);
  }

  @Post('imports')
  @UseInterceptors(FileInterceptor('file'))
  upload(@CurrentUser() u: AuthUser, @Param('activityId') aid: string, @UploadedFile() file: UFile) {
    return this.attendees.import(parseId(aid), file, u.id);
  }

  @Put('imports/:id')
  async edit(@CurrentUser() u: AuthUser, @Param('activityId') aid: string, @Param('id') id: string, @Body(Z(z.object({ regNo: z.string().trim().min(2), fullName: z.string().optional().nullable(), email: z.string().optional().nullable(), session: z.coerce.number().int().min(1).default(1) }))) b: any) {
    const row = await this.prisma.attendeeImport.findFirst({ where: { id: parseId(id), activityId: parseId(aid), deletedAt: null } });
    if (!row) throw NotFound('Imported attendee');
    if (row.status === 'processed') throw Unprocessable('Processed rows cannot be edited.');
    return this.prisma.attendeeImport.update({ where: { id: row.id }, data: { ...b, regNo: b.regNo.replace(/\s+/g, '').toUpperCase(), status: 'unprocessed', comment: null, updatedBy: u.id } });
  }

  @Delete('imports/:id')
  async remove(@CurrentUser() u: AuthUser, @Param('activityId') aid: string, @Param('id') id: string) {
    const row = await this.prisma.attendeeImport.findFirst({ where: { id: parseId(id), activityId: parseId(aid), deletedAt: null } });
    if (!row) throw NotFound('Imported attendee');
    await this.prisma.attendeeImport.update({ where: { id: row.id }, data: { deletedAt: new Date(), deletedBy: u.id } });
    return { ok: true };
  }

  @Post('imports/:id/process')
  async processOne(@CurrentUser() u: AuthUser, @Param('activityId') aid: string, @Param('id') id: string) {
    const row = await this.prisma.attendeeImport.findFirst({ where: { id: parseId(id), activityId: parseId(aid), deletedAt: null } });
    if (!row) throw NotFound('Imported attendee');
    return this.attendees.processOne(row.id, u.id);
  }

  /** Runs as a background job; poll GET /jobs/:id for progress. */
  @Post('imports/process-all')
  processAll(@CurrentUser() u: AuthUser, @Param('activityId') aid: string) {
    return this.jobs.enqueue('attendees.process-all', { activityId: aid, actorId: u.id.toString() }, u.id);
  }
}

@ApiTags('jobs')
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}
  @Get(':id')
  async get(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const run = await this.jobs.get(parseId(id));
    if (!run) throw NotFound('Job');
    if (run.createdBy !== u.id && !hasPermission(u, PERMISSIONS.READ_ADMIN_PANEL)) throw Forbidden();
    return run;
  }
}

@Module({
  imports: [ProvidersModule],
  controllers: [MeClaimsController, QuickClaimController, RegulatorClaimsController, ActivityAttendeesController, JobsController],
  providers: [PointsService, ComplianceService, DiaryService, NonTokenService, AttendeesService, ExemptionsService],
  exports: [PointsService, ComplianceService, DiaryService, ExemptionsService, AttendeesService],
})
export class ClaimsModule {}
