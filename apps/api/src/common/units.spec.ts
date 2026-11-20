import { sanitizeHtml } from '../cms/sanitize';
import { rolesForLegacy } from '../auth/legacy-auth.service';
import { parseConsumerHeader } from '../public-api/api-consumer.guard';
import { generateCredentials } from '../public-api/apps.controller';
import { toCsv } from './files';
import { randomDigits, safeEqualHex, sha256 } from './crypto';
import { tokenStatus } from '../tokens/tokens.service';

describe('sanitizeHtml', () => {
  it('drops scripts, handlers and javascript: links', () => {
    expect(sanitizeHtml('<p onclick="x()">Hi</p><script>alert(1)</script><a href="javascript:x()">y</a><iframe src="x"></iframe>')).toBe('<p>Hi</p><a rel="noopener noreferrer">y</a>');
  });
  it('keeps safe markup', () => {
    expect(sanitizeHtml('<h2>T</h2><a href="https://x.org" target="_blank">x</a>')).toBe('<h2>T</h2><a href="https://x.org" target="_blank" rel="noopener noreferrer">x</a>');
  });
});

describe('legacy roles', () => {
  it.each([[3, ['Practitioner'], false], [4, ['Practitioner'], false], [5, ['Practitioner', 'Provider Coordinator'], false], [10, ['Provider Coordinator'], true], [12, ['Regulator CPD Officer'], true], [null, ['Public User'], false]])('%s', (id, roles, drop) => {
    expect(rolesForLegacy(id as any)).toEqual({ roles, dropPractitioner: drop });
  });
});

describe('api credentials', () => {
  it('key is 21 hex chars, secret the remaining 107 of 128', () => {
    const { key, secret } = generateCredentials();
    expect(key).toMatch(/^[0-9a-f]{21}$/);
    expect(secret).toMatch(/^[0-9a-f]{107}$/);
  });
  it('parses the api-consumer header', () => {
    expect(parseConsumerHeader(Buffer.from('k:s:with:colons').toString('base64'))).toEqual({ key: 'k', secret: 's:with:colons' });
    expect(parseConsumerHeader('not-base64-colonless')).toBeNull();
    expect(parseConsumerHeader(undefined)).toBeNull();
  });
});

describe('crypto helpers', () => {
  it('random digits', () => expect(randomDigits(6)).toMatch(/^\d{6}$/));
  it('constant-time compare', () => {
    expect(safeEqualHex(sha256('a'), sha256('a'))).toBe(true);
    expect(safeEqualHex(sha256('a'), sha256('b'))).toBe(false);
    expect(safeEqualHex('ab', 'abc')).toBe(false);
  });
});

describe('csv export', () => {
  it('escapes and neutralises formulas', () => {
    expect(toCsv([['a,b', '=SUM(A1)', 'x"y']])).toBe('﻿"a,b",\'=SUM(A1),"x""y"');
  });
});

describe('token status', () => {
  it('claimed wins, else expiry decides', () => {
    expect(tokenStatus({ status: 'claimed', expiryDate: new Date('2000-01-01') })).toBe('claimed');
    expect(tokenStatus({ status: 'unclaimed', expiryDate: new Date('2000-01-01') })).toBe('expired');
    expect(tokenStatus({ status: 'unclaimed', expiryDate: new Date('2999-01-01') })).toBe('unclaimed');
  });
});
