import request from 'supertest';
import { closeApp, getApp, loggedIn, prisma, PASSWORD, uniq } from './helpers';
import { makeActivity, makePractitioner, makeProvider, typeByName } from './fixtures';

afterAll(closeApp);

const year = new Date().getUTCFullYear();

async function apiApp(o: { providerId?: bigint; isCouncil?: boolean } = {}) {
  const { client } = await loggedIn(['Admin']);
  await client.post('/auth/confirm-password', { password: PASSWORD });
  const app = await client.post('/regulator/apps', { name: `App ${uniq()}`, type: 'WEB', status: 'ACTIVE', providerId: o.providerId?.toString(), isCouncil: !!o.isCouncil });
  expect(app.status).toBe(201);
  const creds = await client.post(`/regulator/apps/${app.body.id}/credentials`);
  expect(creds.status).toBe(201);
  const header = Buffer.from(`${creds.body.key}:${creds.body.secret}`).toString('base64');
  return { id: app.body.id as number, key: creds.body.key as string, secret: creds.body.secret as string, header, admin: client };
}

async function call(method: 'get' | 'post', url: string, header: string | null, body?: any) {
  const srv = (await getApp()).getHttpServer();
  let r = request(srv)[method](`/api/v1${url}`);
  if (header) r = r.set('api-consumer', header);
  return body ? r.send(body) : r;
}

