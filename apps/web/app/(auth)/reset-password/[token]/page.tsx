'use client';
import Link from 'next/link';
import { useState } from 'react';
import { z } from 'zod';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@/components/ui';
import { post } from '@/lib/api';
import { applyApiError, useZodForm } from '@/lib/forms';

const schema = z
  .object({ password: z.string().min(8, 'At least 8 characters'), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export default function ResetPasswordPage({ params }: { params: { token: string } }) {
  const [done, setDone] = useState(false);
  const form = useZodForm<z.infer<typeof schema>>(schema);
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      await post('/auth/reset-password', { token: params.token, password: v.password });
      setDone(true);
    } catch (e) {
      applyApiError(form, e);
    }
  });
  return (
    <Card>
      <CardHeader><CardTitle>Set a new password</CardTitle></CardHeader>
      <CardContent>
        {done ? (
          <Alert variant="success">Your password has been set. <Link href="/login" className="font-medium underline">Log in</Link></Alert>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label="New password" htmlFor="password" error={form.formState.errors.password?.message}>
              <Input id="password" type="password" autoComplete="new-password" {...form.register('password')} />
            </Field>
            <Field label="Confirm password" htmlFor="confirm" error={form.formState.errors.confirm?.message}>
              <Input id="confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
            </Field>
            <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>Save password</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
