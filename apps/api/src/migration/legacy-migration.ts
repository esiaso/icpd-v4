/**
 * Legacy MySQL → ICPD v4 PostgreSQL migration (spec 11).
 *
 * Step 1 (outside this script): load the MySQL dump into a `legacy` schema of the target database
 * with pgloader (infra/legacy/pgloader.load). pgloader lower-cases identifiers, so legacy columns
 * such as `natID` arrive as `natid`.
 * Step 2 (this script): transform in dependency order into the v4 tables. Every migrated row keeps
 * its `legacyId`, inserts are `ON CONFLICT ("legacyId") DO UPDATE`, so the script is idempotent and
 * can be re-run against a staging copy. Step 3: reconcile points per practitioner per year.
 *
 * Column names below come from the legacy Eloquent models (app/Models/**). Columns that a given
 * dump does not have are tolerated through `col()`, which falls back to NULL.
 */
import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';

type Log = (msg: string) => void;

export interface MigrationReport {
  steps: { step: string; rows: number }[];
  duplicates: { regNo: string; count: number }[];
  reconciliation: { checked: number; mismatches: { legacyUserId: string; year: number; legacy: number; v4: number }[] };
  warnings: string[];
}

const SHA1_DEFAULT = createHash('sha1').update('1234567890').digest('hex');

export class LegacyMigration {
  private columns = new Map<string, Set<string>>();
  private report: MigrationReport = { steps: [], duplicates: [], reconciliation: { checked: 0, mismatches: [] }, warnings: [] };

  constructor(private readonly db: PrismaClient, private readonly log: Log = console.log, private readonly schema = 'legacy') {}

  private async loadColumns() {
    const rows = await this.db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(
      `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = $1`,
      this.schema,
    );
    for (const r of rows) {
      if (!this.columns.has(r.table_name)) this.columns.set(r.table_name, new Set());
      this.columns.get(r.table_name)!.add(r.column_name);
    }
  }

  has(table: string, column?: string) {
    const t = this.columns.get(table);
    return !!t && (!column || t.has(column));
  }

  /** `alias.column` if the legacy column exists, otherwise the fallback SQL. */
  col(table: string, alias: string, name: string, fallback = 'NULL') {
    return this.has(table, name.toLowerCase()) ? `${alias}."${name.toLowerCase()}"` : fallback;
  }

  t(table: string) {
    return `"${this.schema}"."${table}"`;
  }

  private async exec(step: string, sql: string) {
    const n = await this.db.$executeRawUnsafe(sql);
    this.report.steps.push({ step, rows: n });
    this.log(`  ${step}: ${n}`);
    return n;
  }

  private skip(table: string) {
    if (!this.has(table)) {
      this.report.warnings.push(`legacy table ${table} not found; skipped`);
      this.log(`  (skip: ${table} not in legacy schema)`);
      return true;
    }
    return false;
  }

  /** Normalise reg. no.: strip spaces, upper-case; blank → NULL. */
  private regNo(expr: string) {
    return `NULLIF(UPPER(REGEXP_REPLACE(COALESCE(${expr}::text, ''), '\\s+', '', 'g')), '')`;
  }

  private ts(expr: string) {
    // legacy datetimes are Africa/Nairobi wall-clock times
    return `(CASE WHEN ${expr} IS NULL THEN NULL ELSE (${expr})::timestamp AT TIME ZONE 'Africa/Nairobi' END)`;
  }

  private date(expr: string) {
    return `(CASE WHEN ${expr} IS NULL OR ${expr}::text IN ('', '0000-00-00', '0000-00-00 00:00:00') THEN NULL ELSE (${expr})::date END)`;
  }

  async run(): Promise<MigrationReport> {
    await this.loadColumns();
    if (!this.columns.size) throw new Error(`Schema "${this.schema}" is empty. Load the MySQL dump with pgloader first.`);
    this.log('Reference data');
    await this.referenceData();
    this.log('Users, roles and permissions');
    await this.users();
    this.log('Practitioners');
    await this.practitioners();
    this.log('Providers');
    await this.providers();
    this.log('Activities');
    await this.activities();
    this.log('Tokens and claims');
    await this.tokensAndClaims();
    this.log('Non-token claims, comments, exemptions, imports');
    await this.nonToken();
    this.log('Screening, CMS, API apps, logs');
    await this.rest();
    this.log('Reconciliation');
    await this.reconcile();
    await this.duplicates();
    return this.report;
  }

