'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { ConfirmButton, Dialog } from '../dialog';
import { Badge, Button, Card, Field, Input, Select } from '../ui';
import { ApiError, del, get, post, put } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { useAction, useReference } from '@/lib/hooks';

type Kind = 'presenter' | 'moderator';

const FIELDS: Record<Kind, [string, string, boolean][]> = {
  presenter: [['firstName', 'First name', true], ['otherNames', 'Other names', false], ['lastName', 'Last name', true], ['topic', 'Topic', false], ['portfolio', 'Portfolio / title', false], ['affiliation', 'Affiliation', false]],
  moderator: [['firstName', 'First name', true], ['middleName', 'Middle name', false], ['lastName', 'Last name', true], ['portfolio', 'Portfolio / title', false]],
};

/**
 * Reg. no. field with practitioner search. Optional: when a practitioner is picked, the
 * name fields (and affiliation) are filled from their record.
 */
function RegNoLookup({ base, value, onChange, onPick, error }: { base: string; value: string; onChange: (v: string) => void; onPick: (p: any) => void; error?: string }) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTerm(value.trim()), 250);
    return () => clearTimeout(t);
  }, [value]);
  const { data = [], isFetching } = useQuery({
    queryKey: [`${base}/practitioner-lookup`, term],
    queryFn: () => get<any[]>(`${base}/practitioner-lookup?q=${encodeURIComponent(term)}`),
    enabled: term.length >= 2,
  });
  return (
    <Field label="Registration number" error={error} hint="Optional. Type a reg. no. or name to search registered practitioners; only practitioners with a reg. no. can earn the bonus.">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
        <Input
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="pl-9"
          placeholder="e.g. A1234 or Jane Doe"
          autoComplete="off"
          role="combobox"
          aria-expanded={open && data.length > 0}
          aria-controls="practitioner-matches"
        />
        {open && term.length >= 2 && (
          <ul id="practitioner-matches" role="listbox" className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-card shadow-md">
            {data.map((p) => (
              <li key={p.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-secondary"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onPick(p); setOpen(false); }}
                >
                  <span className="font-mono">{p.regNo}</span> · {p.firstName} {p.otherNames ?? ''} {p.lastName}
                  <span className="block text-xs text-muted-foreground">{[p.speciality, p.workplaceInstitution].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
            {!isFetching && !data.length && <li className="px-3 py-2 text-sm text-muted-foreground">No registered practitioner found. You can still type the details below.</li>}
          </ul>
        )}
      </div>
    </Field>
  );
}

function PersonForm({ base, kind, initial, onDone }: { base: string; kind: Kind; initial: any; onDone: () => void }) {
  const { data: ref } = useReference();
  const url = `${base}/${kind}s`;
  const [v, setV] = useState<Record<string, any>>(() => ({ regNo: '', titleId: '', ...Object.fromEntries(FIELDS[kind].map(([k]) => [k, ''])), ...initial }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: string, val: any) => setV((x) => ({ ...x, [k]: val }));
  function pick(p: any) {
    setV((x) => ({
      ...x,
      regNo: p.regNo,
      titleId: p.titleId ?? x.titleId,
      firstName: p.firstName ?? '',
      lastName: p.lastName ?? '',
      ...(kind === 'presenter' ? { otherNames: p.otherNames ?? '', affiliation: x.affiliation || p.workplaceInstitution || '' } : { middleName: p.otherNames ?? '' }),
    }));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, any> = { regNo: v.regNo?.trim() || null, titleId: v.titleId ? Number(v.titleId) : null };
    for (const [k] of FIELDS[kind]) body[k] = typeof v[k] === 'string' ? v[k].trim() || null : v[k];
    setBusy(true);
    setErrors({});
    try {
      initial?.id ? await put(`${url}/${initial.id}`, body) : await post(url, body);
      onDone();
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fields);
      applyApiError(null, err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3">
      <RegNoLookup base={base} value={v.regNo ?? ''} onChange={(x) => set('regNo', x)} onPick={pick} error={errors.regNo} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title">
          <Select value={v.titleId ?? ''} onChange={(e) => set('titleId', e.target.value)}>
            <option value="">—</option>
            {ref?.titles.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        </Field>
        {FIELDS[kind].map(([k, label, req]) => (
          <Field key={k} label={label} required={req} error={errors[k]}>
            <Input value={v[k] ?? ''} onChange={(e) => set(k, e.target.value)} required={req} />
          </Field>
        ))}
      </div>
      <Button type="submit" loading={busy}>Save</Button>
    </form>
  );
}

/** Presenters or moderators of an activity. */
export function People({ base, kind }: { base: string; kind: Kind }) {
  const url = `${base}/${kind}s`;
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: [url], queryFn: () => get<any[]>(url) });
  const [edit, setEdit] = useState<any | null>(null);
  const remove = useAction((id: string) => del(`${url}/${id}`), { success: 'Removed', invalidate: [url] });
  return (
    <div className="space-y-3">
      <Button onClick={() => setEdit({})}>Add {kind}</Button>
      <Card className="divide-y">
        {data.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div>
              <p className="font-medium">{p.firstName} {p.otherNames ?? p.middleName ?? ''} {p.lastName} {p.regNo ? <span className="font-mono text-xs text-muted-foreground">{p.regNo}</span> : <span className="text-xs text-muted-foreground">(no reg. no.)</span>}</p>
              <p className="text-muted-foreground">{[p.topic, p.portfolio, p.affiliation].filter(Boolean).join(' · ')}</p>
            </div>
            <div className="flex items-center gap-2">
              {p.regNo ? (p.pointsAwarded ? <Badge variant="success">bonus awarded</Badge> : <Badge variant="secondary">bonus pending</Badge>) : <Badge variant="outline">no bonus</Badge>}
              <Button size="sm" variant="outline" onClick={() => setEdit(p)}>Edit</Button>
              <ConfirmButton label="Remove" title={`Remove ${p.firstName} ${p.lastName}?`} onConfirm={() => remove.mutateAsync(p.id)} />
            </div>
          </div>
        ))}
        {!data.length && <p className="p-4 text-sm text-muted-foreground">No {kind}s yet. Those with a registration number earn a bonus the first time they claim points for this activity.</p>}
      </Card>
      <Dialog wide open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit?.id ? `Edit ${kind}` : `Add ${kind}`}>
        {edit && <PersonForm base={base} kind={kind} initial={edit} onDone={() => { qc.invalidateQueries({ queryKey: [url] }); setEdit(null); }} />}
      </Dialog>
    </div>
  );
}
