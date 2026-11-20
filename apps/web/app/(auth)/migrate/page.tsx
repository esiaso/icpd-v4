'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, Input } from '@/components/ui';
import { post } from '@/lib/api';
import { applyApiError } from '@/lib/forms';

/** Activate a pre-2021 account with reg. no./email and the old password. */
export default function MigratePage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const me = await post('/auth/migrate', { identifier, password });
      const perms: string[] = me.permissions;
      window.location.href = perms.includes('*') || perms.includes('Read Admin Panel') ? '/regulator' : me.practitionerId ? '/practitioner/portfolio' : perms.includes('Read Provider Panel') ? '/providers' : '/';
    } catch (err) {
      applyApiError(null, err);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Activate your old account</CardTitle>
        <CardDescription>Registered on the CPD portal before 2021? Sign in once with your registration number (or email) and your old password. We&apos;ll move you to the new system.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Registration number or email"><Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" required /></Field>
          <Field label="Old password"><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></Field>
          <Button type="submit" className="w-full" loading={busy}>Activate and sign in</Button>
        </form>
        <p className="mt-4 text-sm text-muted-foreground">Forgot the old password? Ask the regulator to reset it, or <Link className="text-primary underline" href="/register">create a new account</Link> and link your record.</p>
      </CardContent>
    </Card>
  );
}
