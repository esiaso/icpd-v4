import ExcelJS from 'exceljs';
import { Client, closeApp, getApp, loggedIn, outbox, prisma, PDF } from './helpers';
import { makeActivity, makePractitioner, makeProvider, typeByName } from './fixtures';

afterAll(closeApp);

const year = new Date().getUTCFullYear();

async function practitionerClient() {
  const { user, client } = await loggedIn(['Practitioner']);
  const p = await makePractitioner({ userId: user.id, specializationId: 1 });
  return { user, client, p };
}

async function tokensFor(activityId: bigint, n = 1, o: { sessionNo?: number; expiryDate?: string } = {}) {
  const rows = Array.from({ length: n }, (_, i) => ({
    token: `${activityId}${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}${i}`,
    activityId,
    sessionNo: o.sessionNo ?? 1,
    batch: `${activityId}000000`,
    validFrom: new Date(`${year}-01-01T00:00:00Z`),
    expiryDate: new Date(`${o.expiryDate ?? `${year + 1}-12-31`}T00:00:00Z`),
  }));
  await prisma.activityToken.createMany({ data: rows });
  return rows.map((r) => r.token);
}

describe('token claims', () => {
  it('awards base points, writes a claim entry and a success log', async () => {
    const { client, p } = await practitionerClient();
    const prov = await makeProvider();
    const a = await makeActivity(prov.id, { typeName: 'CME session', numSessions: 2, specializationAreas: [1] });
    const [t] = await tokensFor(a.id);
    const r = await client.post('/me/claims/token', { token: t });
    expect(r.status).toBe(201);
    expect(r.body.message).toBe(`You have successfully claimed 2 points for activity #${a.id}`);
    const claim = await prisma.cpdClaim.findFirstOrThrow({ where: { practitionerId: p.id, activityId: a.id }, include: { entries: true } });
    expect(claim.cpdPoints.toString()).toBe('2');
    expect(claim.method).toBe('token');
    expect(claim.tokenTrail).toBe(t);
    expect(claim.entries[0]).toMatchObject({ kind: 'base', token: t, activityTypeId: a.activityTypeId, specialityIds: [1] });
    expect((await prisma.activityToken.findUniqueOrThrow({ where: { token: t } })).claimedBy).toBe(p.id);
    expect(await prisma.practitionerLog.count({ where: { practitionerId: p.id, logType: 'claim_success' } })).toBe(1);
  });

  it('returns the legacy messages for each failure and logs attempts', async () => {
    const { client, p } = await practitionerClient();
    const prov = await makeProvider();
    const a = await makeActivity(prov.id, { numSessions: 1 });
    const [t1, t2] = await tokensFor(a.id, 2);
    const msg = async (token: string) => (await client.post('/me/claims/token', { token })).body.error?.message;
    expect(await msg('99999999999')).toBe('Invalid Token');
    expect((await client.post('/me/claims/token', { token: t1 })).status).toBe(201);
    expect(await msg(t2)).toBe('You have made maximum allowed claims with tokens for this activity!!');
    const other = await practitionerClient();
    expect((await other.client.post('/me/claims/token', { token: t1 })).body.error.message).toBe('The token submitted is had been claimed');
    const b = await makeActivity(prov.id);
    const [expired] = await tokensFor(b.id, 1, { expiryDate: `${year - 1}-12-31` });
    expect(await msg(expired)).toBe('The token submitted is expired!');
    const c = await makeActivity(prov.id, { published: false });
    const [unpub] = await tokensFor(c.id);
    expect(await msg(unpub)).toBe('Token invalid, contact the provider');
    expect(await prisma.practitionerLog.count({ where: { practitionerId: p.id, logType: 'claim_attempt' } })).toBe(4);
  });

  it('stops at max points for the activity', async () => {
    const { client } = await practitionerClient();
    const prov = await makeProvider();
    const a = await makeActivity(prov.id, { numSessions: 2 });
    // Seed an existing claim at the max (e.g. from attendance) so a token can't add more.
    const tokens = await tokensFor(a.id, 1);
    const pr = await prisma.practitioner.findFirstOrThrow({ where: { user: { email: (await client.get('/auth/me')).body.email } } });
    await prisma.cpdClaim.create({ data: { practitionerId: pr.id, activityId: a.id, method: 'attendance', cpdPoints: 4, calYear: year, tokenTrail: 'attendance attendance' } });
    expect((await client.post('/me/claims/token', { token: tokens[0] })).body.error.message).toBe('You have claimed maximum points for this activity.');
  });

  it('adds the presenter bonus on an existing claim (legacy defect #4) and only once', async () => {
    const { client, p } = await practitionerClient();
    const prov = await makeProvider();
    const a = await makeActivity(prov.id, { typeName: 'Conference / Scientific meeting', numSessions: 2 });
    await prisma.activityPresenter.create({ data: { activityId: a.id, regNo: p.regNo!, firstName: 'P', lastName: 'Q' } });
    const [t1, t2] = await tokensFor(a.id, 2);
    await prisma.cpdClaim.create({ data: { practitionerId: p.id, activityId: a.id, method: 'attendance', cpdPoints: 0, calYear: year, tokenTrail: '' } });
    expect((await client.post('/me/claims/token', { token: t1 })).status).toBe(201);
    let claim = await prisma.cpdClaim.findFirstOrThrow({ where: { practitionerId: p.id, activityId: a.id } });
    expect(claim.cpdPoints.toString()).toBe('8'); // 5 base + 3 presenter
    expect(claim.tokenTrail).toBe(`${t1} presenter`);
    expect((await prisma.activityPresenter.findFirstOrThrow({ where: { activityId: a.id } })).pointsAwarded).toBe(true);
    expect((await client.post('/me/claims/token', { token: t2 })).status).toBe(201);
    claim = await prisma.cpdClaim.findFirstOrThrow({ where: { practitionerId: p.id, activityId: a.id } });
    expect(claim.cpdPoints.toString()).toBe('13'); // + 5, no second bonus
  });

  it('two concurrent claims of one token: exactly one wins (defect #8)', async () => {
    const one = await practitionerClient();
    const two = await practitionerClient();
    const prov = await makeProvider();
    const a = await makeActivity(prov.id);
    const [t] = await tokensFor(a.id);
    const [r1, r2] = await Promise.all([one.client.post('/me/claims/token', { token: t }), two.client.post('/me/claims/token', { token: t })]);
    expect([r1.status, r2.status].sort()).toEqual([201, 422]);
    expect(await prisma.cpdClaimEntry.count({ where: { token: t } })).toBe(1);
  });

  it('calYear is min(current year, expiry year)', async () => {
    const { client, p } = await practitionerClient();
    const prov = await makeProvider();
    const a = await makeActivity(prov.id, { releaseDate: `${year - 1}-06-01`, expiryDate: `${year - 1}-06-02` });
    await prisma.activity.update({ where: { id: a.id }, data: { expiryDate: new Date(`${year - 1}-06-02T00:00:00Z`) } });
    const [t] = await tokensFor(a.id, 1, { expiryDate: `${year + 1}-01-01` });
    await client.post('/me/claims/token', { token: t });
    expect((await prisma.cpdClaim.findFirstOrThrow({ where: { practitionerId: p.id, activityId: a.id } })).calYear).toBe(year - 1);
  });
});