  // ───────────────────────── reference data ─────────────────────────
  private async referenceData() {
    const L = (t: string) => this.t(t);
    if (!this.skip('user_category')) {
      // Adopt the seeded category with the same prefix instead of creating a second one.
      await this.exec('user_categories.adopt-seeded', `
        UPDATE user_categories uc SET "legacyId" = c.id, name = c.category_name
        FROM ${L('user_category')} c
        WHERE uc."legacyId" IS NULL AND uc."deletedAt" IS NULL AND uc."prefixLetter" = UPPER(LEFT(c.prefix_letter, 1))
          AND NOT EXISTS (SELECT 1 FROM user_categories x WHERE x."legacyId" = c.id)`);
      await this.exec('user_categories', `
        INSERT INTO user_categories ("legacyId", name, "prefixLetter", "minimumLength", archived, "createdAt", "updatedAt")
        SELECT c.id, c.category_name, UPPER(LEFT(c.prefix_letter, 1)), COALESCE(${this.col('user_category', 'c', 'minimum_length')}::int, 2),
               COALESCE(${this.col('user_category', 'c', 'archived', 'false')}::text IN ('1','true'), false), now(), now()
        FROM ${L('user_category')} c
        ON CONFLICT ("legacyId") DO UPDATE SET name = EXCLUDED.name, "prefixLetter" = EXCLUDED."prefixLetter", "minimumLength" = EXCLUDED."minimumLength"`);
    }
    if (!this.skip('cme_specialities')) {
      await this.exec('specialities', `
        INSERT INTO specialities ("legacyId", name, description, "createdAt", "updatedAt")
        SELECT s.sp_id, s.sp_name, ${this.col('cme_specialities', 's', 'sp_description')}, now(), now() FROM ${L('cme_specialities')} s
        ON CONFLICT ("legacyId") DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`);
    }
    if (!this.skip('cme_user_title')) {
      await this.exec('titles', `INSERT INTO titles ("legacyId", name) SELECT t.ttid, ${this.col('cme_user_title', 't', 'title', this.col('cme_user_title', 't', 'tt_name', "'Dr'"))} FROM ${L('cme_user_title')} t ON CONFLICT ("legacyId") DO NOTHING`);
    }
    if (!this.skip('cme_countries')) {
      await this.exec('countries', `INSERT INTO countries ("legacyId", name, code) SELECT c.cid, ${this.col('cme_countries', 'c', 'country_name', this.col('cme_countries', 'c', 'name', "''"))}, ${this.col('cme_countries', 'c', 'country_code')} FROM ${L('cme_countries')} c ON CONFLICT ("legacyId") DO NOTHING`);
    }
    if (!this.skip('cme_degree_qualification')) {
      await this.exec('academic_qualifications', `INSERT INTO academic_qualifications ("legacyId", name) SELECT d.did, ${this.col('cme_degree_qualification', 'd', 'degree_name', this.col('cme_degree_qualification', 'd', 'name', "''"))} FROM ${L('cme_degree_qualification')} d ON CONFLICT ("legacyId") DO NOTHING`);
    }
    if (!this.skip('med_schools')) {
      await this.exec('medical_schools', `INSERT INTO medical_schools ("legacyId", name) SELECT m.id, ${this.col('med_schools', 'm', 'school_name', this.col('med_schools', 'm', 'name', "''"))} FROM ${L('med_schools')} m ON CONFLICT ("legacyId") DO NOTHING`);
    }
    if (!this.skip('med_facilities')) {
      await this.exec('facilities', `INSERT INTO facilities ("legacyId", name) SELECT f.id, ${this.col('med_facilities', 'f', 'facility_name', this.col('med_facilities', 'f', 'name', "''"))} FROM ${L('med_facilities')} f ON CONFLICT ("legacyId") DO NOTHING`);
    }
    if (!this.skip('cme_activity_type')) {
      const c = (n: string, f = 'NULL') => this.col('cme_activity_type', 't', n, f);
      await this.exec('activity_types', `
        INSERT INTO activity_types ("legacyId", name, category, description, "evidenceRequired", "cpdPoints", "presenterPoints", "moderatorPoints",
          "maxSessionPoints", "maxActivityPoints", "maxYearlyPoints", "claimCondition", "deliveryMode", initiator, archived, "createdAt", "updatedAt", "deletedAt")
        SELECT t.type_id, t.type_name, ${c('type_level')}::text, ${c('type_description')}, ${c('evidence')},
          COALESCE(${c('cpd_points')}::numeric, 0), COALESCE(${c('presenter_points')}::numeric, 0), COALESCE(${c('facilitator_points')}::numeric, 0),
          ${c('max_session_points')}::numeric, ${c('max_activity_points')}::numeric, ${c('max_yearly_points')}::numeric,
          NULLIF(${c('claim_condition', c('type_code'))}::text, ''), ${c('delivery_mode')}::int, ${c('initiator')}::int,
          COALESCE(${c('archived', "'0'")}::text IN ('1','true'), false), now(), now(),
          ${this.has('cme_activity_type', 'deleted_at') ? this.ts('t.deleted_at') : 'NULL'}
        FROM ${this.t('cme_activity_type')} t
        ON CONFLICT ("legacyId") DO UPDATE SET name = EXCLUDED.name, "cpdPoints" = EXCLUDED."cpdPoints", "presenterPoints" = EXCLUDED."presenterPoints",
          "moderatorPoints" = EXCLUDED."moderatorPoints", "maxSessionPoints" = EXCLUDED."maxSessionPoints", archived = EXCLUDED.archived`);
      // 'once' claim condition: legacy used the type code for internship-type claims
      await this.exec('activity_types.claimCondition', `UPDATE activity_types SET "claimCondition" = 'once' WHERE "legacyId" IS NOT NULL AND LOWER(COALESCE("claimCondition", '')) LIKE '%once%'`);
      await this.exec('activity_types.claimCondition.clear', `UPDATE activity_types SET "claimCondition" = NULL WHERE "legacyId" IS NOT NULL AND "claimCondition" IS NOT NULL AND "claimCondition" <> 'once'`);
    }
  }

  // ───────────────────────── users, roles ─────────────────────────
  private async users() {
    if (this.skip('users')) return;
    const c = (n: string, f = 'NULL') => this.col('users', 'u', n, f);
    // Laravel bcrypt ($2y$) is the same algorithm as $2b$.
    await this.exec('users', `
      INSERT INTO users ("legacyId", name, email, "passwordHash", "emailVerifiedAt", "avatarUrl", "categoryId", "createdAt", "updatedAt", "deletedAt")
      SELECT u.id, COALESCE(NULLIF(u.name, ''), u.email), LOWER(TRIM(u.email)),
        CASE WHEN ${c('password')} LIKE '$2y$%' THEN '$2b$' || SUBSTRING(${c('password')} FROM 5) ELSE ${c('password')} END,
        ${this.ts(c('email_verified_at'))}, ${c('avatar')},
        (SELECT id FROM user_categories uc WHERE uc."legacyId" = ${c('category_id')}::int),
        COALESCE(${this.ts(c('created_at'))}, now()), now(), ${this.ts(c('deleted_at'))}
      FROM ${this.t('users')} u
      WHERE u.email IS NOT NULL AND TRIM(u.email) <> ''
        AND u.id = (SELECT MIN(u2.id) FROM ${this.t('users')} u2 WHERE LOWER(TRIM(u2.email)) = LOWER(TRIM(u.email)))
      ON CONFLICT ("legacyId") DO UPDATE SET name = EXCLUDED.name, "emailVerifiedAt" = EXCLUDED."emailVerifiedAt"`);
    if (this.has('roles') && this.has('model_has_roles')) {
      await this.exec('user_roles', `
        INSERT INTO user_roles ("userId", "roleId")
        SELECT nu.id, r.id FROM ${this.t('model_has_roles')} m
        JOIN ${this.t('roles')} lr ON lr.id = m.role_id
        JOIN roles r ON r.name = lr.name
        JOIN users nu ON nu."legacyId" = m.model_id
        WHERE m.model_type LIKE '%User'
        ON CONFLICT DO NOTHING`);
    }
    if (this.has('permissions') && this.has('model_has_permissions')) {
      await this.exec('user_permissions', `
        INSERT INTO user_permissions ("userId", "permissionId")
        SELECT nu.id, p.id FROM ${this.t('model_has_permissions')} m
        JOIN ${this.t('permissions')} lp ON lp.id = m.permission_id
        JOIN permissions p ON p.name = lp.name
        JOIN users nu ON nu."legacyId" = m.model_id
        WHERE m.model_type LIKE '%User'
        ON CONFLICT DO NOTHING`);
    }
    await this.exec('users.public-user-default', `
      INSERT INTO user_roles ("userId", "roleId")
      SELECT u.id, (SELECT id FROM roles WHERE name = 'Public User') FROM users u
      WHERE u."legacyId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur."userId" = u.id)
      ON CONFLICT DO NOTHING`);
  }

