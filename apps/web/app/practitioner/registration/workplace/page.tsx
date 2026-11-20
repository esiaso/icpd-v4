'use client';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { WorkplaceForm, useApplication } from '@/components/registration/forms';
import { Card, CardContent } from '@/components/ui';
import { put } from '@/lib/api';

export default function WorkplaceStep() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: a } = useApplication();
  if (!a) return null;
  return (
    <Card>
      <CardContent className="pt-5">
        <WorkplaceForm initial={a.facilities} onSubmit={async (rows) => { await put('/me/application/workplace', { rows }); qc.invalidateQueries({ queryKey: ['application'] }); router.push('/practitioner/registration/preview'); }} />
      </CardContent>
    </Card>
  );
}
