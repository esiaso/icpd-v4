'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button, Card, CardContent, PageHeader, Select } from '@/components/ui';
import { DiaryTable, TypeSummary } from '@/components/cpd/portfolio-view';
import { download, get } from '@/lib/api';

export default function DiaryPage() {
  const { data: p } = useQuery({ queryKey: ['/me/portfolio', null], queryFn: () => get('/me/portfolio') });
  const [year, setYear] = useState<number | null>(null);
  const [type, setType] = useState<number | null>(null);
  if (!p) return null;
  const y = year ?? p.year;
  return (
    <>
      <PageHeader title="CPD diary" description="Print or download your diary and certificate for any year." />
      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-center gap-2 pt-5">
          <Select className="w-32" value={y} onChange={(e) => setYear(Number(e.target.value))}>
            {p.years.map((yy: number) => <option key={yy} value={yy}>{yy}</option>)}
          </Select>
          <Button onClick={() => download(`/me/diary/pdf?year=${y}`, `cpd-diary-${y}.pdf`)}>Download diary PDF</Button>
          <Button variant="outline" onClick={() => download(`/me/certificate/pdf?year=${y}`, `cpd-certificate-${y}.pdf`)}>Download certificate</Button>
        </CardContent>
      </Card>
      <div className="space-y-4">
        <TypeSummary base="/me" year={y} onPick={setType} picked={type} />
        <DiaryTable base="/me" year={y} activityTypeId={type} />
      </div>
    </>
  );
}