  // ───────────────────────── practitioners ─────────────────────────
  private async practitioners() {
    if (this.skip('cme_users')) return;
    const c = (n: string, f = 'NULL') => this.col('cme_users', 'p', n, f);
    const status = `CASE WHEN ${c('status')}::text IN ('presubmission','submitted','screening','returned','approved','registered','incomplete') THEN ${c('status')}::text ELSE 'registered' END`;
    await this.exec('practitioners', `
      INSERT INTO practitioners ("legacyId", "userId", "regNo", "applicationNo", "titleId", "firstName", "otherNames", "lastName", dob, "nationalId", email,
        mobile1, mobile2, nationality, "countryOfResidenceId", "physicalAddress", "postalAddress", "postalCode", city, "categoryId", "specializationId",
        qualifications, "workplaceInstitution", "workplaceCountryId", "photoUrl", status, "applicationStep", "dateOfApplication", "dateRegistered",
        "createdAt", "updatedAt", "deletedAt")
      SELECT p.user_id,
        (SELECT id FROM users nu WHERE nu."legacyId" = ${c('uuid')}::bigint),
        ${this.regNo(c('reg_no'))},
        NULLIF(${c('application_no')}::text, ''),
        (SELECT id FROM titles t WHERE t."legacyId" = ${c('title')}::int),
        COALESCE(NULLIF(TRIM(${c('first_name')}), ''), '-'), NULLIF(TRIM(${c('other_names')}), ''), COALESCE(NULLIF(TRIM(${c('last_name')}), ''), '-'),
        ${this.date(c('dob'))}, NULLIF(TRIM(${c('natid')}::text), ''), NULLIF(LOWER(TRIM(${c('user_mail')})), ''),
        ${c('mobile1')}::text, ${c('mobile2')}::text, ${c('nationality')}::text,
        (SELECT id FROM countries cc WHERE cc."legacyId" = ${c('country_residence')}::int),
        ${c('place')}::text, ${c('postal_address')}::text, ${c('postal_code')}::text, ${c('city')}::text,
        (SELECT id FROM user_categories uc WHERE uc."legacyId" = ${c('category_id')}::int),
        (SELECT id FROM specialities s WHERE s."legacyId" = ${c('specialization_id')}::int),
        ${c('qualifications')}::text, ${c('work_place', c('workplace'))}::text,
        (SELECT id FROM countries cc WHERE cc."legacyId" = ${c('workplace_country_id')}::int),
        NULLIF(${c('portrait')}::text, ''), (${status})::"PractitionerStatus", 'preview',
        ${this.ts(c('date_of_application'))}, ${this.date(c('dateadded'))},
        COALESCE(${this.ts(c('created_at'))}, now()), now(), ${this.ts(c('deleted_at'))}
      FROM ${this.t('cme_users')} p
      ON CONFLICT ("legacyId") DO UPDATE SET "regNo" = EXCLUDED."regNo", "userId" = COALESCE(practitioners."userId", EXCLUDED."userId"),
        email = EXCLUDED.email, status = EXCLUDED.status, "specializationId" = EXCLUDED."specializationId", "categoryId" = EXCLUDED."categoryId"`);
    // A user may own only one practitioner (unique userId); keep the first, detach the rest.
    await this.exec('practitioners.dedupe-user-links', `
      UPDATE practitioners p SET "userId" = NULL WHERE p."userId" IS NOT NULL AND p.id <> (SELECT MIN(id) FROM practitioners q WHERE q."userId" = p."userId")`);
    // Legacy sha1 passwords → legacy_credentials (never the hard-coded default; defect #3).
    if (this.has('cme_users', 'user_password')) {
      const role = this.has('cme_user_role') ? `(SELECT MAX(r.roleid) FROM ${this.t('cme_user_role')} r WHERE r.user_id = p.user_id)` : '3';
      await this.exec('legacy_credentials', `
        INSERT INTO legacy_credentials ("practitionerId", "sha1Hash", "legacyRoleId")
        SELECT np.id, LOWER(TRIM(p.user_password)), ${role}::int
        FROM ${this.t('cme_users')} p JOIN practitioners np ON np."legacyId" = p.user_id
        WHERE np."userId" IS NULL AND p.user_password IS NOT NULL AND LENGTH(TRIM(p.user_password)) = 40 AND LOWER(TRIM(p.user_password)) <> '${SHA1_DEFAULT}'
        ON CONFLICT ("practitionerId") DO UPDATE SET "sha1Hash" = EXCLUDED."sha1Hash", "legacyRoleId" = EXCLUDED."legacyRoleId" WHERE legacy_credentials."usedAt" IS NULL`);
    }
    if (this.has('cme_user_specialities')) {
      await this.exec('practitioner_specialities', `
        INSERT INTO practitioner_specialities ("practitionerId", "specialityId", "isPrimary")
        SELECT DISTINCT ON (np.id, s.id) np.id, s.id, COALESCE(${this.col('cme_user_specialities', 'us', 'speciality_default', "'0'")}::text IN ('1','true','Yes'), false)
        FROM ${this.t('cme_user_specialities')} us
        JOIN practitioners np ON np."legacyId" = us.usrid
        JOIN specialities s ON s."legacyId" = us.spid
        ON CONFLICT ("practitionerId", "specialityId") DO NOTHING`);
    }
    await this.exec('practitioner_specialities.primary', `
      INSERT INTO practitioner_specialities ("practitionerId", "specialityId", "isPrimary")
      SELECT p.id, p."specializationId", true FROM practitioners p WHERE p."legacyId" IS NOT NULL AND p."specializationId" IS NOT NULL
      ON CONFLICT ("practitionerId", "specialityId") DO UPDATE SET "isPrimary" = true`);
    await this.exec('practitioner_facilities', `
      INSERT INTO practitioner_facilities ("practitionerId", institution, "countryId", current)
      SELECT p.id, p."workplaceInstitution", p."workplaceCountryId", true FROM practitioners p
      WHERE p."legacyId" IS NOT NULL AND COALESCE(p."workplaceInstitution", '') <> ''
        AND NOT EXISTS (SELECT 1 FROM practitioner_facilities f WHERE f."practitionerId" = p.id)`);
  }

