'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DataTable, type Col } from '@/components/data-table';
import { Dialog } from '@/components/dialog';
import { ProviderForm } from '@/components/provider-form';
import { Badge, Button, PageHeader, Select } from '@/components/ui';
import { post } from '@/lib/api';

const statusVariant = (s: string) => (s === 'active' ? 'success' : s === 'suspended' ? 'destructive' : 'secondary') as any;

type Row = { id: string; name: string; regNo: string; town: string; email: string; status: string; _count: { activities: number; users: number } };

export default function ProvidersPage() {
  const router = useRouter();
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);
  const columns: Col<Row>[] = [
    { header: 'Provider', sortKey: 'name', cell: ({ row }) => <Link href={`/regulator/providers/${row.original.id}`} className="font-medium text-primary hover:underline">{row.original.name}</Link> },
    { header: 'Reg. no.', accessorKey: 'regNo' },
    { header: 'Town', accessorKey: 'town' },
    { header: 'Status', sortKey: 'status', cell: ({ row }) => <Badge variant={statusVariant(row.original.status)}>{row.original.status}</Badge> },
    { header: 'Activities', cell: ({ row }) => row.original._count.activities },
    { header: 'Coordinators', cell: ({ row }) => row.original._count.users },
  ];
  return (
    <>
      <PageHeader title="Providers" actions={<Button onClick={() => setOpen(true)}>Add provider</Button>} />
      <DataTable
        endpoint="/regulator/providers"
        params={{ status }}
        columns={columns}
        toolbar={
          <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="suspended">Suspended</option>
          </Select>
        }
      />
      <Dialog wide open={open} onOpenChange={setOpen} title="Add provider">
        <ProviderForm onSubmit={async (v) => { const p = await post('/regulator/providers', v); router.push(`/regulator/providers/${p.id}`); }} />
      </Dialog>
    </>
  );
}
