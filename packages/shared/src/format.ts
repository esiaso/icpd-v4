/** Email masking for /verify (spec 7). */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email || !email.includes('@')) return null;
  const [local, domain] = email.split('@');
  const keep = Math.min(Math.floor(local.length / 2), 10);
  const shown = local.length > 3 ? local.slice(0, keep) : '';
  return `${shown}***@${domain}`;
}

/** Points are numeric(8,2): round to 2 dp to avoid float drift in JS arithmetic. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function performancePercent(points: number, required: number): number {
  if (required <= 0) return 100;
  return round2((points / required) * 100);
}
