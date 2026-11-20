import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { PERMISSIONS, ROLES, type Pagination, type RoleName } from '@icpd/shared';
import { PrismaService } from '../common/prisma.service';
import { CurrentUser, RequirePermissions, type AuthUser } from '../common/auth.decorators';
import { Z } from '../common/zod';
import { PageQuery, pageArgs, paged, parseId } from '../common/pagination';
import { BadRequest, Conflict, NotFound } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { IdentityService } from '../auth/identity.service';
import { AuthService } from '../auth/auth.service';
import { RequirePasswordConfirm } from '../auth/confirm.guard';
import { MailService } from '../mail/mail.service';
import { config } from '../common/config';

const userSchema = z.object({
  name: z.string().trim().min(2).max(255),
  email: z.string().trim().toLowerCase().email(),
  roles: z.array(z.string()).default([]),
  permissions: z.array(z.string()).default([]),
});
const roleSchema = z.object({ name: z.string().trim().min(2).max(100), permissions: z.array(z.string()).default([]) });
const permissionSchema = z.object({ name: z.string().trim().min(2).max(100) });

function userRow(u: any) {
  return {
    id: u.id.toString(),
    publicId: u.publicId,
    name: u.name,
    email: u.email,
    emailVerifiedAt: u.emailVerifiedAt,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
    roles: u.roles?.map((r: any) => r.role.name) ?? [],
    permissions: u.permissions?.map((p: any) => p.permission.name) ?? [],
  };
}