describe('quick QR claim', () => {
  it('claims with reg. no. + token without login', async () => {
    const p = await makePractitioner();
    const prov = await makeProvider();
    const a = await makeActivity(prov.id);
    const [t] = await tokensFor(a.id);
    const anon = new Client(await getApp());
    expect((await anon.post(`/public/claim/${a.id}`, { regNo: 'Q1', token: t })).body.error.message).toContain('Wrong registration number format');
    expect((await anon.post(`/public/claim/${a.id}`, { regNo: 'A99999', token: t })).body.error.message).toContain('Registration Number provided does not exist');
    const r = await anon.post(`/public/claim/${a.id}`, { regNo: ` ${p.regNo!.toLowerCase()} `, token: t });
    expect(r.status).toBe(201);
    expect(r.body.points).toBe(2);
  });

  it('a token of another activity is invalid on this activity link', async () => {
    const p = await makePractitioner();
    const prov = await makeProvider();
    const a = await makeActivity(prov.id);
    const b = await makeActivity(prov.id);
    const [t] = await tokensFor(b.id);
    const anon = new Client(await getApp());
    expect((await anon.post(`/public/claim/${a.id}`, { regNo: p.regNo, token: t })).body.error.message).toBe('Invalid Token');
  });

  it('expiry is enforced unless the regulator turns it off', async () => {
    const p = await makePractitioner();
    const prov = await makeProvider();
    const a = await makeActivity(prov.id);
    const [t] = await tokensFor(a.id, 1, { expiryDate: `${year - 1}-01-01` });
    const anon = new Client(await getApp());
    expect((await anon.post(`/public/claim/${a.id}`, { regNo: p.regNo, token: t })).body.error.message).toBe('The token submitted is expired!');
    await prisma.setting.upsert({ where: { key: 'claims.quickClaimEnforceExpiry' }, create: { key: 'claims.quickClaimEnforceExpiry', value: false }, update: { value: false } });
    expect((await anon.post(`/public/claim/${a.id}`, { regNo: p.regNo, token: t })).status).toBe(201);
    await prisma.setting.delete({ where: { key: 'claims.quickClaimEnforceExpiry' } });
  });
});

