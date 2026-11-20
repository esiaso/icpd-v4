'use client';
import { Suspense } from 'react';
import { ActivityDetail } from '@/components/activity/activity-detail';

export default function ActivityPage({ params }: { params: { providerId: string; activityId: string } }) {
  return (
    <Suspense>
      <ActivityDetail providerId={params.providerId} activityId={params.activityId} backHref={`/providers/${params.providerId}/activities`} />
    </Suspense>
  );
}
