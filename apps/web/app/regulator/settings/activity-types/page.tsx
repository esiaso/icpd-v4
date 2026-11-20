'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { activityTypeSchema } from '@icpd/shared';
import { DataTable, type Col } from '@/components/data-table';
import { Dialog } from '@/components/dialog';
import { Badge, Button, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';
import { post, put } from '@/lib/api';
import { applyApiError, useZodForm } from '@/lib/forms';
import { useAction } from '@/lib/hooks';
import { pts } from '@/lib/utils';

type Row = Record<string, any>;

function TypeForm({ row, onDone }: { row?: Row; onDone: () => void }) {
  const qc = useQueryClient();
  const form = useZodForm<any>(activityTypeSchema, {
    defaultValues: {
      name: row?.name ?? '',
      category: row?.category ?? '',
      description: row?.description ?? '',
      evidenceRequired: row?.evidenceRequired ?? '',
      cpdPoints: row ? Number(row.cpdPoints) : 1,
      presenterPoints: row ? Number(row.presenterPoints) : 0,
      moderatorPoints: row ? Number(row.moderatorPoints) : 0,
      maxSessionPoints: row?.maxSessionPoints ? Number(row.maxSessionPoints) : null,
      maxActivityPoints: row?.maxActivityPoints ? Number(row.maxActivityPoints) : null,
      maxYearlyPoints: row?.maxYearlyPoints ? Number(row.maxYearlyPoints) : null,
      claimCondition: row?.claimCondition ?? '',
      deliveryMode: row?.deliveryMode ?? 1,
      initiator: row?.initiator ?? 1,
      eventBased: row?.eventBased ?? true,
    },
  });
  const e = form.formState.errors as any;
  const num = (name: string) => form.register(name, { setValueAs: (v: string) => (v === '' || v === null ? null : Number(v)) });
  const submit = form.handleSubmit(async (v) => {
    try {
      const body = { ...v, claimCondition: v.claimCondition || null };
      row ? await put(`/settings/activity-types/${row.id}`, body) : await post('/settings/activity-types', body);
      qc.invalidateQueries({ queryKey: ['/settings/activity-types'] });
      qc.invalidateQueries({ queryKey: ['reference'] });
      onDone();
    } catch (err) {
      applyApiError(form, err);
    }
  });
  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <div className="sm:col-span-2"><Field label="Name" error={e.name?.message} required><Input {...form.register('name')} /></Field></div>
      <Field label="Category"><Input {...form.register('category')} /></Field>
      <Field label="Claim condition" hint="'once' = one claim of this kind per calendar year">
        <Select {...form.register('claimCondition')}><option value="">None</option><option value="once">once</option></Select>
      </Field>
      <Field label="CPD points per session" error={e.cpdPoints?.message} required><Input type="number" step="0.01" {...num('cpdPoints')} /></Field>
      <Field label="Presenter bonus"><Input type="number" step="0.01" {...num('presenterPoints')} /></Field>
      <Field label="Moderator bonus"><Input type="number" step="0.01" {...num('moderatorPoints')} /></Field>
      <Field label="Max points per session/claim"><Input type="number" step="0.01" {...num('maxSessionPoints')} /></Field>
      <Field label="Max points per activity"><Input type="number" step="0.01" {...num('maxActivityPoints')} /></Field>
      <Field label="Max points per year"><Input type="number" step="0.01" {...num('maxYearlyPoints')} /></Field>
      <Field label="Delivery mode" hint="Online types can be created via the API">
        <Select {...num('deliveryMode')}><option value={1}>Physical</option><option value={2}>Online</option></Select>
      </Field>
      <Field label="Who can create activities">
        <Select {...num('initiator')}><option value={1}>Providers and API</option><option value={0}>Regulator only</option></Select>
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" {...form.register('eventBased')} /> Event-based (has sessions and tokens)</label>
      <div className="sm:col-span-2"><Field label="Evidence required"><Textarea {...form.register('evidenceRequired')} /></Field></div>
      <div className="sm:col-span-2"><Field label="Description"><Textarea {...form.register('description')} /></Field></div>
      <div className="sm:col-span-2"><Button type="submit" loading={form.formState.isSubmitting}>Save</Button></div>
    </form>
  );
}

export default function ActivityTypesPage() {
  const [archived, setArchived] = useState(false);
  const [edit, setEdit] = useState<Row | null | 'new'>(null);
  const toggle = useAction((r: Row) => post(`/settings/activity-types/${r.id}/archive`, { archived: !r.archived }), { success: 'Updated', invalidate: ['/settings/activity-types', 'reference'] });
  const columns: Col<Row>[] = [
    { header: 'Name', accessorKey: 'name', cell: ({ row }) => <div><p className="font-medium">{row.original.name}</p><p className="text-xs text-muted-foreground">{row.original.category}</p></div> },
    { header: 'Points', cell: ({ row }) => `${pts(row.original.cpdPoints)} (+${pts(row.original.presenterPoints)} / +${pts(row.original.moderatorPoints)})` },
    { header: 'Caps (claim / year)', cell: ({ row }) => `${row.original.maxSessionPoints ? pts(row.original.maxSessionPoints) : '—'} / ${row.original.maxYearlyPoints ? pts(row.original.maxYearlyPoints) : '—'}` },
    { header: 'Flags', cell: ({ row }) => <div className="flex gap-1">{row.original.claimCondition && <Badge variant="warning">{row.original.claimCondition}</Badge>}{row.original.deliveryMode === 2 && <Badge>online</Badge>}</div> },
    {
      id: 'a',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setEdit(row.original)}>Edit</Button>
          <Button size="sm" variant="outline" onClick={() => toggle.mutate(row.original)}>{row.original.archived ? 'Restore' : 'Archive'}</Button>
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader title="Activity types" description="Points per session, role bonuses and caps." actions={<Button onClick={() => setEdit('new')}>Add activity type</Button>} />
      <DataTable
        endpoint="/settings/activity-types"
        params={{ archived }}
        columns={columns}
        toolbar={<Button variant="outline" size="sm" onClick={() => setArchived((a) => !a)}>{archived ? 'Show active' : 'Show archived'}</Button>}
      />
      <Dialog wide open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} title={edit === 'new' ? 'Add activity type' : 'Edit activity type'}>
        {edit !== null && <TypeForm row={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} />}
      </Dialog>
    </>
  );
}