describe('non-token claims', () => {
  const body = (typeId: number, o: Record<string, any> = {}) => ({
    activityTypeId: typeId,
    activityName: 'Published paper on BPH',
    description: 'Article in East African Medical Journal',
    beginDate: `${year}-02-01`,
    endDate: `${year}-02-01`,
    place: 'Nairobi',
    specialityIds: [1],
    ...o,
  });

  it('requires a PDF, saves Pending, is unique, and can be awarded with caps', async () => {
    const { client, p } = await practitionerClient();
    const type = await typeByName('Publication in a peer-reviewed journal');
    const noFile = await client.post('/me/non-token-claims', body(type.id));
    expect(noFile.status).toBe(400);
    const notPdf = await client.upload('/me/non-token-claims', 'evidence', Buffer.from('hello'), 'x.pdf', body(type.id));
    expect(notPdf.status).toBe(400);
    const r = await client.upload('/me/non-token-claims', 'evidence', PDF, 'paper.pdf', body(type.id));
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('Pending');
    expect((await client.upload('/me/non-token-claims', 'evidence', PDF, 'paper.pdf', body(type.id))).status).toBe(409);

    const { client: officer } = await loggedIn(['Regulator CPD Officer']);
    const over = await officer.post(`/regulator/claims/non-token/${r.body.id}/award`, { points: 11 });
    expect(over.status).toBe(422);
    expect(over.body.error.message).toBe('This activity type allows at most 10 points per claim.');
    expect((await officer.post(`/regulator/claims/non-token/${r.body.id}/award`, { points: 10 })).status).toBe(201);
    const claim = await prisma.cpdClaim.findFirstOrThrow({ where: { nonTokenClaimId: BigInt(r.body.id) }, include: { entries: true } });
    expect(claim).toMatchObject({ method: 'nontoken', methodSource: 'nonTokenUserInitiated', calYear: year });
    expect(claim.entries[0].specialityIds).toEqual([1]);
    expect((await client.get('/me/portfolio')).body.points).toBe(10);
    expect((await client.delete(`/me/non-token-claims/${r.body.id}`)).status).toBe(400);
    expect(p.id).toBeTruthy();
  });

  it('enforces the yearly cap of the type across awards', async () => {
    const { client } = await practitionerClient();
    const type = await typeByName('Publication in a peer-reviewed journal'); // 20/year
    const { client: officer } = await loggedIn(['Regulator CPD Officer']);
    const ids: string[] = [];
    for (const n of [1, 2, 3]) {
      const r = await client.upload('/me/non-token-claims', 'evidence', PDF, 'p.pdf', body(type.id, { activityName: `Paper ${n}` }));
      ids.push(r.body.id);
    }
    await officer.post(`/regulator/claims/non-token/${ids[0]}/award`, { points: 10 });
    await officer.post(`/regulator/claims/non-token/${ids[1]}/award`, { points: 10 });
    const r = await officer.post(`/regulator/claims/non-token/${ids[2]}/award`, { points: 1 });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toContain('at most 20 points per year; 0 remaining');
  });

  it('"once" types may only be claimed once per calendar year (defect #9 scoped)', async () => {
    const { client } = await practitionerClient();
    const once = await typeByName('Postgraduate study');
    const intern = await typeByName('Internship supervision');
    const other = await typeByName('Other (with evidence)');
    expect((await client.upload('/me/non-token-claims', 'evidence', PDF, 'a.pdf', body(once.id, { activityName: 'MMed year 1' }))).status).toBe(201);
    const dup = await client.upload('/me/non-token-claims', 'evidence', PDF, 'a.pdf', body(intern.id, { activityName: 'Interns', endDate: `${year}-11-01` }));
    expect(dup.status).toBe(422);
    expect(dup.body.error.message).toBe('You have made a similar type of claim for the same period');
    // Not a "once" type: allowed
    expect((await client.upload('/me/non-token-claims', 'evidence', PDF, 'a.pdf', body(other.id, { activityName: 'Course' }))).status).toBe(201);
    // Next year is fine
    expect((await client.upload('/me/non-token-claims', 'evidence', PDF, 'a.pdf', body(intern.id, { activityName: 'Interns', beginDate: `${year + 1}-01-02`, endDate: `${year + 1}-02-01` }))).status).toBe(201);
  });

  it('rejection stores a comment and emails the practitioner; editing resets to Pending', async () => {
    const { client, p } = await practitionerClient();
    const type = await typeByName('Other (with evidence)');
    const r = await client.upload('/me/non-token-claims', 'evidence', PDF, 'a.pdf', body(type.id, { activityName: 'Workshop abroad' }));
    const { client: officer } = await loggedIn(['Regulator CPD Officer']);
    expect((await officer.post(`/regulator/claims/non-token/${r.body.id}/reject`, {})).status).toBe(422);
    expect((await officer.post(`/regulator/claims/non-token/${r.body.id}/reject`, { reason: 'Certificate is unreadable' })).status).toBe(201);
    expect((await prisma.comment.findFirstOrThrow({ where: { itemId: BigInt(r.body.id), type: 'Non-Token Claim' } })).comment).toBe('Certificate is unreadable');
    const mail = outbox().find((m) => m.to === p.email && m.template === 'NotifyClaimRejection');
    expect(mail?.data).toMatchObject({ activityName: 'Workshop abroad', reason: 'Certificate is unreadable' });
    const portfolio = await client.get('/me/portfolio');
    expect(portfolio.body.pendingClaims.find((c: any) => c.id === r.body.id).reason).toBe('Certificate is unreadable');
    // Defect #10: the new evidence file is saved on edit, and the claim goes back to Pending
    const before = await prisma.nonTokenClaim.findUniqueOrThrow({ where: { id: BigInt(r.body.id) } });
    const edited = await client.upload(`/me/non-token-claims/${r.body.id}`, 'evidence', Buffer.concat([PDF, Buffer.from('v2')]), 'b.pdf', body(type.id, { activityName: 'Workshop abroad' }), 'put');
    expect(edited.status).toBe(200);
    expect(edited.body.status).toBe('Pending');
    expect(edited.body.evidenceUrl).not.toBe(before.evidenceUrl);
  });

  it('practitioners cannot see each other\'s claims (defect #13)', async () => {
    const a = await practitionerClient();
    const b = await practitionerClient();
    const type = await typeByName('Other (with evidence)');
    const r = await a.client.upload('/me/non-token-claims', 'evidence', PDF, 'a.pdf', body(type.id, { activityName: 'Private' }));
    expect((await b.client.get(`/me/non-token-claims/${r.body.id}`)).status).toBe(404);
    expect((await b.client.delete(`/me/non-token-claims/${r.body.id}`)).status).toBe(404);
    expect((await b.client.get(`/regulator/practitioners/${a.p.id}/diary`)).status).toBe(403);
  });
});

