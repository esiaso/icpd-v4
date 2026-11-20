'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConfirmButton } from '@/components/dialog';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Input, PageHeader } from '@/components/ui';
import { del, get, post } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { fmtDate } from '@/lib/utils';

export default function DeveloperDashboard() {
  const qc = useQueryClient();
  const { data = [] } = useQuery({ queryKey: ['pats'], queryFn: () => get<any[]>('/me/tokens') });
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Developer dashboard" description="Personal access tokens for scripts and integrations. Send as Authorization: Bearer <token>." />
      <Card className="mb-4">
        <CardHeader><CardTitle className="text-base">Create a token</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Token name, e.g. Reporting script" value={name} onChange={(e) => setName(e.target.value)} />
            <Button
              disabled={name.trim().length < 2}
              onClick={async () => {
                try {
                  const r = await post('/me/tokens', { name });
                  setCreated(r.token);
                  setName('');
                  qc.invalidateQueries({ queryKey: ['pats'] });
                } catch (e) {
                  applyApiError(null, e);
                }
              }}
            >
              Create
            </Button>
          </div>
          {created && <Alert variant="warning">Copy this token now; it is not shown again: <code className="break-all font-mono">{created}</code></Alert>}
          <p className="text-xs text-muted-foreground">Provider systems calling the public v1 API use app credentials issued by the regulator (header <code>api-consumer</code>), not personal tokens. API docs: <a className="underline" href="/api/docs" target="_blank">/api/docs</a></p>
        </CardContent>
      </Card>
      <Card className="divide-y">
        {data.map((t) => (
          <div key={t.id} className="flex items-center justify-between p-3 text-sm">
            <div><p className="font-medium">{t.name}</p><p className="text-xs text-muted-foreground">Created {fmtDate(t.createdAt)} · last used {fmtDate(t.lastUsedAt, true)}</p></div>
            <ConfirmButton label="Revoke" title={`Revoke ${t.name}?`} onConfirm={async () => { await del(`/me/tokens/${t.id}`); qc.invalidateQueries({ queryKey: ['pats'] }); }} />
          </div>
        ))}
        {!data.length && <p className="p-4 text-sm text-muted-foreground">No tokens yet.</p>}
      </Card>
    </>
  );
}
