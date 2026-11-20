import { closeApp, loggedIn, prisma } from './helpers';
import { makeActivity, makePractitioner, makeProvider, typeByName } from './fixtures';

afterAll(closeApp);

const year = new Date().getUTCFullYear();
let UROLOGY = 0;

beforeAll(async () => {
  UROLOGY = (await prisma.speciality.findFirstOrThrow({ where: { name: 'Urology' } })).id;
});

async function award(practitionerId: bigint, typeName: string, points: number, specialityIds: number[]) {
  const type = await typeByName(typeName);
  const claim = await prisma.cpdClaim.create({ data: { practitionerId, method: 'nontoken', cpdPoints: points, calYear: year, tokenTrail: 'nontoken' } });
  await prisma.cpdClaimEntry.create({ data: { claimId: claim.id, kind: 'base', source: 'nontoken', points, activityTypeId: type.id, specialityIds, calYear: year } });
}

const urologyFramework = (o: Record<string, any> = {}) => ({
  name: 'Urologists',
  cpdYearFrom: year,
  scope: 'speciality',
  specialityId: UROLOGY,
  totalRequiredPoints: 50,
  buckets: [
    { name: 'Urology-related', source: 'speciality_related', minPoints: 30, minDistinctActivityTypes: 2, maxPointsPerActivityType: 20, sortOrder: 0 },
    { name: 'Other areas', source: 'other', minPoints: 20, minDistinctActivityTypes: 2, maxPointsPerActivityType: 15, sortOrder: 1 },
  ],
  typeCaps: [],
  ...o,
});

describe('compliance frameworks', () => {
  it('default framework: plain 50 points, no buckets (legacy behaviour)', async () => {
    const { user, client } = await loggedIn(['Practitioner']);
    const p = await makePractitioner({ userId: user.id });
    await award(p.id, 'CME session', 50, []);
    const r = await client.get(`/me/compliance?year=${year}`);
    expect(r.body).toMatchObject({ compliant: true, countablePoints: 50, totalRequired: 50, buckets: [] });
  });

  it('creating a framework for the current year needs confirmation, then applies with explanations', async () => {
    const { client: admin } = await loggedIn(['Admin']);
    const { user, client } = await loggedIn(['Practitioner']);
    const p = await makePractitioner({ userId: user.id, specializationId: UROLOGY });
    await award(p.id, 'Conference / Scientific meeting', 24, [UROLOGY]);
    await award(p.id, 'Conference / Scientific meeting', 10, []);
    await award(p.id, 'Journal club', 10, []);

    const first = await admin.post('/regulator/compliance/frameworks', urologyFramework());
    expect(first.status).toBe(409);
    expect(first.body.error.code).toBe('CONFIRMATION_REQUIRED');
    expect(first.body.error.details.sampled).toBeGreaterThan(0);
    const saved = await admin.post('/regulator/compliance/frameworks', { ...urologyFramework(), confirm: true });
    expect(saved.status).toBe(201);
    expect(saved.body.buckets).toHaveLength(2);

    const c = await client.get(`/me/compliance?year=${year}`);
    expect(c.body.compliant).toBe(false);
    expect(c.body.buckets[0].message).toBe(
      'Urology-related: 20 of 30 points, add 10 more. All of them are from Conference / Scientific meeting; add at least one other activity type. 4 Conference / Scientific meeting points are above the cap and don\'t count.',
    );
    expect(c.body.buckets[1].message).toBe('Other areas: 20 of 20 points, complete.');

    // the cached result was recomputed by the job
    const cached = await prisma.complianceResult.findUnique({ where: { practitionerId_cpdYear: { practitionerId: p.id, cpdYear: year } } });
    expect(cached?.compliant).toBe(false);

    const sum = await client.get(`/me/diary/summary?year=${year}`);
    expect(sum.body.split).toEqual({ specialityRelated: { raw: 24, countable: 20 }, other: { raw: 20, countable: 20 } });

    // overlapping active framework for the same speciality is refused
    const dup = await admin.post('/regulator/compliance/frameworks', { ...urologyFramework({ name: 'Dup' }), confirm: true });
    expect(dup.status).toBe(400);

    await admin.delete(`/regulator/compliance/frameworks/${saved.body.id}`);
  });

  it('preview runs a draft without saving', async () => {
    const { client: admin } = await loggedIn(['Admin']);
    const p = await makePractitioner({ specializationId: UROLOGY });
    await award(p.id, 'CME session', 60, [UROLOGY]);
    const r = await admin.post('/regulator/compliance/frameworks/preview', { ...urologyFramework(), year });
    expect(r.status).toBe(201);
    const row = r.body.rows.find((x: any) => x.practitionerId === p.id.toString());
    expect(row.before.compliant).toBe(true);
    expect(row.after.compliant).toBe(false);
    expect(await prisma.complianceFramework.count({ where: { name: 'Urologists', deletedAt: null } })).toBe(0);
  });

  it('compliance report and points-by-type export', async () => {
    const prov = await makeProvider();
    await makeActivity(prov.id);
    const p = await makePractitioner();
    await award(p.id, 'Workshop / Skills training', 9, []);
    const { client } = await loggedIn(['Regulator CPD Officer']);
    await client.post(`/regulator/compliance/recompute?year=${year}`).catch(() => undefined);
    const admin = (await loggedIn(['Admin'])).client;
    await admin.post(`/regulator/compliance/recompute?year=${year}`);
    const rep = await client.get(`/regulator/compliance/report?year=${year}&status=not_compliant`);
    expect(rep.status).toBe(200);
    expect(rep.body.data.find((d: any) => d.practitionerId === p.id.toString())?.reasons[0]).toContain('9 of 50');
    const csv = await client.get(`/regulator/compliance/report?year=${year}&format=csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    const pbt = await client.get(`/regulator/reports/points-by-type?year=${year}`);
    expect(pbt.body.data.some((d: any) => d.activityTypeName === 'Workshop / Skills training')).toBe(true);
  });
});
