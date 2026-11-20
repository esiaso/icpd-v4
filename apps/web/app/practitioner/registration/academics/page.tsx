'use client';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AcademicsForm, useApplication } from '@/components/registration/forms';
import { Card, CardContent } from '@/components/ui';
import { put } from '@/lib/api';

export default function AcademicsStep() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: a } = useApplication();
  if (!a) return null;
  return (
    <Card>
      <CardContent className="pt-5">
        <AcademicsForm initial={a.academics} onSubmit={async (rows) => { await put('/me/application/academics', { rows }); qc.invalidateQueries({ queryKey: ['application'] }); router.push('/practitioner/registration/specialization'); }} />
      </CardContent>
    </Card>
  );
}
