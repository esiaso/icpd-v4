'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmButton, Dialog } from '../dialog';
import { Badge, Button, Card, Field, Input } from '../ui';
import { del, get, post, put } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { useAction } from '@/lib/hooks';

const FIELDS = {
  presenter: [['regNo', 'Reg. no.', true], ['firstName', 'First name', true], ['otherNames', 'Other names', false], ['lastName', 'Last name', true], ['topic', 'Topic', false], ['portfolio', 'Portfolio / title', false], ['affiliation', 'Affiliation', false]],
  moderator: [['regNo', 'Reg. no.', true], ['firstName', 'First name', true], ['middleName', 'Middle name', false], ['lastName', 'Last name', true], ['portfolio', 'Portfolio / title', false]],
} as const;

/** Presenters or moderators of an activity (identified by reg. no.). */
export function People({ base, kind }: { base: string; kind: 'presenter' | 'moderator' }) {
  const url = `${base}/${kind}s`;
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: [url], queryFn: () => get<any[]>(url) });
  const [edit, setEdit] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = useAction((id: string) => del(`${url}/${id}`), { success: 'Removed', invalidate: [url] });
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    try {
      edit?.id ? await put(`${url}/${edit.id}`, body) : await post(url, body);
      qc.invalidateQueries({ queryKey: [url] });
      setEdit(null);
    } catch (err) {
      applyApiError(null, err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <Button onClick={() => setEdit({})}>Add {kind}</Button>
      <Card className="divide-y">
        {data.map((p) => (
          <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
            <div>
              <p className="font-medium">{p.firstName} {p.otherNames ?? p.middleName ?? ''} {p.lastName} <span className="font-mono text-xs text-muted-foreground">{p.regNo}</span></p>
              <p className="text-muted-foreground">{[p.topic, p.portfolio, p.affiliation].filter(Boolean).join(' · ')}</p>
            </div>
            <div className="flex items-center gap-2">
              {p.pointsAwarded ? <Badge variant="success">bonus awarded</Badge> : <Badge variant="secondary">bonus pending</Badge>}
              <Button size="sm" variant="outline" onClick={() => setEdit(p)}>Edit</Button>
              <ConfirmButton label="Remove" title={`Remove ${p.firstName} ${p.lastName}?`} onConfirm={() => remove.mutateAsync(p.id)} />
            </div>
          </div>
        ))}
        {!data.length && <p className="p-4 text-sm text-muted-foreground">No {kind}s yet. They earn a bonus the first time they claim points for this activity.</p>}
      </Card>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit?.id ? `Edit ${kind}` : `Add ${kind}`}>
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          {FIELDS[kind].map(([k, label, req]) => (
            <Field key={k} label={label} required={req}><Input name={k} defaultValue={edit?.[k] ?? ''} required={req} /></Field>
          ))}
          <div className="sm:col-span-2"><Button type="submit" loading={busy}>Save</Button></div>
        </form>
      </Dialog>
    </div>
  );
}