  // ───────────────────────── providers ─────────────────────────
  private async providers() {
    if (this.skip('cme_providers')) return;
    const c = (n: string, f = 'NULL') => this.col('cme_providers', 'p', n, f);
    const status = `CASE WHEN LOWER(COALESCE(${c('provider_status', c('status'))}::text, '')) IN ('active','inactive','suspended') THEN LOWER(${c('provider_status', c('status'))}::text)
                         WHEN ${c('active')}::text = 'Yes' THEN 'active' WHEN ${c('active')}::text = 'No' THEN 'inactive' ELSE 'active' END`;
    const specs = this.has('cme_providers', 'specialities')
      ? `(CASE WHEN p.specialities IS NULL OR p.specialities::text = '' THEN '[]'::jsonb ELSE
           COALESCE((SELECT jsonb_agg(s.id) FROM specialities s WHERE s."legacyId"::text IN (SELECT jsonb_array_elements_text(p.specialities::jsonb))), '[]'::jsonb) END)`
      : `'[]'::jsonb`;
    await this.exec('providers', `
      INSERT INTO providers ("legacyId", "regNo", name, specialities, "contactName", "physicalAddress", street, building, "postalAddress", "postalCode", town,
        phone, "fixedLine", email, twitter, facebook, "logoUrl", location, status, "dateAdded", "createdAt", "updatedAt", "deletedAt")
      SELECT p.pr_id, ${c('reg_no')}::text, p.pr_name, ${specs}, ${c('contact_name')}::text, ${c('place')}::text, ${c('street')}::text, ${c('building')}::text,
        ${c('postaladdress')}::text, ${c('postalcode')}::text, ${c('town')}::text, ${c('phone')}::text, ${c('fixed_line')}::text,
        NULLIF(LOWER(TRIM(${c('email')}::text)), ''), ${c('twitter')}::text, ${c('facebook')}::text, NULLIF(${c('logo')}::text, ''), ${c('location')}::text,
        ${status}, COALESCE(${this.ts(c('dateadded'))}, now()), COALESCE(${this.ts(c('created_at'))}, now()), now(),
        CASE WHEN ${c('remove', "'0'")}::text IN ('1','Yes') THEN now() ELSE NULL END
      FROM ${this.t('cme_providers')} p
      ON CONFLICT ("legacyId") DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, specialities = EXCLUDED.specialities`);
    if (this.has('cme_provider_users')) {
      await this.exec('provider_users', `
        INSERT INTO provider_users ("providerId", "userId", status, "createdAt", "updatedAt", "deletedAt")
        SELECT np.id, nu.id, CASE WHEN LOWER(COALESCE(${this.col('cme_provider_users', 'pu', 'status')}::text, 'active')) IN ('active','1','yes') THEN 'Active' ELSE 'Inactive' END,
          now(), now(), ${this.ts(this.col('cme_provider_users', 'pu', 'deleted_at'))}
        FROM ${this.t('cme_provider_users')} pu
        JOIN providers np ON np."legacyId" = pu.provider_id
        JOIN users nu ON nu."legacyId" = pu.user_id
        WHERE NOT EXISTS (SELECT 1 FROM provider_users x WHERE x."providerId" = np.id AND x."userId" = nu.id)`);
    }
    if (this.has('cme_provider_status')) {
      await this.exec('provider_status_history', `
        INSERT INTO provider_status_history ("providerId", status, notes, "effectiveDate", "createdAt")
        SELECT np.id, LOWER(ps.status::text), ps.notes, COALESCE(${this.date('ps.effective_date')}, CURRENT_DATE), COALESCE(${this.ts(this.col('cme_provider_status', 'ps', 'created_at'))}, now())
        FROM ${this.t('cme_provider_status')} ps JOIN providers np ON np."legacyId" = ps.provider_id
        WHERE NOT EXISTS (SELECT 1 FROM provider_status_history h WHERE h."providerId" = np.id AND h.status = LOWER(ps.status::text) AND h."effectiveDate" = COALESCE(${this.date('ps.effective_date')}, CURRENT_DATE))`);
    }
  }

