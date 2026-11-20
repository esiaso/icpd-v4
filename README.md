# ICPD v4

Continuing Professional Development platform for medical and dental practitioners in Kenya: a ground-up rewrite of the legacy Laravel/MySQL system (`esiaso/CPD_2021`). The brief is in [docs/spec/ICPD_V4_REBUILD_PROMPT.md](docs/spec/ICPD_V4_REBUILD_PROMPT.md).

| Package | What |
| --- | --- |
| `apps/api` | NestJS 10 REST API, PostgreSQL 16 via Prisma, OpenAPI at `/api/docs` |
| `apps/web` | Next.js 14 App Router, Tailwind, TanStack Query/Table, React Hook Form + Zod |
| `packages/shared` | Zod schemas, enums and the pure domain rules (points engine, compliance engine, reg. no.) |

## Run it locally

```bash
pnpm install
cp .env.example .env && cp .env apps/api/.env
docker compose up -d                       # Postgres :55433, Redis :6380, Mailpit :8026, MinIO :9010/:9011
pnpm --filter @icpd/shared build
pnpm --filter @icpd/api db:deploy && pnpm --filter @icpd/api db:seed
pnpm --filter @icpd/api dev                # http://localhost:4000/api, docs at /api/docs
pnpm --filter @icpd/web dev                # http://localhost:3100
```

The seed creates the roles and permissions from spec section 3, the screening checklist, reference data, sample activity types (review their points before go-live) and a Super Admin from `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. Emails land in Mailpit at http://localhost:8026.

Host ports are offset from the defaults so the stack runs next to other local projects.

## Tests

```bash
pnpm --filter @icpd/shared test            # points + compliance engines, reg. no., helpers (vitest)
pnpm --filter @icpd/api test               # API unit tests (jest)
pnpm --filter @icpd/api test:e2e           # API end-to-end against a fresh icpd_test database
```

The e2e suite resets `icpd_test` (override with `TEST_DATABASE_URL`) and runs with queues and object storage in memory (`DISABLE_QUEUES=true`). CI (`.github/workflows/ci.yml`) runs all of the above and builds the web app.

## Architecture notes

- **Sessions**: Nest issues a 15-minute JWT access token and a rotating refresh token in httpOnly cookies; replaying a used refresh token revokes the whole family. Unsafe cookie-authenticated requests need the `x-csrf-token` header (double-submit cookie). Next.js proxies `/api/*` to Nest so cookies are first-party. The access token carries role/permission claims only so `middleware.ts` can route; the API always reloads them.
- **RBAC** is enforced by a global guard (`@RequirePermissions`, `@RequireRoles`, `@Public`). Every `/providers/:providerId/*` route uses `ProviderMemberGuard` (active membership, or regulator oversight with *Manage Activities*) and checks the activity belongs to that provider.
- **Errors** are always `{ error: { code, message, details } }`; validation errors are 422 with `details.fields`.
- **Points**: one `PointsService` wraps the pure rules in `packages/shared/src/domain/points.ts`. Token claims lock the token row `FOR UPDATE` plus an advisory lock per (practitioner, activity). Every award writes one `cpd_claim_entries` row per part (base / presenter / moderator), classified by activity type and the activity's speciality areas at award time.
- **Compliance** (spec 5.7.2) is pure code in `packages/shared/src/domain/compliance.ts`; `ComplianceService` loads frameworks, evaluates and caches into `compliance_results` after every award, approval, rejection, merge, exemption and rule change, and nightly.
- **Time**: everything is stored in UTC; "today", token expiry and the CPD year use Africa/Nairobi. Date-only values use Postgres `date`.
- **Files** go to S3-compatible storage (MinIO locally) under private keys; clients get short-lived signed URLs. Uploads are checked by type and magic bytes.
- **Jobs** run on BullMQ: queued email (MJML), attendee "process all", compliance recompute, yearly provider reset (1 Jan 00:00), weekly DB backup (Sun 21:00, needs `pg_dump`) and pruning (Sun 15:00), all in Nairobi time.
- **Audit**: state changes write `audit_log` (log names such as `practitioner-application`, `activity-publishing`, `practitioner-excemption`); claims write `practitioner_logs`; API calls write `api_logs`; every request writes `request_logs`.

## Public API v1

Base path `/api/v1`, header `api-consumer: base64(key:secret)`. Field names follow the legacy API; errors use real 4xx codes. Apps are managed under Regulator → API consumer apps (secret shown once, stored as a hash). The council credential is a separate app that can only call `GET /api/v1/council/diary`. `/points` and `/council/diary` now also return `countablePoints`, `compliant` and `buckets[]`.

Maintenance tasks that were public GET routes in the legacy app are admin-only:

```bash
pnpm --filter @icpd/api cli allocate-tokens --date=2026-05-01            # dry run; add --apply
pnpm --filter @icpd/api cli correct-points                               # dry run; add --apply
pnpm --filter @icpd/api cli recompute-compliance --year=2026
```

## Legacy data migration

See [docs/migration.md](docs/migration.md). In short: pgloader the MySQL dump into a `legacy` schema, run `pnpm --filter @icpd/api migrate:legacy`, read `reconciliation-report.json`. The script is idempotent and exits non-zero if any practitioner-year's points differ from the legacy total.

## Decisions and deviations from the brief

- **Public provider directory** is at `/provider-directory` because `/providers` is the coordinator workspace (the brief put both there). Users/roles admin lives under `/regulator/users` and `/regulator/roles`.
- **Base points are capped at the activity maximum.** The legacy rule let a pending presenter/moderator bonus open room for another full base award, which could push an activity past its maximum. Now base points only fill the room left; bonuses are added on top once. API claims (no bonus) at the maximum are refused.
- **Legacy record import** requires the record to share the account email, or the applicant to give the record's national ID. The old flow linked any record by reg. no. alone.
- **Attendee lists**: `.xlsx` and `.csv` are accepted; old binary `.xls` gets a clear "save as .xlsx" message (the only maintained parser for `.xls` has open security advisories).
- **Activity-type caps** (`maxSessionPoints`/`maxActivityPoints` per claim, `maxYearlyPoints` per year) are enforced when officers award non-token claims; switch off under Regulator → Settings → General if the regulator decides otherwise.
- **Quick QR claims enforce token expiry** (legacy didn't); configurable in the same settings page.
- **Approving an application** keeps an existing *Provider Coordinator* role instead of syncing it away.
- **Permanent delete** of a practitioner is only allowed from the trash, after password confirmation, and only for records without CPD history.

### Open assumptions for the regulator (spec 5.7.2)

All three are data, not code: points above a cap are recorded but don't count; an entry tagged with several specialities counts as related for each; overflow between buckets is off unless a bucket's "overflow to" is set.

## Security review checklist

See [docs/security.md](docs/security.md) for how each of the 16 legacy defects is addressed and the remaining go-live items.
