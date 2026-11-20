'use client';
import { DataTable, type Col } from '@/components/data-table';
import { PageHeader } from '@/components/ui';
import { fmtDate } from '@/lib/utils';

type Row = { id: string; name: string; email: string; phone: string | null; subject: string; message: string; createdAt: string };

const columns: Col<Row>[] = [
  { header: 'Received', cell: ({ row }) => fmtDate(row.original.createdAt, true) },
  { header: 'From', cell: ({ row }) => <div><p>{row.original.name}</p><a className="text-xs text-primary" href={`mailto:${row.original.email}`}>{row.original.email}</a><p className="text-xs text-muted-foreground">{row.original.phone}</p></div> },
  { header: 'Message', cell: ({ row }) => <div className="max-w-xl"><p className="font-medium">{row.original.subject}</p><p className="whitespace-pre-wrap text-muted-foreground">{row.original.message}</p></div> },
];

export default function ContactsPage() {
  return (
    <>
      <PageHeader title="Contact messages" />
      <DataTable endpoint="/cms/contacts" columns={columns} />
    </>
  );
}
