'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Empty, Input, Select } from '@/components/ui';
import { ActivityItem, LoginBox, Panel } from '@/components/public-blocks';
import { get, qs } from '@/lib/api';
import { useReference } from '@/lib/hooks';

/** CPD activity list in the icpdkenya.org layout: speciality filter, list, login sidebar. */
function Activities() {
  const sp = useSearchParams();
  const { data: ref } = useReference();
  const [search, setSearch] = useState(sp.get('search') ?? '');
  const [provider, setProvider] = useState('');
  const [specs, setSpecs] = useState<number[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const { data: providers } = useQuery({ queryKey: ['pub-providers-all'], queryFn: () => get(`/public/providers?pageSize=200`) });
  const { data } = useQuery({
    queryKey: ['pub-activities', search, provider, specs, from, to, page],
    queryFn: () => get(`/public/activities${qs({ search, providers: provider, specialities: specs.join(','), from, to, page, pageSize: 12 })}`),
    placeholderData: keepPreviousData,
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / 12)) : 1;
  const toggle = (id: number) => { setSpecs((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])); setPage(1); };
  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 rounded-sm bg-secondary px-4 py-3 text-sm">
        <Link href="/" className="text-primary hover:underline">Home</Link> <span className="text-muted-foreground">/ Activity list</span>
      </nav>
      <h1 className="mb-4 text-3xl font-bold">CPD Activities</h1>
      <div className="grid gap-5 lg:grid-cols-[200px_1fr_280px]">
        <aside>
          <h2 className="mb-2 border-b pb-1 font-heading text-lg font-bold">Filter by Speciality</h2>
          <div className="max-h-[28rem] space-y-1 overflow-y-auto text-sm">
            {ref?.specialities.map((s) => (
              <label key={s.id} className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={specs.includes(s.id)} onChange={() => toggle(s.id)} /> {s.name}</label>
            ))}
          </div>
        </aside>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Search by name, topic or provider" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            <Select value={provider} onChange={(e) => { setProvider(e.target.value); setPage(1); }}>
              <option value="">All providers</option>
              {providers?.data.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Input type="date" aria-label="From date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
            <Input type="date" aria-label="To date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
          </div>
          <p className="border-b pb-1 text-sm"><b>SORT BY:</b> Newest · {data?.total ?? 0} activities</p>
          {data?.data.map((a: any) => <ActivityItem key={a.id} a={a} />)}
          {data && !data.data.length && <Empty>No activities match your filters.</Empty>}
          <div className="flex items-center gap-2 pt-2 text-sm">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>« Previous</Button>
            <span>Page {page} of {pages}</span>
            <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next »</Button>
          </div>
        </div>
        <aside className="space-y-5">
          <LoginBox />
          <Panel title="Search For CPD Activity">
            <p className="text-sm text-muted-foreground">Use the filters on the left and above, or browse <Link className="text-primary hover:underline" href="/provider-directory">providers</Link>.</p>
          </Panel>
        </aside>
      </div>
    </>
  );
}

export default function ActivitiesPage() {
  return <Suspense><Activities /></Suspense>;
}
