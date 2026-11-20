# ICPD v4: Development Prompt

**Rebuild the ICPD (Continuing Professional Development) system with NestJS, Next.js and PostgreSQL**

> Source studied: `esiaso/CPD_2021` (Laravel 11, PHP 8.2, MySQL, Blade + jQuery/DataTables, Spatie Permission, Passport/Sanctum, DomPDF, Maatwebsite Excel, DigitalOcean Spaces).
> Use this document as the brief for an engineer or coding agent. Section 1 is the prompt to paste; the rest is the specification it refers to.

---

## 1. The prompt

You are building **ICPD v4**, a ground-up rewrite of an existing Laravel/MySQL CPD platform used by a medical and dental regulator in Kenya. Practitioners (doctors and dentists) earn CPD points by attending accredited activities run by CPD providers, and the regulator monitors compliance (50 points per calendar year). Third-party systems query the platform over an API to verify practitioners and award points.

Build it as a **TypeScript monorepo**:

- `apps/api`: **NestJS 10+** REST API, **PostgreSQL 16**, **Prisma** ORM (or TypeORM if you prefer; stay consistent), OpenAPI via `@nestjs/swagger`.
- `apps/web`: **Next.js 14+ App Router**, TypeScript, Tailwind CSS + shadcn/ui, TanStack Query for data, TanStack Table for server-side paginated tables, React Hook Form + Zod for forms.
- `packages/shared`: Zod schemas, enums and DTO types shared by both apps.
- Tooling: pnpm workspaces + Turborepo, ESLint, Prettier, Vitest/Jest, Playwright for E2E, Docker Compose for local Postgres, Redis, Mailpit and MinIO.

Reproduce **every feature and business rule in sections 3 to 9** with the same behaviour, but **fix the defects listed in section 10** instead of copying them. Use clean, consistent naming in the new schema (section 4) and write a one-off **data migration** from the legacy MySQL tables (section 11). Deliver in the phases in section 12, each with tests.

Non-functional requirements:

- All timestamps stored as `timestamptz` in UTC; display and compute "today" and the CPD year in **Africa/Nairobi**.
- Money-like and point values as `numeric(8,2)`; never floats.
- Soft deletes (`deletedAt`, `deletedBy`) and `createdBy` / `updatedBy` on all business tables.
- Every state-changing action writes an audit/activity log entry (section 8).
- RBAC enforced in the API with guards (never only in the UI).
- Files (evidence PDFs, photos, logos, resources) go to S3-compatible storage (DigitalOcean Spaces in production, MinIO locally) through signed URLs.
- Email through a queue (BullMQ + Redis) with React Email or MJML templates.
- Input validation with `class-validator` DTOs or Zod pipes; consistent error envelope `{ error: { code, message, details } }`.
- Rate limiting (`@nestjs/throttler`), Helmet, CORS allow-list, CSRF protection for cookie sessions.
- 80%+ unit coverage on the points engine and the application workflow.

---

## 2. Domain overview

| Actor | What they do |
| --- | --- |
| **Public visitor** | Browse published activities and providers, read CMS pages and resources, contact form, quick token claim from a QR link using reg. no. |
| **Practitioner** | Registers an account, completes a multi-step registration application, gets approved, claims points (token, non-token with evidence), views/downloads CPD diary and performance, manages profile. |
| **Provider Coordinator** | Works on behalf of one or more CPD providers: creates activities, adds presenters/moderators, generates tokens, publishes activities, uploads attendee lists to award points. |
| **Regulator CPD Officer / Admin** | Screens and approves practitioner applications, reviews non-token claims, manages providers and their users/status, exemptions, duplicates, settings, CMS, API consumer apps, users/roles/permissions, dashboards. |
| **API consumer (provider system)** | Calls the public API with `api-consumer` credentials to register/update/publish activities, award points, verify practitioners and fetch points. |
| **Council/Board system** | Fetches a practitioner's points for a year (`/council/diary`). |

---

## 3. Roles and permissions

Recreate the permission model (Spatie-style: users ↔ roles ↔ permissions, plus direct user permissions). Seed these.

**Roles:** `Super Admin`, `Admin`, `Regulator CPD Officer`, `Provider Coordinator`, `Provider`, `Practitioner`, `Public User`.

**Permissions used by the app:**

| Permission | Grants |
| --- | --- |
| `Read Admin Panel` | Access to all `/regulator/*` and `/auth/*` admin areas |
| `Read Provider Panel` | Access to `/providers/*` workspace |
| `Read Developer Panel` | API consumer dashboard / developer area |
| `Manage Users` | Users, roles, permissions CRUD |
| `Can delete user` | Delete users |
| `Manage Practitioners` | Practitioner list and records |
| `Can Edit practitioner` | Edit practitioner, reset legacy password, merge |
| `Can Exempt Practitioner` | Create exemptions |
| `Can Process Applications` | Screening and approval workflow |
| `Manage Providers` | Provider CRUD, users, status |
| `Manage Activities` | Regulator activity oversight and tokens |
| `Manage Claims` | Non-token claim review |
| `Can Manage Settings` | Specializations, activity types, user categories |
| `Can Manage Pages` | CMS pages and resources |
| `Can Manage Apps` | API consumer apps |

Rules:
- New sign-ups get `Public User`. Approved/imported practitioners get `Practitioner`.
- Adding a user to a provider: if the email exists and the user only has `Provider Coordinator`, `Practitioner` or `Public User`, sync to `Practitioner` + `Provider Coordinator`; if they have any other role, refuse ("User exists with a different role"). If new, create the user with `Provider Coordinator`, a random password, and send a verification / set-password email.
- Provider-scoped access: a coordinator may only act on providers where they have an **Active** `provider_users` row. Enforce with a `ProviderMemberGuard` on every `/providers/:providerId/*` route, and check the activity belongs to that provider.

