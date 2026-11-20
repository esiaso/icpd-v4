import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { dateOnly, isExpired, maskEmail, nairobiYear, normalizeRegNo, round2 } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { Public } from '../common/auth.decorators';
import { Z } from '../common/zod';
import { AppError, NotFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { ActivitiesService } from '../activities/activities.service';
import { PointsService, ClaimError } from '../points/points.service';
import { ComplianceService } from '../compliance/compliance.service';
import { ExemptionsService } from '../claims/exemptions.service';
import { DiaryService } from '../claims/diary.service';
import { ApiConsumerGuard, CouncilOnly, type ApiConsumer } from './api-consumer.guard';

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use Y-m-d');
const registration = z
  .object({
    activityType: z.coerce.number().int(),
    activityName: z.string().trim().min(2).max(255),
    releaseDate: ymd,
    expiryDate: ymd,
    objectives: z.string().trim().min(2),
    description: z.string().trim().min(10),
    activityUrl: z.string().url(),
  })
  .refine((v) => v.expiryDate >= v.releaseDate, { path: ['expiryDate'], message: 'expiryDate must be on or after releaseDate' });
const activityIdBody = z.object({ activityId: z.coerce.bigint() });
const regNoBody = z.object({ regNo: z.string().trim().min(2).max(20) });

type Req = { apiConsumer: ApiConsumer; ip?: string };

const activityOut = (a: any) => ({
  activityId: a.id,
  activityNo: a.activityNo,
  activityName: a.name,
  activityType: a.activityTypeId,
  activityTypeName: a.type?.name,
  objectives: a.objectives,
  description: a.description,
  releaseDate: dateOnly(a.releaseDate),
  expiryDate: dateOnly(a.expiryDate),
  activityUrl: a.shortenedUrl ?? a.venueOnline,
  cpdPoints: a.cpdPoints,
  published: a.published,
  datePublished: a.datePublished,
});

/**
 * Public REST API v1 for provider systems (spec 7). Field names follow the legacy API; errors
 * now use proper 4xx status codes with `{ error: { code, message, details } }`.
 */
@ApiTags('public API v1')
@ApiSecurity('api-consumer')
@ApiHeader({ name: 'api-consumer', description: 'base64(key:secret)', required: true })
@ApiResponse({ status: 401, description: 'Missing/invalid credentials' })
@ApiResponse({ status: 403, description: 'Application not ACTIVE, or resource belongs to another provider' })
@ApiResponse({ status: 429, description: 'Rate limited (per consumer)' })
@Public()
@UseGuards(ApiConsumerGuard)
@Throttle({ default: { limit: 120, ttl: 60_000 } })
@Controller('v1')
export class PublicApiV1Controller {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
    private readonly points: PointsService,
    private readonly compliance: ComplianceService,
    private readonly exemptions: ExemptionsService,
    private readonly diary: DiaryService,
  ) {}

  private log(c: ApiConsumer, type: string, notes: string) {
    return this.audit.apiLog(c.providerId, c.appId, type, notes);
  }

  private async ownActivity(c: ApiConsumer, id: bigint) {
    const a = await this.prisma.activity.findFirst({ where: { id, deletedAt: null }, include: { type: true } });
    if (!a) throw NotFound('Activity');
    if (a.providerId !== c.providerId) throw new AppError('FORBIDDEN', 'This activity does not belong to your organisation', 403);
    return a;
  }

  @Get('activities')
  @ApiOperation({ summary: "The calling provider's non-archived activities, ordered by releaseDate" })
  async list(@Req() req: Req, @Query('page') page = '1') {
    const c = req.apiConsumer;
    const p = Math.max(1, Number(page) || 1);
    const where = { providerId: c.providerId!, deletedAt: null, archived: false };
    const [rows, total] = await Promise.all([
      this.prisma.activity.findMany({ where, include: { type: true }, orderBy: { releaseDate: 'desc' }, skip: (p - 1) * 50, take: 50 }),
      this.prisma.activity.count({ where }),
    ]);
    await this.log(c, 'activity_list', `page ${p}`);
    return { data: rows.map(activityOut), total, page: p, pageSize: 50 };
  }

  @Get('activities/types')
  async types(@Req() req: Req) {
    await this.log(req.apiConsumer, 'activity_types', '');
    return this.prisma.activityType.findMany({ where: { deletedAt: null, archived: false }, orderBy: { name: 'asc' } });
  }

  @Get('activities/types/event/based')
  async eventTypes(@Req() req: Req) {
    await this.log(req.apiConsumer, 'activity_types', 'event based');
    return this.prisma.activityType.findMany({ where: { deletedAt: null, archived: false, eventBased: true }, orderBy: { name: 'asc' } });
  }

  @Post('activities/types/details')
  @HttpCode(200)
  async typeDetails(@Req() req: Req, @Body(Z(z.object({ typeId: z.coerce.number().int() }))) b: { typeId: number }) {
    const t = await this.prisma.activityType.findFirst({ where: { id: b.typeId, deletedAt: null } });
    if (!t) throw NotFound('Activity type');
    await this.log(req.apiConsumer, 'activity_type_details', String(b.typeId));
    return t;
  }

  /** Only online types that providers/API may create (deliveryMode 2, initiator 1, not archived). */
  private async apiType(id: number) {
    const t = await this.prisma.activityType.findFirst({ where: { id, deletedAt: null, archived: false, deliveryMode: 2, initiator: 1 } });
    if (!t) throw new AppError('TYPE_NOT_ALLOWED', 'This Activity Type cannot be created via API!', 422);
    return t;
  }

  @Post('activity/registration')
  @ApiOperation({ summary: 'Create an online activity for the calling provider' })
  async register(@Req() req: Req, @Body(Z(registration)) b: z.infer<typeof registration>) {
    const c = req.apiConsumer;
    await this.apiType(b.activityType);
    const a = await this.activities.create(
      c.providerId!,
      { activityTypeId: b.activityType, name: b.activityName, numSessions: 1, releaseDate: b.releaseDate, expiryDate: b.expiryDate, deliveryMode: 'online', venueOnline: b.activityUrl, specializationAreas: [] } as any,
      null,
      { objectives: b.objectives, description: b.description, shortenedUrl: b.activityUrl },
    );
    await this.log(c, 'activity_create', `activity ${a.id}`);
    return { success: true, message: 'Activity registered', activity: activityOut(await this.ownActivity(c, a.id)) };
  }

  @Post('activity/view')
  @HttpCode(200)
  async view(@Req() req: Req, @Body(Z(activityIdBody)) b: { activityId: bigint }) {
    const a = await this.ownActivity(req.apiConsumer, b.activityId);
    await this.log(req.apiConsumer, 'activity_view', String(a.id));
    return activityOut(a);
  }

  @Post('activity/update')
  @HttpCode(200)
  async update(@Req() req: Req, @Body(Z(registration.innerType().extend({ activityId: z.coerce.bigint() }))) b: any) {
    const c = req.apiConsumer;
    const a = await this.ownActivity(c, b.activityId);
    await this.apiType(b.activityType);
    await this.activities.update(
      a.id,
      { activityTypeId: b.activityType, name: b.activityName, numSessions: a.numSessions, releaseDate: b.releaseDate, expiryDate: b.expiryDate, deliveryMode: 'online', venueOnline: b.activityUrl, specializationAreas: (a.specializationAreas as number[]) ?? [] } as any,
      null,
      { objectives: b.objectives, description: b.description, shortenedUrl: b.activityUrl },
    );
    await this.log(c, 'activity_update', String(a.id));
    return { success: true, message: 'Activity updated', activity: activityOut(await this.ownActivity(c, a.id)) };
  }

  @Post('activity/publish')
  @HttpCode(200)
  async publish(@Req() req: Req, @Body(Z(activityIdBody)) b: { activityId: bigint }) {
    const a = await this.ownActivity(req.apiConsumer, b.activityId);
    await this.activities.setPublished(a.id, true, null, 'API');
    await this.log(req.apiConsumer, 'activity_publish', String(a.id));
    return { success: true, message: 'Activity published' };
  }

  @Post('activity/unpublish')
  @HttpCode(200)
  async unpublish(@Req() req: Req, @Body(Z(activityIdBody)) b: { activityId: bigint }) {
    const a = await this.ownActivity(req.apiConsumer, b.activityId);
    await this.activities.setPublished(a.id, false, null, 'API');
    await this.log(req.apiConsumer, 'activity_unpublish', String(a.id));
    return { success: true, message: 'Activity unpublished' };
  }

  @Post('activity/delete')
  @HttpCode(200)
  async remove(@Req() req: Req, @Body(Z(activityIdBody)) b: { activityId: bigint }) {
    const a = await this.ownActivity(req.apiConsumer, b.activityId);
    await this.activities.softDelete(a.id, null);
    await this.log(req.apiConsumer, 'activity_delete', String(a.id));
    return { success: true, message: 'Activity deleted' };
  }

  private async practitionerByRegNo(regNo: string) {
    return this.prisma.practitioner.findFirst({ where: { regNo: normalizeRegNo(regNo), deletedAt: null }, orderBy: { id: 'asc' } });
  }

  /** Points for a year with the exemption rule, plus compliance fields (spec 5.7.2). */
  private async pointsPayload(practitionerId: bigint, regNo: string, year: number) {
    const raw = await this.diary.points(practitionerId, year);
    const c = await this.compliance.evaluate(practitionerId, year);
    const required = c.framework.totalRequiredPoints;
    const rep = await this.exemptions.reportedPoints(practitionerId, year, raw, required);
    return {
      regNo,
      points: round2(rep.points).toFixed(2),
      year,
      ...(rep.exempted ? { exempted: true } : {}),
      countablePoints: c.evaluation.countablePoints.toFixed(2),
      compliant: c.evaluation.compliant,
      requiredPoints: required,
      buckets: c.evaluation.buckets.map((b) => ({ name: b.name, points: b.points, required: b.required, distinctTypes: b.distinctTypes, passed: b.passed })),
      datetime: new Date().toISOString(),
    };
  }

  @Get('practitioners/:regNo')
  @ApiOperation({ summary: 'Practitioner portfolio summary by registration number' })
  async practitioner(@Req() req: Req, @Param('regNo') regNo: string, @Query('year') year?: string) {
    const p = await this.practitionerByRegNo(regNo);
    if (!p) throw NotFound('Practitioner');
    const y = year ? Number(year) : nairobiYear();
    const years = await this.diary.years(p.id);
    await this.log(req.apiConsumer, 'get_points', `${p.regNo} summary`);
    return {
      name: p.status === 'registered' ? p.firstName : null,
      status: p.status === 'registered' ? 'Verified' : 'Unverified',
      ...(await this.pointsPayload(p.id, p.regNo!, y)),
      years,
    };
  }

  @Post('practitioners/claimpoints')
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiOperation({ summary: 'Award base points for an activity (no presenter/moderator bonus)' })
  async claim(@Req() req: Req, @Body(Z(z.object({ regNo: z.string().trim().min(2), activityId: z.coerce.bigint(), claimId: z.string().max(100).optional() }))) b: any) {
    const c = req.apiConsumer;
    const a = await this.ownActivity(c, b.activityId);
    if (isExpired(a.expiryDate)) throw new AppError('ACTIVITY_EXPIRED', 'This activity has expired', 422);
    if (!a.published) throw new AppError('NOT_PUBLISHED', 'This activity is not published', 422);
    const p = await this.practitionerByRegNo(b.regNo);
    if (!p) throw NotFound('Practitioner');
    try {
      const r = await this.points.claimApi(p, a, b.claimId);
      await this.log(c, 'award_points', `${p.regNo} +${r.points} activity ${a.id}`);
      return { success: true, regNo: p.regNo, activityId: a.id, points: r.points, totalForActivity: r.totalForActivity, year: r.calYear, message: `${r.points} points awarded` };
    } catch (e) {
      if (e instanceof ClaimError) await this.log(c, 'award_points_failed', `${p.regNo} activity ${a.id}: ${e.message}`);
      throw e;
    }
  }

  @Post('practitioners/points')
  @HttpCode(200)
  async pointsByRegNo(@Req() req: Req, @Body(Z(z.object({ regNo: z.string().trim().min(4).max(8), year: z.coerce.number().int().optional() }))) b: { regNo: string; year?: number }) {
    const p = await this.practitionerByRegNo(b.regNo);
    if (!p) throw NotFound('Practitioner');
    await this.log(req.apiConsumer, 'get_points', p.regNo!);
    return this.pointsPayload(p.id, p.regNo!, b.year ?? nairobiYear());
  }

  @Post('verify')
  @HttpCode(200)
  async verify(@Req() req: Req, @Body(Z(regNoBody)) b: { regNo: string }) {
    const p = await this.practitionerByRegNo(b.regNo);
    await this.log(req.apiConsumer, 'verify', normalizeRegNo(b.regNo));
    const registered = p?.status === 'registered';
    return {
      regNo: p?.regNo ?? normalizeRegNo(b.regNo),
      email: maskEmail(p?.email),
      ...(registered ? { name: p!.firstName } : {}),
      status: registered ? 'Verified' : 'Unverified',
      datetime: new Date().toISOString(),
    };
  }
}

