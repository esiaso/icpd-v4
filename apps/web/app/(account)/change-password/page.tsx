'use client';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@/components/ui';
import { post } from '@/lib/api';
import { applyApiError, useZodForm } from '@/lib/forms';

const schema = z
  .object({ currentPassword: z.string().min(1, 'Required'), password: z.string().min(8, 'At least 8 characters'), confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export default function ChangePasswordPage() {
  const form = useZodForm<z.infer<typeof schema>>(schema);
  const onSubmit = form.handleSubmit(async ({ currentPassword, password }) => {
    try {
      await post('/auth/change-password', { currentPassword, password });
      toast.success('Password updated');
      form.reset();
    } catch (e) {
      applyApiError(form, e);
    }
  });
  return (
    <div className="mx-auto max-w-md p-6">
      <Card>
        <CardHeader><CardTitle>Change password</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Current password" htmlFor="cur" error={form.formState.errors.currentPassword?.message}>
              <Input id="cur" type="password" autoComplete="current-password" {...form.register('currentPassword')} />
            </Field>
            <Field label="New password" htmlFor="pw" error={form.formState.errors.password?.message}>
              <Input id="pw" type="password" autoComplete="new-password" {...form.register('password')} />
            </Field>
            <Field label="Confirm new password" htmlFor="cf" error={form.formState.errors.confirm?.message}>
              <Input id="cf" type="password" autoComplete="new-password" {...form.register('confirm')} />
            </Field>
            <Button type="submit" loading={form.formState.isSubmitting}>Update password</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
