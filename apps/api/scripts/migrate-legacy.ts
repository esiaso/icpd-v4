/**
 * One-off legacy migration (spec 11). Run against a staging copy first.
 *
 *   1. pgloader infra/legacy/pgloader.load          # MySQL dump → "legacy" schema
 *   2. pnpm --filter @icpd/api db:deploy && pnpm --filter @icpd/api db:seed
 *   3. pnpm --filter @icpd/api migrate:legacy [--schema=legacy] [--report=reconciliation.json]
 *
 * Idempotent: rows are matched on legacyId. Exits 1 if points don't reconcile.
 */
import { writeFileSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { LegacyMigration } from '../src/migration/legacy-migration';

async function main() {
  const flags = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')));
  const prisma = new PrismaClient();
  const started = Date.now();
  try {
    const report = await new LegacyMigration(prisma, console.log, flags.schema ?? 'legacy').run();
    const file = flags.report ?? 'reconciliation-report.json';
    writeFileSync(file, JSON.stringify(report, null, 2));
    console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s. Report: ${file}`);
    console.log(`Duplicates: ${report.duplicates.length}. Warnings: ${report.warnings.length}. Point mismatches: ${report.reconciliation.mismatches.length}.`);
    if (report.reconciliation.mismatches.length) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