  // ───────────────────────── activities ─────────────────────────
  private async activities() {
    if (this.skip('cme_activities')) return;
    const c = (n: string, f = 'NULL') => this.col('cme_activities', 'a', n, f);
    const mode = `CASE WHEN ${c('delivery_mode')}::text IN ('2','online','Online') THEN 'online' WHEN ${c('delivery_mode')}::text IN ('3','hybrid','Hybrid') THEN 'hybrid' ELSE 'physical' END`;
    const specs = this.has('cme_activities', 'specialization_areas')
      ? `(CASE WHEN a.specialization_areas IS NULL OR a.specialization_areas::text IN ('', 'null') THEN '[]'::jsonb ELSE
           COALESCE((SELECT jsonb_agg(s.id) FROM specialities s WHERE s."legacyId"::text IN (SELECT jsonb_array_elements_text(a.specialization_areas::jsonb))), '[]'::jsonb) END)`
      : `'[]'::jsonb`;
    await this.exec('activities', `
      INSERT INTO activities ("legacyId", "activityNo", "providerId", "activityTypeId", name, "shortTitle", topic, objectives, description, coordinator,
        "deliveryMode", venue, city, "gpsLat", "gpsLng", "primaryAudience", "specializationAreas", "releaseDate", "expiryDate", "endTime",
        "numSessions", "multiSessions", "cpdPoints", "maxPoints", published, featured, visibility, "onlineRegistration", archived, "dateArchived",
        "posterUrl", "qrCodeUrl", "shortenedUrl", hashtag, "activityCost", "subProviderUnit", "createdAt", "updatedAt", "deletedAt", "datePublished")
      SELECT a.id, NULLIF(${c('activity_no')}::text, ''), np.id, nt.id, COALESCE(NULLIF(a.activity_name, ''), 'Untitled activity'), ${c('activity_short_title')}::text,
        ${c('activity_topic')}::text, ${c('objectives')}::text, ${c('activity_description')}::text, ${c('activity_coordinator')}::text,
        ${mode}, ${c('venue')}::text, ${c('city')}::text, NULLIF(${c('gps_lat')}::text, '')::numeric, NULLIF(${c('gps_lng')}::text, '')::numeric,
        ${c('primary_audience')}::text, ${specs},
        COALESCE(${this.date(c('release_date'))}, CURRENT_DATE), COALESCE(${this.date(c('expiry_date'))}, ${this.date(c('release_date'))}, CURRENT_DATE), ${c('end_time')}::text,
        GREATEST(COALESCE(NULLIF(${c('numsession')}::text, '')::int, 1), 1),
        COALESCE(NULLIF(${c('numsession')}::text, '')::int, 1) > 1,
        COALESCE(NULLIF(${c('cpd_points')}::text, '')::numeric, nt."cpdPoints"),
        COALESCE(NULLIF(${c('max_points')}::text, '')::numeric, nt."cpdPoints" * GREATEST(COALESCE(NULLIF(${c('numsession')}::text, '')::int, 1), 1)),
        COALESCE(${c('published', "'0'")}::text IN ('1','true','Yes'), false), COALESCE(${c('featured', "'0'")}::text IN ('1','true','Yes'), false),
        ${c('visibility')}::text, COALESCE(${c('online_registration', "'0'")}::text IN ('1','true','Yes'), false),
        COALESCE(${c('archive_status', "'0'")}::text = '1', false), ${this.ts(c('date_archived'))},
        NULLIF(${c('poster')}::text, ''), NULLIF(${c('qrcodelnk')}::text, ''), NULLIF(${c('shortenedurl')}::text, ''), ${c('hashtag')}::text,
        ${c('activity_cost')}::text, ${c('sub_provider_unit')}::text,
        COALESCE(${this.ts(c('creationdate', c('created_at')))}, now()), now(),
        COALESCE(${this.ts(c('deleted_at'))}, CASE WHEN ${c('remove', "'0'")}::text IN ('1','Yes') THEN now() END),
        CASE WHEN ${c('published', "'0'")}::text IN ('1','true','Yes') THEN COALESCE(${this.ts(c('lastmodifieddate'))}, now()) END
      FROM ${this.t('cme_activities')} a
      JOIN providers np ON np."legacyId" = a.provider_id
      JOIN activity_types nt ON nt."legacyId" = a.activity_type
      ON CONFLICT ("legacyId") DO UPDATE SET name = EXCLUDED.name, published = EXCLUDED.published, archived = EXCLUDED.archived,
        "numSessions" = EXCLUDED."numSessions", "cpdPoints" = EXCLUDED."cpdPoints", "maxPoints" = EXCLUDED."maxPoints", "deletedAt" = EXCLUDED."deletedAt"`);
    const orphans = await this.db.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT COUNT(*) AS n FROM ${this.t('cme_activities')} a WHERE NOT EXISTS (SELECT 1 FROM activities x WHERE x."legacyId" = a.id)`,
    );
    if (Number(orphans[0].n)) this.report.warnings.push(`${orphans[0].n} legacy activities skipped (unknown provider or activity type)`);
    for (const [table, model, cols] of [
      ['cme_activity_presenters', 'activity_presenters', `"firstName", "lastName", "otherNames", topic, portfolio, affiliation`],
      ['cme_activity_moderators', 'activity_moderators', `"firstName", "middleName", "lastName", portfolio`],
    ] as const) {
      if (!this.has(table)) continue;
      const pk = this.has(table, 'pr_id') ? 'pr_id' : 'id';
      const c2 = (n: string, f = 'NULL') => this.col(table, 'x', n, f);
      const values =
        table === 'cme_activity_presenters'
          ? `COALESCE(${c2('pr_firstname')}::text, '-'), COALESCE(${c2('pr_lastname')}::text, '-'), ${c2('pr_othernames')}::text, ${c2('pr_topic')}::text, ${c2('pr_portfolio')}::text, ${c2('pr_affiliation')}::text`
          : `COALESCE(${c2('first_name')}::text, '-'), ${c2('middle_name')}::text, COALESCE(${c2('last_name')}::text, '-'), ${c2('portfolio')}::text`;
      await this.exec(model, `
        INSERT INTO ${model} ("legacyId", "activityId", "regNo", ${cols}, "pointsAwarded", "createdAt", "updatedAt", "deletedAt")
        SELECT x.${pk}, na.id, ${this.regNo(c2('regno'))}, ${values}, COALESCE(${c2('pointsstatus', "'0'")}::text = '1', false),
          COALESCE(${this.ts(c2('created_at'))}, now()), now(), ${this.ts(c2('deleted_at'))}
        FROM ${this.t(table)} x JOIN activities na ON na."legacyId" = x.activity_id
        ON CONFLICT ("legacyId") DO UPDATE SET "pointsAwarded" = EXCLUDED."pointsAwarded"`);
    }
  }

  // ───────────────────────── tokens and claims ─────────────────────────
  private async tokensAndClaims() {
    if (!this.skip('cme_activity_token')) {
      const c = (n: string, f = 'NULL') => this.col('cme_activity_token', 't', n, f);
      // Legacy token strings are unique per our index; duplicates keep the first row.
      await this.exec('activity_tokens', `
        INSERT INTO activity_tokens ("legacyId", token, "activityId", "sessionNo", batch, "validFrom", "expiryDate", status, "claimedBy", "claimedAt", issued, "qrCodeUrl", "createdAt", "updatedAt", "deletedAt")
        SELECT DISTINCT ON (TRIM(t.token::text)) t.tokenid, TRIM(t.token::text), na.id, GREATEST(COALESCE(NULLIF(${c('sessionnum')}::text, '')::int, 1), 1),
          COALESCE(NULLIF(${c('tokenbatch')}::text, ''), na.id::text || '000000'),
          COALESCE(${this.date(c('validfrom'))}, na."releaseDate"), COALESCE(${this.date(c('expirydate'))}, na."expiryDate"),
          (CASE WHEN ${c('status')}::text = '1' THEN 'claimed' ELSE 'unclaimed' END)::"TokenStatus",
          (SELECT id FROM practitioners p WHERE p."legacyId" = NULLIF(${c('claimedby')}::text, '')::bigint),
          ${this.ts(c('claimeddate'))}, COALESCE(${c('issued', "'0'")}::text IN ('1','Yes'), false), NULLIF(${c('tokenqrcodelink')}::text, ''),
          COALESCE(${this.ts(c('creationdate'))}, now()), now(), ${this.ts(c('deleted_at'))}
        FROM ${this.t('cme_activity_token')} t JOIN activities na ON na."legacyId" = t.activity_id
        WHERE COALESCE(TRIM(t.token::text), '') <> ''
        ORDER BY TRIM(t.token::text), t.tokenid
        ON CONFLICT ("legacyId") DO UPDATE SET status = EXCLUDED.status, "claimedBy" = EXCLUDED."claimedBy", "claimedAt" = EXCLUDED."claimedAt", "expiryDate" = EXCLUDED."expiryDate"`);
    }
    if (this.skip('cme_activity_token_claims')) return;
    const c = (n: string, f = 'NULL') => this.col('cme_activity_token_claims', 'c', n, f);
    const method = `(CASE LOWER(COALESCE(${c('claimmethod')}::text, ''))
        WHEN 'token' THEN 'token' WHEN 'attendance' THEN 'attendance' WHEN 'api' THEN 'API' WHEN 'nontoken' THEN 'nontoken'
        ELSE CASE WHEN ${c('ui_activity_id')} IS NOT NULL AND ${c('ui_activity_id')}::text NOT IN ('', '0') THEN 'nontoken'
                  WHEN COALESCE(${c('token')}::text, '') ILIKE '%API%' THEN 'API'
                  WHEN COALESCE(${c('token')}::text, '') ILIKE '%attendance%' THEN 'attendance' ELSE 'token' END END)::"ClaimMethod"`;
    await this.exec('cpd_claims', `
      INSERT INTO cpd_claims ("legacyId", "practitionerId", "activityId", method, "methodSource", "tokenTrail", "cpdPoints", "calYear", "claimedAt", "apiClaimId", "apiActivityName", "createdAt", "updatedAt")
      SELECT c.claimid, np.id, na.id, ${method}, ${c('method_source')}::text, TRIM(COALESCE(${c('token')}::text, '')),
        COALESCE(NULLIF(${c('cpd_points')}::text, '')::numeric, 0),
        COALESCE(NULLIF(${c('calyear')}::text, '')::int, EXTRACT(YEAR FROM COALESCE(${this.ts(c('claimeddate'))}, now()))::int),
        COALESCE(${this.ts(c('claimeddate'))}, now()), NULLIF(${c('api_claimid')}::text, ''), ${c('api_activity_name')}::text, now(), now()
      FROM ${this.t('cme_activity_token_claims')} c
      JOIN practitioners np ON np."legacyId" = c.user_id
      LEFT JOIN activities na ON na."legacyId" = NULLIF(c.activity_id::text, '')::bigint
      ON CONFLICT ("legacyId") DO UPDATE SET "cpdPoints" = EXCLUDED."cpdPoints", "calYear" = EXCLUDED."calYear", "tokenTrail" = EXCLUDED."tokenTrail"`);
    await this.buildEntries();
  }

  /**
   * Build cpd_claim_entries by splitting the legacy trail where it adds up to the claim's points;
   * otherwise one 'legacy' entry with the whole amount. Totals always equal cpd_claims.cpdPoints.
   */
  private async buildEntries() {
    const claims = await this.db.$queryRawUnsafe<
      { id: bigint; trail: string; points: string; calYear: number; activityTypeId: number | null; specs: number[] | null; base: string | null; presenter: string | null; moderator: string | null; method: string; ntType: number | null; ntSpecs: number[] | null }[]
    >(`
      SELECT c.id, c."tokenTrail" AS trail, c."cpdPoints"::text AS points, c."calYear", a."activityTypeId", a."specializationAreas" AS specs,
        t."cpdPoints"::text AS base, t."presenterPoints"::text AS presenter, t."moderatorPoints"::text AS moderator, c.method::text AS method,
        n."activityTypeId" AS "ntType", n."specialityIds" AS "ntSpecs"
      FROM cpd_claims c
      LEFT JOIN activities a ON a.id = c."activityId"
      LEFT JOIN activity_types t ON t.id = a."activityTypeId"
      LEFT JOIN non_token_claims n ON n.id = c."nonTokenClaimId"
      WHERE c."legacyId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cpd_claim_entries e WHERE e."claimId" = c.id)`);
    const used = new Set((await this.db.cpdClaimEntry.findMany({ where: { token: { not: null } }, select: { token: true } })).map((e) => e.token!));
    let n = 0;
    let split = 0;
    const batch: any[] = [];
    const flush = async () => {
      if (batch.length) await this.db.cpdClaimEntry.createMany({ data: batch.splice(0) });
    };
    for (const c of claims) {
      const typeId = c.activityTypeId ?? c.ntType ?? (await this.fallbackTypeId());
      const specs = (c.specs ?? c.ntSpecs ?? []) as number[];
      const total = Number(c.points);
      const parts: { kind: string; points: number; token: string | null }[] = [];
      const base = Number(c.base ?? 0);
      for (const raw of (c.trail ?? '').split(/\s+/).filter(Boolean)) {
        const m = raw.toLowerCase();
        if (m === 'presenter') parts.push({ kind: 'presenter', points: Number(c.presenter ?? 0), token: null });
        else if (m === 'moderator') parts.push({ kind: 'moderator', points: Number(c.moderator ?? 0), token: null });
        else if (m === 'nontoken') continue;
        else parts.push({ kind: 'base', points: base, token: /^\d{5,}$/.test(raw) && !used.has(raw) ? raw : null });
      }
      const sum = Math.round(parts.reduce((s, p) => s + p.points, 0) * 100) / 100;
      const rows =
        parts.length && Math.abs(sum - total) < 0.005
          ? (split++, parts)
          : [{ kind: 'base', points: total, token: null as string | null }];
      for (const p of rows) {
        if (p.token) used.add(p.token);
        batch.push({ claimId: c.id, kind: p.kind, source: rows === parts ? c.method : 'legacy', token: p.token, points: p.points, activityTypeId: typeId, specialityIds: specs, calYear: c.calYear });
        n++;
      }
      if (batch.length >= 1000) await flush();
    }
    await flush();
    this.report.steps.push({ step: 'cpd_claim_entries', rows: n });
    this.log(`  cpd_claim_entries: ${n} (${split} claims split from the trail)`);
  }

