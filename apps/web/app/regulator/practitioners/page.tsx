'use client';
import Link from 'next/link';
import { useState } from 'react';
import { DataTable, type Col } from '@/components/data-table';
import { Badge, PageHeader, Select } from '@/components/ui';
import { useReference } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';

const columns: Col<any>[] = [
  { header: 'Reg. no.', sortKey: 'regNo', cell: ({ row }) => <span className="font-mono">{row.original.regNo ?? '—'}</span> },
  { header: 'Name', sortKey: 'lastName', cell: ({ row }) => <Link className="font-medium text-primary hover:underline" href={`/regulator/practitioners/${row.original.id}`}>{row.original.firstName} {row.original.otherNames ?? ''} {row.original.lastName}</Link> },
  { header: 'Contact', cell: ({ row }) => <div className="text-xs"><p>{row.original.email}</p><p className="text-muted-foreground">{row.original.mobile1}</p></div> },
  { header: 'Category / speciality', cell: ({ row }) => <div className="text-xs"><p>{row.original.category?.name}</p><p className="text-muted-foreground">{row.original.specialization?.name}</p></div> },
  { header: 'Status', sortKey: 'status', cell: ({ row }) => <Badge variant={row.original.status === 'registered' ? 'success' : 'secondary'}>{row.original.status}</Badge> },
  { header: 'Registered', sortKey: 'dateRegistered', cell: ({ row }) => fmtDate(row.original.dateRegistered) },
  { header: 'Account', cell: ({ row }) => (row.original.userId ? <Badge variant="outline">linked</Badge> : <span className="text-xs text-muted-foreground">legacy</span>) },
];

export default function PractitionersPage() {
  const { data: ref } = useReference();
  const [list, setList] = useState('all');
  const [categoryId, setCategoryId] = useState('');
  const [specialityId, setSpecialityId] = useState('');
  return (
    <>
      <PageHeader title="Practitioners" />
      <div className="mb-4 flex flex-wrap gap-1 border-b">
        {[['all', 'All'], ['incomplete', 'Incomplete'], ['trashed', 'Trash']].map(([k, l]) => (
          <button key={k} onClick={() => setList(k)} className={`border-b-2 px-3 py-2 text-sm ${list === k ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}>{l}</button>
        ))}
      </div>
      <DataTable
        key={list}
        endpoint="/regulator/practitioners"
        params={{ list, categoryId, specialityId }}
        columns={columns}
        searchPlaceholder="Reg. no., name, email, ID or application no."
        toolbar={
          <>
            <Select className="w-48" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">All categories</option>{ref?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            <Select className="w-48" value={specialityId} onChange={(e) => setSpecialityId(e.target.value)}><option value="">All specialities</option>{ref?.specialities.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          </>
        }
      />
    </>
  );
}
