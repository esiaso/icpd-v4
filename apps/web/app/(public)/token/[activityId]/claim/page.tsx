'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input } from '@/components/ui';
import { ApiError, get, post } from '@/lib/api';
import { fmtDate, pts } from '@/lib/utils';

/** Public QR claim page: reg. no. + token, no login (mobile-first). */
export default function QuickClaim({ params }: { params: { activityId: string } }) {
  const { data: a, error } = useQuery({ queryKey: ['quick', params.activityId], queryFn: () => get(`/public/claim/${params.activityId}`) });
  const [regNo, setRegNo] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const r = await post(`/public/claim/${params.activityId}`, { regNo, token });
      setResult({ ok: true, message: `${r.name ? `Thank you, Dr ${r.name}. ` : ''}${r.message}` });
      setToken('');
    } catch (err) {
      setResult({ ok: false, message: err instanceof ApiError ? err.message : 'Something went wrong' });
    } finally {
      setBusy(false);
    }
  }
  if (error) return <Alert variant="destructive">This claim link is not valid.</Alert>;
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Claim CPD points</CardTitle>
          {a && (
            <div className="text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{a.name}</p>
              <p>{a.provider.name} · {a.type.name}</p>
              <p>{fmtDate(a.releaseDate)} to {fmtDate(a.expiryDate)} · {pts(a.cpdPoints)} points per session</p>
            </div>
          )}
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Registration number" hint="e.g. A1234 or B5678">
              <Input value={regNo} onChange={(e) => setRegNo(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" className="text-lg" required />
            </Field>
            <Field label="Token" hint="The number printed on your token card">
              <Input value={token} onChange={(e) => setToken(e.target.value.replace(/\s+/g, ''))} inputMode="numeric" autoComplete="off" className="font-mono text-lg tracking-wider" required />
            </Field>
            <Button type="submit" size="lg" className="w-full" loading={busy}>Claim points</Button>
          </form>
          {result && <Alert className="mt-4" variant={result.ok ? 'success' : 'destructive'}>{result.message}</Alert>}
          <p className="mt-4 text-xs text-muted-foreground">Have an account? Log in to see your full CPD diary.</p>
        </CardContent>
      </Card>
    </div>
  );
}
