/**
 * Registration number rules (spec 5.1), driven by user categories.
 * Legacy behaviour: prefix A–G, total length ≤ 8, numeric remainder, A/B need ≥ 2 digits,
 * and for B–G a 3-digit number with a leading 0 is rejected.
 */
export interface RegNoCategoryRule {
  prefixLetter: string;
  /** Minimum count of digits after the prefix. */
  minimumLength: number;
}

export const DEFAULT_REGNO_RULES: RegNoCategoryRule[] = 'ABCDEFG'
  .split('')
  .map((l) => ({ prefixLetter: l, minimumLength: 2 }));

export const REGNO_FORMAT_ERROR = 'Wrong registration number format! (e.g Axxxx or Bxxxx …)';
export const REGNO_EXISTS_ERROR = 'Registration number already exist!';

export function normalizeRegNo(input: string | null | undefined): string {
  return (input ?? '').replace(/\s+/g, '').toUpperCase();
}

export interface RegNoCheck {
  valid: boolean;
  normalized: string;
  error?: string;
}

export function validateRegNo(
  input: string | null | undefined,
  rules: RegNoCategoryRule[] = DEFAULT_REGNO_RULES,
): RegNoCheck {
  const normalized = normalizeRegNo(input);
  const fail = (): RegNoCheck => ({ valid: false, normalized, error: REGNO_FORMAT_ERROR });
  if (normalized.length < 2 || normalized.length > 8) return fail();
  const prefix = normalized[0];
  const rule = rules.find((r) => r.prefixLetter.toUpperCase() === prefix);
  if (!rule) return fail();
  const digits = normalized.slice(1);
  if (!/^\d+$/.test(digits)) return fail();
  const min = Math.max(2, rule.minimumLength);
  if (digits.length < min || digits.length > 9) return fail();
  if (prefix !== 'A' && digits.length === 3 && digits.startsWith('0')) return fail();
  return { valid: true, normalized };
}
