'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Field, Input, Select, Textarea } from '../ui';
import { ApiError, get, post, upload } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { useReference } from '@/lib/hooks';
import { pts } from '@/lib/utils';

const d = (s?: string) => (s ? s.slice(0, 10) : '');

/** Non-token claim with PDF evidence and speciality relevance (spec 5.6, 5.7.2). */
export function NonTokenForm({ initial, onDone }: { initial?: any; onDone: (claim: any) => void }) {
  const { data: ref } = useReference();
  const { data: mySpecs = [] } = useQuery({ queryKey: ['my-specs'], queryFn: () => get<{ id: number; name: string }[]>('/me/non-token-claims/specialities') });
  const [typeId, setTypeId] = useState<number>(initial?.activityTypeId ?? 0);
  const [spec, setSpec] = useState<string>(initial ? String((initial.specialityIds as number[])?.[0] ?? '') : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const type = ref?.activityTypes.find((t) => t.id === typeId);

  useEffect(() => {
    if (!typeId) return setWarning(null);
    const points = Number(type?.maxSessionPoints ?? type?.cpdPoints ?? 1) || 1;
    post('/me/claims/cap-warning', { activityTypeId: typeId, specialityIds: spec ? [Number(spec)] : [], points })
      .then((r) => setWarning(r.warning))
      .catch(() => setWarning(null));
  }, [typeId, spec, type]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('specialityIds', JSON.stringify(spec ? [Number(spec)] : []));
    if (!(fd.get('evidence') as File)?.size) fd.delete('evidence');
    setBusy(true);
    setErrors({});
    try {
      const r = await upload(initial ? `/me/non-token-claims/${initial.id}` : '/me/non-token-claims', fd, initial ? 'PUT' : 'POST');
      onDone(r);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      applyApiError(null, err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Activity type" error={errors.activityTypeId} required>
        <Select name="activityTypeId" value={typeId || ''} onChange={(e) => setTypeId(Number(e.target.value))} required>
          <option value="">Choose…</option>
          {ref?.activityTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </Field>
      {type && (
        <Alert>
          {pts(type.cpdPoints)} points{type.maxSessionPoints ? ` (up to ${pts(type.maxSessionPoints)} per claim)` : ''}. {type.evidenceRequired ? `Evidence: ${type.evidenceRequired}.` : ''}
          {type.claimCondition === 'once' && ' This kind of claim can be made once per calendar year.'}
        </Alert>
      )}
      <Field label="Activity name" error={errors.activityName} required><Input name="activityName" defaultValue={initial?.activityName} required /></Field>
      <Field label="Description" error={errors.description} required><Textarea name="description" defaultValue={initial?.description} required /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Begin date" error={errors.beginDate} required><Input type="date" name="beginDate" defaultValue={d(initial?.beginDate)} required /></Field>
        <Field label="End date" error={errors.endDate} required><Input type="date" name="endDate" defaultValue={d(initial?.endDate)} required /></Field>
      </div>
      <Field label="Venue / place" error={errors.place} required><Input name="place" defaultValue={initial?.place} required /></Field>
      <Field label="Which of your specialities is this relevant to?" error={errors.specialityIds} required hint="Used to count the points towards your speciality requirement.">
        <Select value={spec} onChange={(e) => setSpec(e.target.value)}>
          <option value="">General / other</option>
          {mySpecs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </Field>
      {warning && <Alert variant="warning">{warning}</Alert>}
      <Field label="Evidence (PDF)" error={errors.evidence} required={!initial} hint={initial ? 'Leave empty to keep the current file.' : 'PDF only.'}>
        <Input type="file" name="evidence" accept="application/pdf" required={!initial} />
      </Field>
      <Button type="submit" loading={busy}>{initial ? 'Save and resubmit' : 'Submit claim'}</Button>
    </form>
  );
}
