/**
 * Compliance rules engine (spec 5.7.2). Pure functions only: no I/O, no clock.
 *
 * Assumptions (pending regulator confirmation, all switchable by data):
 * - Points above a cap are recorded in the diary but are not countable.
 * - An entry tagged with several specialities is "related" for each of them.
 * - Overflow from a bucket to another only happens when `allowOverflowTo` is set (off by default).
 */
import { round2 } from '../format';
import type { BucketSource } from '../enums';

export interface ComplianceEntry {
  id: string | number;
  activityTypeId: number;
  specialityIds: number[];
  points: number;
  /** ISO date/time used to allocate caps first-come-first-served. */
  date: string;
}

export interface ComplianceBucket {
  id: number;
  name: string;
  source: BucketSource;
  minPoints: number;
  maxCountablePoints: number | null;
  minDistinctActivityTypes: number;
  maxPointsPerActivityType: number | null;
  allowOverflowTo: number | null;
  sortOrder: number;
}

export interface ComplianceTypeCap {
  /** null = applies across the whole framework. */
  bucketId: number | null;
  activityTypeId: number;
  maxPoints: number;
  minPoints: number | null;
}

export interface ComplianceFramework {
  id: number | null;
  name: string;
  scope: 'speciality' | 'category' | 'default';
  specialityId: number | null;
  userCategoryId: number | null;
  totalRequiredPoints: number;
  cpdYearFrom: number;
  cpdYearTo: number | null;
  active: boolean;
  buckets: ComplianceBucket[];
  typeCaps: ComplianceTypeCap[];
}

export interface EntryAllocation {
  entryId: string | number;
  activityTypeId: number;
  bucketId: number;
  rawPoints: number;
  countablePoints: number;
  /** Portion counted in another bucket via overflow. */
  overflowBucketId: number | null;
  overflowPoints: number;
  /** Points recorded but not countable ("above cap"). */
  aboveCapPoints: number;
}

export interface BucketResult {
  bucketId: number;
  name: string;
  source: BucketSource;
  rawPoints: number;
  points: number;
  required: number;
  distinctTypes: number;
  requiredDistinctTypes: number;
  passed: boolean;
  byType: { activityTypeId: number; rawPoints: number; countablePoints: number }[];
  message: string;
}

export interface ComplianceEvaluation {
  frameworkId: number | null;
  frameworkName: string;
  rawPoints: number;
  countablePoints: number;
  totalRequired: number;
  compliant: boolean;
  exempted: boolean;
  buckets: BucketResult[];
  allocations: EntryAllocation[];
  reasons: string[];
}

export const IMPLICIT_BUCKET_ID = 0;

export function defaultFramework(totalRequiredPoints: number, year: number): ComplianceFramework {
  return {
    id: null,
    name: 'Default',
    scope: 'default',
    specialityId: null,
    userCategoryId: null,
    totalRequiredPoints,
    cpdYearFrom: year,
    cpdYearTo: null,
    active: true,
    buckets: [],
    typeCaps: [],
  };
}

function appliesToYear(f: ComplianceFramework, year: number): boolean {
  return f.active && f.cpdYearFrom <= year && (f.cpdYearTo === null || f.cpdYearTo >= year);
}

function strictness(f: ComplianceFramework): [number, number, number] {
  const bucketMin = f.buckets.reduce((s, b) => s + b.minPoints, 0);
  const types = f.buckets.reduce((s, b) => s + b.minDistinctActivityTypes, 0);
  return [f.totalRequiredPoints, bucketMin, types];
}

export interface PractitionerProfileForCompliance {
  primarySpecialityId: number | null;
  specialityIds: number[];
  userCategoryId: number | null;
}

/**
 * Step 1: pick the framework. Speciality framework (primary, or the strictest of all the
 * practitioner's specialities), else user-category framework, else the default framework.
 * When several frameworks of the same scope/target match a year, the latest cpdYearFrom wins.
 */
