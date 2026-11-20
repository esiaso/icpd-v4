import { Client, closeApp, getApp, loggedIn, prisma, PDF } from './helpers';

afterAll(closeApp);

describe('settings', () => {
  it('reference data is public', async () => {
    const c = new Client(await getApp());
    const r = await c.get('/reference');
    expect(r.status).toBe(200);
    expect(r.body.categories.map((x: any) => x.prefixLetter)).toEqual(expect.arrayContaining(['A', 'B', 'C', 'D', 'E', 'F', 'G']));
    expect(r.body.activityTypes.length).toBeGreaterThan(3);
  });

  it('needs Can Manage Settings', async () => {
    const { client } = await loggedIn(['Regulator CPD Officer']);
    expect((await client.post('/settings/specialities', { name: 'X-ray' })).status).toBe(403);
  });

  it('activity types CRUD + archive hides them from reference', async () => {
    const { client } = await loggedIn(['Admin']);
    const created = await client.post('/settings/activity-types', { name: 'Grand rounds', cpdPoints: 2, presenterPoints: 1, moderatorPoints: 1, maxYearlyPoints: 10 });
    expect(created.status).toBe(201);
    expect(created.body.cpdPoints).toBe('2');
    const id = created.body.id;
    expect((await client.put(`/settings/activity-types/${id}`, { name: 'Grand rounds', cpdPoints: 2.5 })).body.cpdPoints).toBe('2.5');
    await client.post(`/settings/activity-types/${id}/archive`, { archived: true });
    const ref = await client.get('/reference');
    expect(ref.body.activityTypes.some((t: any) => t.id === id)).toBe(false);
    const audit = await prisma.auditLog.count({ where: { logName: 'settings', subjectType: 'activity_type', subjectId: String(id) } });
    expect(audit).toBe(3);
  });

  it('user categories need a unique prefix letter', async () => {
    const { client } = await loggedIn(['Admin']);
    const r = await client.post('/settings/user-categories', { name: 'Dup', prefixLetter: 'a', minimumLength: 2 });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toContain('Prefix A is already used');
  });

  it('general settings validate values', async () => {
    const { client } = await loggedIn(['Admin']);
    expect((await client.put('/settings/general/compliance.multiSpecialityMode', { value: 'strictest' })).status).toBe(200);
    expect((await client.put('/settings/general/compliance.multiSpecialityMode', { value: 'nope' })).status).toBe(400);
    expect((await client.get('/settings/general')).body['compliance.multiSpecialityMode']).toBe('strictest');
    await client.put('/settings/general/compliance.multiSpecialityMode', { value: 'primary' });
  });
});

describe('cms', () => {
  it('pages: create, sanitise, read publicly by slug', async () => {
    const { client } = await loggedIn(['Admin']);
    const r = await client.post('/cms/pages', { title: 'FAQ', slug: 'faq', content: '<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:bad()">x</a>' });
    expect(r.status).toBe(201);
    expect(r.body.content).toBe('<p>Hi</p><a rel="noopener noreferrer">x</a>');
    const anon = new Client(await getApp());
    expect((await anon.get('/public/pages/faq')).body.title).toBe('FAQ');
    await client.put(`/cms/pages/${r.body.id}`, { title: 'FAQ', slug: 'faq', status: 'draft' });
    expect((await anon.get('/public/pages/faq')).status).toBe(404);
  });

  it('resources with a file upload and speciality tags', async () => {
    const { client } = await loggedIn(['Admin']);
    const r = await client.upload('/cms/resources', 'file', PDF, 'guide.pdf', { title: 'CPD guide', specialities: [1, 2] });
    expect(r.status).toBe(201);
    expect(r.body.filePath).toMatch(/^resources\/\d{4}\/.+\.pdf$/);
    const list = await new Client(await getApp()).get('/public/resources?speciality=2');
    expect(list.body.data.some((x: any) => x.title === 'CPD guide' && x.fileUrl)).toBe(true);
  });

  it('contact form rejects honeypot and stores messages', async () => {
    const c = new Client(await getApp());
    expect((await c.post('/public/contact', { name: 'Ann', email: 'ann@x.io', subject: 'Hi', message: 'Hello there', website: 'x' })).status).toBe(422);
    expect((await c.post('/public/contact', { name: 'Ann', email: 'ann@x.io', subject: 'Hi', message: 'Hello there' })).status).toBe(201);
    expect(await prisma.contact.count({ where: { email: 'ann@x.io' } })).toBe(1);
  });
});
