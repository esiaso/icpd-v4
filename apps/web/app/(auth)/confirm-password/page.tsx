'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { z } from 'zod';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from '@/components/ui';
import { post } from '@/lib/api';
import { applyApiError, useZodForm } from '@/lib/forms';

const schema = z.object({ password: z.string().min(1, 'Required') });

function Confirm() {
  const router = useRouter();
  const next = useSearchParams().get('next') ?? '/';
  const form = useZodForm<{ password: string }>(schema);
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await post('/auth/confirm-password', v);
      router.replace(next.startsWith('/') ? next : '/');
    } catch (e) {
      applyApiError(form, e);
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Confirm your password</CardTitle>
        <CardDescription>This is a secure area. Please confirm your password before continuing.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
            <Input id="password" type="password" autoComplete="current-password" {...form.register('password')} />
          </Field>
          <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>Confirm</Button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function ConfirmPasswordPage() {
  return <Suspense><Confirm /></Suspense>;
}
