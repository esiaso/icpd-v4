import { createHash } from 'crypto';
import { LegacyMigration } from '../src/migration/legacy-migration';
import { Client, closeApp, getApp, prisma } from './helpers';

afterAll(closeApp);

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');
const S = 'legacy_fixture';

/** A small legacy schema shaped like pgloader's output of the Laravel/MySQL database. */
async function seedLegacy() {
  const sql = [
    `DROP SCHEMA IF EXISTS ${S} CASCADE`,
    `CREATE SCHEMA ${S}`,
    `CREATE TABLE ${S}.user_category (id int, category_name text, prefix_letter text, minimum_length int)`,
    `INSERT INTO ${S}.user_category VALUES (901, 'Legacy Medical', 'A', 2)`,
    `CREATE TABLE ${S}.cme_specialities (sp_id int, sp_name text, sp_description text)`,
    `INSERT INTO ${S}.cme_specialities VALUES (9001, 'Legacy Urology', NULL), (9002, 'Legacy Surgery', NULL)`,
    `CREATE TABLE ${S}.cme_activity_type (type_id int, type_name text, type_level text, cpd_points text, presenter_points text, facilitator_points text, max_session_points text, archived text, delivery_mode int, initiator int, type_code text)`,
    `INSERT INTO ${S}.cme_activity_type VALUES (801, 'Legacy CME', 'Event', '2', '3', '1', NULL, '0', 1, 1, NULL), (802, 'Legacy Internship', 'Self', '10', '0', '0', '10', '0', 1, 0, 'once')`,
    `CREATE TABLE ${S}.users (id int, name text, email text, password text, email_verified_at timestamp, created_at timestamp)`,
    `INSERT INTO ${S}.users VALUES (701, 'Legacy Coord', 'coord@legacy.test', '$2y$10$abcdefghijklmnopqrstuuJ8d0Yy0Rj8Sx1JbYbVv6cQxQkxkG0r2', now(), now())`,
    `CREATE TABLE ${S}.roles (id int, name text)`,
    `INSERT INTO ${S}.roles VALUES (1, 'Provider Coordinator'), (2, 'IREC Reviewer')`,
    `CREATE TABLE ${S}.model_has_roles (role_id int, model_type text, model_id int)`,
    `INSERT INTO ${S}.model_has_roles VALUES (1, 'App\\Models\\User', 701), (2, 'App\\Models\\User', 701)`,
    `CREATE TABLE ${S}.cme_users (user_id int, uuid int, reg_no text, first_name text, last_name text, other_names text, natid text, user_mail text, mobile1 text, specialization_id int, category_id int, status text, user_password text, dateadded date)`,
    `INSERT INTO ${S}.cme_users VALUES
       (601, NULL, ' a 7001 ', 'Old', 'Doctor', NULL, '111', 'old.doctor@legacy.test', '0711', 9001, 901, 'registered', '${sha1('legacy-pass')}', '2019-03-01'),
       (602, NULL, 'A7002', 'Default', 'Password', NULL, '222', 'default@legacy.test', '0712', 9002, 901, 'registered', '${sha1('1234567890')}', '2020-01-01'),
       (603, NULL, 'A7002', 'Dup', 'Record', NULL, '333', 'dup@legacy.test', '0713', NULL, 901, NULL, NULL, '2020-01-01')`,
    `CREATE TABLE ${S}.cme_user_role (user_id int, roleid int)`,
    `INSERT INTO ${S}.cme_user_role VALUES (601, 3)`,
    `CREATE TABLE ${S}.cme_providers (pr_id int, reg_no text, pr_name text, specialities text, email text, active text, town text)`,
    `INSERT INTO ${S}.cme_providers VALUES (501, 'P-1', 'Legacy Hospital', '["9001"]', 'info@legacy.test', 'Yes', 'Kisumu')`,
    `CREATE TABLE ${S}.cme_provider_users (provider_id int, user_id int, status text)`,
    `INSERT INTO ${S}.cme_provider_users VALUES (501, 701, 'Active')`,
    `CREATE TABLE ${S}.cme_activities (id int, provider_id int, activity_type int, activity_name text, release_date date, expiry_date date, numsession text, published text, archive_status text, cpd_points text, max_points text, specialization_areas text)`,
    `INSERT INTO ${S}.cme_activities VALUES (401, 501, 801, 'Legacy CME Day', '2024-05-01', '2024-05-02', '2', '1', '0', '2', '4', '["9001"]')`,
    `CREATE TABLE ${S}.cme_activity_presenters (pr_id int, activity_id int, regno text, pr_firstname text, pr_lastname text, pointsstatus text)`,
    `INSERT INTO ${S}.cme_activity_presenters VALUES (301, 401, 'A7001', 'Old', 'Doctor', '1')`,
    `CREATE TABLE ${S}.cme_activity_token (tokenid int, token text, activity_id int, sessionnum int, tokenbatch text, validfrom date, expirydate date, status text, claimedby text, claimeddate timestamp)`,
    `INSERT INTO ${S}.cme_activity_token VALUES (201, '401123456', 401, 1, '401000001', '2024-05-01', '2024-05-10', '1', '601', '2024-05-01 10:00'), (202, '401654321', 401, 2, '401000001', '2024-05-01', '2024-05-10', '2', NULL, NULL)`,
    `CREATE TABLE ${S}.cme_activity_token_claims (claimid int, claimmethod text, token text, method_source text, activity_id text, ui_activity_id text, claimeddate timestamp, calyear text, user_id int, cpd_points text, api_claimid text, api_activity_name text)`,
    `INSERT INTO ${S}.cme_activity_token_claims VALUES
       (101, 'token', '401123456 presenter', NULL, '401', NULL, '2024-05-01 10:00', '2024', 601, '5', NULL, NULL),
       (102, NULL, 'garbled', NULL, NULL, '51', '2023-07-01 09:00', '2023', 601, '10', NULL, NULL),
       (103, 'API', 'API', 'api', '401', NULL, '2024-06-01 09:00', '2024', 602, '2', 'X1', 'Legacy CME Day')`,
    `CREATE TABLE ${S}.cme_non_token_based_claims (claimid int, user_id int, activitytype text, activityname text, claimdate timestamp, begindate date, enddate date, description text, activityplace text, uploadedfile text, approvedstatus text, approveddate timestamp)`,
    `INSERT INTO ${S}.cme_non_token_based_claims VALUES (51, 601, '802', 'Intern supervision', '2023-06-01', '2023-01-01', '2023-06-30', 'Supervised interns', 'KNH', 'evidence/x.pdf', 'Yes', '2023-07-01')`,
    `CREATE TABLE ${S}.cme_requirement_exemption (id int, user_id int, user_reg text, cpd_year int, exemption_reason text, points_attained text, post_type text)`,
    `INSERT INTO ${S}.cme_requirement_exemption VALUES (11, 602, 'A7002', 2023, 'Study leave', '0', 'FORM')`,
    `CREATE TABLE ${S}.api_consumer_apps (id int, name text, provider_id int, type text, status text, key text, secret text)`,
    `INSERT INTO ${S}.api_consumer_apps VALUES (21, 'Legacy LMS', 501, 'web', 'ACTIVE', 'plainkey', 'plainsecret')`,
  ];
  for (const s of sql) await prisma.$executeRawUnsafe(s);
}

