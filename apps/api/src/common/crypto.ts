import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('hex');

/** n random decimal digits from a CSPRNG (legacy used mt_rand; defect #7). */
export function randomDigits(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += randomInt(0, 10).toString();
  return s;
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');
