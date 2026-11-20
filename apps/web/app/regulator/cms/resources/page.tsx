'use client';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DataTable, type Col } from '@/components/data-table';
import { ConfirmButton, Dialog } from '@/components/dialog';
import { MultiSelect } from '@/components/multi-select';
import { Badge, Button, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';
import { del, upload } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { useAction, useReference } from '@/lib/hooks';

type Row = { id: number; title: string; link: string | null; status: string; specialities: number[]; details: string | null; type: string | null; fullFileName: string | null; fileUrl: string | null };

function ResourceForm({ row, onDone }: { row?: Row; onDone: () => void }) {
  const qc = useQueryClient();
  const { data: ref } = useReference();
  const [specs, setSpecs] = useState<(number | string)[]>(row?.specialities ?? []);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('specialities', JSON.stringify(specs.map(Number)));
    if (!(fd.get('file') as File)?.size) fd.delete('file');
    setBusy(true);
    try {
      await upload(row ? `/cms/resources/${row.id}` : '/cms/resources', fd, row ? 'PUT' : 'POST');
      qc.invalidateQueries({ queryKey: ['/cms/resources'] });
      onDone();
    } catch (err) {
      applyApiError(null, err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Title" required><Input name="title" defaultValue={row?.title} required minLength={2} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type"><Input name="type" defaultValue={row?.type ?? ''} placeholder="Guideline, Form, Report…" /></Field>
        <Field label="Status"><Select name="status" defaultValue={row?.status ?? 'published'}><option value="published">Published</option><option value="draft">Draft</option></Select></Field>
      </div>
      <Field label="External link"><Input name="link" type="url" defaultValue={row?.link ?? ''} /></Field>
      <Field label="File" hint={row?.fullFileName ? `Current: ${row.fullFileName}` : 'PDF, Word, Excel… up to 25 MB'}><Input name="file" type="file" /></Field>
      <Field label="Specialities"><MultiSelect options={ref?.specialities ?? []} value={specs} onChange={setSpecs} /></Field>
      <Field label="Details"><Textarea name="details" defaultValue={row?.details ?? ''} /></Field>
      <Button type="submit" loading={busy}>Save resource</Button>
    </form>
  );
}

export default function CmsResourcesPage() {
  const [edit, setEdit] = useState<Row | null | 'new'>(null);
  const remove = useAction((id: number) => del(`/cms/resources/${id}`), { success: 'Resource deleted', invalidate: ['/cms/resources'] });
  const columns: Col<Row>[] = [
    { header: 'Title', cell: ({ row }) => <div><p className="font-medium">{row.original.title}</p><p className="text-xs text-muted-foreground">{row.original.type}</p></div> },
    { header: 'File / link', cell: ({ row }) => row.original.fileUrl ? <a className="text-primary underline" href={row.original.fileUrl} target="_blank">{row.original.fullFileName}</a> : row.original.link ? <a className="text-primary underline" href={row.original.link} target="_blank">Link</a> : '—' },
    { header: 'Status', cell: ({ row }) => <Badge variant={row.original.status === 'published' ? 'success' : 'secondary'}>{row.original.status}</Badge> },
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
      <PageHeader title="Resources" actions={<Button onClick={() => setEdit('new')}>Add resource</Button>} />
      <DataTable endpoint="/cms/resources" columns={columns} />
      <Dialog wide open={edit !== null} onOpenChange={(o) => !o && setEdit(null)} title={edit === 'new' ? 'Add resource' : 'Edit resource'}>
        {edit !== null && <ResourceForm row={edit === 'new' ? undefined : edit} onDone={() => setEdit(null)} />}
      </Dialog>
    </>
  );
}