---

## 4. Data model (PostgreSQL)

Normalise the legacy `cme_*` tables into the entities below. Legacy names are given so the migration script can map them. Use `bigint` identity PKs, plus a public `uuid` or hashid for anything that appears in URLs (the legacy app used hash-slugs to avoid exposing sequential IDs).

### 4.1 Identity
- **users** (`users`): id, name, email (unique, citext), passwordHash, emailVerifiedAt, avatarUrl, categoryId → user_categories, lastLoginAt, timestamps, soft delete.
- **roles**, **permissions**, **role_permissions**, **user_roles**, **user_permissions**.
- **auth_logs** (`authentication_log`): userId, ip, userAgent, loginAt, loginSuccessful, logoutAt, location.
- **password_reset_tokens**, **email_verification_tokens**, **refresh_tokens / sessions**.

### 4.2 Reference data / settings
- **user_categories** (`user_category`): name, prefixLetter, minimumLength, archived. (Drives reg-no prefixes, e.g. A, B, … G.)
- **specialities** (`cme_specialities`, pk `sp_id`): name, description.
- **titles** (`cme_user_title`, pk `ttid`): Dr, Prof, …
- **countries** (`cme_countries`, pk `cid`).
- **academic_qualifications** (`cme_degree_qualification`, pk `did`).
- **medical_schools** (`med_schools`), **facilities** (`med_facilities`).
- **activity_types** (`cme_activity_type`, pk `type_id`):
  `name`, `category`, `description`, `evidenceRequired` (text), `cpdPoints` (per session), `presenterPoints`, `moderatorPoints` (legacy `facilitator_points`), `maxSessionPoints`, `maxActivityPoints`, `maxYearlyPoints`, `claimCondition` (e.g. `once` = may only be claimed once per calendar year, used for internship-type claims), `deliveryMode` (legacy int: 2 = online), `initiator` (legacy int: 1 = provider/API may create), `archived`.

### 4.3 Practitioners
- **practitioners** (`cme_users`, pk `user_id`):
  `userId` → users (legacy `uuid`), `regNo` (unique when not null), `applicationNo` (e.g. `R1xxxx`, 6 chars, generated), `titleId`, `firstName`, `otherNames`, `lastName`, `dob`, `nationalId` (unique, legacy `natID`), `email` (legacy `user_mail`), `mobile1`, `mobile2`, `nationality`, `countryOfResidenceId`, `physicalAddress` (legacy `place`), `postalAddress`, `postalCode`, `city`, `categoryId`, `specializationId`, `specializationOther`, `qualifications`, `qualificationYear`, `qualificationInstitution`, `qualificationCountry`, `workplaceInstitution`, `workplaceCountryId`, `photoUrl`, `status` (enum below), `applicationStep`, `dateOfApplication`, `dateRegistered` (legacy `dateadded`), soft delete.
  - `status` enum: `presubmission`, `submitted`, `screening`, `returned`, `approved`, `registered`, `incomplete`.
- **practitioner_specialities** (`cme_user_specialities`), **practitioner_academics** (`cme_user_accademics`), **practitioner_facilities** (`cme_user_facilities`).
- **practitioner_logs** (`practitioners_logs`): practitionerId, logType (`claim_success`, `claim_attempt`, `claim_edit_success`, …), logDate, notes, createdBy.

### 4.4 Application screening
- **checklists**: item, slug (`profile`, `photo`, `specialization`, `workplace`, …), evidence (json), module (json: `[{module:'practitioner'},{stage:'screening'}]`).
- **application_verifications**: practitionerId, officerUserId, checklistId, stage (`screening`/`processing`), recommendation (`Complete`/`Incomplete`), applicationReceivedDate, returnedSections (json), approvalComment.
- **application_section_verifications** (`appl_section_verifications`): practitionerId, officerUserId, verificationId, checklistId, sectionName, recommendation (`Complete`/`Incomplete`), notes, stage.

### 4.5 Providers
- **providers** (`cme_providers`, pk `pr_id`): regNo, name, specialities (jsonb array of speciality ids), contactName, physicalAddress, street, building, postalAddress, postalCode, town, phone, fixedLine, email, website, social links, logoUrl, location, `status` (`active`/`inactive`/`suspended`…), `effectiveDate`, dateAdded, addedBy.
- **provider_users** (`cme_provider_users`): providerId, userId, status (`Active`/`Inactive`), soft delete.
- **provider_status_history** (`cme_provider_status`): providerId, status, notes, effectiveDate.

### 4.6 Activities
- **activities** (`cme_activities`): activityNo, providerId, activityTypeId, name, shortTitle, topic, objectives, description, coordinator, deliveryMode (`physical`/`online`/`hybrid`), venue, venueOnline (url), city, gps lat/lng, primaryAudience, specializationAreas (jsonb), releaseDate (start), expiryDate (end), endTime, `numSessions` (≥1), `multiSessions` (bool), `cpdPoints` (snapshot of type points), `maxPoints` (= cpdPoints × numSessions), published (bool), datePublished, featured, visibility, onlineRegistration, archived (legacy `archive_status`), dateArchived, posterUrl, qrCodeUrl, shortenedUrl (external activity URL for API-created activities), hashtag, activityCost, subProviderUnit, soft delete.
- **activity_presenters** (`cme_activity_presenters`): activityId, regNo, titleId, firstName, lastName, otherNames, topic, portfolio, affiliation, `pointsAwarded` (legacy `pointsStatus` 0/1), dateProcessed.
- **activity_moderators** (`cme_activity_moderators`): activityId, regNo, titleId, firstName, middleName, lastName, portfolio, `pointsAwarded`, dateProcessed.
- **activity_tokens** (`cme_activity_token`, pk `tokenid`): token (string, unique), activityId, sessionNo, batch, validFrom, expiryDate, `status` (enum `unclaimed`=legacy 2, `claimed`=legacy 1; "expired" is computed), claimedBy → practitioner, claimedAt, issued, qrCodeUrl, createdBy.
- **attendee_imports** (`cme_activity_attendees_import`): activityId, regNo, fullName, email, session, status (`unprocessed`/`processed`/`failed`/`revoked`), comment, dateProcessed.

