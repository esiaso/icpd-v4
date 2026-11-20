'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DataTable, type Col } from '@/components/data-table';
import { ConfirmButton, Dialog } from '@/components/dialog';
import { Alert, Badge, Button, Field, Input, Select, Textarea, PageHeader } from '@/components/ui';
import { ApiError, del, get, post, put } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { fmtDate } from '@/lib/utils';

function AppForm({ row, onDone }: { row?: any; onDone: () => void }) {
  const { data: providers } = useQuery({ queryKey: ['all-providers'], queryFn: () => get('/regulator/providers?pageSize=200') });
  const [council, setCouncil] = useState<boolean>(row?.isCouncil ?? false);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const v: any = Object.fromEntries(new FormData(e.currentTarget));
        v.isCouncil = council;
        if (!v.providerId) delete v.providerId;
        setBusy(true);
        try {
          row ? await put(`/regulator/apps/${row.id}`, v) : await post('/regulator/apps', v);
          onDone();
        } catch (err) {
          applyApiError(null, err);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Field label="Name" required><Input name="name" defaultValue={row?.name} required /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={council} onChange={(e) => setCouncil(e.target.checked)} /> Council / board credential (reads the council diary only)</label>
      {!council && (
        <Field label="Provider" required>
          <Select name="providerId" defaultValue={row?.providerId ?? ''} required><option value="">Choose…</option>{providers?.data.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
        </Field>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Type"><Select name="type" defaultValue={row?.type ?? 'WEB'}><option>WEB</option><option>MOBILE</option><option>IOT</option></Select></Field>
        <Field label="Status"><Select name="status" defaultValue={row?.status ?? 'INACTIVE'}><option>ACTIVE</option><option>INACTIVE</option><option>SUSPENDED</option><option>BLOCKED</option></Select></Field>
      </div>
      <Field label="URL"><Input name="url" type="url" defaultValue={row?.url ?? ''} /></Field>
      <Field label="Description"><Textarea name="description" defaultValue={row?.description ?? ''} /></Field>
      <Field label="Note"><Textarea name="note" defaultValue={row?.note ?? ''} /></Field>
      <Button type="submit" loading={busy}>Save</Button>
    </form>
  );
}

export default function ApiAppsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [edit, setEdit] = useState<any | null | 'new'>(null);
  const [creds, setCreds] = useState<any | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['/regulator/apps'] });
  async function rotate(id: number) {
    try {
      setCreds(await post(`/regulator/apps/${id}/credentials`));
      refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PASSWORD_CONFIRMATION_REQUIRED') router.push('/confirm-password?next=/regulator/apps');
      else applyApiError(null, e);
    }
  }
  const columns: Col<any>[] = [
    { header: 'App', cell: ({ row }) => <div><p className="font-medium">{row.original.name}</p><p className="text-xs text-muted-foreground">{row.original.isCouncil ? 'Council credential' : row.original.provider?.name}</p></div> },
    { header: 'Type', accessorKey: 'type' },
    { header: 'Status', cell: ({ row }) => <Badge variant={row.original.status === 'ACTIVE' ? 'success' : row.original.status === 'INACTIVE' ? 'secondary' : 'destructive'}>{row.original.status}</Badge> },
    { header: 'Key', cell: ({ row }) => (row.original.key ? <code className="text-xs">{row.original.key}</code> : '—') },
    { header: 'Rotated', cell: ({ row }) => fmtDate(row.original.rotatedAt, true) },
    {
      id: 'a',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="outline" onClick={() => setEdit(row.original)}>Edit</Button>
          <ConfirmButton variant="outline" label={row.original.hasCredentials ? 'Rotate secret' : 'Generate credentials'} title="Generate new credentials?" message={row.original.hasCredentials ? 'The current secret stops working immediately.' : 'The secret is shown once.'} confirmLabel="Generate" onConfirm={() => rotate(row.original.id)} />
          <ConfirmButton label="Delete" title={`Delete ${row.original.name}?`} onConfirm={async () => { await del(`/regulator/apps/${row.original.id}`); refresh(); }} />
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader title="API consumer apps" description="Credentials for provider systems calling /api/v1." actions={<Button onClick={() => setEdit('new')}>New app</Button>} />
      <DataTable endpoint="/regulator/apps" columns={columns} />
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} title={edit === 'new' ? 'New API app' : 'Edit API app'}>
        {edit !== null && <AppForm row={edit === 'new' ? undefined : edit} onDone={() => { setEdit(null); refresh(); toast.success('Saved'); }} />}
      </Dialog>
      <Dialog open={!!creds} onOpenChange={(o) => !o && setCreds(null)} title="API credentials" description="Copy or download these now. The secret cannot be shown again.">
        {creds && (
          <div className="space-y-3 text-sm">
            <Alert variant="warning">Store the secret securely. Anyone with it can act for this provider.</Alert>
            <Field label="Key"><Input readOnly value={creds.key} className="font-mono" /></Field>
            <Field label="Secret"><Input readOnly value={creds.secret} className="font-mono" /></Field>
            <Field label="Header"><Textarea readOnly value={creds.header} className="font-mono text-xs" /></Field>
            <Button
              onClick={() => {
                const url = URL.createObjectURL(new Blob([creds.file], { type: 'text/plain' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = 'icpd-api-credentials.txt';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download credentials file
            </Button>
          </div>
        )}
      </Dialog>
    </>
  );
}
