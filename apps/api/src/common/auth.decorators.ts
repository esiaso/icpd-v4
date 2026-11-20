import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionName, RoleName } from '@icpd/shared';

export interface AuthUser {
  id: bigint;
  publicId: string;
  name: string;
  email: string;
  emailVerified: boolean;
  roles: RoleName[];
  permissions: PermissionName[];
  practitionerId: bigint | null;
}

export const IS_PUBLIC = 'isPublic';
/** Route needs no login. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const PERMS = 'permissions';
/** All listed permissions required (Super Admin bypasses). */
export const RequirePermissions = (...p: PermissionName[]) => SetMetadata(PERMS, p);

export const ROLES_KEY = 'roles';
/** Any of the listed roles required. */
export const RequireRoles = (...r: RoleName[]) => SetMetadata(ROLES_KEY, r);

export const VERIFIED = 'requireVerified';
/** Require a verified email (default for non-public routes is not to). */
export const RequireVerified = () => SetMetadata(VERIFIED, true);

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export function hasPermission(u: AuthUser | undefined, p: PermissionName): boolean {
  if (!u) return false;
  return u.roles.includes('Super Admin') || u.permissions.includes(p);
}
