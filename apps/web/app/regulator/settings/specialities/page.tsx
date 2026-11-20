'use client';
import { useState } from 'react';
import { z } from 'zod';
import { DataTable, type Col } from '@/components/data-table';
import { ConfirmButton, Dialog } from '@/components/dialog';
import { Button, Field, Input, PageHeader, Textarea } from '@/components/ui';
import { del, post, put } from '@/lib/api';
import { applyApiError, useZodForm } from '@/lib/forms';
import { useAction } from '@/lib/hooks';
import { useQueryClient } from '@tanstack/react-query';

const schema = z.object({ name: z.string().min(2, 'Required'), description: z.string().optional() });
type Row = { id: number; name: string; description: string | null };

function SpecialityForm({ row, onDone }: { row?: Row; onDone: () => void }) {
  const qc = useQueryClient();
  const form = useZodForm<z.infer<typeof schema>>(schema, { defaultValues: { name: row?.name ?? '', description: row?.description ?? '' } });
  const submit = form.handleSubmit(async (v) => {
    try {
      row ? await put(`/settings/specialities/${row.id}`, v) : await post('/settings/specialities', v);
      qc.invalidateQueries({ queryKey: ['/settings/specialities'] });
      qc.invalidateQueries({ queryKey: ['reference'] });
      onDone();
    } catch (e) {
      applyApiError(form, e);
    }
  });
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Name" error={form.formState.errors.name?.message} required><Input {...form.register('name')} /></Field>
      <Field label="Description"><Textarea {...form.register('description')} /></Field>
      <Button type="submit" loading={form.formState.isSubmitting}>Save</Button>
    </form>
  );
}

export default function SpecialitiesPage() {
  const [edit, setEdit] = useState<Row | null | 'new'>(null);
  const remove = useAction((id: number) => del(`/settings/specialities/${id}`), { success: 'Deleted', invalidate: ['/settings/specialities', 'reference'] });
  const columns: Col<Row>[] = [
    { header: 'Name', accessorKey: 'name' },
    { header: 'Description', accessorKey: 'description', cell: (c) => c.getValue() ?? '—' },
    {
      header: '',
      id: 'actions',
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setEdit(row.original)}>Edit</Button>
          <ConfirmButton label="Delete" title={`Delete ${row.original.name}?`} onConfirm={() => remove.mutateAsync(row.original.id)} />
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader title="Specializations" actions={<Button onClick={() => setEdit('new')}>Add specialization</Button>} />
      <DataTable endpoint="/settings/specialities" columns={columns} />
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} title={edit === 'new' ? 'Add specialization' : 'Edit specialization'}>
        {edit !== null && <SpecialityForm row={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} />}
      </Dialog>
    </>
  );
}
