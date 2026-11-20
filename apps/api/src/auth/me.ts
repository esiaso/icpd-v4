import type { AuthUser } from '../common/auth.decorators';

export function serializeMe(u: AuthUser | null) {
  if (!u) return null;
  return {
    id: u.publicId,
    name: u.name,
    email: u.email,
    emailVerified: u.emailVerified,
    roles: u.roles,
    permissions: u.roles.includes('Super Admin') ? ['*', ...u.permissions] : u.permissions,
    practitionerId: u.practitionerId?.toString() ?? null,
  };
}
