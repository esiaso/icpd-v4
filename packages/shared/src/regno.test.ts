import { describe, expect, it } from 'vitest';
import { normalizeRegNo, validateRegNo, REGNO_FORMAT_ERROR } from './regno';
import { maskEmail, performancePercent } from './format';
import { isExpired, nairobiToday } from './time';

describe('regNo', () => {
  it('strips spaces and upper-cases', () => expect(normalizeRegNo(' a 12 34 ')).toBe('A1234'));
  it.each(['A12', 'A1234', 'B1234567', 'G12', 'A012', 'C0123'])('accepts %s', (r) =>
    expect(validateRegNo(r).valid).toBe(true));
  it.each(['H1234', 'A1', 'A12X', 'A123456789', '1234', '', 'B012', 'G099'])('rejects %s', (r) => {
    const res = validateRegNo(r);
    expect(res.valid).toBe(false);
    expect(res.error).toBe(REGNO_FORMAT_ERROR);
  });
  it('uses configured categories', () => {
    expect(validateRegNo('H123', [{ prefixLetter: 'H', minimumLength: 3 }]).valid).toBe(true);
    expect(validateRegNo('H12', [{ prefixLetter: 'H', minimumLength: 3 }]).valid).toBe(false);
    expect(validateRegNo('A123', [{ prefixLetter: 'H', minimumLength: 3 }]).valid).toBe(false);
  });
});

describe('maskEmail', () => {
  it('keeps half the local part', () => expect(maskEmail('johndoe@x.com')).toBe('joh***@x.com'));
  it('keeps at most 10 chars', () => expect(maskEmail('abcdefghijklmnopqrstuvwxyz@x.com')).toBe('abcdefghij***@x.com'));
  it('hides short local parts', () => expect(maskEmail('abc@x.com')).toBe('***@x.com'));
  it('null for invalid', () => expect(maskEmail(null)).toBeNull());
});

describe('time', () => {
  it('Nairobi today is UTC+3', () => expect(nairobiToday(new Date('2026-01-01T22:00:00Z'))).toBe('2026-01-02'));
  it('expired is strictly before today', () => {
    const now = new Date('2026-05-10T08:00:00Z');
    expect(isExpired('2026-05-09', now)).toBe(true);
    expect(isExpired('2026-05-10', now)).toBe(false);
    expect(isExpired(new Date('2026-05-10T00:00:00Z'), now)).toBe(false);
    expect(isExpired(null, now)).toBe(false);
  });
  it('performance', () => expect(performancePercent(25, 50)).toBe(50));
});
