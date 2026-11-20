'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Plus, Trash2 } from 'lucide-react';
import { Alert, Button, Field, Input, Select } from '../ui';
import { MultiSelect } from '../multi-select';
import { ApiError, get, upload } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { useReference } from '@/lib/hooks';
import { cn } from '@/lib/utils';

export const STEPS = [
  { key: 'profile', label: 'Profile', href: '/practitioner/registration/edit', section: 'profile' },
  { key: 'photo', label: 'Photo', href: '/practitioner/registration/photo', section: 'photo' },
  { key: 'academic', label: 'Academics', href: '/practitioner/registration/academics', section: 'academic' },
  { key: 'specialities', label: 'Specialization', href: '/practitioner/registration/specialization', section: 'specialization' },
  { key: 'workplace', label: 'Workplace', href: '/practitioner/registration/workplace', section: 'workplace' },
  { key: 'preview', label: 'Preview & submit', href: '/practitioner/registration/preview', section: '' },
];

export function useApplication() {
  return useQuery({ queryKey: ['application'], queryFn: () => get('/me/application') });
}

/** Stepper with returned sections and officer notes highlighted. */
export function Stepper() {
  const path = usePathname();
  const { data: a } = useApplication();
  const reached = STEPS.findIndex((s) => s.key === a?.applicationStep);
  const returned = new Set((a?.returnedSections ?? []).map((r: any) => r.section));
  return (
    <div className="mb-6 space-y-3">
      <ol className="flex flex-wrap gap-2 text-sm">
        {STEPS.map((s, i) => {
          const active = path === s.href || (s.key === 'profile' && path.endsWith('/new'));
          const done = a && (i < reached || (a.status !== 'presubmission' && a.status !== 'returned'));
          const flagged = returned.has(s.section);
          const canGo = !!a && (i <= Math.max(reached, 0) || a.status === 'returned');
          const content = (
            <span className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1', active && 'border-primary bg-primary/10 font-medium text-primary', flagged && 'border-amber-500 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-100')}>
              {done && !flagged ? <Check className="h-3.5 w-3.5" /> : <span className="text-xs">{i + 1}</span>} {s.label}
            </span>
          );
          return <li key={s.key}>{canGo ? <Link href={s.href}>{content}</Link> : content}</li>;
        })}
      </ol>
      {a?.status === 'returned' && (
        <Alert variant="warning">
          <p className="font-medium">Your application was returned. Update these sections, then resubmit from the preview:</p>
          <ul className="ml-5 list-disc">{a.returnedSections.map((r: any) => <li key={r.section}><b>{r.section}</b>{r.notes ? `: ${r.notes}` : ''}{r.documentRequested ? ' (document requested)' : ''}</li>)}</ul>
        </Alert>
      )}
    </div>
  );
}

const opt = (v: FormDataEntryValue | null) => (v === null || v === '' ? null : String(v));

export function ProfileForm({ initial, onSubmit, submitLabel = 'Save and continue' }: { initial?: any; onSubmit: (v: any) => Promise<unknown>; submitLabel?: string }) {
  const { data: ref } = useReference();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const v: any = Object.fromEntries(fd);
    for (const k of ['otherNames', 'mobile2', 'postalAddress', 'postalCode', 'dob', 'titleId']) v[k] = opt(fd.get(k));
    setBusy(true);
    setErrors({});
    try {
      await onSubmit(v);
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      applyApiError(null, err);
    } finally {
      setBusy(false);
    }
  }
  const f = (name: string, label: string, required = false, type = 'text') => (
    <Field label={label} error={errors[name]} required={required}>
      <Input name={name} type={type} defaultValue={type === 'date' ? initial?.[name]?.slice(0, 10) : initial?.[name] ?? ''} required={required} />
    </Field>
  );
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Title"><Select name="titleId" defaultValue={initial?.titleId ?? ''}><option value="">—</option>{ref?.titles.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select></Field>
        {f('firstName', 'First name', true)}
        {f('otherNames', 'Other names')}
        {f('lastName', 'Last name', true)}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Category" error={errors.categoryId} required>
          <Select name="categoryId" defaultValue={initial?.categoryId ?? ''} required><option value="">Choose…</option>{ref?.categories.map((c) => <option key={c.id} value={c.id}>{c.prefixLetter} · {c.name}</option>)}</Select>
        </Field>
        {f('regNo', 'Registration number', true)}
        {f('nationalId', 'National ID / passport no.', true)}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {f('email', 'Email', true, 'email')}
        {f('mobile1', 'Mobile phone', true, 'tel')}
        {f('mobile2', 'Other phone', false, 'tel')}
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {f('dob', 'Date of birth', false, 'date')}
        {f('nationality', 'Nationality', true)}
        <Field label="Country of residence" error={errors.countryOfResidenceId} required>
          <Select name="countryOfResidenceId" defaultValue={initial?.countryOfResidenceId ?? ref?.countries.find((c) => c.code === 'KE')?.id ?? ''}>{ref?.countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        {f('physicalAddress', 'Physical address', true)}
        {f('city', 'City / town', true)}
        {f('postalAddress', 'Postal address')}
        {f('postalCode', 'Postal code')}
      </div>
      <Button type="submit" loading={busy}>{submitLabel}</Button>
    </form>
  );
}

