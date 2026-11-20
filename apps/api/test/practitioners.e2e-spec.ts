import { closeApp, loggedIn, prisma, PASSWORD } from './helpers';
import { makeActivity, makePractitioner, makeProvider } from './fixtures';

afterAll(closeApp);

const year = new Date().getUTCFullYear();

async function claim(practitionerId: bigint, activityId: bigint | null, points: number, trail: string) {
  const c = await prisma.cpdClaim.create({ data: { practitionerId, activityId, method: 'token', cpdPoints: points, calYear: year, tokenTrail: trail } });
  await prisma.cpdClaimEntry.create({ data: { claimId: c.id, kind: 'base', source: 'token', points, activityTypeId: 1, calYear: year } });
  return c;
}

describe('regulator practitioner tools', () => {
  it('lists, edits with an audit diff, trashes and restores', async () => {
    const { client } = await loggedIn(['Regulator CPD Officer']);
    const p = await makePractitioner();
    const list = await client.get(`/regulator/practitioners?search=${p.regNo}`);
    expect(list.body.data[0].id).toBe(p.id.toString());
    const r = await client.put(`/regulator/practitioners/${p.id}`, { firstName: 'Changed', lastName: p.lastName, regNo: p.regNo });
    expect(r.status).toBe(200);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { logName: 'practitioners', event: 'updated', subjectId: p.id.toString() } });
    expect((audit.properties as any).firstName).toEqual({ from: 'Test', to: 'Changed' });
    expect((await client.delete(`/regulator/practitioners/${p.id}`)).status).toBe(200);
    expect((await client.get(`/regulator/practitioners?list=trashed&search=${p.regNo}`)).body.total).toBe(1);
    expect((await client.post(`/regulator/practitioners/${p.id}/restore`)).status).toBe(201);
  });

  it('finds duplicates and merges claims for the same activity into one row', async () => {
    const { client } = await loggedIn(['Regulator CPD Officer']);
    const regNo = `D${Math.floor(Math.random() * 90000 + 10000)}`;
    const a = await makePractitioner({ regNo });
    const b = await makePractitioner({ regNo });
    const prov = await makeProvider();
    const act = await makeActivity(prov.id, { numSessions: 3 });
    const other = await makeActivity(prov.id);
    await claim(a.id, act.id, 2, 'T1');
    await claim(b.id, act.id, 2, 'T2');
    await claim(b.id, other.id, 2, 'T3');
    await prisma.nonTokenClaim.create({ data: { practitionerId: b.id, activityTypeId: 1, activityName: 'X', description: 'Y', beginDate: new Date(), endDate: new Date(), place: 'Z' } });

    const dups = await client.get(`/regulator/practitioners/duplicates?search=${regNo}`);
    expect(dups.body.data[0]).toMatchObject({ regNo, count: 2 });

    const m = await client.post('/regulator/practitioners/merge', { targetId: a.id.toString(), sourceIds: [b.id.toString()] });
    expect(m.body).toEqual({ moved: 1, combined: 1, merged: 1 });
    const claims = await prisma.cpdClaim.findMany({ where: { practitionerId: a.id, deletedAt: null }, orderBy: { id: 'asc' } });
    expect(claims).toHaveLength(2);
    const merged = claims.find((c) => c.activityId === act.id)!;
    expect(merged.cpdPoints.toString()).toBe('4');
    expect(merged.tokenTrail).toBe('T1 T2');
    expect(await prisma.cpdClaimEntry.count({ where: { claimId: merged.id } })).toBe(2);
    expect(await prisma.nonTokenClaim.count({ where: { practitionerId: a.id } })).toBe(1);
    const gone = await prisma.practitioner.findUniqueOrThrow({ where: { id: b.id } });
    expect(gone.regNo).toBeNull();
    expect(gone.deletedAt).not.toBeNull();
    expect((await client.get(`/regulator/practitioners/duplicates?search=${regNo}`)).body.total).toBe(0);
    expect(await prisma.auditLog.count({ where: { event: 'merged', subjectId: a.id.toString() } })).toBe(1);
  });

  it('permanent delete requires trash, password confirmation and no CPD history', async () => {
    const { client } = await loggedIn(['Admin']);
    const p = await makePractitioner();
    expect((await client.delete(`/regulator/practitioners/${p.id}/permanent`)).status).toBe(423);
    await client.post('/auth/confirm-password', { password: PASSWORD });
    expect((await client.delete(`/regulator/practitioners/${p.id}/permanent`)).status).toBe(400);
    await client.delete(`/regulator/practitioners/${p.id}`);
    expect((await client.delete(`/regulator/practitioners/${p.id}/permanent`)).status).toBe(200);
    expect(await prisma.practitioner.findUnique({ where: { id: p.id } })).toBeNull();
  });

  it('dashboard returns totals and 12-month trends', async () => {
    const { client } = await loggedIn(['Regulator CPD Officer']);
    const r = await client.get('/regulator/dashboard');
    expect(r.status).toBe(200);
    expect(r.body.monthly.claims).toHaveLength(12);
    expect(typeof r.body.totals.practitioners).toBe('number');
  });

  it('officers without Can Edit practitioner cannot merge', async () => {
    const { user, client } = await loggedIn(['Public User']);
    const perm = await prisma.permission.findMany({ where: { name: { in: ['Read Admin Panel', 'Manage Practitioners'] } } });
    await prisma.userPermission.createMany({ data: perm.map((p) => ({ userId: user.id, permissionId: p.id })) });
    expect((await client.get('/regulator/practitioners')).status).toBe(200);
    expect((await client.post('/regulator/practitioners/merge', { targetId: '1', sourceIds: ['2'] })).status).toBe(403);
  });
});
