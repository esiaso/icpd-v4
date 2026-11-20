import { Controller, Get, Module, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Pagination } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { Public } from '../common/auth.decorators';
import { PageQuery, pageArgs, paged } from '../common/pagination';
import { NotFound } from '../common/errors';
import { StorageService } from '../storage/storage.service';

const activitySelect = {
  id: true,
  publicId: true,
  name: true,
  shortTitle: true,
  topic: true,
  releaseDate: true,
  expiryDate: true,
  deliveryMode: true,
  venue: true,
  city: true,
  cpdPoints: true,
  maxPoints: true,
  numSessions: true,
  featured: true,
  posterUrl: true,
  provider: { select: { id: true, name: true } },
  type: { select: { id: true, name: true } },
} as const;

const PUBLISHED = { published: true, archived: false, deletedAt: null, provider: { deletedAt: null } } as const;

/** Public site (spec 5.10): published activities and providers. */
@ApiTags('public')
@Public()
@Controller('public')
export class PublicController {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  @Get('home')
  async home() {
    const [featured, recent, providers] = await Promise.all([
      this.prisma.activity.findMany({ where: { ...PUBLISHED, featured: true }, select: activitySelect, orderBy: { releaseDate: 'desc' }, take: 6 }),
      this.prisma.activity.findMany({ where: PUBLISHED, select: activitySelect, orderBy: { datePublished: 'desc' }, take: 9 }),
      this.prisma.provider.findMany({ where: { deletedAt: null, status: 'active' }, select: { id: true, name: true, logoUrl: true }, orderBy: { name: 'asc' }, take: 24 }),
    ]);
    return { featured, recent, providers };
  }

  @Get('activities')
  async activities(@Query(PageQuery()) q: Pagination & { providers?: string; from?: string; to?: string; type?: string }) {
    const where: any = { ...PUBLISHED };
    if (q.search) {
      where.OR = [
        { name: { contains: q.search, mode: 'insensitive' } },
        { topic: { contains: q.search, mode: 'insensitive' } },
        { provider: { name: { contains: q.search, mode: 'insensitive' } } },
      ];
    }
    if (q.providers) where.providerId = { in: q.providers.split(',').filter(Boolean).map((s) => BigInt(s)) };
    if (q.type) where.activityTypeId = Number(q.type);
    if (q.from) where.expiryDate = { gte: new Date(`${q.from}T00:00:00Z`) };
    if (q.to) where.releaseDate = { lte: new Date(`${q.to}T00:00:00Z`) };
    const [rows, total] = await Promise.all([
      this.prisma.activity.findMany({ where, select: activitySelect, ...pageArgs(q), orderBy: [{ datePublished: 'desc' }, { id: 'desc' }] }),
      this.prisma.activity.count({ where }),
    ]);
    return paged(rows, total, q);
  }

  @Get('activities/:id')
  async activity(@Param('id') id: string) {
    const a = await this.prisma.activity.findFirst({
      where: { ...PUBLISHED, ...(/^\d+$/.test(id) ? { id: BigInt(id) } : { publicId: id }) },
      include: {
        provider: { select: { id: true, name: true, website: true, email: true, phone: true } },
        type: { select: { id: true, name: true, cpdPoints: true, presenterPoints: true, moderatorPoints: true } },
        presenters: { where: { deletedAt: null }, select: { firstName: true, lastName: true, otherNames: true, topic: true, affiliation: true, portfolio: true } },
        moderators: { where: { deletedAt: null }, select: { firstName: true, lastName: true, middleName: true, portfolio: true } },
      },
    });
    if (!a) throw NotFound('Activity');
    const specialities = await this.prisma.speciality.findMany({ where: { id: { in: (a.specializationAreas as number[]) ?? [] } }, select: { id: true, name: true } });
    return { ...a, specialities, posterUrl: await this.storage.signedUrl(a.posterUrl, 3600) };
  }

  @Get('providers')
  async providers(@Query(PageQuery()) q: Pagination) {
    const where: any = { deletedAt: null, status: 'active' };
    if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { town: { contains: q.search, mode: 'insensitive' } }];
    const [rows, total] = await Promise.all([
      this.prisma.provider.findMany({
        where,
        select: { id: true, name: true, town: true, website: true, logoUrl: true, _count: { select: { activities: { where: PUBLISHED } } } },
        ...pageArgs(q),
        orderBy: { name: 'asc' },
      }),
      this.prisma.provider.count({ where }),
    ]);
    return paged(rows.map(({ _count, ...p }) => ({ ...p, publishedActivities: _count.activities })), total, q);
  }

  @Get('providers/:id')
  async provider(@Param('id') id: string) {
    const p = await this.prisma.provider.findFirst({
      where: { deletedAt: null, ...(/^\d+$/.test(id) ? { id: BigInt(id) } : { publicId: id }) },
      select: { id: true, name: true, regNo: true, town: true, physicalAddress: true, postalAddress: true, phone: true, email: true, website: true, facebook: true, twitter: true, linkedin: true, logoUrl: true, status: true, specialities: true },
    });
    if (!p) throw NotFound('Provider');
    const specialities = await this.prisma.speciality.findMany({ where: { id: { in: (p.specialities as number[]) ?? [] } }, select: { id: true, name: true } });
    return { ...p, specialities, logoUrl: await this.storage.signedUrl(p.logoUrl, 3600) };
  }

  @Get('providers/:id/activities')
  async providerActivities(@Param('id') id: string, @Query(PageQuery()) q: Pagination) {
    const where: any = { ...PUBLISHED, providerId: BigInt(id) };
    if (q.search) where.name = { contains: q.search, mode: 'insensitive' };
    const [rows, total] = await Promise.all([
      this.prisma.activity.findMany({ where, select: activitySelect, ...pageArgs(q), orderBy: { releaseDate: 'desc' } }),
      this.prisma.activity.count({ where }),
    ]);
    return paged(rows, total, q);
  }
}

@Module({ controllers: [PublicController] })
export class PublicModule {}
