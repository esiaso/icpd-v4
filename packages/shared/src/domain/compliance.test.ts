import { describe, expect, it } from 'vitest';
import {
  classifyEntry,
  defaultFramework,
  evaluateCompliance,
  pickFramework,
  previewCapWarning,
  summarizeByType,
  type ComplianceBucket,
  type ComplianceEntry,
  type ComplianceFramework,
} from './compliance';

const UROLOGY = 7;
const CONF = 1;
const WORKSHOP = 2;
const JOURNAL = 3;
const names = { [CONF]: 'Conferences', [WORKSHOP]: 'Workshops', [JOURNAL]: 'Journal clubs' };

const bucket = (o: Partial<ComplianceBucket> & Pick<ComplianceBucket, 'id' | 'name' | 'source'>): ComplianceBucket => ({
  minPoints: 0,
  maxCountablePoints: null,
  minDistinctActivityTypes: 1,
  maxPointsPerActivityType: null,
  allowOverflowTo: null,
  sortOrder: o.id,
  ...o,
});

const urology = (o: Partial<ComplianceFramework> = {}): ComplianceFramework => ({
  id: 10,
  name: 'Urologists',
  scope: 'speciality',
  specialityId: UROLOGY,
  userCategoryId: null,
  totalRequiredPoints: 50,
  cpdYearFrom: 2026,
  cpdYearTo: null,
  active: true,
  buckets: [
    bucket({ id: 1, name: 'Urology-related', source: 'speciality_related', minPoints: 30, minDistinctActivityTypes: 2, maxPointsPerActivityType: 20 }),
    bucket({ id: 2, name: 'Other areas', source: 'other', minPoints: 20, minDistinctActivityTypes: 2, maxPointsPerActivityType: 15 }),
  ],
  typeCaps: [],
  ...o,
});

let seq = 0;
const e = (type: number, points: number, specs: number[] = [], date = '2026-02-01'): ComplianceEntry => ({
  id: ++seq,
  activityTypeId: type,
  specialityIds: specs,
  points,
  date,
});

describe('default framework (legacy behaviour)', () => {
  const f = defaultFramework(50, 2026);
  it('compliant at 50', () => {
    const r = evaluateCompliance(f, [e(CONF, 30), e(WORKSHOP, 20)]);
    expect(r.compliant).toBe(true);
    expect(r.countablePoints).toBe(50);
    expect(r.buckets).toEqual([]);
  });
  it('not compliant below 50 with a reason', () => {
    const r = evaluateCompliance(f, [e(CONF, 49.5)]);
    expect(r.compliant).toBe(false);
    expect(r.reasons[0]).toBe('Total: 49.50 of 50 countable points, add 0.50 more.');
  });
  it('exemption overrides', () => {
    const r = evaluateCompliance(f, [e(CONF, 3)], { exempted: true });
    expect(r.compliant).toBe(true);
    expect(r.reasons).toEqual([]);
  });
  it('a single type may supply everything when there are no buckets', () =>
    expect(evaluateCompliance(f, [e(CONF, 60)]).countablePoints).toBe(60));
});

describe('classification', () => {
  const f = urology();
  it('tagged entries are related', () => expect(classifyEntry(f, { specialityIds: [UROLOGY] })?.id).toBe(1));
  it('multi-speciality entries count as related for each speciality', () =>
    expect(classifyEntry(f, { specialityIds: [3, UROLOGY] })?.id).toBe(1));
  it('untagged entries are other', () => expect(classifyEntry(f, { specialityIds: [] })?.id).toBe(2));
  it('returns null when no bucket matches', () => {
    const only = urology({ buckets: [bucket({ id: 1, name: 'U', source: 'speciality_related' })] });
    expect(classifyEntry(only, { specialityIds: [] })).toBeNull();
  });
});

