import { Body, Controller, Injectable, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { parseDateOnly, PERMISSIONS } from '@icpd/shared';
import { PrismaService, num } from '../common/prisma.service';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/auth.decorators';
import { Z } from '../common/zod';
import { AuditService } from '../audit/audit.service';
import { PointsService } from '../points/points.service';

/**
 * Legacy maintenance endpoints (/admin/allocateToken, /admin/correct/points) as admin-only
 * internal operations (spec 7). Also exposed through the CLI (`pnpm cli`).
 */
@Injectable()
export class MaintenanceTasks {
  constructor(private readonly prisma: PrismaService, private readonly points: PointsService, private readonly audit: AuditService) {}

  /** Re-award claimed tokens that have no matching claim entry (claimed on a given date, or all). */
  async allocateTokens(date?: string, dryRun = false) {
    const where: any = { status: 'claimed', claimedBy: { not: null }, deletedAt: null };
    if (date) where.claimedAt = { gte: parseDateOnly(date), lt: new Date(parseDateOnly(date).getTime() + 86400000) };
    const tokens = await this.prisma.activityToken.findMany({ where, include: { activity: { include: { type: true } }, claimer: true } });
    let fixed = 0;
    const skipped: string[] = [];
    for (const t of tokens) {
      const entry = await this.prisma.cpdClaimEntry.findUnique({ where: { token: t.token } });
      const legacyTrail = await this.prisma.cpdClaim.findFirst({ where: { practitionerId: t.claimedBy!, activityId: t.activityId, tokenTrail: { contains: t.token } } });
      if (entry || legacyTrail) continue;
      if (dryRun) {
        fixed++;
        continue;
      }
      try {
        await this.prisma.$transaction((tx) => this.points.awardInTx(tx, t.claimer!, t.activity, { method: 'token', token: t.token, includeRoleBonus: true }));
        fixed++;
      } catch (e: any) {
        skipped.push(`${t.token}: ${e.message}`);
      }
    }
    return { checked: tokens.length, fixed, skipped, dryRun };
  }

  /** Claims recorded with 0 points get the activity type's points. */
  async correctZeroPoints(dryRun = false) {
    const claims = await this.prisma.cpdClaim.findMany({ where: { cpdPoints: 0, deletedAt: null, activityId: { not: null } }, include: { activity: { include: { type: true } } } });
    let fixed = 0;
    for (const c of claims) {
      const pts = num(c.activity!.type.cpdPoints);
      if (pts <= 0) continue;
      fixed++;
      if (dryRun) continue;
      await this.prisma.$transaction([
        this.prisma.cpdClaim.update({ where: { id: c.id }, data: { cpdPoints: pts } }),
        this.prisma.cpdClaimEntry.create({ data: { claimId: c.id, kind: 'base', source: 'correction', points: pts, activityTypeId: c.activity!.activityTypeId, specialityIds: (c.activity!.specializationAreas as number[]) ?? [], calYear: c.calYear } }),
      ]);
    }
    return { checked: claims.length, fixed, dryRun };
  }
}

@ApiTags('regulator: maintenance')
@RequirePermissions(PERMISSIONS.READ_ADMIN_PANEL, PERMISSIONS.MANAGE_USERS, PERMISSIONS.MANAGE_ACTIVITIES)
@Controller('regulator/maintenance')
export class MaintenanceController {
  constructor(private readonly tasks: MaintenanceTasks, private readonly audit: AuditService) {}

  @Post('allocate-tokens')
  async allocate(@CurrentUser() u: AuthUser, @Body(Z(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), dryRun: z.boolean().default(true) }))) b: { date?: string; dryRun: boolean }) {
    const r = await this.tasks.allocateTokens(b.date, b.dryRun);
    await this.audit.log({ actorId: u.id, logName: 'maintenance', event: 'allocate-tokens', properties: { ...b, ...r, skipped: r.skipped.length } });
    return r;
  }

  @Post('correct-points')
  async correct(@CurrentUser() u: AuthUser, @Body(Z(z.object({ dryRun: z.boolean().default(true) }))) b: { dryRun: boolean }) {
    const r = await this.tasks.correctZeroPoints(b.dryRun);
    await this.audit.log({ actorId: u.id, logName: 'maintenance', event: 'correct-points', properties: { ...b, ...r } });
    return r;
  }
}
