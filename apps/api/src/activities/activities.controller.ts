import { Body, Controller, Delete, Get, Module, Param, Patch, Post, Put, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { activityDescriptionSchema, activitySchema, generateTokensSchema, PERMISSIONS, type Pagination } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/auth.decorators';
import { Z } from '../common/zod';
import { PageQuery, pageArgs, paged, parseId, sortBy } from '../common/pagination';
import { MIME, sendFile } from '../common/files';
import { qrPng } from '../common/pdf';
import { StorageService, type UploadedFile as UFile } from '../storage/storage.service';
import { ProviderMemberGuard } from '../providers/provider-member.guard';
import { ProvidersModule } from '../providers/providers.controller';
import { ActivitiesService } from './activities.service';
import { TokensService, claimUrl, tokenStatus } from '../tokens/tokens.service';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const presenterSchema = z.object({
  regNo: z.string().trim().optional().nullable().transform((v) => (v ? v : null)),
  titleId: z.coerce.number().int().optional().nullable(),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().min(1),
  otherNames: z.string().optional().nullable(),
  topic: z.string().optional().nullable(),
  portfolio: z.string().optional().nullable(),
  affiliation: z.string().optional().nullable(),
});
const moderatorSchema = z.object({
  regNo: z.string().trim().optional().nullable().transform((v) => (v ? v : null)),
  titleId: z.coerce.number().int().optional().nullable(),
  firstName: z.string().trim().min(1),
  middleName: z.string().optional().nullable(),
  lastName: z.string().trim().min(1),
  portfolio: z.string().optional().nullable(),
});
const validitySchema = z.object({ validFrom: dateStr, expiryDate: dateStr, issued: z.boolean().optional() });
const bulkSchema = validitySchema.extend({ batch: z.string().optional(), sessionNo: z.coerce.number().int().optional() });
const tokenFilterSchema = z.object({
  batch: z.string().optional(),
  sessionNo: z.coerce.number().int().optional(),
  status: z.enum(['claimed', 'unclaimed', 'expired']).optional(),
  search: z.string().optional(),
  format: z.enum(['pdf', 'xlsx']).optional(),
});

function listWhere(providerId: bigint | null, q: Pagination & { archived?: string; published?: string }) {
  const where: any = { deletedAt: null, archived: q.archived === 'true' };
  if (providerId) where.providerId = providerId;
  if (q.published === 'true') where.published = true;
  if (q.published === 'false') where.published = false;
  if (q.search) {
    where.OR = [
      { name: { contains: q.search, mode: 'insensitive' } },
      { activityNo: { contains: q.search, mode: 'insensitive' } },
      ...(providerId ? [] : [{ provider: { name: { contains: q.search, mode: 'insensitive' } } }]),
    ];
  }
  return where;
}

const listInclude = {
  type: { select: { name: true } },
  provider: { select: { id: true, name: true } },
  _count: { select: { tokens: { where: { deletedAt: null } }, claims: { where: { deletedAt: null } } } },
} as const;

/**
 * Provider workspace: activities, presenters, moderators and tokens (spec 5.4, 5.5).
 * ProviderMemberGuard checks membership (or regulator oversight) and that :activityId belongs
 * to :providerId.
 */
@ApiTags('provider workspace: activities')
@UseGuards(ProviderMemberGuard)
@Controller('providers/:providerId/activities')
export class ProviderActivitiesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activities: ActivitiesService,
    private readonly tokens: TokensService,
    private readonly storage: StorageService,
  ) {}

  @Get()
  async list(@Param('providerId') pid: string, @Query(PageQuery()) q: Pagination & { archived?: string; published?: string }) {
    const where = listWhere(parseId(pid), q);
    const [rows, total] = await Promise.all([
      this.prisma.activity.findMany({ where, ...pageArgs(q), orderBy: sortBy(q, ['name', 'releaseDate', 'published', 'createdAt'], { createdAt: 'desc' }), include: listInclude }),
      this.prisma.activity.count({ where }),
    ]);
    return paged(rows, total, q);
  }

  @Post()
  create(@CurrentUser() u: AuthUser, @Param('providerId') pid: string, @Body(Z(activitySchema)) b: z.infer<typeof activitySchema>) {
    return this.activities.create(parseId(pid), b, u.id);
  }

  @Get(':activityId')
  async get(@Param('activityId') id: string) {
    const a = await this.activities.detail(parseId(id));
    return { ...a, posterSignedUrl: await this.storage.signedUrl(a.posterUrl, 3600), claimUrl: claimUrl(a.id) };
  }

  @Put(':activityId')
  update(@CurrentUser() u: AuthUser, @Param('activityId') id: string, @Body(Z(activitySchema)) b: z.infer<typeof activitySchema>) {
    return this.activities.update(parseId(id), b, u.id);
  }

  @Patch(':activityId/description')
  describe(@CurrentUser() u: AuthUser, @Param('activityId') id: string, @Body(Z(activityDescriptionSchema)) b: z.infer<typeof activityDescriptionSchema>) {
    return this.activities.describe(parseId(id), b, u.id);
  }

  @Delete(':activityId')
  async remove(@CurrentUser() u: AuthUser, @Param('activityId') id: string) {
    await this.activities.softDelete(parseId(id), u.id);
    return { ok: true };
  }

  @Post(':activityId/publish')
  publish(@CurrentUser() u: AuthUser, @Param('activityId') id: string) {
    return this.activities.setPublished(parseId(id), true, u.id);
  }

  @Post(':activityId/unpublish')
  unpublish(@CurrentUser() u: AuthUser, @Param('activityId') id: string) {
    return this.activities.setPublished(parseId(id), false, u.id);
  }

  @Post(':activityId/archive')
  archive(@CurrentUser() u: AuthUser, @Param('activityId') id: string, @Body(Z(z.object({ archived: z.boolean() }))) b: { archived: boolean }) {
    return this.activities.setArchived(parseId(id), b.archived, u.id);
  }

  @Post(':activityId/poster')
  @UseInterceptors(FileInterceptor('file'))
  async poster(@CurrentUser() u: AuthUser, @Param('activityId') id: string, @UploadedFile() file: UFile) {
    this.storage.validate(file, 'image', 5 * 1024 * 1024);
    const key = await this.storage.put('posters', file);
    await this.prisma.activity.update({ where: { id: parseId(id) }, data: { posterUrl: key, updatedBy: u.id } });
    return { ok: true };
  }

  /** QR code PNG that links to the public quick-claim page. */
  @Get(':activityId/qr')
  async qr(@Param('activityId') id: string, @Res() res: Response) {
    sendFile(res, await qrPng(claimUrl(id), 600), MIME.png, `activity-${id}-qr.png`, true);
  }

  /** Look up registered practitioners by reg. no. or name to fill presenter/moderator forms. */
  @Get(':activityId/practitioner-lookup')
  lookup(@Query('q') q = '') {
    return this.activities.lookupPractitioners(q);
  }

  // ── presenters ──
  @Get(':activityId/presenters')
  presenters(@Param('activityId') id: string) {
    return this.prisma.activityPresenter.findMany({ where: { activityId: parseId(id), deletedAt: null }, orderBy: { id: 'asc' } });
  }
  @Post(':activityId/presenters')
  addPresenter(@CurrentUser() u: AuthUser, @Param('activityId') id: string, @Body(Z(presenterSchema)) b: z.infer<typeof presenterSchema>) {
    return this.activities.addPerson('presenter', parseId(id), b, u.id);
  }
  @Put(':activityId/presenters/:id')
  updatePresenter(@CurrentUser() u: AuthUser, @Param('activityId') aid: string, @Param('id') id: string, @Body(Z(presenterSchema)) b: z.infer<typeof presenterSchema>) {
    return this.activities.updatePerson('presenter', parseId(aid), parseId(id), b, u.id);
  }
  @Delete(':activityId/presenters/:id')
  async removePresenter(@CurrentUser() u: AuthUser, @Param('activityId') aid: string, @Param('id') id: string) {
    await this.activities.removePerson('presenter', parseId(aid), parseId(id), u.id);
    return { ok: true };
  }

  // ── moderators ──
  @Get(':activityId/moderators')
  moderators(@Param('activityId') id: string) {
    return this.prisma.activityModerator.findMany({ where: { activityId: parseId(id), deletedAt: null }, orderBy: { id: 'asc' } });
  }
  @Post(':activityId/moderators')
  addModerator(@CurrentUser() u: AuthUser, @Param('activityId') id: string, @Body(Z(moderatorSchema)) b: z.infer<typeof moderatorSchema>) {
    return this.activities.addPerson('moderator', parseId(id), b, u.id);
  }
  @Put(':activityId/moderators/:id')
  updateModerator(@CurrentUser() u: AuthUser, @Param('activityId') aid: string, @Param('id') id: string, @Body(Z(moderatorSchema)) b: z.infer<typeof moderatorSchema>) {
    return this.activities.updatePerson('moderator', parseId(aid), parseId(id), b, u.id);
  }
  @Delete(':activityId/moderators/:id')
  async removeModerator(@CurrentUser() u: AuthUser, @Param('activityId') aid: string, @Param('id') id: string) {
    await this.activities.removePerson('moderator', parseId(aid), parseId(id), u.id);
    return { ok: true };
  }

  // ── tokens ──
  @Get(':activityId/tokens')
  async tokenList(@Param('activityId') id: string, @Query(PageQuery()) q: Pagination & z.infer<typeof tokenFilterSchema>) {
    const where = this.tokens.where(parseId(id), q);
    const [rows, total] = await Promise.all([
      this.prisma.activityToken.findMany({
        where,
        ...pageArgs(q),
        orderBy: sortBy(q, ['token', 'sessionNo', 'batch', 'expiryDate', 'claimedAt'], { id: 'asc' }),
        include: { claimer: { select: { regNo: true, firstName: true, lastName: true } } },
      }),
      this.prisma.activityToken.count({ where }),
    ]);
    return paged(rows.map((t) => ({ ...t, computedStatus: tokenStatus(t) })), total, q);
  }

  @Get(':activityId/tokens/summary')
  tokenSummary(@Param('activityId') id: string) {
    return this.tokens.counts(parseId(id));
  }

  @Post(':activityId/tokens')
  generate(@CurrentUser() u: AuthUser, @Param('activityId') id: string, @Body(Z(generateTokensSchema)) b: z.infer<typeof generateTokensSchema>) {
    return this.tokens.generate(parseId(id), b, u.id);
  }

  @Put(':activityId/tokens/:tokenId')
  async updateToken(@CurrentUser() u: AuthUser, @Param('activityId') aid: string, @Param('tokenId') tid: string, @Body(Z(validitySchema)) b: z.infer<typeof validitySchema>) {
    await this.tokens.updateOne(parseId(aid), parseId(tid), b, u.id);
    return { ok: true };
  }

  @Patch(':activityId/tokens')
  bulkUpdate(@CurrentUser() u: AuthUser, @Param('activityId') aid: string, @Body(Z(bulkSchema)) b: z.infer<typeof bulkSchema>) {
    return this.tokens.bulkUpdate(parseId(aid), { batch: b.batch, sessionNo: b.sessionNo }, b, u.id);
  }

  @Delete(':activityId/tokens/:tokenId')
  removeToken(@CurrentUser() u: AuthUser, @Param('activityId') aid: string, @Param('tokenId') tid: string) {
    return this.tokens.remove(parseId(aid), { tokenId: parseId(tid) }, u.id);
  }

  @Post(':activityId/tokens/delete')
  removeTokens(@CurrentUser() u: AuthUser, @Param('activityId') aid: string, @Body(Z(z.object({ batch: z.string().optional(), sessionNo: z.coerce.number().int().optional() }))) b: { batch?: string; sessionNo?: number }) {
    return this.tokens.remove(parseId(aid), b, u.id);
  }

  /** Download all / by batch / by session as printable PDF cards or Excel. */
  @Get(':activityId/tokens/download')
  async download(@Param('activityId') aid: string, @Query(Z(tokenFilterSchema)) q: z.infer<typeof tokenFilterSchema>, @Res() res: Response) {
    const id = parseId(aid);
    const suffix = q.batch ? `batch-${q.batch}` : q.sessionNo ? `session-${q.sessionNo}` : 'all';
    if (q.format === 'xlsx') return sendFile(res, await this.tokens.xlsx(id, q), MIME.xlsx, `tokens-${aid}-${suffix}.xlsx`);
    sendFile(res, await this.tokens.pdf(id, q), MIME.pdf, `tokens-${aid}-${suffix}.pdf`);
  }
}

/** Regulator oversight across all activities (spec 9: activities, archived, preview, tokens). */
@ApiTags('regulator: activities')
@RequirePermissions(PERMISSIONS.READ_ADMIN_PANEL, PERMISSIONS.MANAGE_ACTIVITIES)
@Controller('regulator/activities')
export class RegulatorActivitiesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@Query(PageQuery()) q: Pagination & { archived?: string; published?: string; providerId?: string }) {
    const where = listWhere(null, q);
    if (q.providerId) where.providerId = parseId(q.providerId);
    const [rows, total] = await Promise.all([
      this.prisma.activity.findMany({ where, ...pageArgs(q), orderBy: sortBy(q, ['name', 'releaseDate', 'published', 'createdAt'], { createdAt: 'desc' }), include: listInclude }),
      this.prisma.activity.count({ where }),
    ]);
    return paged(rows, total, q);
  }
}

@Module({
  imports: [ProvidersModule],
  controllers: [ProviderActivitiesController, RegulatorActivitiesController],
  providers: [ActivitiesService, TokensService],
  exports: [ActivitiesService, TokensService],
})
export class ActivitiesModule {}
