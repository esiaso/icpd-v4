'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/dialog';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Empty, Input, PageHeader } from '@/components/ui';
import { get, post, qs } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { fmtDate } from '@/lib/utils';

function Group({ g, onMerged }: { g: any; onMerged: () => void }) {
  const [target, setTarget] = useState<string>(g.records.find((r: any) => r.userId)?.id ?? g.records[0].id);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Reg. no. <span className="font-mono">{g.regNo}</span> <Badge variant="warning">{g.count} records</Badge></CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {g.records.map((r: any) => (
          <label key={r.id} className={`flex cursor-pointer items-start gap-3 rounded-md border p-2 text-sm ${target === r.id ? 'border-primary bg-primary/5' : ''}`}>
            <input type="radio" name={`t-${g.regNo}`} checked={target === r.id} onChange={() => setTarget(r.id)} className="mt-1" />
            <div className="flex-1">
              <Link className="font-medium text-primary hover:underline" href={`/regulator/practitioners/${r.id}`}>{r.firstName} {r.lastName}</Link> <span className="text-xs text-muted-foreground">#{r.id}</span>
              <p className="text-xs text-muted-foreground">{r.email ?? 'no email'} · ID {r.nationalId ?? '—'} · {r.status} · registered {fmtDate(r.dateRegistered)} · {r._count.claims} claims, {r._count.nonTokenClaims} non-token {r.userId ? '· has login' : ''}</p>
            </div>
          </label>
        ))}
        <ConfirmButton
          variant="default"
          label="Merge into the selected record"
          title="Merge these records?"
          message="Claims, tokens, non-token claims and exemptions move to the selected record; claims for the same activity are combined. The other records lose the reg. no. and go to the trash."
          confirmLabel="Merge"
          onConfirm={async () => {
            try {
              const r = await post('/regulator/practitioners/merge', { targetId: target, sourceIds: g.records.filter((x: any) => x.id !== target).map((x: any) => x.id) });
              toast.success(`Merged ${r.merged} record(s): ${r.moved} claims moved, ${r.combined} combined`);
              onMerged();
            } catch (e) {
              applyApiError(null, e);
            }
          }}
        />
      </CardContent>
    </Card>
  );
}

export default function DuplicatesPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useQuery({ queryKey: ['duplicates', search, page], queryFn: () => get(`/regulator/practitioners/duplicates${qs({ search, page, pageSize: 20 })}`) });
  const pages = data ? Math.max(1, Math.ceil(data.total / 20)) : 1;
  return (
    <>
      <PageHeader title="Duplicate registration numbers" description="Pick the record to keep, then merge the others into it." />
      <Input className="mb-4 max-w-xs" placeholder="Search reg. no." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      <div className="space-y-4">
        {data?.data.map((g: any) => <Group key={g.regNo} g={g} onMerged={() => qc.invalidateQueries({ queryKey: ['duplicates'] })} />)}
        {data && !data.data.length && <Empty>No duplicates found.</Empty>}
      </div>
      <div className="mt-4 flex items-center justify-end gap-2 text-sm">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
        <span>Page {page} of {pages}</span>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </>
  );
}