describe('urology example from spec 5.7.2', () => {
  it('fully compliant', () => {
    const r = evaluateCompliance(urology(), [
      e(CONF, 20, [UROLOGY]),
      e(WORKSHOP, 10, [UROLOGY]),
      e(CONF, 10),
      e(JOURNAL, 10),
    ], { typeNames: names });
    expect(r.compliant).toBe(true);
    expect(r.buckets.map((b) => b.message)).toEqual([
      'Urology-related: 30 of 30 points, complete.',
      'Other areas: 20 of 20 points, complete.',
    ]);
  });

  it('explains a shortfall with a single activity type', () => {
    const r = evaluateCompliance(urology({ buckets: [
      bucket({ id: 1, name: 'Urology-related', source: 'speciality_related', minPoints: 30, minDistinctActivityTypes: 2, maxPointsPerActivityType: 30 }),
      bucket({ id: 2, name: 'Other areas', source: 'other', minPoints: 20, minDistinctActivityTypes: 2, maxPointsPerActivityType: 15 }),
    ] }), [
      e(CONF, 24, [UROLOGY]),
      e(CONF, 10),
      e(JOURNAL, 10),
    ], { typeNames: names });
    expect(r.compliant).toBe(false);
    expect(r.buckets[0].message).toBe(
      'Urology-related: 24 of 30 points, add 6 more. All of them are from Conferences; add at least one other activity type.',
    );
    expect(r.buckets[1].message).toBe('Other areas: 20 of 20 points, complete.');
    expect(r.reasons).toContain(r.buckets[0].message);
  });

  it('points above the per-type cap are recorded but not countable', () => {
    const r = evaluateCompliance(urology(), [
      e(CONF, 25, [UROLOGY], '2026-01-01'),
      e(WORKSHOP, 10, [UROLOGY], '2026-01-02'),
      e(CONF, 10),
      e(JOURNAL, 10),
    ], { typeNames: names });
    expect(r.rawPoints).toBe(55);
    expect(r.countablePoints).toBe(50);
    const conf = r.allocations.find((a) => a.rawPoints === 25)!;
    expect(conf.countablePoints).toBe(20);
    expect(conf.aboveCapPoints).toBe(5);
    expect(r.buckets[0].message).toContain('5 Conferences points are above the cap');
    expect(r.compliant).toBe(true);
  });

  it('caps allocate first-come-first-served by date', () => {
    const r = evaluateCompliance(urology(), [
      e(CONF, 15, [UROLOGY], '2026-03-01'),
      e(CONF, 15, [UROLOGY], '2026-01-01'),
    ]);
    const early = r.allocations.find((a) => a.countablePoints === 15)!;
    const late = r.allocations.find((a) => a.countablePoints === 5)!;
    expect(early.aboveCapPoints).toBe(0);
    expect(late.aboveCapPoints).toBe(10);
  });

  it('extra urology points do NOT spill to other areas by default', () => {
    const f = urology({ buckets: [
      bucket({ id: 1, name: 'Urology-related', source: 'speciality_related', minPoints: 30, maxCountablePoints: 30, minDistinctActivityTypes: 1 }),
      bucket({ id: 2, name: 'Other areas', source: 'other', minPoints: 20, minDistinctActivityTypes: 1 }),
    ] });
    const r = evaluateCompliance(f, [e(CONF, 50, [UROLOGY])]);
    expect(r.countablePoints).toBe(30);
    expect(r.buckets[1].points).toBe(0);
    expect(r.compliant).toBe(false);
  });

  it('spills over when the regulator enables allowOverflowTo', () => {
    const f = urology({ buckets: [
      bucket({ id: 1, name: 'Urology-related', source: 'speciality_related', minPoints: 30, maxCountablePoints: 30, minDistinctActivityTypes: 1, allowOverflowTo: 2 }),
      bucket({ id: 2, name: 'Other areas', source: 'other', minPoints: 20, minDistinctActivityTypes: 1 }),
    ] });
    const r = evaluateCompliance(f, [e(CONF, 50, [UROLOGY])]);
    expect(r.countablePoints).toBe(50);
    expect(r.buckets[1].points).toBe(20);
    expect(r.allocations[0]).toMatchObject({ countablePoints: 50, overflowBucketId: 2, overflowPoints: 20, aboveCapPoints: 0 });
    expect(r.compliant).toBe(true);
  });

  it('overflow respects the target bucket per-type cap', () => {
    const f = urology({ buckets: [
      bucket({ id: 1, name: 'U', source: 'speciality_related', minPoints: 30, maxCountablePoints: 30, minDistinctActivityTypes: 1, allowOverflowTo: 2 }),
      bucket({ id: 2, name: 'O', source: 'other', minPoints: 20, minDistinctActivityTypes: 1, maxPointsPerActivityType: 5 }),
    ] });
    const r = evaluateCompliance(f, [e(CONF, 50, [UROLOGY])]);
    expect(r.buckets[1].points).toBe(5);
    expect(r.allocations[0].aboveCapPoints).toBe(15);
  });

  it('compliance_type_caps rows tighten a bucket cap', () => {
    const f = urology({ typeCaps: [{ bucketId: 1, activityTypeId: CONF, maxPoints: 12, minPoints: null }] });
    const r = evaluateCompliance(f, [e(CONF, 20, [UROLOGY])]);
    expect(r.buckets[0].points).toBe(12);
  });

  it('framework-wide type caps apply across buckets', () => {
    const f = urology({ typeCaps: [{ bucketId: null, activityTypeId: CONF, maxPoints: 25, minPoints: null }] });
    const r = evaluateCompliance(f, [e(CONF, 20, [UROLOGY], '2026-01-01'), e(CONF, 15, [], '2026-01-02')]);
    expect(r.countablePoints).toBe(25);
  });

  it('type-cap minimums produce reasons', () => {
    const f = urology({ typeCaps: [{ bucketId: 1, activityTypeId: WORKSHOP, maxPoints: 20, minPoints: 5 }] });
    const r = evaluateCompliance(f, [e(CONF, 20, [UROLOGY]), e(JOURNAL, 10, [UROLOGY])], { typeNames: names });
    expect(r.buckets[0].passed).toBe(false);
    expect(r.buckets[0].message).toContain('needs at least 5 points from Workshops (has 0)');
  });

  it('total requirement can exceed the bucket minimums', () => {
    const r = evaluateCompliance(urology({ totalRequiredPoints: 60 }), [
      e(CONF, 20, [UROLOGY]), e(WORKSHOP, 10, [UROLOGY]), e(CONF, 10), e(JOURNAL, 10),
    ]);
    expect(r.compliant).toBe(false);
    expect(r.reasons[0]).toContain('50 of 60');
  });

  it('distinct-type count only uses countable points', () => {
    const f = urology({ typeCaps: [{ bucketId: 1, activityTypeId: WORKSHOP, maxPoints: 0, minPoints: null }] });
    const r = evaluateCompliance(f, [e(CONF, 20, [UROLOGY]), e(WORKSHOP, 10, [UROLOGY])]);
    expect(r.buckets[0].distinctTypes).toBe(1);
  });

  it('several types short gives a generic message', () => {
    const f = urology({ buckets: [bucket({ id: 1, name: 'U', source: 'any', minPoints: 0, minDistinctActivityTypes: 3 })], totalRequiredPoints: 0 });
    const none = evaluateCompliance(f, []);
    expect(none.buckets[0].message).toBe('U: 0 of 0 points, add points from at least 3 more activity types.');
  });
});

