'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DataTable, type Col } from '@/components/data-table';
import { ConfirmButton, Dialog } from '@/components/dialog';
import { ProviderForm } from '@/components/provider-form';
import { Tabs } from '@/components/tabs';
import { Badge, Button, Card, CardContent, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';
import { del, get, post, put, upload } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { useAction } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';
import { nairobiToday } from '@icpd/shared';

const statusVariant = (s: string) => (s === 'active' ? 'success' : s === 'suspended' ? 'destructive' : 'secondary') as any;

function Users({ id }: { id: string }) {
  const { data = [] } = useQuery({ queryKey: ['prov-users', id], queryFn: () => get<any[]>(`/regulator/providers/${id}/users`) });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const remove = useAction((puid: string) => del(`/regulator/providers/${id}/users/${puid}`), { success: 'User removed', invalidate: ['prov-users'] });
  async function add(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      await post(`/regulator/providers/${id}/users`, Object.fromEntries(new FormData(e.currentTarget)));
      toast.success('User added and notified by email');
      qc.invalidateQueries({ queryKey: ['prov-users', id] });
      setOpen(false);
    } catch (err) {
      applyApiError(null, err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <Button onClick={() => setOpen(true)}>Add coordinator</Button>
      <Card className="divide-y">
        {data.map((pu) => (
          <div key={pu.id} className="flex items-center justify-between p-3 text-sm">
            <div>
              <p className="font-medium">{pu.user.name}</p>
              <p className="text-muted-foreground">{pu.user.email} · last login {fmtDate(pu.user.lastLoginAt, true)}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={pu.status === 'Active' ? 'success' : 'secondary'}>{pu.status}</Badge>
              <ConfirmButton label="Remove" title={`Remove ${pu.user.name}?`} onConfirm={() => remove.mutateAsync(pu.id)} />
            </div>
          </div>
        ))}
        {!data.length && <p className="p-4 text-sm text-muted-foreground">No coordinators yet.</p>}
      </Card>
      <Dialog open={open} onOpenChange={setOpen} title="Add coordinator" description="Existing practitioners keep their practitioner access. New users get an email to set a password.">
        <form onSubmit={add} className="space-y-4">
          <Field label="Name" required><Input name="name" required minLength={2} /></Field>
          <Field label="Email" required><Input name="email" type="email" required /></Field>
          <Button type="submit" loading={busy}>Add</Button>
        </form>
      </Dialog>
    </div>
  );
}

function Status({ id, current }: { id: string; current: string }) {
  const { data = [] } = useQuery({ queryKey: ['prov-status', id], queryFn: () => get<any[]>(`/regulator/providers/${id}/status-history`) });
  const change = useAction((v: any) => post(`/regulator/providers/${id}/status`, v), { success: 'Status updated', invalidate: ['prov-status', 'prov'] });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardContent className="pt-5">
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              change.mutate(Object.fromEntries(new FormData(e.currentTarget)));
            }}
          >
            <Field label="New status" required>
              <Select name="status" defaultValue={current}><option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option></Select>
            </Field>
            <Field label="Effective date" required><Input type="date" name="effectiveDate" defaultValue={nairobiToday()} required /></Field>
            <Field label="Notes"><Textarea name="notes" /></Field>
            <Button type="submit" loading={change.isPending}>Change status</Button>
          </form>
        </CardContent>
      </Card>
      <Card className="divide-y">
        {data.map((h) => (
          <div key={h.id} className="p-3 text-sm">
            <p><Badge variant={statusVariant(h.status)}>{h.status}</Badge> <span className="text-muted-foreground">from {fmtDate(h.effectiveDate)}</span></p>
            {h.notes && <p className="mt-1">{h.notes}</p>}
          </div>
        ))}
        {!data.length && <p className="p-4 text-sm text-muted-foreground">No status changes recorded.</p>}
      </Card>
    </div>
  );
}

export default function ProviderDetail({ params }: { params: { id: string } }) {
  const id = params.id;
  const router = useRouter();
  const qc = useQueryClient();
  const { data: p } = useQuery({ queryKey: ['prov', id], queryFn: () => get(`/regulator/providers/${id}`) });
  const remove = useAction(() => del(`/regulator/providers/${id}`), { success: 'Provider deleted' });
  if (!p) return null;
  const activityCols: Col<any>[] = [
    { header: 'Activity', sortKey: 'name', cell: ({ row }) => <Link className="text-primary hover:underline" href={`/providers/${id}/activities/${row.original.id}`}>{row.original.name}</Link> },
    { header: 'Type', cell: ({ row }) => row.original.type?.name },
    { header: 'Dates', sortKey: 'releaseDate', cell: ({ row }) => `${fmtDate(row.original.releaseDate)} to ${fmtDate(row.original.expiryDate)}` },
    { header: 'Published', sortKey: 'published', cell: ({ row }) => (row.original.published ? <Badge variant="success">yes</Badge> : <Badge variant="secondary">no</Badge>) },
  ];
  return (
    <>
      <PageHeader
        title={p.name}
        description={`${p.regNo ?? ''} · ${p.town ?? ''}`}
        actions={
          <>
            <Badge variant={statusVariant(p.status)} className="self-center">{p.status}</Badge>
            <ConfirmButton label="Delete provider" title={`Delete ${p.name}?`} onConfirm={async () => { await remove.mutateAsync(); router.push('/regulator/providers'); }} />
          </>
        }
      />
      <Tabs
        tabs={[
          {
            value: 'details',
            label: 'Details',
            content: (
              <Card>
                <CardContent className="space-y-5 pt-5">
                  <div className="flex items-center gap-4">
                    {p.logoSignedUrl && <img src={p.logoSignedUrl} alt="" className="h-14 w-auto rounded border" />}
                    <label className="text-sm">
                      <span className="mr-2 text-muted-foreground">Logo</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={async (e) => {
                          const f = e.target.files?.[0];
                          if (!f) return;
                          const fd = new FormData();
                          fd.set('file', f);
                          try {
                            await upload(`/regulator/providers/${id}/logo`, fd);
                            toast.success('Logo updated');
                            qc.invalidateQueries({ queryKey: ['prov', id] });
                          } catch (err) {
                            applyApiError(null, err);
                          }
                        }}
                      />
                    </label>
                  </div>
                  <ProviderForm initial={p} onSubmit={async (v) => { await put(`/regulator/providers/${id}`, v); toast.success('Saved'); qc.invalidateQueries({ queryKey: ['prov', id] }); }} />
                </CardContent>
              </Card>
            ),
          },
          { value: 'users', label: 'Coordinators', content: <Users id={id} /> },
          { value: 'status', label: 'Status history', content: <Status id={id} current={p.status} /> },
          { value: 'activities', label: 'Activities', content: <DataTable endpoint={`/regulator/providers/${id}/activities`} columns={activityCols} /> },
        ]}
      />
    </>
  );
}
