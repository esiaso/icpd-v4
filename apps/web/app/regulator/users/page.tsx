'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DataTable, type Col } from '@/components/data-table';
import { ConfirmButton, Dialog } from '@/components/dialog';
import { Badge, Button, Field, Input, PageHeader, Select } from '@/components/ui';
import { ApiError, del, get, patch, post } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { useAction } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';

type Row = { id: string; name: string; email: string; emailVerifiedAt: string | null; lastLoginAt: string | null; roles: string[]; permissions?: string[] };

function UserForm({ row, onDone }: { row?: Row; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: () => get<any[]>('/admin/roles') });
  const { data: perms = [] } = useQuery({ queryKey: ['permissions'], queryFn: () => get<any[]>('/admin/permissions') });
  const { data: full } = useQuery({ queryKey: ['user', row?.id], queryFn: () => get<Row>(`/admin/users/${row!.id}`), enabled: !!row });
  const [selRoles, setSelRoles] = useState<string[] | null>(null);
  const [selPerms, setSelPerms] = useState<string[] | null>(null);
  const r = selRoles ?? full?.roles ?? row?.roles ?? [];
  const p = selPerms ?? full?.permissions ?? [];
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const body = { name: fd.get('name'), email: fd.get('email'), roles: r, permissions: p };
    setBusy(true);
    try {
      row ? await patch(`/admin/users/${row.id}`, body) : await post('/admin/users', body);
      qc.invalidateQueries({ queryKey: ['/admin/users'] });
      onDone();
    } catch (err) {
      applyApiError(null, err);
    } finally {
      setBusy(false);
    }
  }
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Name" required><Input name="name" defaultValue={row?.name} required /></Field>
      <Field label="Email" required><Input name="email" type="email" defaultValue={row?.email} required /></Field>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Roles</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {roles.map((x) => (
            <label key={x.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={r.includes(x.name)} onChange={() => setSelRoles(toggle(r, x.name))} /> {x.name}</label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Extra direct permissions</legend>
        <div className="grid gap-1 sm:grid-cols-2">
          {perms.map((x) => (
            <label key={x.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.includes(x.name)} onChange={() => setSelPerms(toggle(p, x.name))} /> {x.name}</label>
          ))}
        </div>
      </fieldset>
      {!row && <p className="text-xs text-muted-foreground">The user receives an email to set their password.</p>}
      <Button type="submit" loading={busy}>Save user</Button>
    </form>
  );
}

export default function UsersPage() {
  const router = useRouter();
  const [edit, setEdit] = useState<Row | null | 'new'>(null);
  const [filter, setFilter] = useState('');
  const verify = useAction((id: string) => post(`/admin/users/${id}/verify`), { success: 'Marked as verified', invalidate: ['/admin/users'] });
  const remove = useAction(
    async (id: string) => {
      try {
        return await del(`/admin/users/${id}`);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'PASSWORD_CONFIRMATION_REQUIRED') router.push('/confirm-password?next=/regulator/users');
        throw e;
      }
    },
    { success: 'User deleted', invalidate: ['/admin/users'] },
  );
  const columns: Col<Row>[] = [
    { header: 'Name', cell: ({ row }) => <div><p className="font-medium">{row.original.name}</p><p className="text-xs text-muted-foreground">{row.original.email}</p></div> },
    { header: 'Roles', cell: ({ row }) => <div className="flex flex-wrap gap-1">{row.original.roles.map((r) => <Badge key={r} variant="secondary">{r}</Badge>)}</div> },
    { header: 'Email', cell: ({ row }) => (row.original.emailVerifiedAt ? <Badge variant="success">verified</Badge> : <Badge variant="warning">unverified</Badge>) },
    { header: 'Last login', cell: ({ row }) => fmtDate(row.original.lastLoginAt, true) },
    {
      id: 'a',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          {!row.original.emailVerifiedAt && <Button size="sm" variant="outline" onClick={() => verify.mutate(row.original.id)}>Verify</Button>}
          <Button size="sm" variant="outline" onClick={() => setEdit(row.original)}>Edit</Button>
          <ConfirmButton label="Delete" title={`Delete ${row.original.name}?`} message="The user will no longer be able to sign in." onConfirm={() => remove.mutateAsync(row.original.id)} />
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader title="Users" actions={<Button onClick={() => setEdit('new')}>Add user</Button>} />
      <DataTable
        endpoint="/admin/users"
        params={{ unverified: filter === 'unverified' ? 'true' : undefined, role: filter && filter !== 'unverified' ? filter : undefined }}
        columns={columns}
        toolbar={
          <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-56">
            <option value="">All users</option>
            <option value="unverified">Unverified emails</option>
            {['Super Admin', 'Admin', 'Regulator CPD Officer', 'Provider Coordinator', 'Practitioner', 'Public User'].map((r) => <option key={r} value={r}>{r}</option>)}
          </Select>
        }
      />
      <Dialog wide open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} title={edit === 'new' ? 'Add user' : 'Edit user'}>
        {edit !== null && <UserForm row={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} />}
      </Dialog>
    </>
  );
}
