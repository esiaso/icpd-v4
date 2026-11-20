import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PERMISSIONS } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { hasPermission, type AuthUser } from '../common/auth.decorators';
import { Forbidden, NotFound } from '../common/errors';
import { parseId } from '../common/pagination';

/**
 * Every /providers/:providerId/* route (spec 3): the user must have an Active provider_users row
 * for that provider. Regulators holding "Manage Activities" may act on any provider (oversight).
 * If the route has :activityId, the activity must belong to that provider.
 */
@Injectable()
export class ProviderMemberGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const user: AuthUser | undefined = req.user;
    if (!user) return false;
    const providerId = parseId(req.params.providerId);
    const provider = await this.prisma.provider.findFirst({ where: { id: providerId, deletedAt: null } });
    if (!provider) throw NotFound('Provider');

    const oversight = hasPermission(user, PERMISSIONS.MANAGE_ACTIVITIES);
    if (!oversight) {
      const member = await this.prisma.providerUser.findFirst({
        where: { providerId, userId: user.id, status: 'Active', deletedAt: null },
      });
      if (!member) throw Forbidden('You are not an active coordinator for this provider.');
    }
    if (req.params.activityId) {
      const a = await this.prisma.activity.findFirst({
        where: { id: parseId(req.params.activityId), providerId, deletedAt: null },
        select: { id: true },
      });
      if (!a) throw NotFound('Activity');
    }
    req.provider = provider;
    return true;
  }
}
