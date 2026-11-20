import { describe, expect, it } from 'vitest';
import {
  canStillEarn,
  checkTypeCaps,
  claimCalYear,
  computeAward,
  maxActivityPoints,
  NO_ROLE,
  type ActivityPointsInput,
} from './points';

const act = (o: Partial<ActivityPointsInput> = {}): ActivityPointsInput => ({
  basePoints: 2,
  presenterPoints: 3,
  moderatorPoints: 1,
  numSessions: 3,
  expiryDate: '2026-06-30',
  ...o,
});
const presenter = { unawardedPresenter: true, unawardedModerator: false };
const moderator = { unawardedPresenter: false, unawardedModerator: true };
const both = { unawardedPresenter: true, unawardedModerator: true };

describe('maxActivityPoints', () => {
  it('is base × sessions', () => expect(maxActivityPoints(act())).toBe(6));
  it('is base when numSessions ≤ 1', () => {
    expect(maxActivityPoints(act({ numSessions: 1 }))).toBe(2);
    expect(maxActivityPoints(act({ numSessions: 0 }))).toBe(2);
  });
  it('avoids float drift', () => expect(maxActivityPoints(act({ basePoints: 0.1, numSessions: 3 }))).toBe(0.3));
});

describe('canStillEarn', () => {
  it('true with no claim', () => expect(canStillEarn(null, act(), NO_ROLE)).toBe(true));
  it('true below max', () => expect(canStillEarn(4, act(), NO_ROLE)).toBe(true));
  it('false at max without roles', () => expect(canStillEarn(6, act(), NO_ROLE)).toBe(false));
  it('true at max for unawarded presenter below max+bonus', () => expect(canStillEarn(6, act(), presenter)).toBe(true));
  it('false at max+presenter bonus', () => expect(canStillEarn(9, act(), presenter)).toBe(false));
  it('true at max for unawarded moderator below max+bonus', () => expect(canStillEarn(6, act(), moderator)).toBe(true));
  it('false at max+moderator bonus', () => expect(canStillEarn(7, act(), moderator)).toBe(false));
  it('either role suffices', () => expect(canStillEarn(8, act(), both)).toBe(true));
  it('zero-bonus presenter cannot exceed max', () =>
    expect(canStillEarn(6, act({ presenterPoints: 0 }), presenter)).toBe(false));
});

describe('computeAward', () => {
  it('base only', () => {
    const r = computeAward(act(), NO_ROLE, { baseMarker: 'TOK1', includeRoleBonus: true });
    expect(r.total).toBe(2);
    expect(r.parts.map((p) => p.marker)).toEqual(['TOK1']);
    expect(r.markPresenterAwarded).toBe(false);
  });
  it('adds presenter bonus (legacy defect #4)', () => {
    const r = computeAward(act(), presenter, { baseMarker: 'TOK1', includeRoleBonus: true });
    expect(r.total).toBe(5);
    expect(r.parts.map((p) => p.marker)).toEqual(['TOK1', 'presenter']);
    expect(r.markPresenterAwarded).toBe(true);
  });
  it('adds both bonuses', () => {
    const r = computeAward(act(), both, { baseMarker: 'attendance', includeRoleBonus: true });
    expect(r.total).toBe(6);
    expect(r.markModeratorAwarded).toBe(true);
  });
  it('API claims never add role bonuses', () => {
    const r = computeAward(act(), both, { baseMarker: 'API', includeRoleBonus: false });
    expect(r.total).toBe(2);
    expect(r.markPresenterAwarded).toBe(false);
    expect(r.markModeratorAwarded).toBe(false);
  });
  it('marks role awarded even when its bonus is zero', () => {
    const r = computeAward(act({ presenterPoints: 0 }), presenter, { baseMarker: 't', includeRoleBonus: true });
    expect(r.total).toBe(2);
    expect(r.markPresenterAwarded).toBe(true);
  });
});

describe('computeAward caps base at the activity max', () => {
  it('adds only the remaining room', () => {
    const r = computeAward(act(), NO_ROLE, { baseMarker: 't', includeRoleBonus: true, existingPoints: 5 });
    expect(r.total).toBe(1);
  });
  it('awards only the pending bonus once the max is reached', () => {
    const r = computeAward(act(), presenter, { baseMarker: 't', includeRoleBonus: true, existingPoints: 6 });
    expect(r.parts.map((p) => p.kind)).toEqual(['presenter']);
    expect(r.total).toBe(3);
  });
  it('ignores already-awarded bonus points when measuring room', () => {
    const r = computeAward(act(), NO_ROLE, { baseMarker: 't', includeRoleBonus: true, existingPoints: 7, existingBonus: 3 });
    expect(r.total).toBe(2);
  });
  it('API claims at the max award nothing', () => {
    expect(computeAward(act(), presenter, { baseMarker: 'API', includeRoleBonus: false, existingPoints: 6 }).total).toBe(0);
  });
});

describe('claimCalYear', () => {
  it('uses expiry year when in the past', () =>
    expect(claimCalYear({ expiryDate: '2024-12-31' }, new Date('2026-03-01T00:00:00Z'))).toBe(2024));
  it('caps at the current Nairobi year', () =>
    expect(claimCalYear({ expiryDate: '2027-01-10' }, new Date('2026-03-01T00:00:00Z'))).toBe(2026));
  it('uses Nairobi new year (UTC 21:30 on 31 Dec is already next year)', () =>
    expect(claimCalYear({ expiryDate: '2030-01-01' }, new Date('2025-12-31T21:30:00Z'))).toBe(2026));
  it('accepts Date objects for date columns', () =>
    expect(claimCalYear({ expiryDate: new Date('2025-01-01T00:00:00Z') }, new Date('2026-01-05T00:00:00Z'))).toBe(2025));
});

describe('checkTypeCaps', () => {
  it('rejects zero', () => expect(checkTypeCaps({ requestedPoints: 0, yearToDatePointsOfType: 0 }).ok).toBe(false));
  it('no caps passes', () => expect(checkTypeCaps({ requestedPoints: 99, yearToDatePointsOfType: 0 }).ok).toBe(true));
  it('per-claim cap', () => {
    const r = checkTypeCaps({ requestedPoints: 11, maxSessionPoints: 10, yearToDatePointsOfType: 0 });
    expect(r).toEqual({ ok: false, error: 'This activity type allows at most 10 points per claim.' });
  });
  it('uses the larger of session/activity max', () =>
    expect(checkTypeCaps({ requestedPoints: 15, maxSessionPoints: 5, maxActivityPoints: 20, yearToDatePointsOfType: 0 }).ok).toBe(true));
  it('yearly cap', () => {
    const r = checkTypeCaps({ requestedPoints: 6, maxYearlyPoints: 20, yearToDatePointsOfType: 15 });
    expect(r.ok).toBe(false);
    expect(checkTypeCaps({ requestedPoints: 5, maxYearlyPoints: 20, yearToDatePointsOfType: 15 }).ok).toBe(true);
  });
});
