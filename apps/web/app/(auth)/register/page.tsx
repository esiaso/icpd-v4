'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { registerSchema, type RegisterInput } from '@icpd/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from '@/components/ui';
import { post } from '@/lib/api';
import { applyApiError, useZodForm } from '@/lib/forms';

export default function RegisterPage() {
  const router = useRouter();
  const form = useZodForm<RegisterInput>(registerSchema);
  const { register, handleSubmit, formState } = form;
  const onSubmit = handleSubmit(async (v) => {
    try {
      await post('/auth/register', v);
      router.replace('/verify-email?sent=1');
    } catch (e) {
      applyApiError(form, e);
    }
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>Practitioners: create an account, then complete your registration application.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Full name" htmlFor="name" error={formState.errors.name?.message} required>
            <Input id="name" autoComplete="name" {...register('name')} />
          </Field>
          <Field label="Email" htmlFor="email" error={formState.errors.email?.message} required>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
          </Field>
          <Field label="Password" htmlFor="password" error={formState.errors.password?.message} hint="At least 8 characters" required>
            <Input id="password" type="password" autoComplete="new-password" {...register('password')} />
          </Field>
          {/* Honeypot: hidden from people, filled by bots */}
          <input type="text" tabIndex={-1} autoComplete="off" aria-hidden className="hidden" {...register('website')} />
          <Button type="submit" className="w-full" loading={formState.isSubmitting}>Sign up</Button>
        </form>
        <p className="mt-4 text-sm">Already registered? <Link href="/login" className="text-primary hover:underline">Log in</Link></p>
      </CardContent>
    </Card>
  );
}
