'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Dialog } from '@/components/dialog';
import { Button, Card, Field, Input, PageHeader } from '@/components/ui';
import { get, post, put } from '@/lib/api';
import { applyApiError, useZodForm } from '@/lib/forms';
import { useAction } from '@/lib/hooks';

const schema = z.object({
  name: z.string().min(2, 'Required'),
  prefixLetter: z.string().regex(/^[A-Za-z]$/, 'One letter'),
  minimumLength: z.coerce.number().int().min(1).max(9),
});
type Row = { id: number; name: string; prefixLetter: string; minimumLength: number; archived: boolean };

function CategoryForm({ row, onDone }: { row?: Row; onDone: () => void }) {
  const qc = useQueryClient();
  const form = useZodForm<z.infer<typeof schema>>(schema, { defaultValues: row ?? { name: '', prefixLetter: '', minimumLength: 2 } });
  const submit = form.handleSubmit(async (v) => {
    try {
      row ? await put(`/settings/user-categories/${row.id}`, v) : await post('/settings/user-categories', v);
      qc.invalidateQueries({ queryKey: ['categories'] });
      onDone();
    } catch (e) {
      applyApiError(form, e);
    }
  });
  const e = form.formState.errors;
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Name" error={e.name?.message} required><Input {...form.register('name')} /></Field>
      <Field label="Registration number prefix" error={e.prefixLetter?.message} required><Input maxLength={1} {...form.register('prefixLetter')} /></Field>
      <Field label="Minimum digits after the prefix" error={e.minimumLength?.message} required><Input type="number" {...form.register('minimumLength')} /></Field>
      <Button type="submit" loading={form.formState.isSubmitting}>Save</Button>
    </form>
  );
}

export default function UserCategoriesPage() {
  const [archived, setArchived] = useState(false);
  const [edit, setEdit] = useState<Row | null | 'new'>(null);
  const { data = [] } = useQuery({ queryKey: ['categories', archived], queryFn: () => get<Row[]>(`/settings/user-categories?archived=${archived}`) });
  const toggle = useAction((r: Row) => post(`/settings/user-categories/${r.id}/archive`, { archived: !r.archived }), { success: 'Updated', invalidate: ['categories'] });
  return (
    <>
      <PageHeader
        title="User categories"
        description="Categories drive registration number prefixes (A, B, … G)."
        actions={<><Button variant="outline" onClick={() => setArchived((a) => !a)}>{archived ? 'Show active' : 'Show archived'}</Button><Button onClick={() => setEdit('new')}>Add category</Button></>}
      />
      <Card className="divide-y">
        {data.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium"><span className="mr-2 rounded bg-primary/10 px-2 py-0.5 font-mono text-primary">{r.prefixLetter}</span>{r.name}</p>
              <p className="text-xs text-muted-foreground">At least {r.minimumLength} digits, e.g. {r.prefixLetter}{'1'.padEnd(Math.max(r.minimumLength, 4), '2')}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setEdit(r)}>Edit</Button>
              <Button size="sm" variant="outline" onClick={() => toggle.mutate(r)}>{r.archived ? 'Restore' : 'Archive'}</Button>
            </div>
          </div>
        ))}
        {!data.length && <p className="p-6 text-center text-sm text-muted-foreground">No categories.</p>}
      </Card>
      <Dialog open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} title={edit === 'new' ? 'Add category' : 'Edit category'}>
        {edit !== null && <CategoryForm row={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} />}
      </Dialog>
    </>
  );
}
