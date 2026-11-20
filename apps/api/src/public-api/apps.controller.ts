import { Body, Controller, Delete, Get, Module, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { API_APP_STATUSES, API_APP_TYPES, PERMISSIONS, type Pagination } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { config } from '../common/config';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/auth.decorators';
import { Z } from '../common/zod';
import { PageQuery, pageArgs, paged } from '../common/pagination';
import { BadRequest, NotFound } from '../common/errors';
import { randomToken, sha256 } from '../common/crypto';
import { MIME, sendFile } from '../common/files';
import { AuditService } from '../audit/audit.service';
import { RequirePasswordConfirm } from '../auth/confirm.guard';
import { ActivitiesModule } from '../activities/activities.controller';
import { ClaimsModule } from '../claims/claims.controller';
import { CouncilController, PublicApiV1Controller } from './v1.controller';
import { ApiConsumerGuard } from './api-consumer.guard';
import { MaintenanceController, MaintenanceTasks } from './maintenance';

const appSchema = z.object({
  name: z.string().trim().min(2).max(255),
  description: z.string().optional().nullable(),
  url: z.string().url().optional().nullable().or(z.literal('').transform(() => null)),
  providerId: z.coerce.bigint().optional().nullable(),
  type: z.enum(API_APP_TYPES),
  status: z.enum(API_APP_STATUSES).default('INACTIVE'),
  note: z.string().optional().nullable(),
  isCouncil: z.boolean().default(false),
});

/** key = 21 hex chars; secret = the remaining 107 of 128 hex chars. Only the secret's hash is stored. */
export function generateCredentials() {
  const hex = randomBytes(64).toString('hex');
  return { key: hex.slice(0, 21), secret: hex.slice(21) };
}

const publicApp = (a: any) => {
  const { secretHash, ...rest } = a;
  return { ...rest, hasCredentials: !!secretHash };
};

/** API consumer apps (spec 7: regulator UI). */
@ApiTags('regulator: API apps')
@RequirePermissions(PERMISSIONS.READ_ADMIN_PANEL, PERMISSIONS.MANAGE_APPS)
@Controller('regulator/apps')
export class ApiAppsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  async list(@Query(PageQuery()) q: Pagination & { providerId?: string }) {
    const where: any = { deletedAt: null, ...(q.providerId ? { providerId: BigInt(q.providerId) } : {}) };
    if (q.search) where.name = { contains: q.search, mode: 'insensitive' };
    const [rows, total] = await Promise.all([
      this.prisma.apiConsumerApp.findMany({ where, ...pageArgs(q), orderBy: { createdAt: 'desc' }, include: { provider: { select: { id: true, name: true } } } }),
      this.prisma.apiConsumerApp.count({ where }),
    ]);
    return paged(rows.map(publicApp), total, q);
  }

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body(Z(appSchema)) b: z.infer<typeof appSchema>) {
    if (!b.isCouncil && !b.providerId) throw BadRequest('Link the app to a provider (or mark it as the council credential).');
    const app = await this.prisma.apiConsumerApp.create({ data: { ...b, providerId: b.isCouncil ? null : b.providerId, createdBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'api-apps', event: 'created', subjectType: 'api_app', subjectId: app.id, properties: { ...b, providerId: b.providerId?.toString() } });
    return publicApp(app);
  }

  @Put(':id')
  async update(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(appSchema)) b: z.infer<typeof appSchema>) {
    const app = await this.prisma.apiConsumerApp.update({ where: { id: Number(id) }, data: { ...b, providerId: b.isCouncil ? null : b.providerId, updatedBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'api-apps', event: 'updated', subjectType: 'api_app', subjectId: app.id, properties: { status: b.status } });
    return publicApp(app);
  }

  @Delete(':id')
  async remove(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const app = await this.prisma.apiConsumerApp.findFirst({ where: { id: Number(id), deletedAt: null } });
    if (!app) throw NotFound('App');
    await this.prisma.apiConsumerApp.update({ where: { id: app.id }, data: { deletedAt: new Date(), deletedBy: u.id, key: null, secretHash: null, name: `${app.name} (deleted ${app.id})` } });
    await this.audit.log({ actorId: u.id, logName: 'api-apps', event: 'deleted', subjectType: 'api_app', subjectId: app.id });
    return { ok: true };
  }

  /** Generate or rotate credentials (app must be ACTIVE). The secret is returned once. */
  @RequirePasswordConfirm()
  @Post(':id/credentials')
  async rotate(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const app = await this.prisma.apiConsumerApp.findFirst({ where: { id: Number(id), deletedAt: null } });
    if (!app) throw NotFound('App');
    if (app.status !== 'ACTIVE') throw BadRequest('Activate the app before generating credentials.');
    const { key, secret } = generateCredentials();
    await this.prisma.apiConsumerApp.update({ where: { id: app.id }, data: { key, secretHash: sha256(secret), rotatedAt: new Date(), updatedBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'api-apps', event: app.secretHash ? 'credentials-rotated' : 'credentials-generated', subjectType: 'api_app', subjectId: app.id });
    return {
      key,
      secret,
      header: `api-consumer: ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
      file: `ICPD API credentials\nApp: ${app.name}\nBase URL: ${config.apiUrl}/api/v1\nKey: ${key}\nSecret: ${secret}\nHeader: api-consumer: base64(key:secret)\nGenerated: ${new Date().toISOString()}\n\nStore the secret securely. It cannot be shown again.\n`,
    };
  }

  @Get(':id/logs')
  async logs(@Param('id') id: string, @Query(PageQuery()) q: Pagination) {
    const where = { appId: Number(id) };
    const [rows, total] = await Promise.all([
      this.prisma.apiLog.findMany({ where, ...pageArgs(q), orderBy: { logDate: 'desc' } }),
      this.prisma.apiLog.count({ where }),
    ]);
    return paged(rows, total, q);
  }
}

/** Developer dashboard: personal access tokens (Bearer icpd_pat_…) for API consumers. */
@ApiTags('developer')
@RequirePermissions(PERMISSIONS.READ_DEVELOPER_PANEL)
@Controller('me/tokens')
export class PersonalTokensController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.prisma.personalAccessToken.findMany({ where: { userId: u.id, revokedAt: null }, select: { id: true, name: true, lastUsedAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
  }

  @Post()
  async create(@CurrentUser() u: AuthUser, @Body(Z(z.object({ name: z.string().trim().min(2).max(100) }))) b: { name: string }) {
    const token = `icpd_pat_${randomToken(24)}`;
    const row = await this.prisma.personalAccessToken.create({ data: { userId: u.id, name: b.name, tokenHash: sha256(token) } });
    await this.audit.log({ actorId: u.id, logName: 'auth', event: 'pat-created', subjectType: 'user', subjectId: u.id, properties: { name: b.name } });
    return { id: row.id, name: row.name, token };
  }

  @Delete(':id')
  async revoke(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.personalAccessToken.updateMany({ where: { id: BigInt(id), userId: u.id }, data: { revokedAt: new Date() } });
    await this.audit.log({ actorId: u.id, logName: 'auth', event: 'pat-revoked', subjectType: 'user', subjectId: u.id });
    return { ok: true };
  }
}

export function credentialsFile(res: Response, text: string) {
  sendFile(res, text, MIME.txt, 'icpd-api-credentials.txt');
}

@Module({
  imports: [ActivitiesModule, ClaimsModule],
  controllers: [PublicApiV1Controller, CouncilController, ApiAppsController, PersonalTokensController, MaintenanceController],
  providers: [ApiConsumerGuard, MaintenanceTasks],
  exports: [MaintenanceTasks],
})
export class PublicApiModule {}
