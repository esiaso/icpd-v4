import { Body, Controller, Delete, Get, Module, Param, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { z } from 'zod';
import { PERMISSIONS, type Pagination } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { CurrentUser, Public, RequirePermissions, type AuthUser } from '../common/auth.decorators';
import { Z } from '../common/zod';
import { PageQuery, pageArgs, paged } from '../common/pagination';
import { NotFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { StorageService, type UploadedFile as UFile } from '../storage/storage.service';
import { RecaptchaService } from '../auth/recaptcha.service';
import { sanitizeHtml } from './sanitize';

const pageSchema = z.object({
  title: z.string().trim().min(2).max(255),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and dashes'),
  status: z.enum(['published', 'draft']).default('published'),
  description: z.string().optional().nullable(),
  content: z.string().optional().nullable(),
});

const jsonArray = z.preprocess((v) => (typeof v === 'string' ? (v ? JSON.parse(v) : []) : v), z.array(z.coerce.number().int()));
const resourceSchema = z.object({
  title: z.string().trim().min(2).max(255),
  link: z.string().url().optional().nullable().or(z.literal('')),
  status: z.enum(['published', 'draft']).default('published'),
  specialities: jsonArray.default([]),
  details: z.string().optional().nullable(),
  type: z.string().optional().nullable(),
});

const contactSchema = z.object({
  name: z.string().trim().min(2).max(255),
  email: z.string().trim().email(),
  phone: z.string().trim().max(30).optional().nullable(),
  subject: z.string().trim().min(2).max(255),
  message: z.string().trim().min(5).max(5000),
  website: z.string().max(0).optional(),
  recaptchaToken: z.string().optional(),
});

/** CMS pages, resources and contact form (spec 4.8, 5.10, 5.11). */
@ApiTags('cms')
@Controller()
export class CmsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly recaptcha: RecaptchaService,
  ) {}

  // ── public ──
  @Public()
  @Get('public/pages/:slug')
  async page(@Param('slug') slug: string) {
    const p = await this.prisma.page.findFirst({ where: { slug, status: 'published', deletedAt: null } });
    if (!p) throw NotFound('Page');
    return p;
  }

  @Public()
  @Get('public/resources')
  async publicResources(@Query(PageQuery()) q: Pagination & { speciality?: string }) {
    const where: any = { status: 'published', deletedAt: null };
    if (q.search) where.title = { contains: q.search, mode: 'insensitive' };
    if (q.speciality) where.specialities = { array_contains: [Number(q.speciality)] };
    const [rows, total] = await Promise.all([
      this.prisma.resource.findMany({ where, ...pageArgs(q), orderBy: { createdAt: 'desc' } }),
      this.prisma.resource.count({ where }),
    ]);
    return paged(await Promise.all(rows.map((r) => this.withUrl(r))), total, q);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('public/contact')
  async contact(@Body(Z(contactSchema)) b: z.infer<typeof contactSchema>, @Req() req: Request) {
    await this.recaptcha.check(b, req.ip);
    const { website, recaptchaToken, ...data } = b;
    await this.prisma.contact.create({ data: { ...data, ip: req.ip } });
    return { ok: true, message: 'Thank you. We have received your message.' };
  }

  // ── admin: pages ──
  @RequirePermissions(PERMISSIONS.MANAGE_PAGES)
  @Get('cms/pages')
  async pages(@Query(PageQuery()) q: Pagination) {
    const where: any = { deletedAt: null, ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.page.findMany({ where, ...pageArgs(q), orderBy: { title: 'asc' } }),
      this.prisma.page.count({ where }),
    ]);
    return paged(rows, total, q);
  }

  @RequirePermissions(PERMISSIONS.MANAGE_PAGES)
  @Get('cms/pages/:id')
  async getPage(@Param('id') id: string) {
    const p = await this.prisma.page.findFirst({ where: { id: Number(id), deletedAt: null } });
    if (!p) throw NotFound('Page');
    return p;
  }

  @RequirePermissions(PERMISSIONS.MANAGE_PAGES)
  @Post('cms/pages')
  async createPage(@CurrentUser() u: AuthUser, @Body(Z(pageSchema)) b: z.infer<typeof pageSchema>) {
    const row = await this.prisma.page.create({ data: { ...b, content: sanitizeHtml(b.content), createdBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'cms', event: 'page-created', subjectType: 'page', subjectId: row.id });
    return row;
  }

  @RequirePermissions(PERMISSIONS.MANAGE_PAGES)
  @Put('cms/pages/:id')
  async updatePage(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(pageSchema)) b: z.infer<typeof pageSchema>) {
    const row = await this.prisma.page.update({ where: { id: Number(id) }, data: { ...b, content: sanitizeHtml(b.content), updatedBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'cms', event: 'page-updated', subjectType: 'page', subjectId: row.id });
    return row;
  }

  @RequirePermissions(PERMISSIONS.MANAGE_PAGES)
  @Delete('cms/pages/:id')
  async deletePage(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    const p = await this.prisma.page.update({ where: { id: Number(id) }, data: { deletedAt: new Date(), deletedBy: u.id } });
    // free the slug for reuse
    await this.prisma.page.update({ where: { id: p.id }, data: { slug: `${p.slug}--deleted-${p.id}` } });
    await this.audit.log({ actorId: u.id, logName: 'cms', event: 'page-deleted', subjectType: 'page', subjectId: id });
    return { ok: true };
  }

  // ── admin: resources ──
  @RequirePermissions(PERMISSIONS.MANAGE_PAGES)
  @Get('cms/resources')
  async resources(@Query(PageQuery()) q: Pagination) {
    const where: any = { deletedAt: null, ...(q.search ? { title: { contains: q.search, mode: 'insensitive' } } : {}) };
    const [rows, total] = await Promise.all([
      this.prisma.resource.findMany({ where, ...pageArgs(q), orderBy: { createdAt: 'desc' } }),
      this.prisma.resource.count({ where }),
    ]);
    return paged(await Promise.all(rows.map((r) => this.withUrl(r))), total, q);
  }

  @RequirePermissions(PERMISSIONS.MANAGE_PAGES)
  @Post('cms/resources')
  @UseInterceptors(FileInterceptor('file'))
  async createResource(@CurrentUser() u: AuthUser, @Body(Z(resourceSchema)) b: z.infer<typeof resourceSchema>, @UploadedFile() file?: UFile) {
    const fileData = file ? await this.storeFile(file) : {};
    const row = await this.prisma.resource.create({ data: { ...b, link: b.link || null, ...fileData, createdBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'cms', event: 'resource-created', subjectType: 'resource', subjectId: row.id });
    return row;
  }

  @RequirePermissions(PERMISSIONS.MANAGE_PAGES)
  @Put('cms/resources/:id')
  @UseInterceptors(FileInterceptor('file'))
  async updateResource(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body(Z(resourceSchema)) b: z.infer<typeof resourceSchema>, @UploadedFile() file?: UFile) {
    const fileData = file ? await this.storeFile(file) : {};
    const row = await this.prisma.resource.update({ where: { id: Number(id) }, data: { ...b, link: b.link || null, ...fileData, updatedBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'cms', event: 'resource-updated', subjectType: 'resource', subjectId: row.id });
    return row;
  }

  @RequirePermissions(PERMISSIONS.MANAGE_PAGES)
  @Delete('cms/resources/:id')
  async deleteResource(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.prisma.resource.update({ where: { id: Number(id) }, data: { deletedAt: new Date(), deletedBy: u.id } });
    await this.audit.log({ actorId: u.id, logName: 'cms', event: 'resource-deleted', subjectType: 'resource', subjectId: id });
    return { ok: true };
  }

  @RequirePermissions(PERMISSIONS.READ_ADMIN_PANEL)
  @Get('cms/contacts')
  async contacts(@Query(PageQuery()) q: Pagination) {
    const where: any = q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { subject: { contains: q.search, mode: 'insensitive' } }] } : {};
    const [rows, total] = await Promise.all([
      this.prisma.contact.findMany({ where, ...pageArgs(q), orderBy: { createdAt: 'desc' } }),
      this.prisma.contact.count({ where }),
    ]);
    return paged(rows, total, q);
  }

  private async storeFile(file: UFile) {
    this.storage.validate(file, 'any', 25 * 1024 * 1024);
    const key = await this.storage.put('resources', file);
    return { filePath: key, fullFileName: file.originalname, shortFile: file.originalname.slice(0, 60) };
  }

  private async withUrl<T extends { filePath: string | null }>(r: T) {
    return { ...r, fileUrl: await this.storage.signedUrl(r.filePath, 3600) };
  }
}

@Module({ controllers: [CmsController] })
export class CmsModule {}