describe('pickFramework', () => {
  const surgery = urology({ id: 11, name: 'Surgeons', specialityId: 8, totalRequiredPoints: 60 });
  const cat = urology({ id: 12, name: 'Dentists', scope: 'category', specialityId: null, userCategoryId: 2, buckets: [] });
  const dflt = urology({ id: 13, name: 'Everyone', scope: 'default', specialityId: null, buckets: [], totalRequiredPoints: 40 });
  const all = [urology(), surgery, cat, dflt];
  const opts = { multiSpecialityMode: 'primary' as const, defaultRequired: 50 };

  it('primary speciality framework', () =>
    expect(pickFramework(all, { primarySpecialityId: UROLOGY, specialityIds: [8], userCategoryId: 2 }, 2026, opts).id).toBe(10));
  it('strictest of all specialities', () =>
    expect(pickFramework(all, { primarySpecialityId: UROLOGY, specialityIds: [8], userCategoryId: 2 }, 2026, { ...opts, multiSpecialityMode: 'strictest' }).id).toBe(11));
  it('falls back to category', () =>
    expect(pickFramework(all, { primarySpecialityId: 99, specialityIds: [], userCategoryId: 2 }, 2026, opts).id).toBe(12));
  it('falls back to the stored default', () =>
    expect(pickFramework(all, { primarySpecialityId: null, specialityIds: [], userCategoryId: null }, 2026, opts).id).toBe(13));
  it('synthesises a default when none stored', () => {
    const f = pickFramework([], { primarySpecialityId: null, specialityIds: [], userCategoryId: null }, 2026, opts);
    expect(f.id).toBeNull();
    expect(f.totalRequiredPoints).toBe(50);
  });
  it('past years keep their own rules', () => {
    const old = urology({ id: 20, cpdYearFrom: 2020, cpdYearTo: 2025, totalRequiredPoints: 30 });
    const p = { primarySpecialityId: UROLOGY, specialityIds: [], userCategoryId: null };
    expect(pickFramework([old, urology()], p, 2024, opts).id).toBe(20);
    expect(pickFramework([old, urology()], p, 2026, opts).id).toBe(10);
  });
  it('ignores inactive frameworks', () =>
    expect(pickFramework([urology({ active: false })], { primarySpecialityId: UROLOGY, specialityIds: [], userCategoryId: null }, 2026, opts).id).toBeNull());
});

describe('summarizeByType', () => {
  it('groups raw and countable points with share', () => {
    const entries = [e(CONF, 25, [UROLOGY]), e(CONF, 5, [UROLOGY]), e(WORKSHOP, 10, [UROLOGY])];
    const r = evaluateCompliance(urology(), entries);
    const rows = summarizeByType(entries, r.allocations);
    expect(rows[0]).toEqual({ activityTypeId: CONF, claims: 2, rawPoints: 30, countablePoints: 20, share: 75 });
    expect(rows[1]).toEqual({ activityTypeId: WORKSHOP, claims: 1, rawPoints: 10, countablePoints: 10, share: 25 });
  });
  it('counts claims, not entries', () => {
    const entries = [e(CONF, 2), e(CONF, 3)];
    const rows = summarizeByType(entries, [], () => 'same-claim');
    expect(rows[0].claims).toBe(1);
  });
});

describe('previewCapWarning', () => {
  it('warns when points will not count', () => {
    const msg = previewCapWarning(urology(), [e(CONF, 20, [UROLOGY])], e(CONF, 5, [UROLOGY]), names);
    expect(msg).toBe("You already have 20 Conferences points in Urology-related; these points will be recorded but won't count towards compliance.");
  });
  it('partial count', () => {
    const msg = previewCapWarning(urology(), [e(CONF, 18, [UROLOGY])], e(CONF, 5, [UROLOGY]), names);
    expect(msg).toContain('only 2 of these 5 points will count');
  });
  it('null when everything counts', () =>
    expect(previewCapWarning(urology(), [], e(CONF, 5, [UROLOGY]), names)).toBeNull());
});
