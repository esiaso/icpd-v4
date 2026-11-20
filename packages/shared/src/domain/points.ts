import { round2 } from '../format';
import { dateOnly, nairobiYear } from '../time';

/** Snapshot of what the points engine needs to know about an activity (spec 5.6). */
export interface ActivityPointsInput {
  /** A.type.cpdPoints: points per session. */
  basePoints: number;
  presenterPoints: number;
  moderatorPoints: number;
  numSessions: number;
  expiryDate: Date | string;
}

export interface RoleState {
  /** P's regNo is a presenter on A with pointsAwarded = false. */
  unawardedPresenter: boolean;
  unawardedModerator: boolean;
}

export const NO_ROLE: RoleState = { unawardedPresenter: false, unawardedModerator: false };

export function maxActivityPoints(a: ActivityPointsInput): number {
  return a.numSessions <= 1 ? round2(a.basePoints) : round2(a.basePoints * a.numSessions);
}

export function presenterBonus(a: ActivityPointsInput, r: RoleState): number {
  return r.unawardedPresenter ? round2(a.presenterPoints) : 0;
}

export function moderatorBonus(a: ActivityPointsInput, r: RoleState): number {
  return r.unawardedModerator ? round2(a.moderatorPoints) : 0;
}

/** calYear = min(currentYear, year(A.expiryDate)); current year in Nairobi. */
export function claimCalYear(a: Pick<ActivityPointsInput, 'expiryDate'>, now: Date = new Date()): number {
  const expYear = Number(dateOnly(a.expiryDate).slice(0, 4));
  return Math.min(nairobiYear(now), expYear);
}

/**
 * canStillEarn(P, A): true if no claim yet, or claim.points < max, or (unawarded presenter and
 * claim.points < max + presenterBonus), or (unawarded moderator and claim.points < max + moderatorBonus).
 */
export function canStillEarn(
  existingPoints: number | null | undefined,
  a: ActivityPointsInput,
  r: RoleState,
): boolean {
  if (existingPoints === null || existingPoints === undefined) return true;
  const max = maxActivityPoints(a);
  if (existingPoints < max) return true;
  if (r.unawardedPresenter && existingPoints < max + presenterBonus(a, r)) return true;
  if (r.unawardedModerator && existingPoints < max + moderatorBonus(a, r)) return true;
  return false;
}

export interface AwardPart {
  kind: 'base' | 'presenter' | 'moderator';
  points: number;
  marker: string;
}

export interface AwardComputation {
  total: number;
  parts: AwardPart[];
  markPresenterAwarded: boolean;
  markModeratorAwarded: boolean;
}

/**
 * Points to add for one award event. Token and attendance claims include role bonuses;
 * API claims do not (spec 5.6). Fixes legacy defect #4: bonuses are always part of the total.
 */
export function computeAward(
  a: ActivityPointsInput,
  r: RoleState,
  opts: { baseMarker: string; includeRoleBonus: boolean },
): AwardComputation {
  const parts: AwardPart[] = [{ kind: 'base', points: round2(a.basePoints), marker: opts.baseMarker }];
  let markPresenterAwarded = false;
  let markModeratorAwarded = false;
  if (opts.includeRoleBonus) {
    if (r.unawardedPresenter) {
      markPresenterAwarded = true;
      const pb = presenterBonus(a, r);
      if (pb > 0) parts.push({ kind: 'presenter', points: pb, marker: 'presenter' });
    }
    if (r.unawardedModerator) {
      markModeratorAwarded = true;
      const mb = moderatorBonus(a, r);
      if (mb > 0) parts.push({ kind: 'moderator', points: mb, marker: 'moderator' });
    }
  }
  return {
    total: round2(parts.reduce((s, p) => s + p.points, 0)),
    parts,
    markPresenterAwarded,
    markModeratorAwarded,
  };
}

/** Activity-type caps on regulator-entered (non-token) awards (spec 5.6 "Improve"). */
export interface TypeCapCheckInput {
  requestedPoints: number;
  maxSessionPoints?: number | null;
  maxActivityPoints?: number | null;
  maxYearlyPoints?: number | null;
  /** Points of this type already awarded to P in the same calendar year. */
  yearToDatePointsOfType: number;
}

export function checkTypeCaps(i: TypeCapCheckInput): { ok: true } | { ok: false; error: string } {
  if (!(i.requestedPoints > 0)) return { ok: false, error: 'Points must be greater than zero.' };
  const perClaimCap = [i.maxSessionPoints, i.maxActivityPoints]
    .filter((v): v is number => v !== null && v !== undefined && v > 0)
    .reduce((m, v) => Math.max(m, v), 0);
  if (perClaimCap > 0 && i.requestedPoints > perClaimCap) {
    return { ok: false, error: `This activity type allows at most ${perClaimCap} points per claim.` };
  }
  if (i.maxYearlyPoints && i.maxYearlyPoints > 0) {
    const remaining = round2(i.maxYearlyPoints - i.yearToDatePointsOfType);
    if (i.requestedPoints > remaining) {
      return {
        ok: false,
        error: `This activity type allows at most ${i.maxYearlyPoints} points per year; ${Math.max(0, remaining)} remaining.`,
      };
    }
  }
  return { ok: true };
}
