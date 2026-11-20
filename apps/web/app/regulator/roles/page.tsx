'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ConfirmButton } from '@/components/dialog';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, PageHeader } from '@/components/ui';
import { del, get, post, put } from '@/lib/api';
import { useAction } from '@/lib/hooks';

type Role = { id: number; name: string; users: number; permissions: string[] };

export default function RolesPage() {
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: () => get<Role[]>('/admin/roles') });
  const { data: perms = [] } = useQuery({ queryKey: ['permissions'], queryFn: () => get<{ id: number; name: string }[]>('/admin/permissions') });
  const [draft, setDraft] = useState<Record<number, string[]>>({});
  const [newRole, setNewRole] = useState('');
  const [newPerm, setNewPerm] = useState('');
  const save = useAction((r: Role) => put(`/admin/roles/${r.id}`, { name: r.name, permissions: draft[r.id] ?? r.permissions }), { success: 'Role saved', invalidate: ['roles'] });
  const create = useAction(() => post('/admin/roles', { name: newRole }), { success: 'Role created', invalidate: ['roles'] });
  const removeRole = useAction((id: number) => del(`/admin/roles/${id}`), { success: 'Role deleted', invalidate: ['roles'] });
  const createPerm = useAction(() => post('/admin/permissions', { name: newPerm }), { success: 'Permission created', invalidate: ['permissions'] });

  return (
    <>
      <PageHeader title="Roles & permissions" description="Super Admin always has every permission." />
      <div className="mb-6 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="New role name" value={newRole} onChange={(e) => setNewRole(e.target.value)} />
        <Button disabled={newRole.length < 2} onClick={() => create.mutate(undefined, { onSuccess: () => setNewRole('') })}>Add role</Button>
        <Input className="max-w-xs" placeholder="New permission name" value={newPerm} onChange={(e) => setNewPerm(e.target.value)} />
        <Button variant="outline" disabled={newPerm.length < 2} onClick={() => createPerm.mutate(undefined, { onSuccess: () => setNewPerm('') })}>Add permission</Button>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {roles.map((r) => {
          const current = draft[r.id] ?? r.permissions;
          return (
            <Card key={r.id}>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>{r.name}</CardTitle>
                <Badge variant="secondary">{r.users} user{r.users === 1 ? '' : 's'}</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-1 sm:grid-cols-2">
                  {perms.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        disabled={r.name === 'Super Admin'}
                        checked={r.name === 'Super Admin' || current.includes(p.name)}
                        onChange={() => setDraft((d) => ({ ...d, [r.id]: current.includes(p.name) ? current.filter((x) => x !== p.name) : [...current, p.name] }))}
                      />
                      {p.name}
                    </label>
                  ))}
                </div>
                {r.name !== 'Super Admin' && (
                  <div className="flex gap-2">
                    <Button size="sm" disabled={!draft[r.id]} onClick={() => save.mutate(r)}>Save</Button>
                    <ConfirmButton label="Delete role" title={`Delete role ${r.name}?`} onConfirm={() => removeRole.mutateAsync(r.id)} />
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
