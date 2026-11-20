import request from 'supertest';
import { Client, closeApp, getApp, loggedIn, outbox, prisma, uniq, PASSWORD } from './helpers';

afterAll(closeApp);

describe('auth', () => {
  it('registers with Public User role and sends a verification email', async () => {
    const app = await getApp();
    const c = new Client(app);
    const email = `${uniq()}@test.local`;
    const res = await c.post('/auth/register', { name: 'Jane Doe', email, password: PASSWORD });
    expect(res.status).toBe(201);
    expect(res.body.roles).toEqual(['Public User']);
    expect(res.body.emailVerified).toBe(false);
    const mail = outbox().find((m) => m.to === email && m.template === 'VerifyEmail');
    expect(mail).toBeTruthy();
    const token = new URL(mail!.data.url).searchParams.get('token');
    expect((await c.post('/auth/verify-email', { token })).status).toBe(200);
    expect((await c.get('/auth/me')).body.emailVerified).toBe(true);
    // Single use
    expect((await c.post('/auth/verify-email', { token })).status).toBe(400);
  });

  it('rejects the honeypot', async () => {
    const c = new Client(await getApp());
    const res = await c.post('/auth/register', { name: 'Bot', email: `${uniq()}@x.io`, password: PASSWORD, website: 'spam' });
    expect(res.status).toBe(422);
  });

  it('rejects duplicate email', async () => {
    const { user } = await loggedIn(['Public User']);
    const c = new Client(await getApp());
    const res = await c.post('/auth/register', { name: 'Dup', email: user.email, password: PASSWORD });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('The email has already been taken.');
  });

  it('logs every login attempt', async () => {
    const { user } = await loggedIn(['Public User']);
    const c = new Client(await getApp());
    const bad = await c.post('/auth/login', { email: user.email, password: 'wrong-password' });
    expect(bad.status).toBe(401);
    expect(bad.body).toEqual({ error: { code: 'UNAUTHORIZED', message: 'These credentials do not match our records.' } });
    const logs = await prisma.authLog.findMany({ where: { userId: user.id } });
    expect(logs.map((l) => l.loginSuccessful).sort()).toEqual([false, true]);
  });

  it('requires CSRF header for cookie-authenticated writes', async () => {
    const app = await getApp();
    const { client } = await loggedIn(['Public User']);
    const res = await request(app.getHttpServer())
      .post('/api/auth/change-password')
      .set('Cookie', client.cookies.join('; '))
      .send({ currentPassword: PASSWORD, password: 'NewSecret#1' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF');
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const { client } = await loggedIn(['Public User']);
    const oldRt = client.cookies.find((c) => c.startsWith('icpd_rt='))!;
    expect((await client.post('/auth/refresh')).status).toBe(200);
    const newRt = client.cookies.find((c) => c.startsWith('icpd_rt='))!;
    expect(newRt).not.toEqual(oldRt);
    // Replay the old one
    const attacker = new Client(await getApp());
    attacker.cookies = [oldRt];
    expect((await attacker.post('/auth/refresh')).status).toBe(401);
    // Whole family now revoked
    expect((await client.post('/auth/refresh')).status).toBe(401);
  });

  it('resets a password via emailed link', async () => {
    const { user } = await loggedIn(['Public User']);
    const c = new Client(await getApp());
    expect((await c.post('/auth/forgot-password', { email: user.email })).status).toBe(200);
    const mail = outbox().filter((m) => m.to === user.email && m.template === 'PasswordReset').pop()!;
    const token = mail.data.url.split('/').pop();
    expect((await c.post('/auth/reset-password', { token, password: 'Brand#New123' })).status).toBe(200);
    await c.login(user.email, 'Brand#New123');
  });

  it('forgot-password does not reveal unknown emails', async () => {
    const c = new Client(await getApp());
    const res = await c.post('/auth/forgot-password', { email: 'nobody@nowhere.test' });
    expect(res.status).toBe(200);
  });

  it('enforces permissions in the API', async () => {
    const { client } = await loggedIn(['Practitioner']);
    expect((await client.get('/admin/users')).status).toBe(403);
    const anon = new Client(await getApp());
    expect((await anon.get('/admin/users')).status).toBe(401);
  });

  it('admin can manage users and roles, with an audit entry', async () => {
    const { user: admin, client } = await loggedIn(['Admin']);
    const email = `${uniq()}@test.local`;
    const res = await client.post('/admin/users', { name: 'Officer', email, roles: ['Regulator CPD Officer'] });
    expect(res.status).toBe(201);
    expect(res.body.roles).toEqual(['Regulator CPD Officer']);
    const audit = await prisma.auditLog.findFirst({ where: { actorId: admin.id, logName: 'users', event: 'created' } });
    expect(audit).toBeTruthy();
    const roles = await client.get('/admin/roles');
    expect(roles.body.map((r: any) => r.name)).toEqual(
      expect.arrayContaining(['Super Admin', 'Admin', 'Regulator CPD Officer', 'Provider Coordinator', 'Provider', 'Practitioner', 'Public User']),
    );
  });

  it('deleting a user needs a recent password confirmation', async () => {
    const { client } = await loggedIn(['Admin']);
    const victim = await prisma.user.create({ data: { name: 'Victim', email: `${uniq()}@t.local` } });
    expect((await client.delete(`/admin/users/${victim.id}`)).status).toBe(423);
    expect((await client.post('/auth/confirm-password', { password: PASSWORD })).status).toBe(200);
    expect((await client.delete(`/admin/users/${victim.id}`)).status).toBe(200);
  });

  it('seeds only the spec permissions (defect #14)', async () => {
    const perms = await prisma.permission.findMany();
    expect(perms.length).toBe(15);
    expect(perms.some((p) => /IREC|NACOSTI|research/i.test(p.name))).toBe(false);
  });
});
