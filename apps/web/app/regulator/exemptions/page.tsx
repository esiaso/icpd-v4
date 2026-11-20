'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { nairobiYear } from '@icpd/shared';
import { DataTable, type Col } from '@/components/data-table';
import { ConfirmButton, Dialog } from '@/components/dialog';
import { Button, Field, Input, PageHeader, Textarea } from '@/components/ui';
import { del, post } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { fmtDate, pts } from '@/lib/utils';

export default function ExemptionsPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['/regulator/exemptions'] });
  const columns: Col<any>[] = [
    { header: 'Practitioner', cell: ({ row }) => <Link className="text-primary hover:underline" href={`/regulator/practitioners/${row.original.practitioner.id}`}>{row.original.practitioner.firstName} {row.original.practitioner.lastName} <span className="font-mono text-xs">{row.original.regNo}</span></Link> },
    { header: 'Year', accessorKey: 'cpdYear' },
    { header: 'Reason', accessorKey: 'reason' },
    { header: 'Points then', cell: ({ row }) => pts(row.original.pointsAttained) },
    { header: 'Exempted', cell: ({ row }) => `${fmtDate(row.original.dateExempted)} (${row.original.postType})` },
    { id: 'a', header: '', cell: ({ row }) => <ConfirmButton label="Remove" title="Remove this exemption?" onConfirm={async () => { await del(`/regulator/exemptions/${row.original.id}`); refresh(); }} /> },
  ];
  return (
    <>
      <PageHeader title="Exemptions" actions={<Button onClick={() => setOpen(true)}>Exempt a practitioner</Button>} />
      <DataTable endpoint="/regulator/exemptions" columns={columns} searchPlaceholder="Search reg. no. or name" />
      <Dialog open={open} onOpenChange={setOpen} title="Exempt a practitioner" description="One exemption per practitioner per CPD year. Their current points are recorded.">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await post('/regulator/exemptions', Object.fromEntries(new FormData(e.currentTarget)));
              toast.success('Exemption recorded');
              refresh();
              setOpen(false);
            } catch (err) {
              applyApiError(null, err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Registration number" required><Input name="regNo" required /></Field>
          <Field label="CPD year" required><Input name="cpdYear" type="number" defaultValue={nairobiYear()} required /></Field>
          <Field label="Reason" required><Textarea name="reason" required minLength={3} /></Field>
          <Button type="submit" loading={busy}>Exempt</Button>
        </form>
      </Dialog>
    </>
  );
}
