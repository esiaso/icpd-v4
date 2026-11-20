'use client';
import Link from 'next/link';
import { useState } from 'react';
import { DataTable, type Col } from '@/components/data-table';
import { Badge, Button, PageHeader, Select } from '@/components/ui';
import { fmtDate, pts } from '@/lib/utils';

export default function RegulatorActivities() {
  const [archived, setArchived] = useState(false);
  const [published, setPublished] = useState('');
  const columns: Col<any>[] = [
    { header: 'Activity', sortKey: 'name', cell: ({ row }) => <div><Link className="font-medium text-primary hover:underline" href={`/providers/${row.original.provider.id}/activities/${row.original.id}`}>{row.original.name}</Link><p className="text-xs text-muted-foreground">{row.original.activityNo} · {row.original.type?.name}</p></div> },
    { header: 'Provider', cell: ({ row }) => <Link className="hover:underline" href={`/regulator/providers/${row.original.provider.id}`}>{row.original.provider.name}</Link> },
    { header: 'Dates', sortKey: 'releaseDate', cell: ({ row }) => <span className="whitespace-nowrap text-xs">{fmtDate(row.original.releaseDate)} to {fmtDate(row.original.expiryDate)}</span> },
    { header: 'Points', cell: ({ row }) => `${pts(row.original.cpdPoints)} × ${row.original.numSessions}` },
    { header: 'Tokens / claims', cell: ({ row }) => `${row.original._count.tokens} / ${row.original._count.claims}` },
    { header: 'Status', sortKey: 'published', cell: ({ row }) => (row.original.published ? <Badge variant="success">published</Badge> : <Badge variant="secondary">draft</Badge>) },
  ];
  return (
    <>
      <PageHeader title={archived ? 'Archived activities' : 'All activities'} description="Open an activity to manage its tokens, attendees and publishing on the provider's behalf." />
      <DataTable
        endpoint="/regulator/activities"
        params={{ archived, published }}
        columns={columns}
        toolbar={
          <>
            <Select className="w-40" value={published} onChange={(e) => setPublished(e.target.value)}><option value="">Any status</option><option value="true">Published</option><option value="false">Draft</option></Select>
            <Button variant="outline" size="sm" onClick={() => setArchived((a) => !a)}>{archived ? 'Show current' : 'Show archived'}</Button>
          </>
        }
      />
    </>
  );
}
