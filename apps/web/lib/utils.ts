import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtDate(d: string | Date | null | undefined, withTime = false) {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d) : d;
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: d && typeof d === 'string' && d.length === 10 ? 'UTC' : 'Africa/Nairobi',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

export function pts(v: string | number | null | undefined) {
  const n = Number(v ?? 0);
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function fullName(p: { firstName?: string | null; otherNames?: string | null; lastName?: string | null }) {
  return [p.firstName, p.otherNames, p.lastName].filter(Boolean).join(' ');
}
