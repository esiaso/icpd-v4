import { execSync } from 'child_process';

/** Fresh test database: reset schema, apply migrations, seed. */
export default async function () {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://icpd:icpd@localhost:55433/icpd_test?schema=public';
  const env = { ...process.env, DATABASE_URL: url };
  execSync('npx prisma migrate reset --force --skip-generate --skip-seed', { env, stdio: 'ignore', cwd: __dirname + '/..' });
  execSync('npx ts-node --transpile-only prisma/seed.ts', { env, stdio: 'ignore', cwd: __dirname + '/..' });
}
