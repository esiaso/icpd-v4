'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { nairobiYear } from '@icpd/shared';
import { ConfirmButton } from '@/components/dialog';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';
import { ApiError, del, get, post, put } from '@/lib/api';
import { useReference } from '@/lib/hooks';
import { pts } from '@/lib/utils';

type Bucket = { name: string; source: string; minPoints: number; maxCountablePoints: number | null; minDistinctActivityTypes: number; maxPointsPerActivityType: number | null; allowOverflowToIndex: number | null; sortOrder: number };
type Cap = { bucketIndex: number | null; activityTypeId: number; maxPoints: number; minPoints: number | null };
type Draft = { id?: number; name: string; cpdYearFrom: number; cpdYearTo: number | null; scope: string; specialityId: number | null; userCategoryId: number | null; totalRequiredPoints: number; active: boolean; notes: string; buckets: Bucket[]; typeCaps: Cap[] };

const blankBucket = (i: number, source = 'any'): Bucket => ({ name: '', source, minPoints: 0, maxCountablePoints: null, minDistinctActivityTypes: 1, maxPointsPerActivityType: null, allowOverflowToIndex: null, sortOrder: i });
const numOrNull = (v: string) => (v === '' ? null : Number(v));

function Editor({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const { data: ref } = useReference();
  const qc = useQueryClient();
  const [d, setD] = useState<Draft>(initial);
  const [preview, setPreview] = useState<any | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; details: any } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const setBucket = (i: number, patch: Partial<Bucket>) => set({ buckets: d.buckets.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const setCap = (i: number, patch: Partial<Cap>) => set({ typeCaps: d.typeCaps.map((c, j) => (j === i ? { ...c, ...patch } : c)) });

  const payload = (extra: Record<string, unknown> = {}) => ({ ...d, notes: d.notes || null, ...extra });

  async function runPreview() {
    setBusy(true);
    try {
      setPreview(await post('/regulator/compliance/frameworks/preview', payload({ year: Math.max(d.cpdYearFrom, Math.min(nairobiYear(), d.cpdYearTo ?? 9999)) })));
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function save(confirmed = false) {
    setBusy(true);
    try {
      const body = payload({ confirm: confirmed });
      d.id ? await put(`/regulator/compliance/frameworks/${d.id}`, body) : await post('/regulator/compliance/frameworks', body);
      toast.success('Rules saved. Compliance is being recalculated.');
      qc.invalidateQueries({ queryKey: ['frameworks'] });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CONFIRMATION_REQUIRED') setConfirm({ message: e.message, details: e.details });
      else toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const speciality = d.scope === 'speciality';
  return (
    <Card>
      <CardHeader><CardTitle>{d.id ? `Edit ${d.name}` : 'New compliance framework'}</CardTitle></CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2"><Field label="Name" required><Input value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Urologists" /></Field></div>
          <Field label="Total points required" required><Input type="number" value={d.totalRequiredPoints} onChange={(e) => set({ totalRequiredPoints: Number(e.target.value) })} /></Field>
          <Field label="Applies to" required>
            <Select value={d.scope} onChange={(e) => set({ scope: e.target.value, buckets: e.target.value === 'speciality' ? d.buckets : d.buckets.map((b) => ({ ...b, source: 'any' })) })}>
              <option value="speciality">A speciality</option>
              <option value="category">A user category</option>
              <option value="default">Everyone else (default)</option>
            </Select>
          </Field>
          {d.scope === 'speciality' && (
            <Field label="Speciality" required>
              <Select value={d.specialityId ?? ''} onChange={(e) => set({ specialityId: numOrNull(e.target.value) })}>
                <option value="">Choose…</option>
                {ref?.specialities.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
          )}
          {d.scope === 'category' && (
            <Field label="User category" required>
              <Select value={d.userCategoryId ?? ''} onChange={(e) => set({ userCategoryId: numOrNull(e.target.value) })}>
                <option value="">Choose…</option>
                {ref?.categories.map((c) => <option key={c.id} value={c.id}>{c.prefixLetter}: {c.name}</option>)}
              </Select>
            </Field>
          )}
          <Field label="From CPD year" required><Input type="number" value={d.cpdYearFrom} onChange={(e) => set({ cpdYearFrom: Number(e.target.value) })} /></Field>
          <Field label="To CPD year" hint="Leave empty for open-ended"><Input type="number" value={d.cpdYearTo ?? ''} onChange={(e) => set({ cpdYearTo: numOrNull(e.target.value) })} /></Field>
          <label className="flex items-center gap-2 self-end text-sm"><input type="checkbox" checked={d.active} onChange={(e) => set({ active: e.target.checked })} /> Active</label>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">Buckets</h3>
            <Button size="sm" variant="outline" onClick={() => set({ buckets: [...d.buckets, blankBucket(d.buckets.length, speciality ? 'other' : 'any')] })}><Plus className="h-4 w-4" /> Add bucket</Button>
          </div>
          {!d.buckets.length && <p className="text-sm text-muted-foreground">No buckets: only the total counts (legacy behaviour).</p>}
          <div className="space-y-3">
            {d.buckets.map((b, i) => (
              <div key={i} className="grid gap-3 rounded-md border p-3 sm:grid-cols-4">
                <Field label="Bucket name"><Input value={b.name} onChange={(e) => setBucket(i, { name: e.target.value })} placeholder="e.g. Urology-related" /></Field>
                <Field label="Counts entries">
                  <Select value={b.source} onChange={(e) => setBucket(i, { source: e.target.value })} disabled={!speciality}>
                    {speciality && <option value="speciality_related">Tagged with the speciality</option>}
                    {speciality && <option value="other">Not tagged with it</option>}
                    <option value="any">Any entry</option>
                  </Select>
                </Field>
                <Field label="Min points"><Input type="number" value={b.minPoints} onChange={(e) => setBucket(i, { minPoints: Number(e.target.value) })} /></Field>
                <Field label="Min distinct activity types"><Input type="number" value={b.minDistinctActivityTypes} onChange={(e) => setBucket(i, { minDistinctActivityTypes: Number(e.target.value) })} /></Field>
                <Field label="Max points per activity type"><Input type="number" value={b.maxPointsPerActivityType ?? ''} onChange={(e) => setBucket(i, { maxPointsPerActivityType: numOrNull(e.target.value) })} /></Field>
                <Field label="Max countable in bucket"><Input type="number" value={b.maxCountablePoints ?? ''} onChange={(e) => setBucket(i, { maxCountablePoints: numOrNull(e.target.value) })} /></Field>
                <Field label="Extra points overflow to" hint="Off by default">
                  <Select value={b.allowOverflowToIndex ?? ''} onChange={(e) => setBucket(i, { allowOverflowToIndex: numOrNull(e.target.value) })}>
                    <option value="">Nowhere (not countable)</option>
                    {d.buckets.map((o, j) => j !== i && <option key={j} value={j}>{o.name || `Bucket ${j + 1}`}</option>)}
                  </Select>
                </Field>
                <div className="flex items-end"><Button variant="ghost" size="sm" onClick={() => set({ buckets: d.buckets.filter((_, j) => j !== i), typeCaps: d.typeCaps.filter((c) => c.bucketIndex !== i).map((c) => ({ ...c, bucketIndex: c.bucketIndex !== null && c.bucketIndex > i ? c.bucketIndex - 1 : c.bucketIndex })) })}><Trash2 className="h-4 w-4" /> Remove</Button></div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-semibold">Activity-type caps</h3>
            <Button size="sm" variant="outline" onClick={() => set({ typeCaps: [...d.typeCaps, { bucketIndex: null, activityTypeId: ref?.activityTypes[0]?.id ?? 0, maxPoints: 10, minPoints: null }] })}><Plus className="h-4 w-4" /> Add cap</Button>
          </div>
          <div className="space-y-2">
            {d.typeCaps.map((c, i) => (
              <div key={i} className="grid gap-2 rounded-md border p-2 sm:grid-cols-5">
                <Select aria-label="Activity type" value={c.activityTypeId} onChange={(e) => setCap(i, { activityTypeId: Number(e.target.value) })}>
                  {ref?.activityTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
                <Select aria-label="Bucket" value={c.bucketIndex ?? ''} onChange={(e) => setCap(i, { bucketIndex: numOrNull(e.target.value) })}>
                  <option value="">Whole framework</option>
                  {d.buckets.map((b, j) => <option key={j} value={j}>{b.name || `Bucket ${j + 1}`}</option>)}
                </Select>
                <Input aria-label="Max points" type="number" value={c.maxPoints} onChange={(e) => setCap(i, { maxPoints: Number(e.target.value) })} placeholder="Max points" />
                <Input aria-label="Min points" type="number" value={c.minPoints ?? ''} onChange={(e) => setCap(i, { minPoints: numOrNull(e.target.value) })} placeholder="Min points (optional)" />
                <Button variant="ghost" size="sm" onClick={() => set({ typeCaps: d.typeCaps.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
        </div>
        <Field label="Notes"><Textarea value={d.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>

        <Alert variant="warning" className="text-xs">
          Pending regulator confirmation: points above a cap are recorded but don&apos;t count; an entry tagged with several specialities counts as related for each; overflow between buckets is off unless set above.
        </Alert>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={runPreview} loading={busy}>Preview on practitioners</Button>
          <Button onClick={() => save(false)} loading={busy}>Save rules</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>

        {confirm && (
          <Alert variant="warning" className="space-y-2">
            <p>{confirm.message}</p>
            <Button size="sm" onClick={() => save(true)} loading={busy}>Confirm and save</Button>
          </Alert>
        )}

        {preview && (
          <div className="space-y-2">
            <p className="text-sm">
              Year {preview.year}: {preview.applicable} practitioners in scope, {preview.sampled} checked. <b>{preview.compliantAfter}</b> would be compliant; <b>{preview.changed}</b> would change status.
            </p>
            <div className="max-h-80 overflow-y-auto rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-secondary text-left"><tr><th className="p-2">Practitioner</th><th className="p-2">Now</th><th className="p-2">With these rules</th><th className="p-2">Reasons</th></tr></thead>
                <tbody>
                  {preview.rows.map((r: any) => (
                    <tr key={r.practitionerId} className={`border-t ${r.before.compliant !== r.after.compliant ? 'bg-amber-50 dark:bg-amber-950/30' : ''}`}>
                      <td className="p-2">{r.name} <span className="font-mono">{r.regNo}</span></td>
                      <td className="p-2">{r.before.compliant ? '✓' : '✗'} {pts(r.before.countablePoints)}</td>
                      <td className="p-2">{r.after.compliant ? '✓' : '✗'} {pts(r.after.countablePoints)}</td>
                      <td className="p-2">{r.after.reasons.join(' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function ComplianceRulesPage() {
  const qc = useQueryClient();
  const { data: ref } = useReference();
  const { data: list = [] } = useQuery({ queryKey: ['frameworks'], queryFn: () => get<any[]>('/regulator/compliance/frameworks') });
  const [edit, setEdit] = useState<Draft | null>(null);
  const year = nairobiYear();
  const newDraft = (): Draft => ({ name: '', cpdYearFrom: year, cpdYearTo: null, scope: 'speciality', specialityId: null, userCategoryId: null, totalRequiredPoints: 50, active: true, notes: '', buckets: [{ ...blankBucket(0, 'speciality_related'), minPoints: 30, minDistinctActivityTypes: 2 }, { ...blankBucket(1, 'other'), minPoints: 20, minDistinctActivityTypes: 2 }], typeCaps: [] });
  const target = (f: any) => (f.scope === 'speciality' ? ref?.specialities.find((s) => s.id === f.specialityId)?.name : f.scope === 'category' ? ref?.categories.find((c) => c.id === f.userCategoryId)?.name : 'Everyone else');
  if (edit) return <Editor initial={edit} onClose={() => setEdit(null)} />;
  return (
    <>
      <PageHeader
        title="Compliance rules"
        description="How the annual requirement must be made up, per speciality, user category or for everyone. Past years keep their own rules."
        actions={
          <>
            <Button variant="outline" onClick={async () => { await post(`/regulator/compliance/recompute?year=${year}`); toast.success('Recalculating compliance for everyone'); }}>Recalculate {year}</Button>
            <Button onClick={() => setEdit(newDraft())}>New framework</Button>
          </>
        }
      />
      {!list.length && <Alert>No frameworks yet. Everyone needs a plain {50} points (the default).</Alert>}
      <div className="grid gap-3 md:grid-cols-2">
        {list.map((f) => (
          <Card key={f.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {f.name}
                <Badge variant={f.active ? 'success' : 'secondary'}>{f.active ? 'active' : 'inactive'}</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">{target(f)} · {f.cpdYearFrom}–{f.cpdYearTo ?? 'open'} · {pts(f.totalRequiredPoints)} points</p>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {f.buckets.map((b: any) => (
                <p key={b.id}>• <b>{b.name}</b>: ≥ {pts(b.minPoints)} pts, ≥ {b.minDistinctActivityTypes} types{b.maxPointsPerActivityType !== null ? `, ≤ ${pts(b.maxPointsPerActivityType)} per type` : ''}</p>
              ))}
              {!!f.typeCaps.length && <p className="text-xs text-muted-foreground">{f.typeCaps.length} activity-type cap(s)</p>}
              <div className="flex gap-2 pt-2">
                <Button size="sm" variant="outline" onClick={() => setEdit({ ...f, notes: f.notes ?? '' })}>Edit</Button>
                <ConfirmButton label="Delete" title={`Delete ${f.name}?`} message="Practitioners it covered fall back to the next applicable rules." onConfirm={async () => { await del(`/regulator/compliance/frameworks/${f.id}`); qc.invalidateQueries({ queryKey: ['frameworks'] }); }} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
