'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DataTable, type Col } from '@/components/data-table';
import { Dialog } from '@/components/dialog';
import { Tabs } from '@/components/tabs';
import { Alert, Badge, Button, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';
import { ApiError, get, post } from '@/lib/api';
import { fmtDate, pts } from '@/lib/utils';

const variant = (s: string) => (s === 'Yes' ? 'success' : s === 'Pending' ? 'warning' : 'destructive') as any;

function Review({ id, onDone }: { id: string; onDone: () => void }) {
  const { data: c } = useQuery({ queryKey: ['nt-review', id], queryFn: () => get(`/regulator/claims/non-token/${id}`) });
  const [points, setPoints] = useState('');
  const [spec, setSpec] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!c) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const specs = [c.practitioner.specialization, ...c.practitioner.specialities.map((s: any) => s.speciality)].filter(Boolean).filter((s: any, i: number, a: any[]) => a.findIndex((x) => x.id === s.id) === i);
  const currentSpec = spec ?? String((c.specialityIds as number[])?.[0] ?? '');
  async function act(fn: () => Promise<any>) {
    setBusy(true);
    setErr(null);
    try {
      const r = await fn();
      toast.success(r.message);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-2 text-sm">
        <p><span className="text-muted-foreground">Practitioner:</span> {c.practitioner.firstName} {c.practitioner.lastName} ({c.practitioner.regNo})</p>
        <p><span className="text-muted-foreground">Type:</span> {c.activityType.name} · {pts(c.activityType.cpdPoints)} pts{c.activityType.maxSessionPoints ? `, max ${pts(c.activityType.maxSessionPoints)}/claim` : ''}{c.activityType.maxYearlyPoints ? `, max ${pts(c.activityType.maxYearlyPoints)}/year` : ''}</p>
        <p><span className="text-muted-foreground">Dates:</span> {fmtDate(c.beginDate)} to {fmtDate(c.endDate)} · {c.place}</p>
        <p className="whitespace-pre-wrap">{c.description}</p>
        {c.activityType.evidenceRequired && <p className="text-xs text-muted-foreground">Evidence required: {c.activityType.evidenceRequired}</p>}
        {c.capWarning && <Alert variant="warning">{c.capWarning}</Alert>}
        {c.comments.map((m: any) => <Alert key={m.id}>Earlier note: {m.comment}</Alert>)}
        {c.status === 'Yes' ? (
          <Alert variant="success">Approved with {pts(c.cpdClaim?.cpdPoints)} points on {fmtDate(c.approvedAt)}.</Alert>
        ) : (
          <div className="space-y-3 rounded-md border p-3">
            <Field label="Speciality relevance" hint="Correct it if the practitioner picked the wrong one.">
              <Select value={currentSpec} onChange={(e) => setSpec(e.target.value)}>
                <option value="">General / other</option>
                {specs.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <div className="flex items-end gap-2">
              <Field label="Points to award"><Input type="number" step="0.01" min="0" value={points} onChange={(e) => setPoints(e.target.value)} className="w-32" /></Field>
              <Button loading={busy} disabled={!points} onClick={() => act(() => post(`/regulator/claims/non-token/${id}/award`, { points: Number(points), specialityIds: currentSpec ? [Number(currentSpec)] : [] }))}>Award</Button>
            </div>
            <Field label="Or reject with a reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
            <Button variant="destructive" loading={busy} disabled={reason.trim().length < 3} onClick={() => act(() => post(`/regulator/claims/non-token/${id}/reject`, { reason }))}>Reject</Button>
            {err && <Alert variant="destructive">{err}</Alert>}
          </div>
        )}
      </div>
      <div>{c.evidenceSignedUrl ? <iframe title="Evidence PDF" src={c.evidenceSignedUrl} className="h-[70vh] w-full rounded border" /> : <Alert>No evidence file.</Alert>}</div>
    </div>
  );
}

export default function ClaimsReview() {
  const qc = useQueryClient();
  const [open, setOpen] = useState<string | null>(null);
  const columns: Col<any>[] = [
    { header: 'Submitted', sortKey: 'claimDate', cell: ({ row }) => fmtDate(row.original.claimDate) },
    { header: 'Practitioner', cell: ({ row }) => <div><p>{row.original.practitioner.firstName} {row.original.practitioner.lastName}</p><p className="font-mono text-xs text-muted-foreground">{row.original.practitioner.regNo}</p></div> },
    { header: 'Activity', sortKey: 'activityName', cell: ({ row }) => <div><p className="font-medium">{row.original.activityName}</p><p className="text-xs text-muted-foreground">{row.original.activityType.name}</p></div> },
    { header: 'Status', sortKey: 'status', cell: ({ row }) => <Badge variant={variant(row.original.status)}>{row.original.status === 'Yes' ? `Approved (${pts(row.original.cpdClaim?.cpdPoints)})` : row.original.status}</Badge> },
    { id: 'a', header: '', cell: ({ row }) => <Button size="sm" variant="outline" onClick={() => setOpen(row.original.id)}>{row.original.status === 'Pending' ? 'Review' : 'View'}</Button> },
  ];
  return (
    <>
      <PageHeader title="Non-token claims" description="Review evidence, then award points or reject with a reason." />
      <Tabs
        tabs={[
          { value: 'pending', label: 'Pending', content: <DataTable endpoint="/regulator/claims/non-token" params={{ state: 'pending' }} columns={columns} /> },
          { value: 'processed', label: 'Processed', content: <DataTable endpoint="/regulator/claims/non-token" params={{ state: 'processed' }} columns={columns} /> },
        ]}
      />
      <Dialog wide open={!!open} onOpenChange={(o) => !o && setOpen(null)} title="Review claim">
        {open && <Review id={open} onDone={() => { setOpen(null); qc.invalidateQueries({ queryKey: ['/regulator/claims/non-token'] }); }} />}
      </Dialog>
    </>
  );
}
