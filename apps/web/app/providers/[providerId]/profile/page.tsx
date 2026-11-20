'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ProviderForm } from '@/components/provider-form';
import { Card, CardContent, PageHeader } from '@/components/ui';
import { get, put } from '@/lib/api';

export default function ProviderProfile({ params }: { params: { providerId: string } }) {
  const qc = useQueryClient();
  const { data: p } = useQuery({ queryKey: ['prov-profile', params.providerId], queryFn: () => get(`/providers/${params.providerId}/profile`) });
  const { data: users = [] } = useQuery({ queryKey: ['prov-team', params.providerId], queryFn: () => get<any[]>(`/providers/${params.providerId}/users`) });
  if (!p) return null;
  return (
    <>
      <PageHeader title="Provider profile" description={`${p.name} · ${p.regNo ?? ''}. The name, accreditation number and specialities are managed by the regulator.`} />
      <Card>
        <CardContent className="pt-5">
          <ProviderForm coordinator initial={p} onSubmit={async (v) => { await put(`/providers/${params.providerId}/profile`, v); toast.success('Profile saved'); qc.invalidateQueries({ queryKey: ['prov-profile'] }); }} />
        </CardContent>
      </Card>
      <h2 className="mb-2 mt-6 font-semibold">Coordinators</h2>
      <ul className="text-sm">{users.map((u) => <li key={u.id}>{u.name} <span className="text-muted-foreground">({u.email})</span></li>)}</ul>
    </>
  );
}