describe('attendee import', () => {
  async function xlsx(rows: any[][]) {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('s');
    ws.addRow(['regno', 'fullname', 'email', 'activitysession']);
    rows.forEach((r) => ws.addRow(r));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  it('imports, skips blanks/duplicates, processes all and marks outcomes', async () => {
    const { user, client } = await loggedIn(['Provider Coordinator']);
    const prov = await makeProvider();
    await prisma.providerUser.create({ data: { providerId: prov.id, userId: user.id } });
    const a = await makeActivity(prov.id, { numSessions: 1 });
    const known = await makePractitioner();
    const base = `/providers/${prov.id}/activities/${a.id}`;
    const file = await xlsx([[known.regNo!.toLowerCase(), 'Known', 'k@x.io', 1], ['', 'Blank', '', 1], [known.regNo, 'Dup', '', 1], ['A1', 'Unknown', '', 1], ['B 9999', 'Missing', '', '']]);
    const up = await client.upload(`${base}/imports`, 'file', file, 'list.xlsx');
    expect(up.status).toBe(201);
    expect(up.body).toEqual({ imported: 3, skipped: 1 });
    const run = await client.post(`${base}/imports/process-all`);
    expect(run.body.status).toBe('done');
    expect(run.body.result).toMatchObject({ processed: 3, awarded: 1, failed: 2 });
    const rows = await prisma.attendeeImport.findMany({ where: { activityId: a.id }, orderBy: { id: 'asc' } });
    expect(rows.map((r) => [r.regNo, r.status, r.comment])).toEqual([
      [known.regNo, 'processed', 'Points awarded!'],
      ['A1', 'failed', 'Not Found'],
      ['B9999', 'failed', 'Not Found'],
    ]);
    const claim = await prisma.cpdClaim.findFirstOrThrow({ where: { practitionerId: known.id, activityId: a.id } });
    expect(claim).toMatchObject({ method: 'attendance', tokenTrail: 'attendance' });
    // A second list for the same session/person: max claims made
    await prisma.attendeeImport.create({ data: { activityId: a.id, regNo: known.regNo!, session: 1 } }).catch(() => undefined);
    const row = await prisma.attendeeImport.findFirstOrThrow({ where: { activityId: a.id, regNo: known.regNo!, status: 'unprocessed' } });
    expect((await client.post(`${base}/imports/${row.id}/process`)).body).toEqual({ status: 'failed', message: 'Max claims made' });
  });

  it('regulator re-processes failed imports after late registration', async () => {
    const prov = await makeProvider();
    const a = await makeActivity(prov.id);
    await prisma.attendeeImport.create({ data: { activityId: a.id, regNo: 'G88888', session: 1, status: 'failed', comment: 'Not Found' } });
    const p = await makePractitioner({ regNo: 'G88888' });
    const { client } = await loggedIn(['Regulator CPD Officer']);
    const r = await client.post(`/regulator/practitioners/${p.id}/reprocess-attendance`);
    expect(r.body.message).toBe('1 processed, 1 awarded, 0 failed');
  });

  it('refuses .xls with guidance', async () => {
    const { user, client } = await loggedIn(['Provider Coordinator']);
    const prov = await makeProvider();
    await prisma.providerUser.create({ data: { providerId: prov.id, userId: user.id } });
    const a = await makeActivity(prov.id);
    const r = await client.upload(`/providers/${prov.id}/activities/${a.id}/imports`, 'file', Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), 'old.xls');
    expect(r.body.error.message).toContain('save it as .xlsx');
  });
});

