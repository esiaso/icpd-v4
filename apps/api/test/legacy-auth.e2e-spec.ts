import http from 'http';
import type { AddressInfo } from 'net';
import { createHash } from 'crypto';
import request from 'supertest';
import { Client, closeApp, getApp, prisma, uniq } from './helpers';
import { makePractitioner } from './fixtures';

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

describe('legacy migration login', () => {
  afterAll(closeApp);

  it.each([
    [3, ['Practitioner'], false],
    [5, ['Practitioner', 'Provider Coordinator'], false],
    [10, ['Provider Coordinator'], true],
    [12, ['Regulator CPD Officer'], true],
    [99, ['Public User'], false],
  ])('legacy role %s → %j', async (roleId, roles, dropped) => {
    const p = await makePractitioner({ email: `${uniq('legacy')}@old.test` });
    await prisma.legacyCredential.create({ data: { practitionerId: p.id, sha1Hash: sha1('oldpass1'), legacyRoleId: roleId } });
    const c = new Client(await getApp());
    expect((await c.post('/auth/migrate', { identifier: p.regNo, password: 'wrong' })).status).toBe(401);
    const r = await c.post('/auth/migrate', { identifier: p.regNo!.toLowerCase(), password: 'oldpass1' });
    expect(r.status).toBe(200);
    expect([...r.body.roles].sort()).toEqual([...roles].sort());
    expect(r.body.emailVerified).toBe(true);
    const cred = await prisma.legacyCredential.findUniqueOrThrow({ where: { practitionerId: p.id } });
    expect(cred.sha1Hash).toBe('');
    expect(cred.usedAt).not.toBeNull();
    const after = await prisma.practitioner.findUniqueOrThrow({ where: { id: p.id } });
    expect(!!after.deletedAt).toBe(dropped);
    // the old password now works as a normal login (bcrypt), and migrate can't be replayed
    await new Client(await getApp()).login(p.email!, 'oldpass1');
    expect((await new Client(await getApp()).post('/auth/migrate', { identifier: p.regNo, password: 'oldpass1' })).status).toBe(401);
  });

  it('new practitioners never get a legacy password (defect #3)', async () => {
    expect(await prisma.legacyCredential.count({ where: { sha1Hash: sha1('1234567890') } })).toBe(0);
  });
});

describe('OSP SSO', () => {
  let sso: http.Server;
  let issued = '';
  beforeAll(async () => {
    sso = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url === '/oauth/token' && req.method === 'POST') {
          const params = new URLSearchParams(body);
          if (params.get('code') !== 'good-code' || params.get('client_secret') !== 'shh') {
            res.writeHead(400).end('{}');
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'tok' }));
          return;
        }
        if (req.url === '/api/user' && req.headers.authorization === 'Bearer tok') {
          res.writeHead(200, { 'content-type': 'application/json' }).end(issued);
          return;
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((r) => sso.listen(0, r));
    const port = (sso.address() as AddressInfo).port;
    process.env.SSO_SERVER = `http://127.0.0.1:${port}`;
    process.env.SSO_CLIENT_ID = 'icpd';
    process.env.SSO_CLIENT_SECRET = 'shh';
    process.env.SSO_REDIRECT_URI = 'http://localhost:4000/api/auth/osp/callback';
  });
  afterAll(async () => {
    sso.close();
    await closeApp();
  });

  async function startLogin() {
    const srv = (await getApp()).getHttpServer();
    const r = await request(srv).get('/api/auth/osp/login');
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.location);
    expect(loc.pathname).toBe('/oauth/authorize');
    const state = loc.searchParams.get('state')!;
    const cookie = (r.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('icpd_sso_state='))!.split(';')[0];
    return { srv, state, cookie };
  }

  it('exchanges the code, reads the profile from the server and links the practitioner', async () => {
    const p = await makePractitioner({ email: `${uniq('sso')}@osp.test` });
    issued = JSON.stringify({ email: p.email, reg_no: p.regNo, name: 'Sso Doc' });
    const { srv, state, cookie } = await startLogin();
    const cb = await request(srv).get(`/api/auth/osp/callback?code=good-code&state=${state}`).set('Cookie', cookie);
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toContain('/practitioner/portfolio');
    expect((cb.headers['set-cookie'] as unknown as string[]).some((c) => c.startsWith('icpd_at='))).toBe(true);
    const linked = await prisma.practitioner.findUniqueOrThrow({ where: { id: p.id }, include: { user: { include: { roles: { include: { role: true } } } } } });
    expect(linked.user?.email).toBe(p.email);
    expect(linked.user?.roles.map((r) => r.role.name)).toContain('Practitioner');
  });

  it('rejects a bad state and never trusts query parameters (defect #1)', async () => {
    const { srv, cookie } = await startLogin();
    const bad = await request(srv).get('/api/auth/osp/callback?code=good-code&state=forged&email=victim@x.io&reg_no=A1').set('Cookie', cookie);
    expect(bad.headers.location).toContain('sso_error');
    expect((bad.headers['set-cookie'] as unknown as string[] | undefined)?.some((c) => c.startsWith('icpd_at=')) ?? false).toBe(false);
    const { srv: s2, state, cookie: c2 } = await startLogin();
    const badCode = await request(s2).get(`/api/auth/osp/callback?code=stolen&state=${state}`).set('Cookie', c2);
    expect(badCode.headers.location).toContain('sso_error');
  });
});
