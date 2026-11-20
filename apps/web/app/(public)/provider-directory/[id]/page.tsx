'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, CardContent, CardHeader, CardTitle, Empty, Input } from '@/components/ui';
import { get, qs } from '@/lib/api';
import { fmtDate, pts } from '@/lib/utils';

export default function ProviderDetail({ params }: { params: { id: string } }) {
  const [search, setSearch] = useState('');
  const { data: p, error } = useQuery({ queryKey: ['pub-provider', params.id], queryFn: () => get(`/public/providers/${params.id}`) });
  const { data: acts } = useQuery({
    queryKey: ['pub-provider-acts', params.id, search],
    queryFn: () => get(`/public/providers/${params.id}/activities${qs({ search, pageSize: 50 })}`),
  });
  if (error) return <Empty>Provider not found.</Empty>;
  if (!p) return null;
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="h-fit">
        <CardHeader>
          {p.logoUrl && <img src={p.logoUrl} alt="" className="mb-2 h-16 w-auto object-contain" />}
          <CardTitle>{p.name}</CardTitle>
          <div className="flex flex-wrap gap-1">{p.specialities.map((s: any) => <Badge key={s.id} variant="secondary">{s.name}</Badge>)}</div>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          {p.physicalAddress && <p>{p.physicalAddress}{p.town ? `, ${p.town}` : ''}</p>}
          {p.postalAddress && <p className="text-muted-foreground">{p.postalAddress}</p>}
          {p.phone && <p>Tel: {p.phone}</p>}
          {p.email && <p><a className="text-primary underline" href={`mailto:${p.email}`}>{p.email}</a></p>}
          {p.website && <p><a className="text-primary underline" href={p.website} target="_blank" rel="noreferrer">Website</a></p>}
        </CardContent>
      </Card>
      <div className="space-y-3 lg:col-span-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-semibold">Published activities</h2>
          <Input className="max-w-xs" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        {acts?.data.map((a: any) => (
          <Link key={a.id} href={`/activities/${a.id}`} className="block">
            <Card className="hover:shadow-md">
              <CardContent className="p-4">
                <p className="font-medium">{a.name}</p>
                <p className="text-xs text-muted-foreground">{a.type?.name} · {fmtDate(a.releaseDate)} to {fmtDate(a.expiryDate)} · {pts(a.cpdPoints)} pts/session</p>
              </CardContent>
            </Card>
          </Link>
        ))}
        {acts && !acts.data.length && <Empty>No published activities.</Empty>}
      </div>
    </div>
  );
}