describe('diary, exemptions and documents', () => {
  it('portfolio shows points and performance; PDFs render', async () => {
    const { client, p } = await practitionerClient();
    const prov = await makeProvider();
    const a = await makeActivity(prov.id, { typeName: 'Conference / Scientific meeting' });
    const [t] = await tokensFor(a.id);
    await client.post('/me/claims/token', { token: t });
    const pf = await client.get(`/me/portfolio?year=${year}`);
    expect(pf.body).toMatchObject({ points: 5, required: 50, performance: 10, compliant: false });
    expect(pf.body.years).toContain(year);
    const sum = await client.get(`/me/diary/summary?year=${year}`);
    expect(sum.body.byType[0]).toMatchObject({ activityTypeName: 'Conference / Scientific meeting', claims: 1, rawPoints: 5, share: 100 });
    const pdf = await client.get(`/me/diary/pdf?year=${year}`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const cert = await client.get(`/me/certificate/pdf?year=${year}`);
    expect(cert.status).toBe(200);
    expect(p.id).toBeTruthy();
  });

  it('exemption: one per year, snapshot of points, compliant afterwards', async () => {
    const { client: me, p } = await practitionerClient();
    const { client } = await loggedIn(['Regulator CPD Officer']);
    const r = await client.post('/regulator/exemptions', { practitionerId: p.id.toString(), cpdYear: year, reason: 'Maternity leave' });
    expect(r.status).toBe(201);
    expect(r.body.pointsAttained).toBe('0');
    const again = await client.post('/regulator/exemptions', { regNo: p.regNo, cpdYear: year, reason: 'Again' });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toBe('This practitioner/dentist has been Exempted for the specified year.');
    expect((await me.get(`/me/portfolio?year=${year}`)).body).toMatchObject({ exempted: true, compliant: true });
    expect(await prisma.auditLog.count({ where: { logName: 'practitioner-excemption', subjectId: String(p.id) } })).toBe(2);
  });
});
