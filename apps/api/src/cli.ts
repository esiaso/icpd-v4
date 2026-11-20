/**
 * Admin CLI for maintenance tasks that the legacy app exposed as public GET routes.
 *   pnpm cli allocate-tokens [--date=YYYY-MM-DD] [--apply]
 *   pnpm cli correct-points [--apply]
 *   pnpm cli recompute-compliance [--year=YYYY]
 *   pnpm cli providers-yearly-reset
 * Without --apply the token/points tasks are a dry run.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { nairobiYear } from '@icpd/shared';
import { AppModule } from './app.module';
import { MaintenanceTasks } from './public-api/maintenance';
import { ComplianceService } from './compliance/compliance.service';
import { ProvidersService } from './providers/providers.service';

process.env.RUN_WORKERS = 'false';

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const flags = Object.fromEntries(rest.map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? 'true']));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const apply = flags.apply === 'true';
  let out: unknown;
  switch (cmd) {
    case 'allocate-tokens':
      out = await app.get(MaintenanceTasks).allocateTokens(flags.date, !apply);
      break;
    case 'correct-points':
      out = await app.get(MaintenanceTasks).correctZeroPoints(!apply);
      break;
    case 'recompute-compliance':
      out = await app.get(ComplianceService, { strict: false }).recomputeAll(flags.year ? Number(flags.year) : nairobiYear());
      break;
    case 'providers-yearly-reset':
      out = await app.get(ProvidersService, { strict: false }).yearlyReset();
      break;
    default:
      console.log('Commands: allocate-tokens, correct-points, recompute-compliance, providers-yearly-reset');
  }
  if (out) console.log(JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  await app.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
