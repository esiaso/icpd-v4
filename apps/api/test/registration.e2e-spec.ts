import { closeApp, loggedIn, outbox, prisma, PNG, uniq } from './helpers';
import { makePractitioner } from './fixtures';

afterAll(closeApp);

let seq = 7000;
const profile = (o: Record<string, any> = {}) => ({
  firstName: 'Amina',
  lastName: 'Otieno',
  email: `${uniq('amina')}@doc.test`,
  mobile1: '0722000000',
  nationality: 'Kenyan',
  countryOfResidenceId: 1,
  nationalId: `ID${++seq}${Date.now() % 10000}`,
  physicalAddress: 'Kilimani',
  city: 'Nairobi',
  regNo: `A${++seq}`,
  categoryId: 1,
  ...o,
});

async function applicant() {
  const { user, client } = await loggedIn(['Public User']);
  return { user, client };
}

describe('registration application', () => {
  it('requires a verified email', async () => {
    const { client } = await loggedIn(['Public User'], { verified: false });
    expect((await client.post('/me/application/profile', profile())).status).toBe(403);
  });

  it('runs profile → photo → academics → specialities → workplace → submit', async () => {
    const { user, client } = await applicant();
    const bad = await client.post('/me/application/profile', profile({ regNo: 'Z12' }));
    expect(bad.status).toBe(422);
    expect(bad.body.error.message).toBe('Wrong registration number format! (e.g Axxxx or Bxxxx …)');

    const r = await client.post('/me/application/profile', profile({ email: user.email }));
    expect(r.status).toBe(201);
    expect(r.body.next).toBe('photo');
    expect(r.body.practitioner.applicationNo).toMatch(/^R1\d{4,}$/);
    expect(r.body.practitioner.status).toBe('presubmission');

    const early = await client.post('/me/application/submit');
    expect(early.status).toBe(422);
    expect(early.body.error.details.missing).toEqual(['photo', 'academic', 'specialities', 'workplace']);

    expect((await client.upload('/me/application/photo', 'file', PNG, 'me.png')).status).toBe(201);
    expect((await client.put('/me/application/academics', { rows: [{ qualification: 'MBChB', institution: 'University of Nairobi', year: 2015 }] })).status).toBe(200);
    expect((await client.put('/me/application/specialities', { primaryId: 1, otherIds: [2] })).status).toBe(200);
    expect((await client.put('/me/application/workplace', { rows: [{ institution: 'KNH', position: 'MO' }] })).status).toBe(200);
    const s = await client.post('/me/application/submit');
    expect(s.status).toBe(201);
    const p = await prisma.practitioner.findFirstOrThrow({ where: { userId: user.id } });
    expect(p.status).toBe('submitted');
    expect(p.dateOfApplication).not.toBeNull();
    expect(outbox().some((m) => m.to === user.email && m.template === 'NotifySubmission')).toBe(true);
    // No more edits after submission
    expect((await client.put('/me/application/workplace', { rows: [{ institution: 'Other' }] })).status).toBe(403);
  });

  it('duplicate reg. no. is rejected with the legacy message', async () => {
    const existing = await makePractitioner({ userId: (await loggedIn(['Practitioner'])).user.id });
    const { client } = await applicant();
    const r = await client.post('/me/application/profile', profile({ regNo: existing.regNo }));
    expect(r.status).toBe(422);
    expect(r.body.error.message).toBe('Registration number already exist!');
  });

  it('offers to import a legacy record and only links it with a matching ID or email', async () => {
    const legacy = await prisma.practitioner.create({ data: { regNo: 'B4321', firstName: 'Old', lastName: 'Record', nationalId: '12345678', status: 'registered', email: 'someone-else@legacy.test' } });
    const { user, client } = await applicant();
    const r = await client.post('/me/application/profile', profile({ regNo: 'b 4321' }));
    expect(r.body.next).toBe('import');
    expect(r.body.importable.id).toBe(legacy.id.toString());
    expect((await client.post('/me/application/import', { regNo: 'B4321', nationalId: 'nope' })).status).toBe(403);
    const ok = await client.post('/me/application/import', { regNo: 'B4321', nationalId: '12345678' });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('registered');
    const roles = await prisma.userRole.findMany({ where: { userId: user.id }, include: { role: true } });
    expect(roles.map((x) => x.role.name)).toEqual(['Practitioner']);
    expect(outbox().some((m) => m.to === user.email && m.template === 'NotifyImport')).toBe(true);
  });
});

