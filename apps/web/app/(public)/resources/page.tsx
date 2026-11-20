'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, Empty, Input, PageHeader, Select } from '@/components/ui';
import { get, qs } from '@/lib/api';
import { useReference } from '@/lib/hooks';

export default function ResourcesPage() {
  const [search, setSearch] = useState('');
  const [speciality, setSpeciality] = useState('');
  const { data: ref } = useReference();
  const { data } = useQuery({
    queryKey: ['public-resources', search, speciality],
    queryFn: () => get(`/public/resources${qs({ search, speciality, pageSize: 100 })}`),
  });
  return (
    <>
      <PageHeader title="Resources" description="Guidelines, forms and reading material." />
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Search resources" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" />
        <Select value={speciality} onChange={(e) => setSpeciality(e.target.value)} className="sm:max-w-xs">
          <option value="">All specialities</option>
          {ref?.specialities.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {data?.data.map((r: any) => (
          <Card key={r.id}>
            <CardContent className="space-y-1 p-4">
              <p className="text-xs text-muted-foreground">{r.type}</p>
              <p className="font-semibold">{r.title}</p>
              {r.details && <p className="text-sm text-muted-foreground">{r.details}</p>}
              <div className="flex gap-3 pt-1 text-sm">
                {r.fileUrl && <a className="text-primary underline" href={r.fileUrl} target="_blank" rel="noreferrer">Download</a>}
                {r.link && <a className="text-primary underline" href={r.link} target="_blank" rel="noreferrer">Open link</a>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {data && !data.data.length && <Empty>No resources found.</Empty>}
    </>
  );
}
