'use client';
import Link from 'next/link';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { nairobiYear } from '@icpd/shared';
import { Badge, Button, Input, PageHeader, Select, Stat } from '@/components/ui';
import { download, get, qs } from '@/lib/api';
import { useReference } from '@/lib/hooks';
import { pts } from '@/lib/utils';

export default function ComplianceReport() {
  const { data: ref } = useReference();
  const [f, setF] = useState({ year: nairobiYear(), status: '', specialityId: '', categoryId: '', search: '', page: 1 });
  const q = qs(f);
  const { data } = useQuery({ queryKey: ['compliance-report', q], queryFn: () => get(`/regulator/compliance/report${q}`), placeholderData: keepPreviousData });
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, page: 1, ...p }));
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <>
      <PageHeader
        title="Compliance report"
        description="Compliant, not compliant and exempted practitioners, with the reasons."
        actions={
          <>
            <Button variant="outline" onClick={() => download(`/regulator/compliance/report${qs({ ...f, format: 'csv' })}`, `compliance-${f.year}.csv`)}>Export CSV</Button>
            <Button variant="outline" onClick={() => download(`/regulator/compliance/report${qs({ ...f, format: 'xlsx' })}`, `compliance-${f.year}.xlsx`)}>Export Excel</Button>
          </>
        }
      />
      {data && (
        <div className="mb-4 grid grid-cols-3 gap-3">
          <Stat label="Compliant" value={data.summary.compliant} />
          <Stat label="Not compliant" value={data.summary.notCompliant} />
          <Stat label="Exempted" value={data.summary.exempted} />
        </div>
      )}
      <div className="mb-3 grid gap-2 sm:grid-cols-5">
        <Input type="number" aria-label="Year" value={f.year} onChange={(e) => set({ year: Number(e.target.value) })} />
        <Select value={f.status} onChange={(e) => set({ status: e.target.value })}><option value="">All statuses</option><option value="compliant">Compliant</option><option value="not_compliant">Not compliant</option><option value="exempted">Exempted</option></Select>
        <Select value={f.specialityId} onChange={(e) => set({ specialityId: e.target.value })}><option value="">All specialities</option>{ref?.specialities.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Select value={f.categoryId} onChange={(e) => set({ categoryId: e.target.value })}><option value="">All categories</option>{ref?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Input placeholder="Reg. no. or name" value={f.search} onChange={(e) => set({ search: e.target.value })} />
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/60 text-left"><tr><th className="px-3 py-2">Practitioner</th><th className="px-3 py-2">Speciality / category</th><th className="px-3 py-2">Rules</th><th className="px-3 py-2 text-right">Countable</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Reasons</th></tr></thead>
          <tbody>
            {data?.data.map((r: any) => (
              <tr key={r.practitionerId} className="border-t align-top">
                <td className="px-3 py-2"><Link className="text-primary hover:underline" href={`/regulator/practitioners/${r.practitionerId}`}>{r.name}</Link><p className="font-mono text-xs">{r.regNo}</p></td>
                <td className="px-3 py-2 text-xs">{r.speciality ?? '—'}<br />{r.category ?? ''}</td>
                <td className="px-3 py-2 text-xs">{r.framework}</td>
                <td className="px-3 py-2 text-right">{pts(r.countablePoints)}{r.rawPoints !== r.countablePoints && <span className="block text-xs text-muted-foreground">of {pts(r.rawPoints)}</span>}</td>
                <td className="px-3 py-2"><Badge variant={r.status === 'compliant' ? 'success' : r.status === 'exempted' ? 'warning' : 'destructive'}>{r.status}</Badge></td>
                <td className="max-w-md px-3 py-2 text-xs">{r.reasons.join(' ')}</td>
              </tr>
            ))}
            {data && !data.data.length && <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">No results. Run "Recalculate" under Compliance rules if this year has not been computed yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2 text-sm">
        <Button size="sm" variant="outline" disabled={f.page <= 1} onClick={() => setF((x) => ({ ...x, page: x.page - 1 }))}>Previous</Button>
        <span>Page {f.page} of {pages}</span>
        <Button size="sm" variant="outline" disabled={f.page >= pages} onClick={() => setF((x) => ({ ...x, page: x.page + 1 }))}>Next</Button>
      </div>
    </>
  );
}