export function pickFramework(
  frameworks: ComplianceFramework[],
  p: PractitionerProfileForCompliance,
  year: number,
  opts: { multiSpecialityMode: 'primary' | 'strictest'; defaultRequired: number },
): ComplianceFramework {
  const live = frameworks
    .filter((f) => appliesToYear(f, year))
    .sort((a, b) => b.cpdYearFrom - a.cpdYearFrom);
  const forSpeciality = (sid: number) =>
    live.find((f) => f.scope === 'speciality' && f.specialityId === sid);

  if (opts.multiSpecialityMode === 'primary') {
    if (p.primarySpecialityId !== null) {
      const f = forSpeciality(p.primarySpecialityId);
      if (f) return f;
    }
  } else {
    const ids = new Set<number>(p.specialityIds);
    if (p.primarySpecialityId !== null) ids.add(p.primarySpecialityId);
    const candidates = [...ids].map(forSpeciality).filter((f): f is ComplianceFramework => !!f);
    if (candidates.length) {
      return candidates.sort((a, b) => {
        const sa = strictness(a);
        const sb = strictness(b);
        for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i];
        return (a.id ?? 0) - (b.id ?? 0);
      })[0];
    }
  }
  if (p.userCategoryId !== null) {
    const f = live.find((x) => x.scope === 'category' && x.userCategoryId === p.userCategoryId);
    if (f) return f;
  }
  const d = live.find((x) => x.scope === 'default');
  return d ?? defaultFramework(opts.defaultRequired, year);
}

function bucketsOf(f: ComplianceFramework): ComplianceBucket[] {
  if (f.buckets.length) return [...f.buckets].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  return [
    {
      id: IMPLICIT_BUCKET_ID,
      name: 'All activities',
      source: 'any',
      minPoints: 0,
      maxCountablePoints: null,
      minDistinctActivityTypes: 0,
      maxPointsPerActivityType: null,
      allowOverflowTo: null,
      sortOrder: 0,
    },
  ];
}

/** Step 2: classify an entry to the first bucket (by sortOrder) whose source matches. */
export function classifyEntry(
  f: ComplianceFramework,
  e: Pick<ComplianceEntry, 'specialityIds'>,
): ComplianceBucket | null {
  const related = f.specialityId !== null && e.specialityIds.includes(f.specialityId);
  for (const b of bucketsOf(f)) {
    if (b.source === 'any') return b;
    if (b.source === 'speciality_related' && related) return b;
    if (b.source === 'other' && !related) return b;
  }
  return null;
}

/** Effective cap for (bucket, type): the tighter of the bucket rule and a matching type cap. */
function typeCapFor(f: ComplianceFramework, b: ComplianceBucket, typeId: number): number | null {
  const caps: number[] = [];
  if (b.maxPointsPerActivityType !== null) caps.push(b.maxPointsPerActivityType);
  for (const c of f.typeCaps) {
    if (c.activityTypeId === typeId && c.bucketId === b.id) caps.push(c.maxPoints);
  }
  return caps.length ? Math.min(...caps) : null;
}

function frameworkTypeCap(f: ComplianceFramework, typeId: number): number | null {
  const caps = f.typeCaps.filter((c) => c.bucketId === null && c.activityTypeId === typeId);
  return caps.length ? Math.min(...caps.map((c) => c.maxPoints)) : null;
}

type TypeNames = Record<number, string>;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/**
 * Steps 2-6: classify, cap, overflow, check buckets, decide, explain.
 * `exempted` overrides everything for the year (compliant = true).
 */
