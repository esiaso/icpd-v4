'use client';
import { useState } from 'react';
import { DataTable, type Col } from '@/components/data-table';
import { PageHeader, Select } from '@/components/ui';
import { fmtDate } from '@/lib/utils';

type Row = { id: string; actorId: string | null; logName: string; event: string; subjectType: string | null; subjectId: string | null; description: string | null; properties: any; createdAt: string };

const LOGS = ['', 'auth', 'users', 'roles', 'settings', 'cms', 'providers', 'activity-publishing', 'tokens', 'claims', 'practitioner-application', 'practitioner-excemption', 'practitioners', 'compliance', 'api-apps'];

const columns: Col<Row>[] = [
  { header: 'When', cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.createdAt, true)}</span> },
  { header: 'Log', accessorKey: 'logName' },
  { header: 'Event', accessorKey: 'event' },
  { header: 'Subject', cell: ({ row }) => (row.original.subjectType ? `${row.original.subjectType} #${row.original.subjectId}` : '—') },
  { header: 'Actor', cell: ({ row }) => row.original.actorId ?? 'system' },
  { header: 'Details', cell: ({ row }) => <code className="block max-w-md truncate text-xs" title={JSON.stringify(row.original.properties)}>{JSON.stringify(row.original.properties)}</code> },
];

export default function AuditPage() {
  const [log, setLog] = useState('');
  return (
    <>
      <PageHeader title="Audit log" />
      <DataTable
        endpoint="/admin/audit-log"
        params={{ logName: log }}
        columns={columns}
        toolbar={<Select className="w-60" value={log} onChange={(e) => setLog(e.target.value)}>{LOGS.map((l) => <option key={l} value={l}>{l || 'All logs'}</option>)}</Select>}
      />
    </>
  );
}
