'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { nairobiYear } from '@icpd/shared';
import { Button, Card, CardContent, Input, PageHeader, Select } from '@/components/ui';
import { download, get, qs } from '@/lib/api';
import { useReference } from '@/lib/hooks';
import { pts } from '@/lib/utils';

export default function PointsByType() {
  const { data: ref } = useReference();
  const { data: providers } = useQuery({ queryKey: ['all-providers'], queryFn: () => get('/regulator/providers?pageSize=200') });
  const [f, setF] = useState({ year: nairobiYear(), specialityId: '', categoryId: '', providerId: '' });
  const q = qs(f);
  const { data } = useQuery({ queryKey: ['pbt', q], queryFn: () => get(`/regulator/reports/points-by-type${q}`) });
  return (
    <>
      <PageHeader
        title="Points by activity type"
        actions={
          <>
            <Button variant="outline" onClick={() => download(`/regulator/reports/points-by-type${qs({ ...f, format: 'csv' })}`, `points-by-type-${f.year}.csv`)}>Export CSV</Button>
            <Button variant="outline" onClick={() => download(`/regulator/reports/points-by-type${qs({ ...f, format: 'xlsx' })}`, `points-by-type-${f.year}.xlsx`)}>Export Excel</Button>
          </>
        }
      />
      <div className="mb-4 grid gap-2 sm:grid-cols-4">
        <Input type="number" aria-label="Year" value={f.year} onChange={(e) => setF({ ...f, year: Number(e.target.value) })} />
        <Select value={f.specialityId} onChange={(e) => setF({ ...f, specialityId: e.target.value })}><option value="">All specialities</option>{ref?.specialities.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}><option value="">All categories</option>{ref?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select value={f.providerId} onChange={(e) => setF({ ...f, providerId: e.target.value })}><option value="">All providers</option>{providers?.data.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
      </div>
      {data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardContent className="h-80 pt-5">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.data} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" fontSize={11} />
                  <YAxis type="category" dataKey="activityTypeName" width={150} fontSize={11} />
                  <Tooltip formatter={(v: any) => pts(v)} />
                  <Bar dataKey="points" name="Points" fill="#0f5132" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-secondary/60 text-left"><tr><th className="px-3 py-2">Activity type</th><th className="px-3 py-2 text-right">Claims</th><th className="px-3 py-2 text-right">Practitioners</th><th className="px-3 py-2 text-right">Points</th><th className="px-3 py-2 text-right">Share</th></tr></thead>
              <tbody>
                {data.data.map((r: any) => (
                  <tr key={r.activityTypeId} className="border-t"><td className="px-3 py-2">{r.activityTypeName}</td><td className="px-3 py-2 text-right">{r.claims}</td><td className="px-3 py-2 text-right">{r.practitioners}</td><td className="px-3 py-2 text-right">{pts(r.points)}</td><td className="px-3 py-2 text-right">{r.share}%</td></tr>
                ))}
                <tr className="border-t font-medium"><td className="px-3 py-2">Total</td><td /><td /><td className="px-3 py-2 text-right">{pts(data.total)}</td><td /></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
