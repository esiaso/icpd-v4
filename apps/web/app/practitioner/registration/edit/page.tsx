'use client';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ProfileForm, useApplication } from '@/components/registration/forms';
import { Card, CardContent } from '@/components/ui';
import { put } from '@/lib/api';

export default function EditProfileStep() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: a } = useApplication();
  if (!a) return null;
  return (
    <Card>
      <CardContent className="pt-5">
        <ProfileForm initial={a} onSubmit={async (v) => { await put('/me/application/profile', v); qc.invalidateQueries({ queryKey: ['application'] }); router.push('/practitioner/registration/photo'); }} />
      </CardContent>
    </Card>
  );
}
