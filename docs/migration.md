# Legacy data migration and cut-over

## What moves

The transform (`apps/api/src/migration/legacy-migration.ts`) runs in dependency order and keeps a `legacyId` on every migrated row:

reference data (categories, specialities, titles, countries, qualifications, schools, facilities, activity types) → users, roles, direct permissions → practitioners (+ specialities, workplace, legacy sha1 credentials) → providers (+ coordinators, status history) → activities (+ presenters, moderators) → tokens → claims (+ entries) → non-token claims → comments → exemptions → attendee imports → checklists, CMS pages and resources → API apps → practitioner and API logs.

Mappings worth knowing:

| Legacy | v4 |
| --- | --- |
| token status `1` / `2` | `claimed` / `unclaimed` (expired is computed) |
| `archive_status` `'0'`/`'1'` | `archived` boolean |
| provider `active` `Yes`/`No` | `status` `active`/`inactive` |
| `specialities` / `specialization_areas` JSON | jsonb arrays of v4 speciality ids |
| reg. nos. | spaces stripped, upper-cased; duplicates reported, not fixed |
| `user_password` (sha1) | `legacy_credentials`, except the hard-coded default `1234567890` |
| Laravel `$2y$` bcrypt | `$2b$` (same algorithm) |
| Spatie roles/permissions | matched by name; only the spec section 3 names exist |
| API consumer secrets | not copied; apps arrive `INACTIVE` and must generate new credentials |
| legacy datetimes | read as Africa/Nairobi wall-clock, stored as UTC |

Claim entries: the legacy `token` trail (`"<token> presenter attendance API …"`) is split into base/presenter/moderator entries when the parts add up to the claim's points; otherwise the claim gets one `legacy` entry with its whole amount. Either way the entries sum to the claim.

## Running it

1. Restore the latest MySQL dump on a staging MySQL server.
2. Point `infra/legacy/pgloader.load` at it and at the **staging** v4 database, then `pgloader infra/legacy/pgloader.load`. This creates a `legacy` schema with lower-cased identifiers.
3. `pnpm --filter @icpd/api db:deploy && pnpm --filter @icpd/api db:seed`
4. `pnpm --filter @icpd/api migrate:legacy --report=reconciliation-report.json`
5. Read the report:
   - `reconciliation.mismatches` must be empty (the command exits 1 otherwise). Each row is a legacy practitioner-year whose total differs.
   - `duplicates`: reg. nos. used by more than one live record. Resolve them in Regulator → Duplicates after go-live, or before by re-running.
   - `warnings`: tables that were missing, and activities skipped because their provider or type was missing.
6. `pnpm --filter @icpd/api cli recompute-compliance --year=<current year>` to fill the compliance cache.

Re-running is safe: rows are matched on `legacyId` and updated, link tables use `NOT EXISTS`, and entries are only built for claims that have none.

## Cut-over plan

1. **T-14 days**: full rehearsal on staging with yesterday's dump; time each step; regulator UAT on staging (sign-in via `/migrate`, portfolio totals for a sample of practitioners, provider workspace, API with a test consumer).
2. **T-7 days**: email providers with API integrations: new base URL, new credentials needed, 4xx status codes instead of 200 + `{error}`.
3. **T-1 day**: announce a read-only window.
4. **Cut-over** (low-traffic evening):
   1. Put the legacy app in maintenance mode; take the final MySQL dump.
   2. Run steps 2–6 above against production; confirm zero mismatches.
   3. Generate API credentials for active provider apps and hand them over.
   4. Switch DNS / reverse proxy to the v4 web and API.
   5. Smoke test: login, `/migrate` with a known account, token claim on a test activity, non-token claim upload, regulator screening list, `/api/v1/verify`.
5. **Rollback**: until the first new claim is accepted, roll back by pointing DNS at the legacy app again (its database was not modified). After that, keep the legacy app read-only for reference.
6. **T+7 days**: review `request_logs`/`api_logs` errors, duplicates list, and failed attendee imports; re-run "re-process pending attendance" for late registrations.
