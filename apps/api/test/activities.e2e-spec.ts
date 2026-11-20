import { closeApp, getApp, loggedIn, prisma, Client } from './helpers';
import { addMember, makeActivity, makeProvider, typeByName } from './fixtures';

afterAll(closeApp);

async function coordinator() {
  const { user, client } = await loggedIn(['Provider Coordinator']);
  const p = await makeProvider();
  await addMember(p.id, user.id);
  return { user, client, p, base: `/providers/${p.id}/activities` };
}

const year = new Date().getUTCFullYear();
const ACT = (typeId: number) => ({
  activityTypeId: typeId,
  name: 'Annual Surgical Conference',
  numSessions: 3,
  releaseDate: `${year}-03-01`,
  expiryDate: `${year}-03-03`,
  deliveryMode: 'physical',
  venue: 'KICC',
  city: 'Nairobi',
  specializationAreas: [1],
});

describe('activities', () => {
  it('creates with a points snapshot and activity number', async () => {
    const { client, base } = await coordinator();
    const type = await typeByName('Conference / Scientific meeting');
    const r = await client.post(base, ACT(type.id));
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ cpdPoints: '5', maxPoints: '15', multiSessions: true, published: false });
    expect(r.body.activityNo).toMatch(/^CPD-\d{4}-\d{6}$/);
    const detail = await client.get(`${base}/${r.body.id}`);
    expect(detail.body.sessions.map((s: any) => s.label)).toEqual(['Session 1', 'Session 2', 'Session 3']);
  });

  it('single-session label is "Session 1 (Default)" and archived types are refused', async () => {
    const { client, base } = await coordinator();
    const type = await typeByName('CME session');
    const r = await client.post(base, { ...ACT(type.id), numSessions: 1 });
    expect((await client.get(`${base}/${r.body.id}`)).body.sessions[0].label).toBe('Session 1 (Default)');
    const archived = await prisma.activityType.create({ data: { name: 'Old type', cpdPoints: 1, archived: true } });
    expect((await client.post(base, ACT(archived.id))).status).toBe(422);
  });

  it('validates end date after start', async () => {
    const { client, base } = await coordinator();
    const type = await typeByName('CME session');
    const r = await client.post(base, { ...ACT(type.id), expiryDate: `${year}-01-01` });
    expect(r.status).toBe(422);
    expect(r.body.error.details.fields.expiryDate).toBeTruthy();
  });

  it('publish/unpublish are POST and audited, failures too', async () => {
    const { client, base, p } = await coordinator();
    const a = await makeActivity(p.id, { published: false });
    expect((await client.get(`${base}/${a.id}/publish`)).status).toBe(404);
    expect((await client.post(`${base}/${a.id}/publish`)).status).toBe(201);
    expect((await prisma.activity.findUniqueOrThrow({ where: { id: a.id } })).datePublished).not.toBeNull();
    expect((await client.post(`${base}/${a.id}/publish`)).status).toBe(400);
    expect((await client.post(`${base}/${a.id}/unpublish`)).status).toBe(201);
    const after = await prisma.activity.findUniqueOrThrow({ where: { id: a.id } });
    expect(after.published).toBe(false);
    expect(after.datePublished).toBeNull();
    const events = await prisma.auditLog.findMany({ where: { logName: 'activity-publishing', subjectId: String(a.id) }, orderBy: { id: 'asc' } });
    expect(events.map((e) => e.event)).toEqual(['publish', 'publish-attempt', 'unpublish']);
  });

  it('inactive providers cannot publish', async () => {
    const { client, base, p } = await coordinator();
    await prisma.provider.update({ where: { id: p.id }, data: { status: 'inactive' } });
    const a = await makeActivity(p.id, { published: false });
    const r = await client.post(`${base}/${a.id}/publish`);
    expect(r.status).toBe(400);
  });

  it("activities of another provider can't be reached through mine", async () => {
    const { client, base } = await coordinator();
    const other = await makeProvider();
    const a = await makeActivity(other.id);
    expect((await client.get(`${base}/${a.id}`)).status).toBe(404);
    expect((await client.post(`${base}/${a.id}/tokens`, { count: 1, sessionNo: 1, validFrom: `${year}-01-01`, expiryDate: `${year}-12-31` })).status).toBe(404);
  });

  it('presenters need a valid reg. no. and are unique per activity', async () => {
    const { client, base, p } = await coordinator();
    const a = await makeActivity(p.id);
    const bad = await client.post(`${base}/${a.id}/presenters`, { regNo: 'Z99', firstName: 'A', lastName: 'B' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.message).toContain('Wrong registration number format');
    expect((await client.post(`${base}/${a.id}/presenters`, { regNo: 'a 1234', firstName: 'Ann', lastName: 'Bee' })).body.regNo).toBe('A1234');
    expect((await client.post(`${base}/${a.id}/presenters`, { regNo: 'A1234', firstName: 'Ann', lastName: 'Bee' })).status).toBe(400);
    expect((await client.post(`${base}/${a.id}/moderators`, { regNo: 'B5678', firstName: 'Mo', lastName: 'D' })).status).toBe(201);
  });

  it('regulator sees all activities', async () => {
    const p = await makeProvider();
    await makeActivity(p.id);
    const { client } = await loggedIn(['Regulator CPD Officer']);
    const r = await client.get('/regulator/activities');
    expect(r.body.total).toBeGreaterThan(0);
  });
});

