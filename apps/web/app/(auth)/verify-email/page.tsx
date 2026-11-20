'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { ApiError, post } from '@/lib/api';

function Verify() {
  const sp = useSearchParams();
  const token = sp.get('token');
  const [state, setState] = useState<'idle' | 'ok' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!token) return;
    post('/auth/verify-email', { token })
      .then((r) => { setState('ok'); setMsg(r.message); })
      .catch((e: ApiError) => { setState('error'); setMsg(e.message); });
  }, [token]);

  async function resend() {
    try {
      const r = await post('/auth/verify-email/resend');
      toast.success(r.message);
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Verify your email</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        {state === 'ok' && <Alert variant="success">{msg} <Link className="font-medium underline" href="/practitioner/registration/new">Continue</Link></Alert>}
        {state === 'error' && <Alert variant="destructive">{msg}</Alert>}
        {!token && (
          <p className="text-sm">
            {sp.get('sent') ? 'We have sent a verification link to your email address. ' : ''}
            Click the link in the email to verify your address. Didn&apos;t get it?
          </p>
        )}
        {state !== 'ok' && <Button variant="outline" onClick={resend}>Resend verification email</Button>}
      </CardContent>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return <Suspense><Verify /></Suspense>;
}