export function evaluateCompliance(
  f: ComplianceFramework,
  entries: ComplianceEntry[],
  opts: { exempted?: boolean; typeNames?: TypeNames } = {},
): ComplianceEvaluation {
  const names = opts.typeNames ?? {};
  const typeName = (id: number) => names[id] ?? `activity type #${id}`;
  const buckets = bucketsOf(f);
  const bucketById = new Map(buckets.map((b) => [b.id, b]));
  const sorted = [...entries].sort(
    (a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)),
  );

  // Running usage: per (bucket,type), per bucket, and framework-wide per type.
  const usedBucketType = new Map<string, number>();
  const usedBucket = new Map<number, number>();
  const usedFrameworkType = new Map<number, number>();
  const rawBucket = new Map<number, number>();
  const rawBucketType = new Map<string, number>();
  const countBucketType = new Map<string, number>();
  const key = (b: number, t: number) => `${b}:${t}`;
  const add = <K>(m: Map<K, number>, k: K, v: number) => m.set(k, round2((m.get(k) ?? 0) + v));

  /** How much of `amount` can count in bucket b for type t, given all caps. */
  const room = (b: ComplianceBucket, t: number, amount: number): number => {
    let r = amount;
    const tc = typeCapFor(f, b, t);
    if (tc !== null) r = Math.min(r, tc - (usedBucketType.get(key(b.id, t)) ?? 0));
    const fc = frameworkTypeCap(f, t);
    if (fc !== null) r = Math.min(r, fc - (usedFrameworkType.get(t) ?? 0));
    return Math.max(0, round2(r));
  };
  const bucketRoom = (b: ComplianceBucket, amount: number): number => {
    if (b.maxCountablePoints === null) return amount;
    return Math.max(0, round2(Math.min(amount, b.maxCountablePoints - (usedBucket.get(b.id) ?? 0))));
  };
  const consume = (b: ComplianceBucket, t: number, pts: number) => {
    add(usedBucketType, key(b.id, t), pts);
    add(usedBucket, b.id, pts);
    add(usedFrameworkType, t, pts);
    add(countBucketType, key(b.id, t), pts);
  };

  const allocations: EntryAllocation[] = [];
  const unclassified: ComplianceEntry[] = [];

  for (const e of sorted) {
    const b = classifyEntry(f, e);
    if (!b) {
      unclassified.push(e);
      continue;
    }
    const pts = round2(e.points);
    add(rawBucket, b.id, pts);
    add(rawBucketType, key(b.id, e.activityTypeId), pts);

    // Step 3a: per-type caps; above-cap points never count and do not overflow.
    const typeAllowed = room(b, e.activityTypeId, pts);
    // Step 3b: bucket maxCountablePoints; the excess may overflow.
    const inBucket = bucketRoom(b, typeAllowed);
    consume(b, e.activityTypeId, inBucket);
    let overflowBucketId: number | null = null;
    let overflowPoints = 0;
    const excess = round2(typeAllowed - inBucket);
    if (excess > 0 && b.allowOverflowTo !== null) {
      const target = bucketById.get(b.allowOverflowTo);
      if (target && target.id !== b.id) {
        const ok = bucketRoom(target, room(target, e.activityTypeId, excess));
        if (ok > 0) {
          consume(target, e.activityTypeId, ok);
          overflowBucketId = target.id;
          overflowPoints = ok;
        }
      }
    }
    allocations.push({
      entryId: e.id,
      activityTypeId: e.activityTypeId,
      bucketId: b.id,
      rawPoints: pts,
      countablePoints: round2(inBucket + overflowPoints),
      overflowBucketId,
      overflowPoints,
      aboveCapPoints: round2(pts - inBucket - overflowPoints),
    });
  }

  // Step 4: check each bucket.
  const reasons: string[] = [];
  const results: BucketResult[] = buckets.map((b) => {
    const typeIds = new Set<number>();
    for (const k of [...rawBucketType.keys(), ...countBucketType.keys()]) {
      const [bid, tid] = k.split(':').map(Number);
      if (bid === b.id) typeIds.add(tid);
    }
    const byType = [...typeIds]
      .map((t) => ({
        activityTypeId: t,
        rawPoints: rawBucketType.get(key(b.id, t)) ?? 0,
        countablePoints: countBucketType.get(key(b.id, t)) ?? 0,
      }))
      .sort((x, y) => y.countablePoints - x.countablePoints || x.activityTypeId - y.activityTypeId);
    const points = usedBucket.get(b.id) ?? 0;
    const counted = byType.filter((t) => t.countablePoints > 0);
    const distinctTypes = counted.length;
    const problems: string[] = [];
    if (points < b.minPoints) problems.push(`add ${fmt(round2(b.minPoints - points))} more`);
    if (distinctTypes < b.minDistinctActivityTypes) {
      const need = b.minDistinctActivityTypes - distinctTypes;
      if (distinctTypes === 1) {
        problems.push(
          `All of them are from ${typeName(counted[0].activityTypeId)}; add at least ${need === 1 ? 'one other activity type' : `${need} other activity types`}`,
        );
      } else {
        problems.push(`add points from at least ${plural(need, 'more activity type')}`);
      }
    }
    for (const c of f.typeCaps.filter((c) => c.bucketId === b.id && c.minPoints !== null)) {
      const got = countBucketType.get(key(b.id, c.activityTypeId)) ?? 0;
      if (got < (c.minPoints as number)) {
        problems.push(`needs at least ${fmt(c.minPoints as number)} points from ${typeName(c.activityTypeId)} (has ${fmt(got)})`);
      }
    }
    const capped = byType.filter((t) => t.rawPoints > t.countablePoints);
    const passed = problems.length === 0;
    let message = `${b.name}: ${fmt(points)} of ${fmt(b.minPoints)} points`;
    message += passed ? ', complete.' : `, ${problems.join('. ')}.`;
    if (capped.length) {
      message += ` ${capped
        .map((t) => `${fmt(round2(t.rawPoints - t.countablePoints))} ${typeName(t.activityTypeId)} points are above the cap and don't count`)
        .join('; ')}.`;
    }
    if (!passed) reasons.push(message);
    return {
      bucketId: b.id,
      name: b.name,
      source: b.source,
      rawPoints: rawBucket.get(b.id) ?? 0,
      points,
      required: b.minPoints,
      distinctTypes,
      requiredDistinctTypes: b.minDistinctActivityTypes,
      passed,
      byType,
      message,
    };
  });

  // Framework-wide minimums for type caps without a bucket.
  for (const c of f.typeCaps.filter((c) => c.bucketId === null && c.minPoints !== null)) {
    const got = usedFrameworkType.get(c.activityTypeId) ?? 0;
    if (got < (c.minPoints as number)) {
      reasons.push(`At least ${fmt(c.minPoints as number)} points from ${typeName(c.activityTypeId)} are required (has ${fmt(got)}).`);
    }
  }

  const rawPoints = round2(entries.reduce((s, e) => s + e.points, 0));
  const countablePoints = round2(allocations.reduce((s, a) => s + a.countablePoints, 0));
  if (countablePoints < f.totalRequiredPoints) {
    reasons.unshift(
      `Total: ${fmt(countablePoints)} of ${fmt(f.totalRequiredPoints)} countable points, add ${fmt(round2(f.totalRequiredPoints - countablePoints))} more.`,
    );
  }
  if (unclassified.length) {
    reasons.push(`${plural(unclassified.length, 'entry')} did not match any bucket and do not count.`);
  }
  const passedAll = reasons.length === 0;
  const exempted = !!opts.exempted;
  return {
    frameworkId: f.id,
    frameworkName: f.name,
    rawPoints,
    countablePoints,
    totalRequired: f.totalRequiredPoints,
    compliant: exempted || passedAll,
    exempted,
    buckets: f.buckets.length ? results : [],
    allocations,
    reasons: exempted ? [] : reasons,
  };
}

/** Points grouped by activity type (spec 5.7.1). */
export interface TypeSummaryRow {
  activityTypeId: number;
  claims: number;
  rawPoints: number;
  countablePoints: number;
  share: number;
}

export function summarizeByType(
  entries: Pick<ComplianceEntry, 'id' | 'activityTypeId' | 'points'>[],
  allocations: EntryAllocation[],
  claimIdOf: (entryId: string | number) => string | number = (id) => id,
): TypeSummaryRow[] {
  const total = entries.reduce((s, e) => s + e.points, 0);
  const alloc = new Map(allocations.map((a) => [a.entryId, a]));
  const rows = new Map<number, { claims: Set<string | number>; raw: number; countable: number }>();
  for (const e of entries) {
    const r = rows.get(e.activityTypeId) ?? { claims: new Set(), raw: 0, countable: 0 };
    r.claims.add(claimIdOf(e.id));
    r.raw = round2(r.raw + e.points);
    r.countable = round2(r.countable + (alloc.get(e.id)?.countablePoints ?? 0));
    rows.set(e.activityTypeId, r);
  }
  return [...rows.entries()]
    .map(([activityTypeId, r]) => ({
      activityTypeId,
      claims: r.claims.size,
      rawPoints: r.raw,
      countablePoints: r.countable,
      share: total > 0 ? round2((r.raw / total) * 100) : 0,
    }))
    .sort((a, b) => b.rawPoints - a.rawPoints);
}

/**
 * Claim-time warning (spec 5.7.2 "When claiming"): would these points be above a cap?
 * Returns a human message or null.
 */
export function previewCapWarning(
  f: ComplianceFramework,
  existing: ComplianceEntry[],
  candidate: ComplianceEntry,
  typeNames: TypeNames = {},
): string | null {
  const before = evaluateCompliance(f, existing, { typeNames });
  const after = evaluateCompliance(f, [...existing, candidate], { typeNames });
  const gained = round2(after.countablePoints - before.countablePoints);
  const lost = round2(candidate.points - gained);
  if (lost <= 0) return null;
  const b = classifyEntry(f, candidate);
  const tn = typeNames[candidate.activityTypeId] ?? 'this activity type';
  const already = b
    ? before.buckets.find((x) => x.bucketId === b.id)?.byType.find((t) => t.activityTypeId === candidate.activityTypeId)?.countablePoints ?? 0
    : 0;
  const where = b && f.buckets.length ? ` in ${b.name}` : '';
  if (gained <= 0) {
    return `You already have ${fmt(already)} ${tn} points${where}; these points will be recorded but won't count towards compliance.`;
  }
  return `You already have ${fmt(already)} ${tn} points${where}; only ${fmt(gained)} of these ${fmt(candidate.points)} points will count towards compliance.`;
}
