import { TIMEZONE } from './enums';

/** Calendar parts of an instant in Africa/Nairobi. */
export function nairobiParts(d: Date = new Date()): { year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const [year, month, day] = fmt.format(d).split('-').map(Number);
  return { year, month, day };
}

/** "Today" in Nairobi as YYYY-MM-DD. */
export function nairobiToday(d: Date = new Date()): string {
  const { year, month, day } = nairobiParts(d);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function nairobiYear(d: Date = new Date()): number {
  return nairobiParts(d).year;
}

/** Date-only value (YYYY-MM-DD) of an instant in Nairobi. */
export function toNairobiDate(d: Date): string {
  return nairobiToday(d);
}

/**
 * Date-only DB columns (Postgres `date`) arrive as UTC-midnight Date objects; read the
 * calendar date from the ISO string, never by shifting into a time zone.
 */
export function dateOnly(d: Date | string): string {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

/** Parse YYYY-MM-DD into a UTC-midnight Date for a `date` column. */
export function parseDateOnly(s: string): Date {
  return new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
}

/** A token/activity is expired when its expiry date is strictly before today in Nairobi. */
export function isExpired(expiryDate: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!expiryDate) return false;
  return dateOnly(expiryDate) < nairobiToday(now);
}
