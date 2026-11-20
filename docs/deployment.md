# Deploying ICPD v4 (staging / production)

The repo ships two images and a compose file:

| File | What |
| --- | --- |
| `infra/docker/api.Dockerfile` | NestJS API, Prisma, and `pg_dump` 16 for the weekly backup job. Runs the background workers in-process. |
| `infra/docker/web.Dockerfile` | Next.js standalone server. `API_URL` and `NEXT_PUBLIC_*` are baked in at build time. |
| `infra/docker/compose.prod.yml` | Postgres 16, Redis, a one-shot `migrate` job, `api`, `web`, and an optional `minio` profile. |
| `infra/docker/prod.env.example` | Every setting the stack needs. Copy to `prod.env` (git-ignored). |

## First deployment on a single server

1. Install Docker and the compose plugin. Point the domain at the server and put a TLS reverse proxy in front of port 3100 (Caddy is the shortest: `cpd.example.org { reverse_proxy localhost:3100 }`). Session cookies are `Secure` in production, so the site must be served over HTTPS.
2. `cp infra/docker/prod.env.example infra/docker/prod.env` and fill it in. Generate secrets with `openssl rand -hex 32`. Create the Spaces buckets (`S3_BUCKET`, `BACKUP_BUCKET`) first.
3. Build and start:
   ```bash
   docker compose -f infra/docker/compose.prod.yml --env-file infra/docker/prod.env up -d --build
   ```
   `migrate` applies the database migrations and exits; `api` starts after it.
4. Seed roles, permissions, the screening checklist, reference data and the first Super Admin (once):
   ```bash
   docker compose -f infra/docker/compose.prod.yml --env-file infra/docker/prod.env run --rm api npx ts-node --transpile-only prisma/seed.ts
   ```
   Sign in, change that password, then remove `SEED_ADMIN_PASSWORD` from `prod.env`.
5. Review the seeded activity types (points and caps) and the compliance settings with the regulator.
6. For the legacy data, follow [migration.md](migration.md) against this database before opening the site.

## Updating

```bash
git pull
docker compose -f infra/docker/compose.prod.yml --env-file infra/docker/prod.env up -d --build
```

Migrations run automatically through the `migrate` service on every start.

## Operations

- Health: `GET /api/health` (used by the API container's health check).
- Logs: `docker compose … logs -f api web`. Every request is also stored in `request_logs`.
- Backups: the API dumps the database to `BACKUP_BUCKET` every Sunday at 21:00 Nairobi time and keeps the last 8. Test a restore with `pg_restore` before go-live.
- Maintenance CLI: `docker compose … run --rm api node dist/cli.js recompute-compliance --year=2026` (see the README for other commands).
- Scaling: the API runs the BullMQ workers too. To run more API replicas, set `RUN_WORKERS=false` on all but one.

## Notes

- With the `minio` profile, signed file URLs point at `S3_ENDPOINT`; it must be reachable from users' browsers (give MinIO its own HTTPS hostname). DigitalOcean Spaces needs nothing extra.
- `JWT_ACCESS_SECRET` must be the same for `api` and `web` (the web middleware reads role claims from the access token).
