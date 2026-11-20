# Security review

## Legacy defects (spec section 10)

| # | Defect | Fix | Test |
| --- | --- | --- | --- |
| 1 | SSO callback trusted request input | Authorization-code exchange and profile read from the SSO server; browser-bound `state` cookie checked in constant time | `legacy-auth.e2e-spec.ts` |
| 2 | Plain-text API secrets, middleware `exit` | Secrets stored as SHA-256 hashes (128-bit+ random), constant-time compare, Nest guard with 401/403, ACTIVE apps only, provider from the app | `public-api.e2e-spec.ts` |
| 3 | SHA-1 passwords, hard-coded `1234567890` | bcrypt (cost 12); legacy hashes only in `legacy_credentials`, cleared on first use; the default hash is never migrated | `legacy-auth`, `legacy-migration` |
| 4 | Presenter bonus lost on existing claims | One points engine adds bonuses on every path | `claims.e2e-spec.ts`, `points.test.ts` |
| 5 | `user_exist` always true | Real existence checks (`findFirst`) | registration tests |
| 6 | Broken public QR claim | Rewritten; token must belong to the linked activity | `claims.e2e-spec.ts` |
| 7 | `mt_rand` tokens, no uniqueness | `crypto.randomInt`, unique index + retry, batches of 30 | `activities.e2e-spec.ts` |
| 8 | Token claim race | Transaction, `SELECT … FOR UPDATE` on the token, advisory lock per (practitioner, activity), unique token on claim entries | concurrent-claim test |
| 9 | SQL injection in `checkIfInternshipClaimed`, wrong scope | Prisma parameters; scoped to `once` types | `claims.e2e-spec.ts` |
| 10 | Evidence not saved on edit | File stored before the update | `claims.e2e-spec.ts` |
| 11 | Chairman review looked up a missing column | Stored on the current verification | `registration.e2e-spec.ts` |
| 12 | State-changing GET routes | All writes are POST/PUT/PATCH/DELETE | publish test asserts GET → 404 |
| 13 | Missing ownership checks | `/me/*` only reads the caller's practitioner; `ProviderMemberGuard` everywhere | defect #13 tests |
| 14 | Stale seeders | Only section 3 roles/permissions seeded | `auth.e2e-spec.ts` |
| 15 | Duplicate models per table | One Prisma model per table | n/a |
| 16 | Hard-coded 50 points | Compliance frameworks; default 50 from `CPD_ANNUAL_REQUIREMENT` | `compliance.e2e-spec.ts` |

## Other controls in place

- Helmet, CORS allow-list (`CORS_ORIGINS`), CSRF double-submit for cookie sessions, `SameSite=Lax` httpOnly cookies (`Secure` in production).
- Rate limits: global 300/min per IP; login/register 10/min; resend verification and forgot password 6/min; quick claim 10/min; API v1 120/min per consumer key (claimpoints 600/min).
- Refresh-token rotation with reuse detection; password reset revokes all sessions.
- Password confirmation (3 h) before deleting users, permanently deleting practitioners and rotating API credentials.
- Honeypot + reCAPTCHA (when `RECAPTCHA_SECRET` is set) on register, forgot password and contact.
- CMS HTML sanitised on save; CSV exports neutralise spreadsheet formulas.
- Uploads: size limits, MIME and magic-byte checks; private object keys with signed URLs.
- Every login attempt in `auth_logs`; new-device email.

## Before go-live

- Set strong `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (same access secret in the web app for middleware), `NODE_ENV=production`, real `CORS_ORIGINS`, `RECAPTCHA_*`, `MAIL_*`, `S3_*`, `SSO_*`.
- Change the seeded Super Admin password and email.
- Put `pg_dump` on the API image for the weekly backup job, and test a restore.
- Run `pnpm audit` and a dependency update pass; run an external penetration test against staging.
- Confirm the regulator's answers on the open compliance assumptions and on activity-type caps.
