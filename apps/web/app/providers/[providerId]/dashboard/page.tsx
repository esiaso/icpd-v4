'use client';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Alert, Badge, Card, CardContent, CardHeader, CardTitle, PageHeader, Stat } from '@/components/ui';
import { get } from '@/lib/api';
import { fmtDate, pts } from '@/lib/utils';

export default function ProviderDashboard({ params }: { params: { providerId: string } }) {
  const { data: d } = useQuery({ queryKey: ['prov-dash', params.providerId], queryFn: () => get(`/providers/${params.providerId}/dashboard`) });
  if (!d) return null;
  return (
    <>
      <PageHeader title={d.provider.name} description="Activities, tokens and claims at a glance." actions={<Link href={`/providers/${params.providerId}/activities/new`} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">New activity</Link>} />
      {d.provider.status !== 'active' && (
        <Alert variant="warning" className="mb-4">This provider is <b>{d.provider.status}</b>{d.provider.effectiveDate ? ` since ${fmtDate(d.provider.effectiveDate)}` : ''}. Contact the regulator about re-accreditation.</Alert>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Activities" value={d.activities} hint={`${d.published} published, ${d.archived} archived`} />
        <Stat label="Tokens" value={d.tokens} hint={`${d.claimedTokens} claimed, ${d.unclaimedTokens} unclaimed`} />
        <Stat label="Claims" value={d.claims} hint={`${pts(d.pointsAwarded)} points awarded`} />
        <Stat label="Attendees to process" value={d.pendingImports} />
      </div>
      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Recent activities</CardTitle></CardHeader>
        <CardContent className="divide-y p-0">
          {d.recent.map((a: any) => (
            <Link key={a.id} href={`/providers/${params.providerId}/activities/${a.id}`} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-secondary/40">
              <div>
                <p className="font-medium">{a.name}</p>
                <p className="text-xs text-muted-foreground">{fmtDate(a.releaseDate)} to {fmtDate(a.expiryDate)} · {a._count.tokens} tokens · {a._count.claims} claims</p>
              </div>
              <Badge variant={a.published ? 'success' : 'secondary'}>{a.published ? 'published' : 'draft'}</Badge>
            </Link>
          ))}
          {!d.recent.length && <p className="px-5 py-4 text-sm text-muted-foreground">No activities yet.</p>}
        </CardContent>
      </Card>
    </>
  );
}
