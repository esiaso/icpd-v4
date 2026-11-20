'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { DataTable, type Col } from '@/components/data-table';
import { ConfirmButton, Dialog } from '@/components/dialog';
import { Badge, Button, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';
import { del, post, put } from '@/lib/api';
import { applyApiError, useZodForm } from '@/lib/forms';
import { useAction } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';

const schema = z.object({
  title: z.string().min(2, 'Required'),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and dashes'),
  status: z.enum(['published', 'draft']),
  description: z.string().optional(),
  content: z.string().optional(),
});
type Row = z.infer<typeof schema> & { id: number; updatedAt: string };

function PageForm({ row, onDone }: { row?: Row; onDone: () => void }) {
  const qc = useQueryClient();
  const form = useZodForm<z.infer<typeof schema>>(schema, { defaultValues: row ?? { title: '', slug: '', status: 'published', description: '', content: '' } });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      row ? await put(`/cms/pages/${row.id}`, v) : await post('/cms/pages', v);
      qc.invalidateQueries({ queryKey: ['/cms/pages'] });
      onDone();
    } catch (err) {
      applyApiError(form, err);
    }
  });
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="sm:col-span-2"><Field label="Title" error={e.title?.message} required><Input {...form.register('title')} /></Field></div>
        <Field label="Status"><Select {...form.register('status')}><option value="published">Published</option><option value="draft">Draft</option></Select></Field>
      </div>
      <Field label="URL slug" error={e.slug?.message} hint="Shown at /about/your-slug" required><Input {...form.register('slug')} /></Field>
      <Field label="Short description"><Input {...form.register('description')} /></Field>
      <Field label="Content (HTML)" hint="Headings, paragraphs, lists, links, tables and images are allowed."><Textarea rows={14} className="font-mono text-xs" {...form.register('content')} /></Field>
      <Button type="submit" loading={form.formState.isSubmitting}>Save page</Button>
    </form>
  );
}

export default function CmsPagesPage() {
  const [edit, setEdit] = useState<Row | null | 'new'>(null);
  const remove = useAction((id: number) => del(`/cms/pages/${id}`), { success: 'Page deleted', invalidate: ['/cms/pages'] });
  const columns: Col<Row>[] = [
    { header: 'Title', accessorKey: 'title' },
    { header: 'URL', cell: ({ row }) => <a className="text-primary underline" href={`/about/${row.original.slug}`} target="_blank">/about/{row.original.slug}</a> },
    { header: 'Status', cell: ({ row }) => <Badge variant={row.original.status === 'published' ? 'success' : 'secondary'}>{row.original.status}</Badge> },
    { header: 'Updated', cell: ({ row }) => fmtDate(row.original.updatedAt) },
    {
      id: 'a',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setEdit(row.original)}>Edit</Button>
          <ConfirmButton label="Delete" title={`Delete "${row.original.title}"?`} onConfirm={() => remove.mutateAsync(row.original.id)} />
        </div>
      ),
    },
  ];
  return (
    <>
      <PageHeader title="Website pages" actions={<Button onClick={() => setEdit('new')}>New page</Button>} />
      <DataTable endpoint="/cms/pages" columns={columns} />
      <Dialog wide open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} title={edit === 'new' ? 'New page' : 'Edit page'}>
        {edit !== null && <PageForm row={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} />}
      </Dialog>
    </>
  );
}
