'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { loginSchema, type LoginInput } from '@icpd/shared';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from '@/components/ui';
import { post } from '@/lib/api';
import { applyApiError, useZodForm } from '@/lib/forms';

function landing(me: { roles: string[]; permissions: string[]; practitionerId: string | null }) {
  const perms = me.permissions;
  if (perms.includes('*') || perms.includes('Read Admin Panel')) return '/regulator';
  if (perms.includes('Read Provider Panel') && !me.practitionerId) return '/providers';
  if (me.practitionerId) return '/practitioner/portfolio';
  return '/practitioner/registration/new';
}

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = sp.get('next');
  const ssoError = sp.get('sso_error');
  const form = useZodForm<LoginInput>(loginSchema);
  const { register, handleSubmit, formState } = form;

  const onSubmit = handleSubmit(async (v) => {
    try {
      const me = await post('/auth/login', v);
      router.replace(next && next.startsWith('/') ? next : landing(me));
      router.refresh();
    } catch (e) {
      applyApiError(form, e);
    }
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log in</CardTitle>
        <CardDescription>Use the email and password for your ICPD account.</CardDescription>
      </CardHeader>
      <CardContent>
        {ssoError && <p role="alert" className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900">{ssoError}</p>}
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Email" htmlFor="email" error={formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
          </Field>
          <Field label="Password" htmlFor="password" error={formState.errors.password?.message}>
            <Input id="password" type="password" autoComplete="current-password" {...register('password')} />
          </Field>
          <Button type="submit" className="w-full" loading={formState.isSubmitting}>Log in</Button>
        </form>
        <div className="mt-4 space-y-2 text-sm">
          <p><Link href="/forgot-password" className="text-primary hover:underline">Forgot your password?</Link></p>
          <p>No account? <Link href="/register" className="text-primary hover:underline">Sign up</Link></p>
          <p className="text-muted-foreground">Registered before 2021? <Link href="/migrate" className="text-primary hover:underline">Activate your old account</Link> or <a href="/osp/login" className="text-primary hover:underline">sign in with OSP</a>.</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
