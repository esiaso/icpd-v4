'use client';
import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Camera } from 'lucide-react';
import { NonTokenForm } from '@/components/cpd/non-token-form';
import { QrScanner } from '@/components/qr-scanner';
import { Tabs } from '@/components/tabs';
import { Alert, Button, Card, CardContent, Field, Input, PageHeader } from '@/components/ui';
import { ApiError, post } from '@/lib/api';

function TokenClaim() {
  const qc = useQueryClient();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; warning?: string | null } | null>(null);
  const onScan = useCallback((text: string) => {
    setScan(false);
    // A scanned card URL carries no token; a scanned token is digits.
    const digits = text.match(/\d{7,}/)?.[0];
    if (digits) setToken(digits);
    else toast.info('That QR code opens the claim page. Type the token printed on the card.');
  }, []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const r = await post('/me/claims/token', { token });
      setResult({ ok: true, message: r.message, warning: r.warning });
      setToken('');
      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/me') });
    } catch (err) {
      setResult({ ok: false, message: err instanceof ApiError ? err.message : 'Something went wrong' });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardContent className="space-y-4 pt-5">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Token" hint="The number printed on your token card. One token per session.">
            <div className="flex gap-2">
              <Input inputMode="numeric" autoComplete="off" autoFocus value={token} onChange={(e) => setToken(e.target.value.replace(/\s+/g, ''))} className="font-mono text-lg tracking-wider" placeholder="e.g. 12345678901" />
              <Button type="button" variant="outline" size="icon" aria-label="Scan with camera" onClick={() => setScan(true)}><Camera className="h-5 w-5" /></Button>
            </div>
          </Field>
          <Button type="submit" size="lg" className="w-full sm:w-auto" loading={busy} disabled={token.length < 4}>Claim points</Button>
        </form>
        {scan && <QrScanner onResult={onScan} onClose={() => setScan(false)} />}
        {result && <Alert variant={result.ok ? 'success' : 'destructive'}>{result.message}</Alert>}
        {result?.warning && <Alert variant="warning">{result.warning}</Alert>}
      </CardContent>
    </Card>
  );
}

export default function ClaimPage() {
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <>
      <PageHeader title="Claim CPD points" />
      <Tabs
        tabs={[
          { value: 'token', label: 'With a token', content: <TokenClaim /> },
          {
            value: 'nontoken',
            label: 'Without a token (upload evidence)',
            content: (
              <Card>
                <CardContent className="pt-5">
                  <NonTokenForm
                    onDone={() => {
                      toast.success('Claim submitted. The regulator will review your evidence.');
                      qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('/me') });
                      router.push('/practitioner/portfolio/claims');
                    }}
                  />
                </CardContent>
              </Card>
            ),
          },
        ]}
      />
    </>
  );
}