/** Council/board system: points for a year (separate council credential). */
@ApiTags('public API v1')
@ApiSecurity('api-consumer')
@Public()
@CouncilOnly()
@UseGuards(ApiConsumerGuard)
@Controller('v1/council')
export class CouncilController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly diary: DiaryService,
    private readonly compliance: ComplianceService,
    private readonly exemptions: ExemptionsService,
  ) {}

  @Get('diary')
  async diaryForYear(@Req() req: Req, @Query(Z(z.object({ regNo: z.string().trim().min(2), year: z.coerce.number().int().min(2000).max(2100) }))) q: { regNo: string; year: number }) {
    const p = await this.prisma.practitioner.findFirst({ where: { regNo: normalizeRegNo(q.regNo), deletedAt: null }, orderBy: { id: 'asc' } });
    if (!p) throw NotFound('Practitioner');
    const raw = await this.diary.points(p.id, q.year);
    const c = await this.compliance.evaluate(p.id, q.year);
    const rep = await this.exemptions.reportedPoints(p.id, q.year, raw, c.framework.totalRequiredPoints);
    await this.audit.apiLog(null, req.apiConsumer.appId, 'council_diary', `${p.regNo} ${q.year}`);
    return {
      regNo: p.regNo,
      year: q.year,
      points: round2(rep.points).toFixed(2),
      exempted: rep.exempted,
      countablePoints: c.evaluation.countablePoints.toFixed(2),
      compliant: c.evaluation.compliant,
      buckets: c.evaluation.buckets.map((b) => ({ name: b.name, points: b.points, required: b.required, distinctTypes: b.distinctTypes, passed: b.passed })),
      datetime: new Date().toISOString(),
    };
  }
}