describe('legacy migration', () => {
  beforeAll(seedLegacy);
  afterAll(() => prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${S} CASCADE`));

  it('migrates in dependency order, reconciles points exactly and is idempotent', async () => {
    const first = await new LegacyMigration(prisma, () => undefined, S).run();
    expect(first.reconciliation.mismatches).toEqual([]);
    expect(first.reconciliation.checked).toBe(3);
    expect(first.duplicates).toContainEqual({ regNo: 'A7002', count: 2 });
    expect(await prisma.userCategory.count({ where: { prefixLetter: 'A', deletedAt: null } })).toBe(1);

    const second = await new LegacyMigration(prisma, () => undefined, S).run();
    expect(second.reconciliation.mismatches).toEqual([]);
    expect(await prisma.practitioner.count({ where: { legacyId: { in: [601n, 602n, 603n] } } })).toBe(3);
    expect(await prisma.cpdClaim.count({ where: { legacyId: { in: [101n, 102n, 103n] } } })).toBe(3);

    const p = await prisma.practitioner.findFirstOrThrow({ where: { legacyId: 601n }, include: { specialities: true } });
    expect(p.regNo).toBe('A7001');
    expect(p.specialities[0].isPrimary).toBe(true);

    // trail split into base + presenter entries with the token and activity classification
    const c101 = await prisma.cpdClaim.findFirstOrThrow({ where: { legacyId: 101n }, include: { entries: { orderBy: { id: 'asc' } }, activity: true } });
    expect(c101.entries.map((e) => [e.kind, Number(e.points), e.token])).toEqual([['base', 2, '401123456'], ['presenter', 3, null]]);
    expect(c101.entries[0].specialityIds).toEqual(c101.activity!.specializationAreas);

    // unparseable trail → one legacy entry; linked to its non-token claim and type
    const c102 = await prisma.cpdClaim.findFirstOrThrow({ where: { legacyId: 102n }, include: { entries: true, nonTokenClaim: true } });
    expect(c102.method).toBe('nontoken');
    expect(c102.nonTokenClaim?.activityName).toBe('Intern supervision');
    expect(c102.entries).toHaveLength(1);
    expect(Number(c102.entries[0].points)).toBe(10);

    // the 'once' claim condition came across
    expect((await prisma.activityType.findFirstOrThrow({ where: { legacyId: 802 } })).claimCondition).toBe('once');

    // tokens: legacy status 1 → claimed, 2 → unclaimed
    const tokens = await prisma.activityToken.findMany({ where: { legacyId: { in: [201n, 202n] } }, orderBy: { legacyId: 'asc' } });
    expect(tokens.map((t) => t.status)).toEqual(['claimed', 'unclaimed']);
    expect(tokens[0].claimedBy).toBe(p.id);

    // roles: only spec roles mapped; Laravel bcrypt prefix normalised
    const coord = await prisma.user.findFirstOrThrow({ where: { legacyId: 701n }, include: { roles: { include: { role: true } } } });
    expect(coord.roles.map((r) => r.role.name)).toEqual(['Provider Coordinator']);
    expect(coord.passwordHash?.startsWith('$2b$')).toBe(true);
    expect(await prisma.providerUser.count({ where: { userId: coord.id } })).toBe(1);

    // API apps never keep plain secrets; must rotate
    const app = await prisma.apiConsumerApp.findFirstOrThrow({ where: { legacyId: 21 } });
    expect(app).toMatchObject({ status: 'INACTIVE', key: null, secretHash: null });

    // the hard-coded default password is never migrated (defect #3)
    const dflt = await prisma.practitioner.findFirstOrThrow({ where: { legacyId: 602n } });
    expect(await prisma.legacyCredential.findUnique({ where: { practitionerId: dflt.id } })).toBeNull();
    expect(await prisma.exemption.count({ where: { practitionerId: dflt.id, cpdYear: 2023 } })).toBe(1);
  });

  it('migrated practitioners can activate with their old password', async () => {
    const c = new Client(await getApp());
    const r = await c.post('/auth/migrate', { identifier: 'A7001', password: 'legacy-pass' });
    expect(r.status).toBe(200);
    expect(r.body.roles).toEqual(['Practitioner']);
    const pf = await c.get('/me/portfolio?year=2024');
    expect(pf.body.points).toBe(5);
  });
});
