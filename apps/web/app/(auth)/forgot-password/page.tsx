'use client';
import { useState } from 'react';
import { forgotPasswordSchema } from '@icpd/shared';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@/components/ui';
import { post } from '@/lib/api';
import { applyApiError, useZodForm } from '@/lib/forms';

export default function ForgotPasswordPage() {
  const [done, setDone] = useState<string | null>(null);
  const form = useZodForm<{ email: string; website?: string }>(forgotPasswordSchema);
  const onSubmit = form.handleSubmit(async (v) => {
    try {
      const r = await post('/auth/forgot-password', v);
      setDone(r.message);
    } catch (e) {
      applyApiError(form, e);
    }
  });
  return (
    <Card>
      <CardHeader><CardTitle>Forgot your password?</CardTitle></CardHeader>
      <CardContent>
        {done ? (
          <Alert variant="success">{done}</Alert>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label="Email" htmlFor="email" error={form.formState.errors.email?.message}>
              <Input id="email" type="email" {...form.register('email')} />
            </Field>
            <input type="text" tabIndex={-1} aria-hidden className="hidden" {...form.register('website')} />
            <Button type="submit" className="w-full" loading={form.formState.isSubmitting}>Email me a reset link</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
