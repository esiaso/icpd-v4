import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { PermissionName, RoleName } from '@icpd/shared';
import {
  IS_PUBLIC,
  PERMS,
  ROLES_KEY,
  VERIFIED,
  hasPermission,
  type AuthUser,
} from '../common/auth.decorators';
import { config } from '../common/config';
import { AppError, Forbidden, Unauthorized } from '../common/errors';
import { IdentityService } from './identity.service';

export const ACCESS_COOKIE = 'icpd_at';
export const REFRESH_COOKIE = 'icpd_rt';
export const CSRF_COOKIE = 'icpd_csrf';
export const CSRF_HEADER = 'x-csrf-token';

export function readAccessToken(req: Request): { token: string | null; viaCookie: boolean } {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return { token: h.slice(7), viaCookie: false };
  const c = (req as any).cookies?.[ACCESS_COOKIE];
  return { token: c ?? null, viaCookie: !!c };
}

/**
 * Global guard: authenticates the JWT (cookie or Bearer), loads the user, enforces CSRF
 * (double-submit cookie) for cookie-authenticated unsafe requests, then checks
 * @RequirePermissions / @RequireRoles / @RequireVerified.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly identity: IdentityService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    // API-consumer routes use their own guard.
    if ((req as any).apiConsumer) return true;

    const { token, viaCookie } = readAccessToken(req);
    if (token) {
      try {
        const payload = await this.jwt.verifyAsync<{ sub: string; typ: string }>(token, {
          secret: config.jwtAccessSecret,
        });
        if (payload.typ === 'access') {
          const user = await this.identity.load(BigInt(payload.sub));
          if (user) req.user = user;
        }
      } catch {
        if (!isPublic) throw Unauthorized('Session expired');
      }
    }

    if (req.user && viaCookie && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const header = req.headers[CSRF_HEADER];
      const cookie = (req as any).cookies?.[CSRF_COOKIE];
      if (!cookie || header !== cookie) throw new AppError('CSRF', 'Invalid CSRF token', 403);
    }

    if (isPublic) return true;
    if (!req.user) throw Unauthorized();

    const needVerified = this.reflector.getAllAndOverride<boolean>(VERIFIED, [ctx.getHandler(), ctx.getClass()]);
    if (needVerified && !req.user.emailVerified) {
      throw new AppError('EMAIL_NOT_VERIFIED', 'Please verify your email address first', 403);
    }
    const roles = this.reflector.getAllAndOverride<RoleName[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !req.user.roles.includes('Super Admin') && !roles.some((r) => req.user!.roles.includes(r))) {
      throw Forbidden();
    }
    const perms = this.reflector.getAllAndOverride<PermissionName[]>(PERMS, [ctx.getHandler(), ctx.getClass()]);
    if (perms?.length && !perms.every((p) => hasPermission(req.user, p))) throw Forbidden();
    return true;
  }
}
