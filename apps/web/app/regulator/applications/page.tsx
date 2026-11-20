'use client';
import Link from 'next/link';
import { useState } from 'react';
import { DataTable, type Col } from '@/components/data-table';
import { Badge, PageHeader } from '@/components/ui';
import { fmtDate } from '@/lib/utils';

const LISTS = [
  ['new', 'New'],
  ['screening', 'In screening'],
  ['returned', 'Returned'],
  ['approved', 'Awaiting registration'],
  ['all', 'All'],
  ['presubmission', 'Not submitted'],
  ['incomplete', 'Incomplete'],
] as const;

const columns: Col<any>[] = [
  { header: 'Application', sortKey: 'applicationNo', cell: ({ row }) => <Link className="font-mono text-primary hover:underline" href={`/regulator/applications/${row.original.id}`}>{row.original.applicationNo}</Link> },
  { header: 'Applicant', sortKey: 'lastName', cell: ({ row }) => <div><p>{row.original.firstName} {row.original.lastName}</p><p className="text-xs text-muted-foreground">{row.original.email}</p></div> },
  { header: 'Reg. no.', cell: ({ row }) => <span className="font-mono">{row.original.regNo}</span> },
  { header: 'Category', cell: ({ row }) => row.original.category?.name ?? '—' },
  { header: 'Submitted', sortKey: 'dateOfApplication', cell: ({ row }) => fmtDate(row.original.dateOfApplication) },
  { header: 'Status', sortKey: 'status', cell: ({ row }) => <Badge variant="secondary">{row.original.status}</Badge> },
];

export default function ApplicationsPage() {
  const [list, setList] = useState<string>('new');
  return (
    <>
      <PageHeader title="Registration applications" />
      <div className="mb-4 flex flex-wrap gap-1 border-b">
        {LISTS.map(([k, label]) => (
          <button key={k} onClick={() => setList(k)} className={`border-b-2 px-3 py-2 text-sm ${list === k ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}>{label}</button>
        ))}
      </div>
      <DataTable key={list} endpoint="/regulator/applications" params={{ list }} columns={columns} searchPlaceholder="Search application no., reg. no. or name" />
    </>
  );
}