### 4.7 Claims and compliance
- **cpd_claims** (`cme_activity_token_claims`, pk `claimid`) — the CPD diary ledger:
  practitionerId, activityId (nullable), nonTokenClaimId (legacy `ui_activity_id`, nullable), `method` (`token`/`attendance`/`API`/`nontoken`), methodSource, tokenTrail (legacy `token`: space-separated history of tokens and markers like `presenter`, `moderator`, `attendance`, `API`), cpdPoints, calYear, claimedAt, apiClaimId, apiActivityName.
  - **Improve:** add a child table **cpd_claim_entries** (one row per award event: token used, role bonus, source, points) and keep `cpd_claims` as the per-activity aggregate, instead of concatenating strings.
- **non_token_claims** (`cme_non_token_based_claims`, pk `claimID`): practitionerId, activityTypeId, activityName, description, beginDate, endDate, place, evidenceUrl (PDF), claimDate, `status` (`Pending`/`Yes`=approved/`Rejected`/`No`), approvedAt, approvedBy, rejectedAt, rejectedBy.
- **comments** (`cme_comments`, pk `c_id`): profilePractitionerId, authorUserId, comment, type (`Non-Token Claim`, …), itemId, date.
- **exemptions** (`cme_requirement_exemption`): practitionerId, regNo, cpdYear, reason, exemptedBy, pointsAttained (snapshot), postType (`FORM`/`API`), ip, dateExempted. Unique (practitionerId, cpdYear).
- **New: classification on every award.** `cpd_claim_entries` must store `activityTypeId` and `specialityIds` (jsonb snapshot) at the time of the award: taken from the activity's type and `specializationAreas` for token/attendance/API claims, and from the non-token claim's type and the speciality the practitioner picks on the claim form (add `specialityIds` to **non_token_claims**). This is what the grouping and compliance rules in 5.7.1 and 5.7.2 read, so later edits to an activity don't rewrite history.

