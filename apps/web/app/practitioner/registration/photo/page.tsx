'use client';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { PhotoForm, useApplication } from '@/components/registration/forms';
import { Card, CardContent } from '@/components/ui';

export default function PhotoStep() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: a } = useApplication();
  if (!a) return null;
  return (
    <Card>
      <CardContent className="pt-5">
        <PhotoForm current={a.photoSignedUrl} endpoint="/me/application/photo" onDone={() => { qc.invalidateQueries({ queryKey: ['application'] }); router.push('/practitioner/registration/academics'); }} />
      </CardContent>
    </Card>
  );
}