  private fallbackType?: number;
  private async fallbackTypeId() {
    if (this.fallbackType) return this.fallbackType;
    const t =
      (await this.db.activityType.findFirst({ where: { name: 'Legacy / unclassified' } })) ??
      (await this.db.activityType.create({ data: { name: 'Legacy / unclassified', cpdPoints: 0, archived: true, description: 'Claims migrated without an activity type' } }));
    this.fallbackType = t.id;
    return t.id;
  }

  // ───────────────────────── non-token, comments, exemptions, imports ─────────────────────────
  private async nonToken() {
    if (!this.skip('cme_non_token_based_claims')) {
      const c = (n: string, f = 'NULL') => this.col('cme_non_token_based_claims', 'n', n, f);
      const status = `CASE WHEN ${c('approvedstatus')}::text IN ('Yes','No','Pending','Rejected') THEN ${c('approvedstatus')}::text WHEN ${c('approvedstatus')}::text = '1' THEN 'Yes' ELSE 'Pending' END`;
      await this.exec('non_token_claims', `
        INSERT INTO non_token_claims ("legacyId", "practitionerId", "activityTypeId", "activityName", description, "beginDate", "endDate", place, "evidenceUrl",
          "specialityIds", "claimDate", status, "approvedAt", "createdAt", "updatedAt", "deletedAt")
        SELECT n.claimid, np.id, COALESCE(nt.id, ${await this.fallbackTypeId()}), COALESCE(NULLIF(n.activityname, ''), '-'), COALESCE(${c('description')}::text, ''),
          COALESCE(${this.date(c('begindate'))}, ${this.date(c('claimdate'))}, CURRENT_DATE), COALESCE(${this.date(c('enddate'))}, ${this.date(c('begindate'))}, CURRENT_DATE),
          COALESCE(${c('activityplace')}::text, ''), NULLIF(${c('uploadedfile')}::text, ''),
          CASE WHEN np."specializationId" IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(np."specializationId") END,
          COALESCE(${this.ts(c('claimdate'))}, now()), ${status}, ${this.ts(c('approveddate'))},
          COALESCE(${this.ts(c('created_at'))}, now()), now(), ${this.ts(c('deleted_at'))}
        FROM ${this.t('cme_non_token_based_claims')} n
        JOIN practitioners np ON np."legacyId" = n.user_id
        LEFT JOIN activity_types nt ON nt."legacyId" = NULLIF(n.activitytype::text, '')::int
        ON CONFLICT ("legacyId") DO UPDATE SET status = EXCLUDED.status, "approvedAt" = EXCLUDED."approvedAt"`);
      // link diary rows to their non-token claim (legacy ui_activity_id)
      if (this.has('cme_activity_token_claims', 'ui_activity_id')) {
        await this.exec('cpd_claims.nonTokenClaimId', `
          UPDATE cpd_claims c SET "nonTokenClaimId" = n.id, method = 'nontoken'
          FROM ${this.t('cme_activity_token_claims')} lc, non_token_claims n
          WHERE c."legacyId" = lc.claimid AND n."legacyId" = NULLIF(lc.ui_activity_id::text, '')::bigint AND c."nonTokenClaimId" IS NULL
            AND NOT EXISTS (SELECT 1 FROM cpd_claims x WHERE x."nonTokenClaimId" = n.id)`);
        await this.exec('cpd_claim_entries.nontoken-type', `
          UPDATE cpd_claim_entries e SET "activityTypeId" = n."activityTypeId", "specialityIds" = n."specialityIds"
          FROM cpd_claims c JOIN non_token_claims n ON n.id = c."nonTokenClaimId"
          WHERE e."claimId" = c.id AND c."activityId" IS NULL`);
      }
    }
    if (!this.skip('cme_comments')) {
      const c = (n: string, f = 'NULL') => this.col('cme_comments', 'm', n, f);
      await this.exec('comments', `
        INSERT INTO comments ("legacyId", "profilePractitionerId", "authorUserId", comment, type, "itemId", date, "createdAt", "deletedAt")
        SELECT m.c_id, (SELECT id FROM practitioners p WHERE p."legacyId" = ${c('profile_user_id')}::bigint),
          (SELECT id FROM users u WHERE u."legacyId" = ${c('comment_user_id')}::bigint), COALESCE(m.comment, ''), COALESCE(${c('c_type')}::text, 'Comment'),
          CASE WHEN ${c('c_type')}::text = 'Non-Token Claim' THEN (SELECT id FROM non_token_claims n WHERE n."legacyId" = ${c('item_id')}::bigint) ELSE ${c('item_id')}::bigint END,
          COALESCE(${this.ts(c('c_date'))}, now()), now(), ${this.ts(c('deleted_at'))}
        FROM ${this.t('cme_comments')} m ON CONFLICT ("legacyId") DO NOTHING`);
    }
    if (!this.skip('cme_requirement_exemption')) {
      const c = (n: string, f = 'NULL') => this.col('cme_requirement_exemption', 'e', n, f);
      await this.exec('exemptions', `
        INSERT INTO exemptions ("legacyId", "practitionerId", "regNo", "cpdYear", reason, "exemptedBy", "pointsAttained", "postType", ip, "dateExempted", "createdAt", "updatedAt")
        SELECT DISTINCT ON (np.id, e.cpd_year::int) e.id, np.id, ${this.regNo(c('user_reg'))}, e.cpd_year::int, COALESCE(${c('exemption_reason')}::text, ''),
          (SELECT id FROM users u WHERE u."legacyId" = ${c('exempted_by')}::bigint), COALESCE(NULLIF(${c('points_attained')}::text, '')::numeric, 0),
          COALESCE(${c('post_type')}::text, 'FORM'), ${c('ip_address')}::text, COALESCE(${this.ts(c('date_exempted'))}, now()), now(), now()
        FROM ${this.t('cme_requirement_exemption')} e JOIN practitioners np ON np."legacyId" = e.user_id
        WHERE NOT EXISTS (SELECT 1 FROM exemptions x WHERE x."practitionerId" = np.id AND x."cpdYear" = e.cpd_year::int AND x."legacyId" IS DISTINCT FROM e.id)
        ORDER BY np.id, e.cpd_year::int, e.id
        ON CONFLICT ("legacyId") DO NOTHING`);
    }
    if (!this.skip('cme_activity_attendees_import')) {
      const c = (n: string, f = 'NULL') => this.col('cme_activity_attendees_import', 'i', n, f);
      const status = `(CASE WHEN LOWER(COALESCE(${c('status')}::text, '')) IN ('unprocessed','processed','failed','revoked') THEN LOWER(${c('status')}::text)
                            WHEN ${c('comment')}::text = 'Points awarded!' THEN 'processed' WHEN ${c('comment')}::text IN ('Max claims made','Not Found') THEN 'failed' ELSE 'unprocessed' END)::"ImportStatus"`;
      await this.exec('attendee_imports', `
        INSERT INTO attendee_imports ("legacyId", "activityId", "regNo", "fullName", email, session, status, comment, "dateProcessed", "createdAt", "updatedAt", "deletedAt")
        SELECT i.id, na.id, COALESCE(${this.regNo(c('reg_no'))}, '-'), ${c('fullname')}::text, ${c('email')}::text, GREATEST(COALESCE(NULLIF(${c('session')}::text, '')::int, 1), 1),
          ${status}, ${c('comment')}::text, ${this.ts(c('date_processed'))}, COALESCE(${this.ts(c('created_at'))}, now()), now(), ${this.ts(c('deleted_at'))}
        FROM ${this.t('cme_activity_attendees_import')} i JOIN activities na ON na."legacyId" = i.activity_id
        ON CONFLICT ("legacyId") DO UPDATE SET status = EXCLUDED.status, comment = EXCLUDED.comment`);
    }
  }