/** Users, roles and permissions administration (/auth/users, /auth/roles, /auth/permissions). */
@ApiTags('admin: users & roles')
@RequirePermissions(PERMISSIONS.READ_ADMIN_PANEL, PERMISSIONS.MANAGE_USERS)
@Controller('admin')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly identity: IdentityService,
    private readonly auth: AuthService,
    private readonly mail: MailService,
  ) {}

  @Get('users')
  async list(@Query(PageQuery()) q: Pagination & { unverified?: string; role?: string }) {
    const where: any = { deletedAt: null };
    if (q.search) where.OR = [{ name: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }];
    if (q.unverified === 'true') where.emailVerifiedAt = null;
    if (q.role) where.roles = { some: { role: { name: q.role } } };
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({ where, ...pageArgs(q), orderBy: { createdAt: 'desc' }, include: { roles: { include: { role: true } } } }),
      this.prisma.user.count({ where }),
    ]);
    return paged(rows.map(userRow), total, q);
  }

  @Get('users/:id')
  async get(@Param('id') id: string) {
    const u = await this.prisma.user.findFirst({
      where: { id: parseId(id), deletedAt: null },
      include: { roles: { include: { role: true } }, permissions: { include: { permission: true } } },
    });
    if (!u) throw NotFound('User');
    return userRow(u);
  }

  @Post('users')
  async create(@CurrentUser() actor: AuthUser, @Body(Z(userSchema)) body: z.infer<typeof userSchema>) {
    if (await this.prisma.user.findUnique({ where: { email: body.email } })) throw Conflict('The email has already been taken.');
    const u = await this.prisma.user.create({ data: { name: body.name, email: body.email, createdBy: actor.id } });
    await this.applyAccess(u.id, body.roles, body.permissions, actor);
    const token = await this.auth.createPasswordToken(u.id);
    await this.mail.send(u.email, 'PasswordReset', { name: u.name, url: `${config.appUrl}/reset-password/${token}` });
    await this.audit.log({ actorId: actor.id, logName: 'users', event: 'created', subjectType: 'user', subjectId: u.id, properties: body });
    return this.get(u.id.toString());
  }

  @Patch('users/:id')
  async update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body(Z(userSchema)) body: z.infer<typeof userSchema>) {
    const uid = parseId(id);
    await this.prisma.user.update({ where: { id: uid }, data: { name: body.name, email: body.email, updatedBy: actor.id } });
    await this.applyAccess(uid, body.roles, body.permissions, actor);
    await this.audit.log({ actorId: actor.id, logName: 'users', event: 'updated', subjectType: 'user', subjectId: uid, properties: body });
    return this.get(id);
  }

  private async applyAccess(userId: bigint, roles: string[], permissions: string[], actor: AuthUser) {
    if (roles.includes(ROLES.SUPER_ADMIN) && !actor.roles.includes('Super Admin')) throw BadRequest('Only a Super Admin can grant Super Admin.');
    await this.identity.syncRoles(userId, roles as RoleName[]);
    const perms = await this.prisma.permission.findMany({ where: { name: { in: permissions } } });
    await this.prisma.userPermission.deleteMany({ where: { userId } });
    if (perms.length) await this.prisma.userPermission.createMany({ data: perms.map((p) => ({ userId, permissionId: p.id })) });
  }

  @RequirePermissions(PERMISSIONS.DELETE_USER)
  @RequirePasswordConfirm()
  @Delete('users/:id')
  async remove(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    const uid = parseId(id);
    if (uid === actor.id) throw BadRequest('You cannot delete your own account.');
    await this.prisma.user.update({ where: { id: uid }, data: { deletedAt: new Date(), deletedBy: actor.id } });
    await this.prisma.refreshToken.updateMany({ where: { userId: uid, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.audit.log({ actorId: actor.id, logName: 'users', event: 'deleted', subjectType: 'user', subjectId: uid });
    return { ok: true };
  }

  @Post('users/:id/verify')
  async markVerified(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    const uid = parseId(id);
    await this.prisma.user.update({ where: { id: uid }, data: { emailVerifiedAt: new Date() } });
    await this.audit.log({ actorId: actor.id, logName: 'users', event: 'email-verified-manually', subjectType: 'user', subjectId: uid });
    return { ok: true };
  }

  @Get('users/:id/auth-logs')
  async authLogs(@Param('id') id: string) {
    return this.prisma.authLog.findMany({ where: { userId: parseId(id) }, orderBy: { loginAt: 'desc' }, take: 100 });
  }

  // ── roles ──
  @Get('roles')
  async roles() {
    const rows = await this.prisma.role.findMany({ orderBy: { id: 'asc' }, include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } } });
    return rows.map((r) => ({ id: r.id, name: r.name, users: r._count.users, permissions: r.permissions.map((p) => p.permission.name) }));
  }

  @Post('roles')
  async createRole(@CurrentUser() actor: AuthUser, @Body(Z(roleSchema)) body: z.infer<typeof roleSchema>) {
    const role = await this.prisma.role.create({ data: { name: body.name } });
    await this.setRolePerms(role.id, body.permissions);
    await this.audit.log({ actorId: actor.id, logName: 'roles', event: 'created', subjectType: 'role', subjectId: role.id, properties: body });
    return role;
  }

  @Put('roles/:id')
  async updateRole(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body(Z(roleSchema)) body: z.infer<typeof roleSchema>) {
    const role = await this.prisma.role.findUnique({ where: { id: Number(id) } });
    if (!role) throw NotFound('Role');
    const isSeeded = (Object.values(ROLES) as string[]).includes(role.name);
    if (isSeeded && role.name !== body.name) throw BadRequest('Built-in roles cannot be renamed.');
    await this.prisma.role.update({ where: { id: role.id }, data: { name: body.name } });
    await this.setRolePerms(role.id, body.permissions);
    await this.audit.log({ actorId: actor.id, logName: 'roles', event: 'updated', subjectType: 'role', subjectId: role.id, properties: body });
    return { ok: true };
  }

  @Delete('roles/:id')
  async deleteRole(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    const role = await this.prisma.role.findUnique({ where: { id: Number(id) } });
    if (!role) throw NotFound('Role');
    if ((Object.values(ROLES) as string[]).includes(role.name)) throw BadRequest('Built-in roles cannot be deleted.');
    await this.prisma.role.delete({ where: { id: role.id } });
    await this.audit.log({ actorId: actor.id, logName: 'roles', event: 'deleted', subjectType: 'role', subjectId: role.id });
    return { ok: true };
  }

  private async setRolePerms(roleId: number, names: string[]) {
    const perms = await this.prisma.permission.findMany({ where: { name: { in: names } } });
    await this.prisma.rolePermission.deleteMany({ where: { roleId } });
    if (perms.length) await this.prisma.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) });
  }

  // ── permissions ──
  @Get('permissions')
  permissions() {
    return this.prisma.permission.findMany({ orderBy: { name: 'asc' } });
  }

  @Post('permissions')
  async createPermission(@CurrentUser() actor: AuthUser, @Body(Z(permissionSchema)) body: { name: string }) {
    const p = await this.prisma.permission.create({ data: { name: body.name } });
    await this.audit.log({ actorId: actor.id, logName: 'permissions', event: 'created', subjectType: 'permission', subjectId: p.id });
    return p;
  }

  @Delete('permissions/:id')
  async deletePermission(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
    const p = await this.prisma.permission.findUnique({ where: { id: Number(id) } });
    if (!p) throw NotFound('Permission');
    if ((Object.values(PERMISSIONS) as string[]).includes(p.name)) throw BadRequest('Built-in permissions cannot be deleted.');
    await this.prisma.permission.delete({ where: { id: p.id } });
    await this.audit.log({ actorId: actor.id, logName: 'permissions', event: 'deleted', subjectType: 'permission', subjectId: p.id });
    return { ok: true };
  }

  // ── audit trail ──
  @Get('audit-log')
  async auditLog(@Query(PageQuery()) q: Pagination & { logName?: string; subjectType?: string; subjectId?: string }) {
    const where: any = {};
    if (q.logName) where.logName = q.logName;
    if (q.subjectType) where.subjectType = q.subjectType;
    if (q.subjectId) where.subjectId = q.subjectId;
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, ...pageArgs(q), orderBy: { createdAt: 'desc' } }),
      this.prisma.auditLog.count({ where }),
    ]);
    return paged(rows, total, q);
  }
}
