'use client';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { SpecialitiesForm, useApplication } from '@/components/registration/forms';
import { Card, CardContent } from '@/components/ui';
import { put } from '@/lib/api';

export default function SpecializationStep() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: a } = useApplication();
  if (!a) return null;
  return (
    <Card>
      <CardContent className="pt-5">
        <SpecialitiesForm initial={a} onSubmit={async (v) => { await put('/me/application/specialities', v); qc.invalidateQueries({ queryKey: ['application'] }); router.push('/practitioner/registration/workplace'); }} />
      </CardContent>
    </Card>
  );
}
