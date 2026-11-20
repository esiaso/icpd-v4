'use client';
import Link from 'next/link';
import { DataTable, type Col } from '@/components/data-table';
import { Badge, PageHeader } from '@/components/ui';
import { fmtDate } from '@/lib/utils';

const variant = (s: string) => (s === 'Yes' ? 'success' : s === 'Pending' ? 'warning' : 'destructive') as any;
const label = (s: string) => (s === 'Yes' ? 'Approved' : s === 'No' ? 'Not approved' : s);

const columns: Col<any>[] = [
  { header: 'Activity', cell: ({ row }) => <Link className="font-medium text-primary hover:underline" href={`/practitioner/portfolio/claims/${row.original.id}`}>{row.original.activityName}</Link> },
  { header: 'Type', cell: ({ row }) => row.original.activityType.name },
  { header: 'Dates', cell: ({ row }) => <span className="whitespace-nowrap text-xs">{fmtDate(row.original.beginDate)} to {fmtDate(row.original.endDate)}</span> },
  { header: 'Submitted', cell: ({ row }) => fmtDate(row.original.claimDate) },
  { header: 'Status', cell: ({ row }) => <Badge variant={variant(row.original.status)}>{label(row.original.status)}</Badge> },
];

export default function MyClaims() {
  return (
    <>
      <PageHeader title="My non-token claims" actions={<Link href="/practitioner/portfolio/claim" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">New claim</Link>} />
      <DataTable endpoint="/me/non-token-claims" columns={columns} />
    </>
  );
}
