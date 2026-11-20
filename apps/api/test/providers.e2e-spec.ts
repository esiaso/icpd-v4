import { closeApp, loggedIn, makeUser, outbox, prisma, uniq } from './helpers';
import { addMember, makeProvider, PROVIDER_INPUT } from './fixtures';
import { getApp } from './helpers';

afterAll(closeApp);

describe('providers (regulator)', () => {
  it('creates a provider with all required fields', async () => {
    const { client } = await loggedIn(['Regulator CPD Officer']);
    const missing = await client.post('/regulator/providers', { name: 'X' });
    expect(missing.status).toBe(422);
    const r = await client.post('/regulator/providers', PROVIDER_INPUT());
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('active');
  });

  it('adds a new user as Provider Coordinator with a set-password email', async () => {
    const { client } = await loggedIn(['Regulator CPD Officer']);
    const p = await makeProvider();
    const email = `${uniq()}@coord.test`;
    const r = await client.post(`/regulator/providers/${p.id}/users`, { name: 'Coord', email });
    expect(r.status).toBe(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { roles: { include: { role: true } } } });
    expect(user.roles.map((x) => x.role.name)).toEqual(['Provider Coordinator']);
    const mail = outbox().find((m) => m.to === email && m.template === 'NotifyProviderUser');
    expect(mail?.data.setPasswordUrl).toContain('/reset-password/');
  });

  it('syncs an existing practitioner to Practitioner + Provider Coordinator', async () => {
    const { client } = await loggedIn(['Regulator CPD Officer']);
    const p = await makeProvider();
    const doc = await makeUser(['Practitioner']);
    expect((await client.post(`/regulator/providers/${p.id}/users`, { name: 'Doc', email: doc.email })).status).toBe(201);
    const roles = await prisma.userRole.findMany({ where: { userId: doc.id }, include: { role: true } });
    expect(roles.map((r) => r.role.name).sort()).toEqual(['Practitioner', 'Provider Coordinator']);
  });

  it('refuses users with other roles', async () => {
    const { client } = await loggedIn(['Regulator CPD Officer']);
    const p = await makeProvider();
    const officer = await makeUser(['Regulator CPD Officer']);
    const r = await client.post(`/regulator/providers/${p.id}/users`, { name: 'Officer', email: officer.email });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toBe('User exists with a different role');
  });

  it('records status changes in history', async () => {
    const { client } = await loggedIn(['Regulator CPD Officer']);
    const p = await makeProvider();
    expect((await client.post(`/regulator/providers/${p.id}/status`, { status: 'suspended', effectiveDate: '2026-03-01', notes: 'Audit' })).status).toBe(201);
    const h = await client.get(`/regulator/providers/${p.id}/status-history`);
    expect(h.body[0]).toMatchObject({ status: 'suspended', notes: 'Audit', effectiveDate: '2026-03-01T00:00:00.000Z' });
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('suspended');
  });

  it('yearly reset deactivates every provider with a note', async () => {
    const p = await makeProvider();
    const { client } = await loggedIn(['Admin']);
    const r = await client.post('/regulator/providers/jobs/yearly-reset');
    expect(r.body.deactivated).toBeGreaterThan(0);
    const row = await prisma.provider.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.status).toBe('inactive');
    const h = await prisma.providerStatusHistory.findFirst({ where: { providerId: p.id }, orderBy: { id: 'desc' } });
    expect(h?.notes).toBe('Reset end of year');
  });
});

describe('provider workspace', () => {
  it('lists only active memberships and guards other providers (defect #13)', async () => {
    const { user, client } = await loggedIn(['Provider Coordinator']);
    const mine = await makeProvider();
    const other = await makeProvider();
    const inactive = await makeProvider();
    await addMember(mine.id, user.id);
    await addMember(inactive.id, user.id, 'Inactive');
    const list = await client.get('/providers/mine');
    expect(list.body.map((p: any) => p.id)).toEqual([mine.id.toString()]);
    expect((await client.get(`/providers/${mine.id}/dashboard`)).status).toBe(200);
    expect((await client.get(`/providers/${other.id}/dashboard`)).status).toBe(403);
    expect((await client.get(`/providers/${inactive.id}/dashboard`)).status).toBe(403);
  });

  it('coordinators can edit contact details but not the name', async () => {
    const { user, client } = await loggedIn(['Provider Coordinator']);
    const p = await makeProvider();
    await addMember(p.id, user.id);
    const r = await client.put(`/providers/${p.id}/profile`, { ...PROVIDER_INPUT(), name: 'Hacked', phone: '0711111111' });
    expect(r.status).toBe(200);
    const row = await prisma.provider.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.phone).toBe('0711111111');
    expect(row.name).not.toBe('Hacked');
  });

  it('practitioners cannot reach the workspace', async () => {
    const { client } = await loggedIn(['Practitioner']);
    await getApp();
    expect((await client.get('/providers/mine')).status).toBe(403);
  });
});