describe('public API v1', () => {
  it('rejects missing/invalid credentials with 401 and inactive apps with 403; secrets are stored hashed', async () => {
    const prov = await makeProvider();
    const a = await apiApp({ providerId: prov.id });
    expect((await call('get', '/activities', null)).status).toBe(401);
    expect((await call('get', '/activities', Buffer.from(`${a.key}:wrong`).toString('base64'))).status).toBe(401);
    const row = await prisma.apiConsumerApp.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.key).toHaveLength(21);
    expect(a.secret).toHaveLength(107);
    expect(row.secretHash).not.toContain(a.secret);
    await prisma.apiConsumerApp.update({ where: { id: a.id }, data: { status: 'SUSPENDED' } });
    const r = await call('get', '/activities', a.header);
    expect(r.status).toBe(403);
    expect(r.body.error.message).toBe('This application is suspended');
  });

  it('registers, updates, publishes and lists activities for its own provider only', async () => {
    const prov = await makeProvider();
    const a = await apiApp({ providerId: prov.id });
    const online = await typeByName('Webinar / Online CME');
    const physical = await typeByName('Conference / Scientific meeting');
    const body = { activityType: online.id, activityName: 'Webinar on AMR', releaseDate: `${year}-05-01`, expiryDate: `${year + 1}-05-01`, objectives: 'Learn', description: 'A long enough description', activityUrl: 'https://example.org/amr' };
    const bad = await call('post', '/activity/registration', a.header, { ...body, activityType: physical.id });
    expect(bad.status).toBe(422);
    expect(bad.body.error.message).toBe('This Activity Type cannot be created via API!');
    const r = await call('post', '/activity/registration', a.header, body);
    expect(r.status).toBe(201);
    const id = r.body.activity.activityId;
    expect(r.body.activity).toMatchObject({ activityName: 'Webinar on AMR', activityUrl: 'https://example.org/amr', published: false });
    expect((await call('post', '/activity/update', a.header, { ...body, activityId: id, activityName: 'Webinar on AMR (updated)' })).body.activity.activityName).toBe('Webinar on AMR (updated)');
    expect((await call('post', '/activity/publish', a.header, { activityId: id })).status).toBe(200);
    const list = await call('get', '/activities', a.header);
    expect(list.body.data.some((x: any) => x.activityId === id && x.published)).toBe(true);
    // another provider's activity
    const other = await makeActivity((await makeProvider()).id);
    expect((await call('post', '/activity/view', a.header, { activityId: other.id.toString() })).status).toBe(403);
    expect(await prisma.apiLog.count({ where: { appId: a.id } })).toBeGreaterThan(3);
    expect(await prisma.auditLog.count({ where: { logName: 'activity-publishing', subjectId: String(id), event: 'publish' } })).toBe(1);
  });

  it('claimpoints awards base points only (no role bonus), checks expiry and publish', async () => {
    const prov = await makeProvider();
    const a = await apiApp({ providerId: prov.id });
    const act = await makeActivity(prov.id, { typeName: 'Conference / Scientific meeting', numSessions: 1 });
    const p = await makePractitioner();
    await prisma.activityPresenter.create({ data: { activityId: act.id, regNo: p.regNo!, firstName: 'A', lastName: 'B' } });
    const r = await call('post', '/practitioners/claimpoints', a.header, { regNo: p.regNo, activityId: act.id.toString() });
    expect(r.status).toBe(201);
    expect(r.body.points).toBe(5);
    const claim = await prisma.cpdClaim.findFirstOrThrow({ where: { practitionerId: p.id, activityId: act.id } });
    expect(claim).toMatchObject({ method: 'API', tokenTrail: 'API' });
    expect((await prisma.activityPresenter.findFirstOrThrow({ where: { activityId: act.id } })).pointsAwarded).toBe(false);
    const again = await call('post', '/practitioners/claimpoints', a.header, { regNo: p.regNo, activityId: act.id.toString() });
    expect(again.status).toBe(422);
    const old = await makeActivity(prov.id, { releaseDate: `${year - 2}-01-01`, expiryDate: `${year - 2}-01-02` });
    expect((await call('post', '/practitioners/claimpoints', a.header, { regNo: p.regNo, activityId: old.id.toString() })).body.error.message).toBe('This activity has expired');
    expect(await prisma.apiLog.count({ where: { appId: a.id, logType: 'award_points' } })).toBe(1);
  });

  it('points, verify (masked email) and the exemption rule', async () => {
    const prov = await makeProvider();
    const a = await apiApp({ providerId: prov.id });
    const p = await makePractitioner({ email: 'wanjiku.kamau@doc.test' });
    const pts = await call('post', '/practitioners/points', a.header, { regNo: p.regNo });
    expect(pts.body).toMatchObject({ regNo: p.regNo, points: '0.00', year, compliant: false, countablePoints: '0.00', buckets: [] });
    await prisma.exemption.create({ data: { practitionerId: p.id, cpdYear: year, reason: 'Study leave' } });
    const ex = await call('post', '/practitioners/points', a.header, { regNo: p.regNo });
    expect(ex.body).toMatchObject({ exempted: true, points: '50.00', compliant: true });
    const v = await call('post', '/verify', a.header, { regNo: p.regNo!.toLowerCase() });
    expect(v.body).toMatchObject({ regNo: p.regNo, email: 'wanjik***@doc.test', name: 'Test', status: 'Verified' });
    const unknown = await call('post', '/verify', a.header, { regNo: 'A0000001' });
    expect(unknown.body).toMatchObject({ status: 'Unverified', email: null });
  });

  it('council diary needs a council credential, and council credentials only reach it', async () => {
    const prov = await makeProvider();
    const provider = await apiApp({ providerId: prov.id });
    const council = await apiApp({ isCouncil: true });
    const p = await makePractitioner();
    expect((await call('get', `/council/diary?regNo=${p.regNo}&year=${year}`, provider.header)).status).toBe(403);
    const r = await call('get', `/council/diary?regNo=${p.regNo}&year=${year}`, council.header);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ regNo: p.regNo, year, points: '0.00', exempted: false });
    expect((await call('get', '/activities', council.header)).status).toBe(403);
  });

  it('rotating credentials invalidates the old secret', async () => {
    const prov = await makeProvider();
    const a = await apiApp({ providerId: prov.id });
    expect((await call('get', '/activities', a.header)).status).toBe(200);
    await a.admin.post(`/regulator/apps/${a.id}/credentials`);
    expect((await call('get', '/activities', a.header)).status).toBe(401);
  });

  it('personal access tokens authenticate as the user and can be revoked', async () => {
    const { client } = await loggedIn(['Provider']);
    const t = await client.post('/me/tokens', { name: 'CI' });
    expect(t.body.token).toMatch(/^icpd_pat_/);
    const srv = (await getApp()).getHttpServer();
    expect((await request(srv).get('/api/auth/me').set('Authorization', `Bearer ${t.body.token}`)).status).toBe(200);
    await client.delete(`/me/tokens/${t.body.id}`);
    expect((await request(srv).get('/api/auth/me').set('Authorization', `Bearer ${t.body.token}`)).status).toBe(401);
  });

  it('maintenance: correct zero-point claims (dry run, then apply)', async () => {
    const { client } = await loggedIn(['Admin']);
    const prov = await makeProvider();
    const act = await makeActivity(prov.id);
    const p = await makePractitioner();
    await prisma.cpdClaim.create({ data: { practitionerId: p.id, activityId: act.id, method: 'token', cpdPoints: 0, calYear: year } });
    const dry = await client.post('/regulator/maintenance/correct-points', { dryRun: true });
    expect(dry.body.fixed).toBeGreaterThan(0);
    await client.post('/regulator/maintenance/correct-points', { dryRun: false });
    expect((await prisma.cpdClaim.findFirstOrThrow({ where: { practitionerId: p.id } })).cpdPoints.toString()).toBe('2');
  });
});
