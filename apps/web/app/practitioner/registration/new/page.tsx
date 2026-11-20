'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ProfileForm, useApplication } from '@/components/registration/forms';
import { Alert, Button, Card, CardContent, Field, Input } from '@/components/ui';
import { get, post } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { useMe } from '@/lib/hooks';

export default function NewApplication() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: app, isLoading } = useApplication();
  const [importable, setImportable] = useState<any>(null);
  const [nationalId, setNationalId] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (app) router.replace('/practitioner/registration/preview');
  }, [app, router]);
  useEffect(() => {
    if (me?.emailVerified) get('/me/application/legacy').then((r) => setImportable(r.importable)).catch(() => undefined);
  }, [me]);

  if (me && !me.emailVerified) return <Alert variant="warning">Please verify your email address first. Check your inbox for the link, or <a className="underline" href="/verify-email">resend it</a>.</Alert>;
  if (isLoading || app) return null;

  if (importable) {
    return (
      <Card>
        <CardContent className="space-y-4 pt-5">
          <Alert>We found an existing practitioner record <b>{importable.regNo}</b> ({importable.firstName} {importable.lastName}). Link it to your account instead of creating a new application.</Alert>
          <Field label="National ID / passport number on that record" hint="Needed unless the record already uses your account email.">
            <Input value={nationalId} onChange={(e) => setNationalId(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <Button
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await post('/me/application/import', { regNo: importable.regNo, nationalId: nationalId || undefined });
                  await post('/auth/refresh');
                  toast.success('Your record is linked. Welcome back!');
                  qc.invalidateQueries();
                  window.location.href = '/practitioner/portfolio';
                } catch (e) {
                  applyApiError(null, e);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Link my record
            </Button>
            <Button variant="outline" onClick={() => setImportable(null)}>This is not me</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-5">
        <ProfileForm
          initial={{ email: me?.email, firstName: me?.name?.split(' ')[0], lastName: me?.name?.split(' ').slice(1).join(' ') }}
          onSubmit={async (v) => {
            const r = await post('/me/application/profile', v);
            if (r.next === 'import') {
              setImportable(r.importable);
              return;
            }
            qc.invalidateQueries({ queryKey: ['application'] });
            await post('/auth/refresh').catch(() => undefined);
            router.push('/practitioner/registration/photo');
          }}
        />
      </CardContent>
    </Card>
  );
}
