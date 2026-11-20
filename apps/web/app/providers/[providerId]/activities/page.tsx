'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { DataTable, type Col } from '@/components/data-table';
import { Badge, PageHeader } from '@/components/ui';
import { fmtDate, pts } from '@/lib/utils';

function List({ providerId }: { providerId: string }) {
  const archived = useSearchParams().get('archived') === 'true';
  const base = `/providers/${providerId}/activities`;
  const columns: Col<any>[] = [
    { header: 'Activity', sortKey: 'name', cell: ({ row }) => <div><Link className="font-medium text-primary hover:underline" href={`${base}/${row.original.id}`}>{row.original.name}</Link><p className="text-xs text-muted-foreground">{row.original.activityNo} · {row.original.type?.name}</p></div> },
    { header: 'Dates', sortKey: 'releaseDate', cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.releaseDate)} to {fmtDate(row.original.expiryDate)}</span> },
    { header: 'Points', cell: ({ row }) => `${pts(row.original.cpdPoints)} × ${row.original.numSessions}` },
    { header: 'Tokens', cell: ({ row }) => row.original._count.tokens },
    { header: 'Claims', cell: ({ row }) => row.original._count.claims },
    { header: 'Status', sortKey: 'published', cell: ({ row }) => (row.original.published ? <Badge variant="success">published</Badge> : <Badge variant="secondary">draft</Badge>) },
  ];
  return (
    <>
      <PageHeader title={archived ? 'Archived activities' : 'Activities'} actions={<Link href={`${base}/new`} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">New activity</Link>} />
      <DataTable endpoint={base} params={{ archived }} columns={columns} />
    </>
  );
}

export default function ActivitiesPage({ params }: { params: { providerId: string } }) {
  return <Suspense><List providerId={params.providerId} /></Suspense>;
}
