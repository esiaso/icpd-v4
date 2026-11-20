import { Injectable } from '@nestjs/common';
import type { PermissionName, RoleName } from '@icpd/shared';
import { PrismaService, type Db } from '../common/prisma.service';
import type { AuthUser } from '../common/auth.decorators';

/** Loads users with effective roles/permissions and manages role assignment. */
@Injectable()
export class IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async load(userId: bigint): Promise<AuthUser | null> {
    const u = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
        permissions: { include: { permission: true } },
        practitioner: { select: { id: true, deletedAt: true } },
      },
    });
    if (!u) return null;
    const roles = u.roles.map((r) => r.role.name as RoleName);
    const perms = new Set<PermissionName>();
    for (const r of u.roles) for (const p of r.role.permissions) perms.add(p.permission.name as PermissionName);
    for (const p of u.permissions) perms.add(p.permission.name as PermissionName);
    return {
      id: u.id,
      publicId: u.publicId,
      name: u.name,
      email: u.email,
      emailVerified: !!u.emailVerifiedAt,
      roles,
      permissions: [...perms],
      practitionerId: u.practitioner && !u.practitioner.deletedAt ? u.practitioner.id : null,
    };
  }

  async roleNames(userId: bigint, db: Db = this.prisma): Promise<RoleName[]> {
    const rows = await db.userRole.findMany({ where: { userId }, include: { role: true } });
    return rows.map((r) => r.role.name as RoleName);
  }

  /** Replace the user's roles with exactly these (Spatie syncRoles). */
  async syncRoles(userId: bigint, names: RoleName[], db: Db = this.prisma) {
    const roles = await db.role.findMany({ where: { name: { in: names } } });
    await db.userRole.deleteMany({ where: { userId } });
    if (roles.length) {
      await db.userRole.createMany({ data: roles.map((r) => ({ userId, roleId: r.id })) });
    }
  }

  async assignRole(userId: bigint, name: RoleName, db: Db = this.prisma) {
    const role = await db.role.findUniqueOrThrow({ where: { name } });
    await db.userRole.upsert({
      where: { userId_roleId: { userId, roleId: role.id } },
      create: { userId, roleId: role.id },
      update: {},
    });
  }

  async removeRole(userId: bigint, name: RoleName, db: Db = this.prisma) {
    const role = await db.role.findUnique({ where: { name } });
    if (role) await db.userRole.deleteMany({ where: { userId, roleId: role.id } });
  }
}
