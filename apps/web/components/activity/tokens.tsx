'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { nairobiToday } from '@icpd/shared';
import { DataTable, type Col } from '../data-table';
import { ConfirmButton, Dialog } from '../dialog';
import { Badge, Button, Card, CardContent, Field, Input, Select, Stat } from '../ui';
import { download, get, patch, post, put, del } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { fmtDate } from '@/lib/utils';

const variant = (s: string) => (s === 'claimed' ? 'success' : s === 'expired' ? 'destructive' : 'secondary') as any;

/** Token tools for one activity: generate, list/search, edit, bulk edit/delete by batch or session, download. */
export function Tokens({ base, activity }: { base: string; activity: any }) {
  const url = `${base}/tokens`;
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith(url) });
  const { data: sum } = useQuery({ queryKey: [`${url}/summary`], queryFn: () => get(`${url}/summary`) });
  const [filter, setFilter] = useState<{ status?: string; sessionNo?: string; batch?: string }>({});
  const [gen, setGen] = useState(false);
  const [bulk, setBulk] = useState<{ batch?: string; sessionNo?: number } | null>(null);
  const [editTok, setEditTok] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const sessions = activity.sessions as { sessionNo: number; label: string }[];
  const today = nairobiToday();

  async function run(fn: () => Promise<any>, msg: (r: any) => string) {
    setBusy(true);
    try {
      const r = await fn();
      toast.success(msg(r));
      refresh();
      return true;
    } catch (e) {
      applyApiError(null, e);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const columns: Col<any>[] = [
    { header: 'Token', sortKey: 'token', cell: ({ row }) => <span className="font-mono">{row.original.token}</span> },
    { header: 'Session', sortKey: 'sessionNo', accessorKey: 'sessionNo' },
    { header: 'Batch', sortKey: 'batch', cell: ({ row }) => <button className="font-mono text-xs text-primary underline" onClick={() => setFilter({ batch: row.original.batch })}>{row.original.batch}</button> },
    { header: 'Valid', sortKey: 'expiryDate', cell: ({ row }) => <span className="whitespace-nowrap text-xs">{fmtDate(row.original.validFrom)} to {fmtDate(row.original.expiryDate)}</span> },
    { header: 'Status', cell: ({ row }) => <Badge variant={variant(row.original.computedStatus)}>{row.original.computedStatus}</Badge> },
    { header: 'Claimed by', sortKey: 'claimedAt', cell: ({ row }) => (row.original.claimer ? <span className="text-xs">{row.original.claimer.regNo} · {fmtDate(row.original.claimedAt, true)}</span> : '—') },
    {
      id: 'a',
      header: '',
      cell: ({ row }) =>
        row.original.status !== 'claimed' && (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => setEditTok(row.original)}>Edit</Button>
            <ConfirmButton label="Delete" title={`Delete token ${row.original.token}?`} onConfirm={() => run(() => del(`${url}/${row.original.id}`), () => 'Token deleted')} />
          </div>
        ),
    },
  ];

  const dl = (format: 'pdf' | 'xlsx', scope: Record<string, any> = {}) => {
    const q = new URLSearchParams({ format, ...Object.fromEntries(Object.entries(scope).filter(([, v]) => v)) });
    return download(`${url}/download?${q}`, `tokens-${activity.id}.${format}`).catch((e) => applyApiError(null, e));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total" value={sum?.total ?? '—'} />
        <Stat label="Claimed" value={sum?.claimed ?? '—'} />
        <Stat label="Unclaimed" value={sum?.unclaimed ?? '—'} />
        <Stat label="Expired" value={sum?.expired ?? '—'} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setGen(true)}>Generate tokens</Button>
        <Button variant="outline" onClick={() => dl('pdf')}>Download all (PDF cards)</Button>
        <Button variant="outline" onClick={() => dl('xlsx')}>Download all (Excel)</Button>
      </div>

      {!!sum?.batches.length && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-left"><tr><th className="px-3 py-2">Batch</th><th className="px-3 py-2">Session</th><th className="px-3 py-2">Tokens</th><th className="px-3 py-2">Validity</th><th /></tr></thead>
              <tbody>
                {sum.batches.map((b: any) => (
                  <tr key={b.batch} className="border-t">
                    <td className="px-3 py-2 font-mono text-xs">{b.batch}</td>
                    <td className="px-3 py-2">{b.sessionNo}</td>
                    <td className="px-3 py-2">{b.count}</td>
                    <td className="px-3 py-2 text-xs">{fmtDate(b.validFrom)} to {fmtDate(b.expiryDate)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => dl('pdf', { batch: b.batch })}>PDF</Button>
                        <Button size="sm" variant="ghost" onClick={() => setBulk({ batch: b.batch })}>Edit validity</Button>
                        <ConfirmButton label="Delete" title={`Delete unclaimed tokens in batch ${b.batch}?`} message="Claimed tokens are kept." onConfirm={() => run(() => post(`${url}/delete`, { batch: b.batch }), (r) => `${r.deleted} tokens deleted`)} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted-foreground">By session:</span>
        {sessions.map((s) => (
          <span key={s.sessionNo} className="inline-flex items-center gap-1 rounded-md border px-2 py-1">
            {s.label}
            <button className="text-primary underline" onClick={() => dl('pdf', { sessionNo: s.sessionNo })}>PDF</button>
            <button className="text-primary underline" onClick={() => setBulk({ sessionNo: s.sessionNo })}>edit</button>
            <ConfirmButton label="delete" variant="outline" title={`Delete unclaimed tokens for ${s.label}?`} onConfirm={() => run(() => post(`${url}/delete`, { sessionNo: s.sessionNo }), (r) => `${r.deleted} tokens deleted`)} />
          </span>
        ))}
      </div>

      <DataTable
        endpoint={url}
        params={filter}
        columns={columns}
        searchPlaceholder="Search token"
        toolbar={
          <>
            <Select className="w-36" value={filter.status ?? ''} onChange={(e) => setFilter({ ...filter, status: e.target.value || undefined })}>
              <option value="">Any status</option><option value="unclaimed">Unclaimed</option><option value="claimed">Claimed</option><option value="expired">Expired</option>
            </Select>
            <Select className="w-40" value={filter.sessionNo ?? ''} onChange={(e) => setFilter({ ...filter, sessionNo: e.target.value || undefined })}>
              <option value="">All sessions</option>
              {sessions.map((s) => <option key={s.sessionNo} value={s.sessionNo}>{s.label}</option>)}
            </Select>
            {filter.batch && <Button size="sm" variant="outline" onClick={() => setFilter({ ...filter, batch: undefined })}>Batch {filter.batch} ✕</Button>}
          </>
        }
      />

      <Dialog open={gen} onOpenChange={setGen} title="Generate tokens" description="Tokens are printed in batches of 30. Each attendee uses one token per session.">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const v = Object.fromEntries(new FormData(e.currentTarget));
            if (await run(() => post(url, v), (r) => `${r.created} tokens created in ${r.batches.length} batch(es)`)) setGen(false);
          }}
        >
          <Field label="Session" required>
            <Select name="sessionNo">{sessions.map((s) => <option key={s.sessionNo} value={s.sessionNo}>{s.label}</option>)}</Select>
          </Field>
          <Field label="How many tokens" required><Input name="count" type="number" min={1} max={5000} defaultValue={30} required /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Valid from" required><Input name="validFrom" type="date" defaultValue={activity.releaseDate.slice(0, 10)} required /></Field>
            <Field label="Valid to" required><Input name="expiryDate" type="date" defaultValue={activity.expiryDate.slice(0, 10) < today ? today : activity.expiryDate.slice(0, 10)} required /></Field>
          </div>
          <Button type="submit" loading={busy}>Generate</Button>
        </form>
      </Dialog>

      <Dialog open={!!bulk} onOpenChange={(o) => !o && setBulk(null)} title={bulk?.batch ? `Edit validity for batch ${bulk.batch}` : `Edit validity for session ${bulk?.sessionNo}`} description="Applies to unclaimed tokens only.">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const v = Object.fromEntries(new FormData(e.currentTarget));
            if (await run(() => patch(url, { ...bulk, ...v }), (r) => `${r.updated} tokens updated`)) setBulk(null);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Valid from" required><Input name="validFrom" type="date" required /></Field>
            <Field label="Valid to" required><Input name="expiryDate" type="date" required /></Field>
          </div>
          <Button type="submit" loading={busy}>Update</Button>
        </form>
      </Dialog>

      <Dialog open={!!editTok} onOpenChange={(o) => !o && setEditTok(null)} title={`Edit token ${editTok?.token ?? ''}`}>
        {editTok && (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const v = { validFrom: fd.get('validFrom'), expiryDate: fd.get('expiryDate'), issued: fd.get('issued') === 'on' };
              if (await run(() => put(`${url}/${editTok.id}`, v), () => 'Token updated')) setEditTok(null);
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Valid from"><Input name="validFrom" type="date" defaultValue={editTok.validFrom.slice(0, 10)} /></Field>
              <Field label="Valid to"><Input name="expiryDate" type="date" defaultValue={editTok.expiryDate.slice(0, 10)} /></Field>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="issued" defaultChecked={editTok.issued} /> Issued to an attendee</label>
            <Button type="submit" loading={busy}>Save</Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}
