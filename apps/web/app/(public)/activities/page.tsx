'use client';
import Link from 'next/link';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Badge, Button, Card, CardContent, Empty, Input, PageHeader, Select } from '@/components/ui';
import { get, qs } from '@/lib/api';
import { fmtDate, pts } from '@/lib/utils';

export default function ActivitiesPage() {
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const { data: providers } = useQuery({ queryKey: ['pub-providers-all'], queryFn: () => get(`/public/providers?pageSize=200`) });
  const { data } = useQuery({
    queryKey: ['pub-activities', search, provider, from, to, page],
    queryFn: () => get(`/public/activities${qs({ search, providers: provider, from, to, page, pageSize: 12 })}`),
    placeholderData: keepPreviousData,
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / 12)) : 1;
  return (
    <>
      <PageHeader title="CPD activities" description="Accredited activities published by CPD providers." />
      <div className="mb-5 grid gap-2 sm:grid-cols-4">
        <Input placeholder="Search by name, topic or provider" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <Select value={provider} onChange={(e) => { setProvider(e.target.value); setPage(1); }}>
          <option value="">All providers</option>
          {providers?.data.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Input type="date" aria-label="From date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        <Input type="date" aria-label="To date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data?.data.map((a: any) => (
          <Link key={a.id} href={`/activities/${a.id}`}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardContent className="space-y-2 p-4">
                <div className="flex flex-wrap gap-1">
                  <Badge variant="secondary">{a.type?.name}</Badge>
                  <Badge variant="outline">{a.deliveryMode}</Badge>
                </div>
                <p className="font-semibold leading-snug">{a.name}</p>
                <p className="text-sm text-muted-foreground">{a.provider?.name}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(a.releaseDate)} to {fmtDate(a.expiryDate)}{a.city ? ` · ${a.city}` : ''}</p>
                <p className="text-sm font-medium text-primary">{pts(a.cpdPoints)} pts × {a.numSessions} session{a.numSessions > 1 ? 's' : ''} (max {pts(a.maxPoints)})</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      {data && !data.data.length && <Empty>No activities match your filters.</Empty>}
      <div className="mt-6 flex items-center justify-center gap-3 text-sm">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
        <span>Page {page} of {pages}</span>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </>
  );
}
