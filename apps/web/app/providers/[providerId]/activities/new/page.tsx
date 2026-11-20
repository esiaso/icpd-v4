'use client';
import { useRouter } from 'next/navigation';
import { ActivityForm } from '@/components/activity-form';
import { Card, CardContent, PageHeader } from '@/components/ui';
import { post } from '@/lib/api';

export default function NewActivity({ params }: { params: { providerId: string } }) {
  const router = useRouter();
  const base = `/providers/${params.providerId}/activities`;
  return (
    <>
      <PageHeader title="New activity" description="Step 1 of 2: the basics. Next you add the description, objectives and topic." />
      <Card>
        <CardContent className="pt-5">
          <ActivityForm
            submitLabel="Continue to description"
            onSubmit={async (v) => {
              const a = await post(base, v);
              router.push(`${base}/${a.id}?tab=description`);
            }}
          />
        </CardContent>
      </Card>
    </>
  );
}