describe('tokens', () => {
  it('generates tokens in batches of 30 with activityId prefixes', async () => {
    const { client, base, p } = await coordinator();
    const a = await makeActivity(p.id, { numSessions: 2 });
    const r = await client.post(`${base}/${a.id}/tokens`, { count: 65, sessionNo: 2, validFrom: `${year}-01-01`, expiryDate: `${year + 1}-12-31` });
    expect(r.status).toBe(201);
    expect(r.body.created).toBe(65);
    expect(r.body.batches).toHaveLength(3);
    const tokens = await prisma.activityToken.findMany({ where: { activityId: a.id } });
    const sizes = Object.values(tokens.reduce<Record<string, number>>((m, t) => ({ ...m, [t.batch]: (m[t.batch] ?? 0) + 1 }), {})).sort();
    expect(sizes).toEqual([30, 30, 5]);
    for (const t of tokens) {
      expect(t.token).toMatch(new RegExp(`^${a.id}\\d{6}$`));
      expect(t.batch).toMatch(new RegExp(`^${a.id}\\d{6}$`));
      expect(t.sessionNo).toBe(2);
    }
    const summary = await client.get(`${base}/${a.id}/tokens/summary`);
    expect(summary.body).toMatchObject({ total: 65, claimed: 0, unclaimed: 65, expired: 0 });
  });

  it('rejects sessions beyond numSessions', async () => {
    const { client, base, p } = await coordinator();
    const a = await makeActivity(p.id, { numSessions: 1 });
    expect((await client.post(`${base}/${a.id}/tokens`, { count: 2, sessionNo: 2, validFrom: `${year}-01-01`, expiryDate: `${year}-12-31` })).status).toBe(400);
  });

  it('computes expired status, bulk-edits by batch, deletes by session but keeps claimed tokens', async () => {
    const { client, base, p } = await coordinator();
    const a = await makeActivity(p.id, { numSessions: 2 });
    const g = await client.post(`${base}/${a.id}/tokens`, { count: 3, sessionNo: 1, validFrom: `${year - 1}-01-01`, expiryDate: `${year - 1}-12-31` });
    const list = await client.get(`${base}/${a.id}/tokens?status=expired`);
    expect(list.body.total).toBe(3);
    expect(list.body.data[0].computedStatus).toBe('expired');
    const upd = await client.patch(`${base}/${a.id}/tokens`, { batch: g.body.batches[0], validFrom: `${year}-01-01`, expiryDate: `${year + 1}-01-01` });
    expect(upd.body.updated).toBe(3);
    expect((await client.get(`${base}/${a.id}/tokens?status=unclaimed`)).body.total).toBe(3);
    const one = await prisma.activityToken.findFirstOrThrow({ where: { activityId: a.id } });
    await prisma.activityToken.update({ where: { id: one.id }, data: { status: 'claimed' } });
    expect((await client.delete(`${base}/${a.id}/tokens/${one.id}`)).status).toBe(400);
    const del = await client.post(`${base}/${a.id}/tokens/delete`, { sessionNo: 1 });
    expect(del.body.deleted).toBe(2);
  });

  it('downloads PDF cards and Excel', async () => {
    const { client, base, p } = await coordinator();
    const a = await makeActivity(p.id);
    await client.post(`${base}/${a.id}/tokens`, { count: 12, sessionNo: 1, validFrom: `${year}-01-01`, expiryDate: `${year + 1}-12-31` });
    const app = await getApp();
    const c = new Client(app);
    c.cookies = client.cookies;
    const pdf = await c.get(`${base}/${a.id}/tokens/download?format=pdf`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(Buffer.from(pdf.body as any).subarray(0, 4).toString()).toBe('%PDF');
    const x = await c.get(`${base}/${a.id}/tokens/download?format=xlsx&sessionNo=1`);
    expect(x.headers['content-type']).toContain('spreadsheetml');
  });
});