### 4.7.1 New: compliance rules (see 5.7.2)
- **compliance_frameworks**: name, cpdYearFrom, cpdYearTo (nullable = open), `scope` (`speciality` / `category` / `default`), specialityId (nullable), userCategoryId (nullable), totalRequiredPoints (default 50), active, notes. Unique active framework per (scope target, year).
- **compliance_buckets**: frameworkId, name (e.g. "Urology-related", "Other areas"), `source` (`speciality_related` = entry tagged with the framework's speciality, `other` = not tagged with it, `any`), minPoints, maxCountablePoints (nullable), minDistinctActivityTypes (default 1), maxPointsPerActivityType (nullable), allowOverflowTo (bucketId, nullable), sortOrder.
- **compliance_type_caps**: frameworkId, bucketId (nullable = whole framework), activityTypeId, maxPoints, minPoints (nullable). Lets the regulator set "max allowable points" for a given speciality + activity type pair.
- **compliance_results** (cache, recomputed on every award/approval/exemption and nightly): practitionerId, cpdYear, frameworkId, rawPoints, countablePoints, bucket breakdown (jsonb), compliant (bool), reasons (jsonb), computedAt.

### 4.8 CMS, contact and API
- **pages** (`web_pages`): title, slug/url, status, description, content (rich text). Public route `/about/:slug`.
- **resources**: title, link, status, specialities (jsonb), shortFile, fullFileName, filePath, details, type.
- **contacts**: name, email, phone, subject, message (protected by reCAPTCHA + honeypot).
- **api_consumer_apps**: name (unique), description, url, providerId, type (`WEB`/`MOBILE`/`IOT`), status (`ACTIVE`/`INACTIVE`/`SUSPENDED`/`BLOCKED`, default `INACTIVE`), note, key, **secretHash** (store hashed, not plain).
- **api_logs**: providerId, logType (`get_points`, `award_points`, `activity_create`, …), logDate, notes, createdBy.
- **request_logs**: method, path, status, duration, ip, userId/consumerId (replaces the `LogRequests`/`LogRoute` middleware).
- **audit_log**: actorId, subjectType, subjectId, event, logName (e.g. `activity-publishing`, `practitioner-excemption`, `researcher-application`), properties jsonb, batchId (replaces Spatie activitylog + owen-it auditing).
- **user_logs**: userId, logType, logDate, notes.

---

## 5. Business rules (implement exactly; these are the heart of the system)

### 5.1 Registration number format (`regNoFormat`)
- Strip all spaces before validating or looking up.
- First character must be one of **A, B, C, D, E, F, G** (better: the prefix letters configured in `user_categories`).
- Total length ≤ 8; the part after the letter must be numeric.
- Numeric part length between 2 and 9 digits (legacy rules: A/B need ≥ 2 digits; 3-digit numbers with a leading 0 are rejected for B–G). Re-implement as a clear, tested function driven by the category's `prefixLetter` and `minimumLength`.
- Must be unique across practitioners, except for the practitioner being edited.
- Error messages to keep: "Wrong registration number format! (e.g Axxxx or Bxxxx …)", "Registration number already exist!".

### 5.2 Practitioner registration application
Steps (`applicationStep`): `profile` → `photo` → `academic` → `specialities` → `workplace` → `preview` → submit.

1. **Create profile** (logged-in user without a practitioner record):
   - If a practitioner already exists for this user, go to preview.
   - If a legacy practitioner exists with the user's email, or with the entered reg. no., show the **import profile** form instead of creating a duplicate.
   - Required: firstName, lastName, email (unique), physicalAddress, city, phone, countryOfResidence, nationality, nationalId/passport (unique), regNo (format + unique), categoryId.
   - Creates practitioner with `status = presubmission`, `applicationStep = profile`, and generates `applicationNo` = `R1` + zero-padded sequence (6 chars total).
2. **Import profile** (legacy record): updates the legacy record, links `userId`, sets `status = registered`, copies `categoryId` from the user, assigns `Practitioner` role, emails "NotifyImport".
3. **Photo** upload (image, stored to object storage; also sets user avatar).
4. **Academics**, **Specialization**, **Workplace** forms. Editing any step is only allowed while `status ∈ {presubmission, returned}`. When status is `returned`, saving a section marks that section's `application_section_verifications.recommendation = Complete`.
5. **Submit**: requires photo uploaded, specialization filled, academic qualification filled, at least one workplace/affiliation. Sets `status = submitted`, `dateOfApplication = now`, emails "NotifySubmission" with the application number.
6. **Resubmit** (after return): re-validates reg-no format, sets `status = submitted`, emails "NotifyReSubmission".

### 5.3 Regulator screening workflow
- Lists: new (`submitted`), all (not `incomplete`/`presubmission`), by status (`screening`, `returned`, `approved`, `presubmission`, …), incomplete.
- **Start processing**: requires a checklist with module `practitioner` and stage `screening` (else error "There is no screening checklist"). Sets `status = screening`, creates a new `application_verifications` row (stage `screening`, officer, received date). Copies forward all sections that were `Complete` in the previous verification.
- **Screen a section** (`/screening/:slug/:application`): officer records `Complete` or `Incomplete` + notes per checklist section.
- Button logic: if any section is `Incomplete` → show **Return**; if all sections are verified and all `Complete` → show **Next stage**.
- **Return application**: `status = returned`, store returned sections on the verification, email "NotifyReturn" with the list/notes and a link to edit.
- **Complete screening**: `status = approved`.
- **Chairman's review** (optional comment step): stores `approvalComment`.
- **Approve / register**: `status = registered`, `dateRegistered = today`, user roles synced to `Practitioner`, email "NotifyApproval".
- **Request / remove document** for a section, **view returned**, **view incomplete**, **delete application** (presubmission only).
- Log every step to the audit log (`logName: researcher-application` in legacy; rename to `practitioner-application`).

### 5.4 Activities (provider side)
- Create: required activityType, name (≤255), numSessions, releaseDate, expiryDate, deliveryMode; optional venue, venueOnline, city, specializationAreas. On create, snapshot `cpdPoints = type.cpdPoints`, `maxPoints = cpdPoints × numSessions`, `multiSessions = numSessions > 1`. Then go to the **description** step (objectives, description, topic, etc.).
- Only non-archived activity types are selectable. Provide `GET activity-type details` for the form to show points/evidence.
- Edit, delete (soft), archive list, preview.
- **Publish** sets `published = true`, `datePublished = now`; **Unpublish** clears both. Both write audit entries (success and failed attempts).
- Presenters and moderators CRUD per activity (identified by regNo).
- Sessions: an activity has sessions 1..numSessions (label "Session N"; if 1, "Session 1 (Default)").

### 5.5 Tokens
- Generate N tokens for one session with validFrom and validTo:
  - Split into **batches of 30**; each batch id = `activityId + 6 random digits`.
  - Each token = `activityId + 6 random digits`; status `unclaimed`. **Fix:** use a crypto RNG and guarantee uniqueness (unique index + retry).
- List/search tokens; per-activity counts: total, claimed, unclaimed.
- Edit a single token; bulk edit validity by **batch** or by **session**; delete by token, batch or session.
- Download tokens (all / by batch / by session) as printable PDF/Excel cards with QR codes that link to `/token/:activityId/claim`.
- A token is **expired** when `expiryDate < today (Nairobi)`; computed status = `expired`, else stored status.
- Regulator has the same token tools across all activities.

### 5.6 Points engine (single `PointsService`, fully unit-tested)
Definitions for activity A and practitioner P:
- `base = A.type.cpdPoints`
- `maxActivityPoints = base × A.numSessions` (or `base` when numSessions ≤ 1)
- `presenterBonus = A.type.presenterPoints` if P's regNo is a presenter on A with `pointsAwarded = false`, else 0
- `moderatorBonus = A.type.moderatorPoints` likewise for moderators
- `calYear = min(currentYear, year(A.expiryDate))`
- Existing claim row = `cpd_claims` where (P, A).

`canStillEarn(P, A)`: true if no claim yet, or `claim.points < maxActivityPoints`, or (P is an unawarded presenter and `claim.points < max + presenterBonus`), or (unawarded moderator and `claim.points < max + moderatorBonus`).

**Token claim** (practitioner portal):
1. Token must exist ("Invalid Token").
2. Number of tokens P has already claimed for A must be < `numSessions` ("You have made maximum allowed claims with tokens for this activity!!").
3. Token status: claimed → "The token submitted is had been claimed"; expired → "The token submitted is expired!".
4. Activity must be published ("Token invalid, contact the provider").
5. `canStillEarn` ("You have claimed maximum points for this activity.").
6. Reject if this token string already appears on a claim (double-spend guard).
7. In **one DB transaction**: mark token claimed (claimedBy, claimedAt), then upsert the claim: add `base` + presenter/moderator bonuses, append markers to the trail, set method `token`, calYear; mark presenter/moderator `pointsAwarded = true`, `dateProcessed = now`.
8. Write practitioner log `claim_success` / `claim_attempt` for every outcome.
9. Success message: "You have successfully claimed {base} points for activity #{id}".

**Quick/public QR claim** (`/token/:activity/claim`, no login): reg. no. + token; validate reg. no. format, look up practitioner ("Registration Number provided does not exist…"), then the same rules as above (legacy skipped the expiry check here; keep expiry enforced unless the regulator says otherwise and make it configurable).

**Attendance claim** (attendee list import): same as token claim without a token: adds `base` + bonuses, method `attendance`, trail marker `attendance`; fails with "Max claims made" when `canStillEarn` is false.

**API claim** (`POST /api/v1/practitioners/claimpoints`): activity must exist, belong to the calling provider, not be expired (`expiryDate ≥ today`), be published, practitioner must exist, `canStillEarn`; adds `base` (no role bonus), method `API`, trail `API`; logs `award_points` in `api_logs`.

**Non-token claim** (practitioner uploads evidence):
- Required: activityType, activityName, description, beginDate, endDate (≥ beginDate), venue, evidence **PDF** (max upload size from config).
- Unique per (practitioner, activityType, activityName, beginDate).
- If the type has `claimCondition = once` and P already has a claim of a `once` type with endDate in the same year → "You have made a similar type of claim for the same period".
- Saved as `Pending`. Practitioner may edit (resets status to `Pending`) or delete while not approved.
- Regulator **award**: enters points; creates a `cpd_claims` row (method `nontoken`, methodSource `nonTokenUserInitiated`, calYear = year(endDate), claimedAt = claimDate, link to nonTokenClaimId); status `Yes`, approvedAt/By.
- Regulator **reject**: requires reason → stored as a comment (type `Non-Token Claim`); status `Rejected`, rejectedAt/By; email "NotifyClaimRejection" with activity name, claim date and reason.
- Lists: pending vs processed (approved/rejected).
- **Improve:** enforce `activity_types.maxYearlyPoints` and `maxSessionPoints` caps on awards (columns exist but legacy never enforced them; confirm with the regulator).

**Attendee list import** (provider):
- Upload `.xlsx/.xls` ≤ 10 MB with heading row: `regno`, `fullname`, `email`, `activitysession` (default 1).
- Skip rows without regno; strip spaces; skip duplicates of (activity, regNo, session).
- Imported rows start `unprocessed`. Provider can edit/delete a row, process one, or **process all**.
- Processing: if practitioner with regNo exists → attendance claim → `processed` "Points awarded!" or `failed` "Max claims made"; else `failed` "Not Found".
- Regulator can **re-process pending attendance** for one practitioner: retries all `failed` imports for their regNo and reports "N processed, X awarded, Y failed". Useful after a practitioner registers late.
- Run large imports and "process all" as background jobs with progress.

### 5.7 CPD diary and compliance
- **Annual requirement: 50 points.** Performance % = points / 50 × 100.
- Current points = sum of `cpd_claims.cpdPoints` for P and calYear (default current year).
- Portfolio page: current-year points and performance gauge, diary (claims for the year), list of non-approved non-token claims (Pending/Rejected/No), year selector from the distinct claim years.
- Print/download diary for a year as PDF; performance widget per year.
- Certificate of compliance PDF for a year (profile → certificate).
- **Exemptions**: regulator exempts P for a cpdYear with a reason; snapshot current points; one per (P, year) ("This practitioner/dentist has been Exempted for the specified year."). In API and council responses, an exempted practitioner with < 50 points is reported as `exempted: true, points: 50.00`.

#### 5.7.1 New: points grouped by activity type
- `GET /practitioners/:id/diary/summary?year=` (and `/me/...` for the practitioner) returns, per activity type: type name, number of claims, raw points, countable points (after the caps in 5.7.2), and share of the year's total. Include a "speciality-related vs other" split when a framework applies.
- Practitioner portfolio: a grouped table plus a bar/donut chart by activity type for the selected year, with drill-down to the diary entries of that type. The printed/downloaded diary PDF and the compliance certificate show the same grouped summary.
- Regulator practitioner detail: the same view. Regulator reports: points by activity type across all practitioners, filterable by year, speciality, user category and provider; export to Excel/CSV.

#### 5.7.2 New: regulator-defined compliance rules by speciality and activity type
The regulator can define, per speciality (or user category, or a default for everyone), how the annual requirement must be made up. Example, Urologist, total 50 points:

| Bucket | Source | Min points | Distinct activity types | Max per activity type |
| --- | --- | --- | --- | --- |
| Urology-related | entries tagged with Urology | 30 | at least 2 | e.g. 20 (so 30 can't come from one type) |
| Other areas | entries not tagged with Urology | 20 | at least 2 | e.g. 15 |

Rules engine (`ComplianceService`, pure functions, exhaustively unit-tested):
1. **Pick the framework** for P and the year: speciality framework for P's primary speciality, else user-category framework, else default (plain 50 points, no buckets, which is the legacy behaviour). If P has several specialities, the regulator chooses whether the primary one or the strictest applies (setting).
2. **Classify** each claim entry for the year into a bucket using its snapshot `specialityIds` and `activityTypeId`.
3. **Apply caps**: within a bucket, points of one activity type above `maxPointsPerActivityType` (or a matching `compliance_type_caps` row) are **not countable**. They stay in the diary, shown as "above cap". Bucket points above `maxCountablePoints` overflow to `allowOverflowTo` if set (e.g. extra urology points may count towards "Other areas" only if the regulator allows it; default off), otherwise they are not countable.
4. **Check each bucket**: countable points ≥ minPoints and distinct activity types with countable points ≥ minDistinctActivityTypes.
5. **Compliant** when every bucket passes and total countable points ≥ totalRequiredPoints. An exemption still overrides everything for that year.
6. **Explain the result** in plain words for the practitioner, e.g. "Urology-related: 24 of 30 points, add 6 more. All of them are from Conferences; add at least one other activity type." and "Other areas: 20 of 20, complete."
7. Recompute and cache in `compliance_results` after every award, approval, rejection, merge, exemption or rule change. Changing a framework for a year that has started asks the regulator to confirm and shows how many practitioners change status.

Where it shows up:
- **Regulator settings → Compliance rules**: create/edit frameworks, buckets and type caps; a "preview" that runs the rules on a sample of practitioners before saving; versioning by year so past years keep their old rules.
- **Practitioner portfolio**: a progress bar per bucket, the per-type breakdown, and the explanation messages. When claiming, warn if the points would be above a cap and not count ("You already have 20 Conference points in Urology-related; these points will be recorded but won't count towards compliance").
- **Regulator compliance report**: compliant / not compliant / exempted per year, filterable by speciality and category, with the failing reasons; export.
- **API and council endpoints**: keep the current fields (`points`, `exempted`) for backward compatibility and add `countablePoints`, `compliant`, and `buckets[]` (`name`, `points`, `required`, `distinctTypes`, `passed`).
- **Non-token claim form**: add a required speciality-relevance field (the practitioner's specialities + "General / other") so these claims can be bucketed; the regulator can correct it when reviewing.

Assumptions to confirm with the regulator: points above a cap are recorded but don't count (rather than being refused at claim time); a single activity tagged with several specialities counts as related for each of them; overflow from the speciality bucket to "Other areas" is off by default.

### 5.8 Practitioner records (regulator)
- Server-side paginated list with search; incomplete list; detail; edit; soft delete, trashed list, restore, permanent delete; view diary, filter diary by year, preview a claim, points summary.
- **Duplicates**: group by regNo with count > 1. **Merge** into a chosen practitioner: move token `claimedBy`, non-token claims, and `cpd_claims` to the target, then null the regNo on the others. Do it in a transaction and write an audit entry. **Fix:** merge claims for the same activity into one row instead of leaving two.
- Reset a legacy password for a practitioner.

### 5.9 Providers (regulator)
- CRUD: name, regNo, specialities (multi), physical/postal address, postal code, city, telephone, email, website (all required on create).
- Users: add (rules in section 3, email "NotifyProviderUser"), remove (soft).
- Activities per provider (server-side table).
- **Status change**: newStatus + effectiveDate + notes → insert into status history and update the provider.
- **Yearly job**: on 1 January set every provider `inactive` with note "Reset end of year" (they must be re-accredited). Make it a scheduled BullMQ/cron job.
- Provider workspace: if a coordinator belongs to more than one active provider, show a provider picker; else go straight to that provider's dashboard (activity counts, tokens, claims).

### 5.10 Public site
- Home: featured/recent published activities, providers.
- Activities list (published only, newest first, paginated) with filter by providers, date range and search term; activity detail with presenters and moderators.
- Providers list and provider detail with its published activities (server-side search).
- CMS pages `/about/:slug`, resources page, terms, privacy, contact form.

### 5.11 Settings (regulator)
- Specializations CRUD.
- Activity types CRUD + archive (fields in 4.2).
- User categories CRUD + archive (name, prefixLetter, minimumLength).
- CMS pages and resources CRUD (resources with file upload and speciality tags).

### 5.12 Dashboards
- Regulator: totals (practitioners, providers, activities, users, claims) and monthly trend charts (registrations, activities, claims, non-token claims, etc.) for the current year.
- Provider: per-provider activity and token stats.

---

## 6. Authentication

- Email + password sign-up with **email verification** (link expires; resend throttled to 6/min), login, logout, forgot/reset password, confirm password for sensitive actions, change password.
- Honeypot + reCAPTCHA on register, forgot password and contact.
- Session strategy: NestJS issues short-lived JWT access token + rotating refresh token in **httpOnly secure cookies**; Next.js middleware protects routes by role/permission. (Alternatively Auth.js on the Next side calling the Nest API; pick one and document it.)
- Record every login attempt in `auth_logs` (IP, UA, success) and notify on new device (legacy used rappasoft/authentication-log).
- **Legacy migration login** (`/migrate`): users from the pre-2021 system have `sha1(password)` in `cme_users.user_password`. On login with reg. no./email + password, if sha1 matches: create a modern user with bcrypt/argon2 hash, link it to the practitioner, verify email, and assign roles by the legacy role id: 3 or 4 → `Practitioner`; 5 → `Practitioner` + `Provider Coordinator`; 10 → `Provider Coordinator` (and remove the practitioner row); 12 → `Regulator CPD Officer` (remove practitioner row); else `Public User`. Then clear the legacy hash.
- **OSP SSO** (`/osp/login`, `/osp/callback`): OAuth2 authorization-code flow against `SSO_SERVER` with `SSO_CLIENT_ID` / `SSO_REDIRECT_URI`. On callback, find practitioner by email or reg. no.; create/link user and practitioner (status `registered`, role `Practitioner`) and sign in. **Must exchange the code and read the profile from the SSO server** (see section 10).

---

## 7. Public REST API (v1)

Base path `/api/v1`. Auth header `api-consumer: base64(key:secret)`; the consumer must be `ACTIVE`; resolve `providerId` from the consumer app (never from the request body). Return proper HTTP status codes (legacy often returned 200 with `{error}`; keep the same JSON field names for backward compatibility but use 4xx codes, and document both in OpenAPI). Log each call to `api_logs`. Per-consumer rate limits.

| Method | Path | Body / query | Behaviour |
| --- | --- | --- | --- |
| GET | `/activities` | page | Calling provider's non-archived activities, ordered by releaseDate |
| GET | `/activities/types` | | Non-archived activity types |
| GET | `/activities/types/event/based` | | Event-based types |
| POST | `/activities/types/details` | `typeId` | Type details |
| POST | `/activity/registration` | `activityType` (num), `activityName` (≤255), `releaseDate`, `expiryDate` (Y-m-d), `objectives`, `description` (≥10), `activityUrl` (url) | Only types with `deliveryMode = 2` (online), `initiator = 1`, not archived ("This Activity Type cannot be created via API!"). Creates activity for the provider |
| POST | `/activity/view` | `activityId` | Must belong to the provider |
| POST | `/activity/update` | same as registration + `activityId` | Must belong to the provider |
| POST | `/activity/publish` / `/activity/unpublish` | `activityId` | Must belong to the provider |
| POST | `/activity/delete` | `activityId` | Soft delete, must belong to the provider |
| GET | `/practitioners/:id` | | Practitioner portfolio summary |
| POST | `/practitioners/claimpoints` | `regNo`, `activityId` | API claim (section 5.6) |
| POST | `/practitioners/points` | `regNo` (4–8 chars) | `{ regNo, points, year, datetime }`, or `exempted: true, points: 50.00` |
| POST | `/verify` | `regNo` | `{ regNo, email (masked), name (first name, only if registered), status: Verified/Unverified, datetime }` |
| GET | `/council/diary` | `regNo`, `year` | Points for year with the exemption rule; separate council credential |
| GET | `/admin/allocateToken`, `/admin/correct/points` | | Maintenance: re-award claimed tokens that have no claim row for a date; fix claims with 0 points from the type's points. Make these **admin-only internal endpoints or CLI commands**, not public |

Email masking: keep first `min(len/2, 10)` chars of the local part if longer than 3, then `***@domain`.

**API consumer apps (regulator UI):** list/create/update/delete apps per provider; type and status; generate or rotate credentials (`key` = 21 hex chars, secret = rest of 128 hex chars; show the secret once, store hash); download credentials file; app must be `ACTIVE` to rotate. Developer dashboard for consumers: create/delete personal access tokens.

---

## 8. Audit, logging and notifications

- Audit log entries for: activity publish/unpublish (success + attempt), exemptions (success + attempt), application workflow steps, practitioner edits/merges/deletes, provider status changes, settings changes, role/permission changes.
- Practitioner logs for every claim attempt and success.
- API logs for every API call.
- Request log middleware (method, path, status, latency, actor).
- Emails (queued): NotifySubmission, NotifyReSubmission, NotifyReturn, NotifyApproval, NotifyImport, NotifyApplicationDelete, NotifyClaimRejection, NotifyProviderUser, email verification, password reset.
- Scheduled jobs: weekly DB backup to object storage (Sunday 21:00 Nairobi) and archive/prune old backups (Sunday 15:00); yearly provider deactivation (1 Jan 00:00).

---

## 9. Frontend (Next.js) page map

Use route groups and layouts per area. Server components for reads; client components for tables and forms. All admin tables are server-side paginated, sortable and searchable (replaces DataTables).

**Public** `(public)`: `/`, `/activities`, `/activities/[id]`, `/providers`, `/providers/[id]`, `/about/[slug]`, `/resources`, `/contact`, `/terms`, `/privacy`, `/token/[activityId]/claim`.

**Auth** `(auth)`: `/login`, `/register`, `/forgot-password`, `/reset-password/[token]`, `/verify-email`, `/confirm-password`, `/migrate`, `/osp/login`.

**Account**: `/profile`, `/profile/edit`, `/profile/photo`, `/change-password`, `/client/dashboard` (API tokens).

**Practitioner** `/practitioner`:
- `registration/new`, `registration/[app]/edit`, `/photo`, `/academics`, `/specialization`, `/workplace`, `/preview`, submit/resubmit actions (a stepper showing the steps and any returned sections with officer notes).
- `profile`, `profile/edit`, `profile/speciality`, `profile/workplace`, `profile/photo`, `profile/certificate`.
- `portfolio` (points gauge, diary, pending claims), `portfolio/claim` (tabs: token / non-token with PDF upload), `portfolio/claims/[id]` (view/edit/delete non-token), `portfolio/diary` (print/download by year).

**Provider workspace** `/providers`: provider picker; `[providerId]/dashboard`, `/profile`, `/activities` (list, archived), `/activities/new`, `/activities/[id]` (tabs: overview, description, presenters, moderators, tokens, attendees, imported attendees), publish/unpublish, token generation dialog, batch/session tools and downloads, Excel upload with a template download.

**Regulator** `/regulator`: dashboard; practitioners (all, incomplete, duplicates + merge, trashed, detail with diary/points/exemptions/edit); applications (new, all, by status) and screening screens per checklist section with Complete/Incomplete + notes, return/approve actions; activities (all, archived, preview, tokens); claims (non-token pending/processed, review dialog with evidence PDF viewer, award/reject); exemptions; providers (CRUD, users, status history, activities); settings (specializations, activity types, user categories); CMS pages; resources; API consumer apps; users/roles/permissions (`/auth/users`, `/auth/roles`, `/auth/permissions`, unverified users).

UX notes: Kenyan context (mobile-first; many practitioners claim on phones at events), fast token entry with QR scan, clear error messages copied from section 5, accessible forms, dark mode optional.

---

## 10. Legacy defects to fix (do not replicate)

1. **SSO callback trusts request input.** `/osp/callback` creates/logs in users from `email`, `reg_no`, `password` in the request without exchanging the OAuth code. Implement the real code-for-token exchange and fetch the user profile from the SSO server; verify `state`.
2. **API consumer secrets stored in plain text**; compare hashed secrets in constant time. Middleware echoes a body and `exit`s; use a proper Nest guard and 401/403.
3. **Legacy SHA-1 passwords** and a hard-coded `user_password = '1234567890'` on new practitioners. Store nothing in that column for new records; rehash on migration login.
4. **Presenter bonus bug** in `setUserCPDPoints`: on an existing claim the presenter bonus is added to a throwaway variable, so it is never saved. Bonuses must be added consistently in all claim paths.
5. `PractitionersHelper::user_exist` uses `->get()` and `!empty(collection)`, so it always returns true. Use a real existence check.
6. `claimQr` destructures `getCPDActivityID()` with `list()` but the function returns a model array or `''`, and calls `$isValid->success` on an array. Rewrite the public claim cleanly.
7. Token generation uses `mt_rand` with no uniqueness guarantee; batch remainder logic is fragile. Use crypto RNG + unique index.
8. Token claim and points update are not transactional (race: two people can claim the same token). Use a transaction with `SELECT … FOR UPDATE` on the token row.
9. `checkIfInternshipClaimed` uses raw `YEAR()` string interpolation (SQL injection risk) and does not filter by the type being claimed. Parameterise and scope it to `once` types.
10. `updateNonToken` returns before saving a new evidence file. Save the file first.
11. `submitChairmansReview` looks up `application_id` which does not exist on the verification table.
12. Duplicate route definitions and GET routes that change state (`publish`, `unpublish`, `award`, `reject`, `attendees remove`). Use POST/PATCH/DELETE.
13. Missing authorization checks: practitioners can reach other practitioners' claims/diary by ID; providers' `{provider}` param isn't checked against membership in several controllers. Add ownership guards everywhere.
14. Stale seeders from another project (IREC/NACOSTI permissions). Seed only the roles/permissions in section 3.
15. Mixed duplicate models for the same tables (`Activities\Activity` vs `Regulator\Activities\Activity`, etc.). One entity per table.
16. Hard-coded 50-point requirement; make it a setting (per year and per user category). This is superseded by the compliance frameworks in 5.7.2, where the default framework is 50 points with no buckets.

---

## 11. Data migration (MySQL → PostgreSQL)

Write `apps/api/scripts/migrate-legacy.ts` (or use pgloader into a `legacy` schema first, then SQL/TypeScript transforms):

1. Load the MySQL dump into a `legacy` schema.
2. Transform in dependency order: reference data → users/roles/permissions → user categories → practitioners (+ specialities/academics/facilities) → providers (+ users, status) → activity types → activities (+ presenters, moderators) → tokens → claims (build `cpd_claim_entries` by splitting the legacy `token` trail where possible) → non-token claims → comments → exemptions → attendee imports → verifications/checklists → CMS → API apps (force credential rotation) → logs.
3. Keep a `legacyId` column on each migrated table for traceability; keep legacy `user_password` sha1 hashes in a separate `legacy_credentials` table for the migration login only.
4. Map status codes: token `1`→`claimed`, `2`→`unclaimed`; `archive_status '0'/'1'`→boolean; `active 'Yes'/'No'`→status; provider `specialities` JSON → jsonb.
5. Normalise reg. nos. (strip spaces, upper-case); report duplicates instead of failing.
6. Recompute and compare: total points per practitioner per year must match the legacy sum exactly; output a reconciliation report.
7. Make it idempotent and runnable against a staging copy first.

---

## 12. Delivery phases

1. **Foundation**: monorepo, Docker Compose, Prisma schema + migrations, seed (roles, permissions, checklists, reference data), auth (register, verify, login, reset, refresh), RBAC guards, audit log, OpenAPI, CI (lint, typecheck, tests).
2. **Settings and CMS**: specializations, activity types, user categories, pages, resources, public pages, contact.
3. **Providers**: CRUD, users, status history, yearly deactivation job, provider workspace and picker.
4. **Activities and tokens**: activity wizard, presenters, moderators, publish, token generation/batches/sessions/downloads with QR, public activity listing.
5. **Points engine and claims**: `PointsService` with exhaustive unit tests, token claim, public QR claim, attendee import + processing jobs, non-token claims and regulator review, diary, performance, PDFs, exemptions.
5b. **Compliance by speciality and activity type**: claim-entry classification, points grouped by activity type, `ComplianceService` with frameworks/buckets/type caps, regulator rules UI with preview, practitioner progress view, compliance report, API fields.
6. **Practitioner registration and screening**: stepper, submission, screening checklist, return/resubmit, approval, emails.
7. **Regulator tools**: practitioner management, duplicates merge, trashed/restore, dashboards and charts.
8. **Public API v1 + consumer apps**: guard, endpoints, logs, rate limits, developer dashboard.
9. **Legacy auth**: migration login, OSP SSO.
10. **Data migration + reconciliation**, performance testing, security review, UAT, cut-over plan.

Definition of done for each phase: migrations, seeds, API endpoints with OpenAPI docs, UI pages, unit + e2e tests passing, audit logging in place, and a short README section.

---

## 13. Environment variables

`DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `APP_URL`, `API_URL`, `TZ=Africa/Nairobi`, `MAIL_*`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_KEY`, `S3_SECRET`, `S3_REGION`, `RECAPTCHA_SITE_KEY`, `RECAPTCHA_SECRET`, `SSO_SERVER`, `SSO_CLIENT_ID`, `SSO_CLIENT_SECRET`, `SSO_REDIRECT_URI`, `CPD_ANNUAL_REQUIREMENT=50`, `MAX_UPLOAD_MB`, `BACKUP_BUCKET`.
