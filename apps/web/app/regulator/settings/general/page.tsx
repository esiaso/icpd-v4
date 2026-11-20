'use client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeader, Select } from '@/components/ui';
import { get, put } from '@/lib/api';
import { useAction } from '@/lib/hooks';

export default function GeneralSettingsPage() {
  const { data } = useQuery({ queryKey: ['settings-general'], queryFn: () => get<Record<string, any>>('/settings/general') });
  const save = useAction(({ key, value }: { key: string; value: unknown }) => put(`/settings/general/${key}`, { value }), { success: 'Saved', invalidate: ['settings-general'] });
  if (!data) return null;
  const bool = (k: string, d = true) => String(data[k] ?? d);
  return (
    <>
      <PageHeader title="General settings" />
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Several specialities</CardTitle>
            <CardDescription>Which compliance framework applies when a practitioner has more than one speciality.</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={data['compliance.multiSpecialityMode'] ?? 'primary'} onChange={(e) => save.mutate({ key: 'compliance.multiSpecialityMode', value: e.target.value })}>
              <option value="primary">The primary speciality&apos;s framework</option>
              <option value="strictest">The strictest framework among all specialities</option>
            </Select>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Quick QR claims</CardTitle>
            <CardDescription>The legacy QR claim skipped the token expiry check. Keep it enforced unless the regulator decides otherwise.</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={bool('claims.quickClaimEnforceExpiry')} onChange={(e) => save.mutate({ key: 'claims.quickClaimEnforceExpiry', value: e.target.value === 'true' })}>
              <option value="true">Reject expired tokens</option>
              <option value="false">Accept expired tokens (legacy behaviour)</option>
            </Select>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Activity-type caps on awards</CardTitle>
            <CardDescription>Enforce each activity type&apos;s max points per claim and per year when officers award non-token claims.</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={bool('claims.enforceTypeCaps')} onChange={(e) => save.mutate({ key: 'claims.enforceTypeCaps', value: e.target.value === 'true' })}>
              <option value="true">Enforce caps</option>
              <option value="false">Do not enforce</option>
            </Select>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
