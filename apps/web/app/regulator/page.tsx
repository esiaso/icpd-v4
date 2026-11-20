'use client';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Stat } from '@/components/ui';
import { get } from '@/lib/api';
import { DashboardCharts } from './dashboard-charts';

export default function RegulatorDashboard() {
  const { data } = useQuery({ queryKey: ['reg-dashboard'], queryFn: () => get('/regulator/dashboard') });
  const t = data?.totals ?? {};
  return (
    <>
      <PageHeader title="Dashboard" description={`CPD year ${data?.year ?? ''}`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Practitioners" value={t.practitioners ?? '—'} />
        <Stat label="Pending applications" value={t.pendingApplications ?? '—'} />
        <Stat label="Providers" value={t.providers ?? '—'} />
        <Stat label="Activities" value={t.activities ?? '—'} />
        <Stat label="Claims this year" value={t.claims ?? '—'} />
        <Stat label="Pending non-token" value={t.pendingNonToken ?? '—'} />
      </div>
      {data?.monthly && <DashboardCharts monthly={data.monthly} />}
    </>
  );
}
