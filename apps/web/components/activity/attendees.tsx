'use client';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DataTable, type Col } from '../data-table';
import { ConfirmButton, Dialog } from '../dialog';
import { Badge, Button, Card, CardContent, Field, Input, Progress, Select } from '../ui';
import { del, download, get, post, put, upload } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { fmtDate, pts } from '@/lib/utils';

const importVariant = (s: string) => (s === 'processed' ? 'success' : s === 'failed' ? 'destructive' : s === 'revoked' ? 'warning' : 'secondary') as any;

function JobProgress({ runId, onDone }: { runId: string; onDone: () => void }) {
  const [run, setRun] = useState<any>(null);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const r = await get(`/jobs/${runId}`).catch(() => null);
      if (stop) return;
      setRun(r);
      if (r && (r.status === 'done' || r.status === 'failed')) {
        if (r.status === 'done') toast.success(r.result?.message ?? 'Done');
        else toast.error(r.error ?? 'The job failed');
        onDone();
      } else setTimeout(tick, 1500);
    };
    tick();
    return () => {
      stop = true;
    };
  }, [runId, onDone]);
  if (!run || run.status === 'done' || run.status === 'failed') return null;
  return (
    <Card>
      <CardContent className="space-y-2 pt-5 text-sm">
        <p>Processing attendees… {run.progress} of {run.total || '?'}</p>
        <Progress value={run.total ? (run.progress / run.total) * 100 : 5} />
      </CardContent>
    </Card>
  );
}

/** Attendees: who claimed points, and the imported attendee list with processing. */
export function Attendees({ base }: { base: string; activity: any }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<any | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith(base) });

  async function run(fn: () => Promise<any>, msg?: (r: any) => string) {
    setBusy(true);
    try {
      const r = await fn();
      if (msg) toast.success(msg(r));
      refresh();
      return r;
    } catch (e) {
      applyApiError(null, e);
    } finally {
      setBusy(false);
    }
  }

  const claimCols: Col<any>[] = [
    { header: 'Practitioner', cell: ({ row }) => <div><p>{row.original.practitioner.firstName} {row.original.practitioner.lastName}</p><p className="font-mono text-xs text-muted-foreground">{row.original.practitioner.regNo}</p></div> },
    { header: 'Points', cell: ({ row }) => pts(row.original.cpdPoints) },
    { header: 'Method', cell: ({ row }) => <Badge variant="secondary">{row.original.method}</Badge> },
    { header: 'Trail', cell: ({ row }) => <span className="font-mono text-xs">{row.original.tokenTrail}</span> },
    { header: 'Claimed', cell: ({ row }) => fmtDate(row.original.claimedAt, true) },
  ];
  const importCols: Col<any>[] = [
    { header: 'Reg. no.', cell: ({ row }) => <span className="font-mono">{row.original.regNo}</span> },
    { header: 'Name', accessorKey: 'fullName' },
    { header: 'Session', accessorKey: 'session' },
    { header: 'Status', cell: ({ row }) => <Badge variant={importVariant(row.original.status)}>{row.original.status}</Badge> },
    { header: 'Comment', accessorKey: 'comment' },
    {
      id: 'a',
      header: '',
      cell: ({ row }) =>
        row.original.status !== 'processed' && (
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => run(() => post(`${base}/imports/${row.original.id}/process`), (r) => r.message)}>Process</Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(row.original)}>Edit</Button>
            <ConfirmButton label="Delete" title={`Remove ${row.original.regNo} from the list?`} onConfirm={() => run(() => del(`${base}/imports/${row.original.id}`), () => 'Removed')} />
          </div>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="font-semibold">Upload attendee list</h3>
        <p className="text-sm text-muted-foreground">Excel (.xlsx/.xls, up to 10 MB) with a heading row: <code>regno</code>, <code>fullname</code>, <code>email</code>, <code>activitysession</code> (defaults to 1). Rows without a reg. no. and duplicates are skipped.</p>
        <div className="flex flex-wrap items-end gap-2">
          <Button variant="outline" onClick={() => download(`${base}/imports/template`, 'attendees-template.xlsx')}>Download template</Button>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              if (!(fd.get('file') as File)?.size) return toast.error('Choose a file first');
              await run(() => upload(`${base}/imports`, fd), (r) => `${r.imported} rows imported, ${r.skipped} skipped`);
              (e.target as HTMLFormElement).reset();
            }}
          >
            <Input type="file" name="file" accept=".xlsx,.xls" className="max-w-xs" />
            <Button type="submit" loading={busy}>Upload</Button>
          </form>
          <Button
            onClick={async () => {
              const r = await run(() => post(`${base}/imports/process-all`));
              if (r?.id) setRunId(String(r.id));
            }}
          >
            Process all
          </Button>
        </div>
        {runId && <JobProgress runId={runId} onDone={() => { setRunId(null); refresh(); }} />}
        <DataTable
          endpoint={`${base}/imports`}
          params={{ status }}
          columns={importCols}
          searchPlaceholder="Search reg. no. or name"
          toolbar={
            <Select className="w-40" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Any status</option><option value="unprocessed">Unprocessed</option><option value="processed">Processed</option><option value="failed">Failed</option><option value="revoked">Revoked</option>
            </Select>
          }
        />
      </section>
      <section className="space-y-3">
        <h3 className="font-semibold">Practitioners who earned points</h3>
        <DataTable endpoint={`${base}/claims`} columns={claimCols} searchPlaceholder="Search reg. no. or name" />
      </section>
      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title="Edit imported attendee">
        {edit && (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              await run(() => put(`${base}/imports/${edit.id}`, Object.fromEntries(new FormData(e.currentTarget))), () => 'Saved');
              setEdit(null);
            }}
          >
            <Field label="Reg. no." required><Input name="regNo" defaultValue={edit.regNo} required /></Field>
            <Field label="Full name"><Input name="fullName" defaultValue={edit.fullName ?? ''} /></Field>
            <Field label="Email"><Input name="email" type="email" defaultValue={edit.email ?? ''} /></Field>
            <Field label="Session"><Input name="session" type="number" min={1} defaultValue={edit.session} /></Field>
            <Button type="submit" loading={busy}>Save</Button>
          </form>
        )}
      </Dialog>
    </div>
  );
}