  // ───────────────────────── screening, CMS, apps, logs ─────────────────────────
  private async rest() {
    if (this.has('web_pages')) {
      const c = (n: string, f = 'NULL') => this.col('web_pages', 'w', n, f);
      await this.exec('pages', `
        INSERT INTO pages (title, slug, status, description, content, "createdAt", "updatedAt")
        SELECT COALESCE(${c('title')}::text, 'Page'), LOWER(REGEXP_REPLACE(COALESCE(${c('url', c('slug'))}::text, ${c('title')}::text, 'page-' || w.id), '[^a-zA-Z0-9]+', '-', 'g')),
          CASE WHEN LOWER(COALESCE(${c('status')}::text, '1')) IN ('1','published','active') THEN 'published' ELSE 'draft' END,
          ${c('description')}::text, ${c('content')}::text, now(), now()
        FROM ${this.t('web_pages')} w ON CONFLICT (slug) DO NOTHING`);
    }
    if (this.has('resources')) {
      const c = (n: string, f = 'NULL') => this.col('resources', 'r', n, f);
      await this.exec('resources', `
        INSERT INTO resources (title, link, status, "shortFile", "fullFileName", "filePath", details, type, "createdAt", "updatedAt")
        SELECT COALESCE(${c('title')}::text, 'Resource'), ${c('link')}::text, CASE WHEN LOWER(COALESCE(${c('status')}::text, '1')) IN ('1','published','active') THEN 'published' ELSE 'draft' END,
          ${c('short_file')}::text, ${c('full_file_name')}::text, ${c('file_path')}::text, ${c('details')}::text, ${c('type')}::text, now(), now()
        FROM ${this.t('resources')} r
        WHERE NOT EXISTS (SELECT 1 FROM resources x WHERE x.title = COALESCE(${c('title')}::text, 'Resource') AND COALESCE(x."filePath", '') = COALESCE(${c('file_path')}::text, ''))`);
    }
    if (this.has('api_consumer_apps')) {
      const c = (n: string, f = 'NULL') => this.col('api_consumer_apps', 'a', n, f);
      // Credentials are NOT copied: every app must rotate (spec 11). Apps start INACTIVE.
      await this.exec('api_consumer_apps', `
        INSERT INTO api_consumer_apps ("legacyId", name, description, url, "providerId", type, status, note, "createdAt", "updatedAt")
        SELECT a.id, a.name, ${c('description')}::text, ${c('url')}::text, (SELECT id FROM providers p WHERE p."legacyId" = ${c('provider_id')}::bigint),
          COALESCE(UPPER(${c('type')}::text), 'WEB'), 'INACTIVE', 'Migrated from the legacy system: generate new credentials before activating.', now(), now()
        FROM ${this.t('api_consumer_apps')} a ON CONFLICT ("legacyId") DO NOTHING`);
    }
    if (this.has('checklists')) {
      await this.exec('checklists', `
        INSERT INTO checklists (item, slug, evidence, module, "createdAt", "updatedAt")
        SELECT c.item, c.slug, COALESCE(NULLIF(${this.col('checklists', 'c', 'evidence')}::text, ''), '[]')::jsonb, COALESCE(NULLIF(${this.col('checklists', 'c', 'module')}::text, ''), '[]')::jsonb, now(), now()
        FROM ${this.t('checklists')} c WHERE NOT EXISTS (SELECT 1 FROM checklists x WHERE x.slug = c.slug)`);
    }
    if (this.has('practitioners_logs')) {
      const c = (n: string, f = 'NULL') => this.col('practitioners_logs', 'l', n, f);
      await this.exec('practitioner_logs', `
        INSERT INTO practitioner_logs ("practitionerId", "logType", "logDate", notes)
        SELECT np.id, COALESCE(${c('log_type')}::text, 'legacy'), COALESCE(${this.ts(c('log_date', c('created_at')))}, now()), ${c('notes')}::text
        FROM ${this.t('practitioners_logs')} l JOIN practitioners np ON np."legacyId" = ${c('user_id', c('practitioner_id'))}::bigint
        WHERE NOT EXISTS (SELECT 1 FROM practitioner_logs x WHERE x."practitionerId" = np.id AND x.notes IS NOT DISTINCT FROM ${c('notes')}::text AND x."logDate" = COALESCE(${this.ts(c('log_date', c('created_at')))}, now()))`);
    }
    if (this.has('api_logs')) {
      const c = (n: string, f = 'NULL') => this.col('api_logs', 'l', n, f);
      await this.exec('api_logs', `
        INSERT INTO api_logs ("providerId", "logType", "logDate", notes)
        SELECT (SELECT id FROM providers p WHERE p."legacyId" = ${c('provider_id')}::bigint), COALESCE(${c('log_type')}::text, 'legacy'), COALESCE(${this.ts(c('log_date', c('created_at')))}, now()), ${c('notes')}::text
        FROM ${this.t('api_logs')} l
        WHERE NOT EXISTS (SELECT 1 FROM api_logs x WHERE x."logType" = COALESCE(${c('log_type')}::text, 'legacy') AND x."logDate" = COALESCE(${this.ts(c('log_date', c('created_at')))}, now()) AND x.notes IS NOT DISTINCT FROM ${c('notes')}::text)`);
    }
    await this.exec('application_no_seq', `SELECT setval('application_no_seq', GREATEST((SELECT COALESCE(MAX(NULLIF(REGEXP_REPLACE(SUBSTRING("applicationNo" FROM 3), '\\D', '', 'g'), '')::bigint), 0) FROM practitioners WHERE "applicationNo" LIKE 'R1%'), 1))`);
  }