export function PhotoForm({ current, endpoint, onDone }: { current?: string | null; endpoint: string; onDone: () => void }) {
  const [preview, setPreview] = useState<string | null>(current ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      {preview && <img src={preview} alt="Your photo" className="h-40 w-32 rounded border object-cover" />}
      <Input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); if (f) setPreview(URL.createObjectURL(f)); }} />
      <p className="text-xs text-muted-foreground">A recent passport-style photo, JPG or PNG, up to 5 MB.</p>
      <Button
        loading={busy}
        disabled={!file}
        onClick={async () => {
          const fd = new FormData();
          fd.set('file', file!);
          setBusy(true);
          try {
            await upload(endpoint, fd);
            onDone();
          } catch (e) {
            applyApiError(null, e);
          } finally {
            setBusy(false);
          }
        }}
      >
        Upload photo
      </Button>
    </div>
  );
}

export function AcademicsForm({ initial, onSubmit }: { initial: any[]; onSubmit: (rows: any[]) => Promise<unknown> }) {
  const { data: ref } = useReference();
  const [rows, setRows] = useState<any[]>(initial.length ? initial : [{ qualification: '', institution: '', country: 'Kenya', year: '' }]);
  const [busy, setBusy] = useState(false);
  const set = (i: number, p: any) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-5">
          <Field label="Qualification" required>
            <Input list="quals" value={r.qualification ?? ''} onChange={(e) => set(i, { qualification: e.target.value })} />
          </Field>
          <div className="sm:col-span-2"><Field label="Institution" required><Input value={r.institution ?? ''} onChange={(e) => set(i, { institution: e.target.value })} /></Field></div>
          <Field label="Country"><Input value={r.country ?? ''} onChange={(e) => set(i, { country: e.target.value })} /></Field>
          <div className="flex items-end gap-2">
            <Field label="Year"><Input type="number" value={r.year ?? ''} onChange={(e) => set(i, { year: e.target.value })} /></Field>
            {rows.length > 1 && <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
          </div>
        </div>
      ))}
      <datalist id="quals">{ref?.qualifications.map((q) => <option key={q.id} value={q.name} />)}</datalist>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setRows([...rows, { qualification: '', institution: '', country: '', year: '' }])}><Plus className="h-4 w-4" /> Add qualification</Button>
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit(rows.map((r) => ({ ...r, year: r.year ? Number(r.year) : null })));
            } catch (e) {
              applyApiError(null, e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Save and continue
        </Button>
      </div>
    </div>
  );
}

export function SpecialitiesForm({ initial, onSubmit, submitLabel = 'Save and continue' }: { initial?: any; onSubmit: (v: any) => Promise<unknown>; submitLabel?: string }) {
  const { data: ref } = useReference();
  const [primary, setPrimary] = useState<string>(String(initial?.specializationId ?? ''));
  const [others, setOthers] = useState<(number | string)[]>((initial?.specialities ?? []).filter((s: any) => !s.isPrimary).map((s: any) => s.specialityId));
  const [other, setOther] = useState(initial?.specializationOther ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-4">
      <Field label="Primary speciality" required hint="Your primary speciality decides which compliance rules apply to you.">
        <Select value={primary} onChange={(e) => setPrimary(e.target.value)}><option value="">Choose…</option>{ref?.specialities.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
      </Field>
      <Field label="Other specialities"><MultiSelect options={(ref?.specialities ?? []).filter((s) => String(s.id) !== primary)} value={others} onChange={setOthers} /></Field>
      <Field label="Other (not listed)"><Input value={other} onChange={(e) => setOther(e.target.value)} /></Field>
      <Button
        loading={busy}
        disabled={!primary}
        onClick={async () => {
          setBusy(true);
          try {
            await onSubmit({ primaryId: Number(primary), otherIds: others.map(Number), specializationOther: other || null });
          } catch (e) {
            applyApiError(null, e);
          } finally {
            setBusy(false);
          }
        }}
      >
        {submitLabel}
      </Button>
    </div>
  );
}

export function WorkplaceForm({ initial, onSubmit, submitLabel = 'Save and continue' }: { initial: any[]; onSubmit: (rows: any[]) => Promise<unknown>; submitLabel?: string }) {
  const { data: ref } = useReference();
  const [rows, setRows] = useState<any[]>(initial.length ? initial : [{ institution: '', position: '', countryId: ref?.countries.find((c) => c.code === 'KE')?.id ?? null, current: true }]);
  const [busy, setBusy] = useState(false);
  const set = (i: number, p: any) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-4">
          <div className="sm:col-span-2"><Field label="Institution / facility" required><Input value={r.institution ?? ''} onChange={(e) => set(i, { institution: e.target.value })} /></Field></div>
          <Field label="Position"><Input value={r.position ?? ''} onChange={(e) => set(i, { position: e.target.value })} /></Field>
          <Field label="Country">
            <Select value={r.countryId ?? ''} onChange={(e) => set(i, { countryId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">—</option>{ref?.countries.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={r.current !== false} onChange={(e) => set(i, { current: e.target.checked })} /> Current</label>
          {rows.length > 1 && <Button variant="ghost" size="sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /> Remove</Button>}
        </div>
      ))}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => setRows([...rows, { institution: '', position: '', current: false }])}><Plus className="h-4 w-4" /> Add workplace</Button>
        <Button
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit(rows.map(({ id, practitionerId, createdAt, updatedAt, createdBy, updatedBy, deletedAt, deletedBy, ...r }) => r));
            } catch (e) {
              applyApiError(null, e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
