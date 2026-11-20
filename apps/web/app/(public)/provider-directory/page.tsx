'use client';
import Link from 'next/link';
import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, Card, CardContent, Empty, Input, PageHeader } from '@/components/ui';
import { get, qs } from '@/lib/api';

export default function ProviderDirectory() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useQuery({
    queryKey: ['pub-providers', search, page],
    queryFn: () => get(`/public/providers${qs({ search, page, pageSize: 24 })}`),
    placeholderData: keepPreviousData,
  });
  const pages = data ? Math.max(1, Math.ceil(data.total / 24)) : 1;
  return (
    <>
      <PageHeader title="CPD providers" description="Organisations accredited to run CPD activities." />
      <Input className="mb-5 max-w-sm" placeholder="Search providers or towns" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data?.data.map((p: any) => (
          <Link key={p.id} href={`/provider-directory/${p.id}`}>
            <Card className="h-full hover:shadow-md">
              <CardContent className="p-4">
                <p className="font-semibold">{p.name}</p>
                <p className="text-sm text-muted-foreground">{p.town ?? ''}</p>
                <p className="mt-1 text-xs text-muted-foreground">{p.publishedActivities} published activit{p.publishedActivities === 1 ? 'y' : 'ies'}</p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      {data && !data.data.length && <Empty>No providers found.</Empty>}
      <div className="mt-6 flex items-center justify-center gap-3 text-sm">
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
        <span>Page {page} of {pages}</span>
        <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
      </div>
    </>
  );
}