  // ───────────────────────── checks ─────────────────────────
  /** Points per legacy practitioner per year must match exactly (spec 11.6). */
  private async reconcile() {
    if (!this.has('cme_activity_token_claims')) return;
    const rows = await this.db.$queryRawUnsafe<{ uid: bigint; year: number; legacy: string; v4: string | null }[]>(`
      WITH l AS (
        SELECT c.user_id AS uid, COALESCE(NULLIF(c.calyear::text, '')::int, EXTRACT(YEAR FROM c.claimeddate::timestamp)::int) AS year,
               SUM(COALESCE(NULLIF(c.cpd_points::text, '')::numeric, 0)) AS pts
        FROM ${this.t('cme_activity_token_claims')} c
        WHERE EXISTS (SELECT 1 FROM ${this.t('cme_users')} u WHERE u.user_id = c.user_id)
        GROUP BY 1, 2
      ), v AS (
        SELECT p."legacyId" AS uid, c."calYear" AS year, SUM(c."cpdPoints") AS pts
        FROM cpd_claims c JOIN practitioners p ON p.id = c."practitionerId"
        WHERE c."legacyId" IS NOT NULL GROUP BY 1, 2
      ), e AS (
        SELECT p."legacyId" AS uid, c."calYear" AS year, SUM(x.points) AS pts
        FROM cpd_claim_entries x JOIN cpd_claims c ON c.id = x."claimId" JOIN practitioners p ON p.id = c."practitionerId"
        WHERE c."legacyId" IS NOT NULL GROUP BY 1, 2
      )
      SELECT l.uid, l.year, l.pts::text AS legacy, v.pts::text AS v4
      FROM l LEFT JOIN v ON v.uid = l.uid AND v.year = l.year LEFT JOIN e ON e.uid = l.uid AND e.year = l.year
      WHERE v.pts IS DISTINCT FROM l.pts OR e.pts IS DISTINCT FROM l.pts`);
    const checked = await this.db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(*) AS n FROM (SELECT DISTINCT user_id, calyear FROM ${this.t('cme_activity_token_claims')}) t`);
    this.report.reconciliation = {
      checked: Number(checked[0].n),
      mismatches: rows.map((r) => ({ legacyUserId: r.uid.toString(), year: r.year, legacy: Number(r.legacy), v4: Number(r.v4 ?? 0) })),
    };
    this.log(`  ${this.report.reconciliation.checked} practitioner-years checked, ${rows.length} mismatches`);
  }

  /** Report duplicate reg. nos. instead of failing (spec 11.5). */
  private async duplicates() {
    const rows = await this.db.$queryRawUnsafe<{ regNo: string; n: bigint }[]>(
      `SELECT "regNo", COUNT(*) AS n FROM practitioners WHERE "deletedAt" IS NULL AND "regNo" IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1 ORDER BY 2 DESC`,
    );
    this.report.duplicates = rows.map((r) => ({ regNo: r.regNo, count: Number(r.n) }));
    this.log(`  ${rows.length} duplicate reg. nos. (resolve with Regulator → Duplicates)`);
  }
}
