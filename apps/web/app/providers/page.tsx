'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Card, CardContent, Empty, PageHeader } from '@/components/ui';
import { get } from '@/lib/api';

/** Provider picker: straight to the dashboard when the coordinator has one provider. */
export default function ProviderPicker() {
  const router = useRouter();
  const { data } = useQuery({ queryKey: ['my-providers'], queryFn: () => get<any[]>('/providers/mine') });
  useEffect(() => {
    if (data?.length === 1) router.replace(`/providers/${data[0].id}/dashboard`);
  }, [data, router]);
  if (!data || data.length === 1) return null;
  return (
    <div className="mx-auto max-w-3xl p-6">
      <PageHeader title="Choose a provider" description="You coordinate CPD for more than one provider." />
      {!data.length && <Empty>You are not an active coordinator for any provider. Contact the regulator.</Empty>}
      <div className="grid gap-3 sm:grid-cols-2">
        {data.map((p) => (
          <Link key={p.id} href={`/providers/${p.id}/dashboard`}>
            <Card className="hover:shadow-md">
              <CardContent className="p-4">
                <p className="font-semibold">{p.name}</p>
                <p className="text-sm text-muted-foreground">{p.town}</p>
                <Badge className="mt-2" variant={p.status === 'active' ? 'success' : 'secondary'}>{p.status}</Badge>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