describe('screening', () => {
  async function submitted() {
    const { user, client } = await applicant();
    await client.post('/me/application/profile', profile({ email: user.email }));
    await client.upload('/me/application/photo', 'file', PNG, 'me.png');
    await client.put('/me/application/academics', { rows: [{ qualification: 'MBChB', institution: 'Moi University' }] });
    await client.put('/me/application/specialities', { primaryId: 1, otherIds: [] });
    await client.put('/me/application/workplace', { rows: [{ institution: 'MTRH' }] });
    await client.post('/me/application/submit');
    const p = await prisma.practitioner.findFirstOrThrow({ where: { userId: user.id } });
    return { user, client, p };
  }

  it('screen → return → resubmit (sections carried forward) → approve', async () => {
    const { user, client, p } = await submitted();
    const { client: officer } = await loggedIn(['Regulator CPD Officer']);
    const base = `/regulator/applications/${p.id}`;
    expect((await officer.get('/regulator/applications?list=new')).body.data.some((x: any) => x.id === p.id.toString())).toBe(true);
    expect((await officer.post(`${base}/start`)).status).toBe(201);
    for (const slug of ['profile', 'photo', 'academic', 'specialization']) await officer.post(`${base}/sections/${slug}`, { recommendation: 'Complete' });
    await officer.post(`${base}/sections/workplace`, { recommendation: 'Incomplete', notes: 'Add your current employer' });
    let d = await officer.get(base);
    expect(d.body.actions).toMatchObject({ canReturn: true, canAdvance: false });
    expect((await officer.post(`${base}/return`)).status).toBe(201);
    const mail = outbox().find((m) => m.to === user.email && m.template === 'NotifyReturn');
    expect(mail?.data.sections).toEqual([{ section: 'Workplace / affiliation', slug: 'workplace', notes: 'Add your current employer' }]);

    // applicant sees the returned section, fixes it (auto-marked Complete) and resubmits
    const pv = await client.get('/me/application');
    expect(pv.body.returnedSections).toEqual([{ section: 'workplace', notes: 'Add your current employer', documentRequested: false }]);
    await client.put('/me/application/workplace', { rows: [{ institution: 'Aga Khan Hospital' }] });
    const sec = await prisma.applicationSectionVerification.findFirstOrThrow({ where: { practitionerId: p.id, sectionName: 'workplace' }, orderBy: { id: 'desc' } });
    expect(sec.recommendation).toBe('Complete');
    expect((await client.post('/me/application/resubmit')).status).toBe(201);

    // second round: previous Complete sections are carried forward
    await officer.post(`${base}/start`);
    d = await officer.get(base);
    expect(d.body.sections.filter((s: any) => s.recommendation === 'Complete').map((s: any) => s.slug)).toEqual(['profile', 'photo', 'academic', 'specialization', 'workplace']);
    expect(d.body.actions.canAdvance).toBe(true);
    expect((await officer.post(`${base}/complete-screening`)).status).toBe(201);
    expect((await officer.post(`${base}/chairman-review`, { comment: 'Fine' })).status).toBe(201);
    expect((await prisma.applicationVerification.findFirstOrThrow({ where: { practitionerId: p.id }, orderBy: { id: 'desc' } })).approvalComment).toBe('Fine');
    expect((await officer.post(`${base}/approve`)).status).toBe(201);
    const after = await prisma.practitioner.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.status).toBe('registered');
    expect(after.dateRegistered).not.toBeNull();
    const roles = await prisma.userRole.findMany({ where: { userId: user.id }, include: { role: true } });
    expect(roles.map((r) => r.role.name)).toEqual(['Practitioner']);
    expect(outbox().some((m) => m.to === user.email && m.template === 'NotifyApproval')).toBe(true);
    const events = await prisma.auditLog.findMany({ where: { logName: 'practitioner-application', subjectId: p.id.toString() }, orderBy: { id: 'asc' } });
    expect(events.map((e) => e.event)).toEqual(expect.arrayContaining(['submitted', 'screening-started', 'returned', 'resubmitted', 'screening-completed', 'chairman-review', 'approved']));
  });

  it('fails clearly without a screening checklist', async () => {
    const { p } = await submitted();
    const { client: officer } = await loggedIn(['Regulator CPD Officer']);
    await prisma.checklist.updateMany({ data: { deletedAt: new Date() } });
    const r = await officer.post(`/regulator/applications/${p.id}/start`);
    expect(r.body.error.message).toBe('There is no screening checklist');
    await prisma.checklist.updateMany({ data: { deletedAt: null } });
  });

  it('only presubmission applications can be deleted', async () => {
    const { user, client } = await applicant();
    await client.post('/me/application/profile', profile({ email: user.email }));
    const p = await prisma.practitioner.findFirstOrThrow({ where: { userId: user.id } });
    const { client: officer } = await loggedIn(['Regulator CPD Officer']);
    expect((await officer.delete(`/regulator/applications/${p.id}`)).status).toBe(200);
    expect(outbox().some((m) => m.template === 'NotifyApplicationDelete' && m.to === user.email)).toBe(true);
  });
});
