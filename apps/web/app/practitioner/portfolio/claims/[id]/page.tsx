'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { NonTokenForm } from '@/components/cpd/non-token-form';
import { ConfirmButton } from '@/components/dialog';
import { Alert, Badge, Button, Card, CardContent, PageHeader } from '@/components/ui';
import { del, get } from '@/lib/api';
import { fmtDate, pts } from '@/lib/utils';

export default function ClaimDetail({ params }: { params: { id: string } }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const { data: c, error } = useQuery({ queryKey: ['my-claim', params.id], queryFn: () => get(`/me/non-token-claims/${params.id}`) });
  if (error) return <Alert variant="destructive">{(error as Error).message}</Alert>;
  if (!c) return null;
  const approved = c.status === 'Yes';
  return (
    <>
      <PageHeader
        title={c.activityName}
        description={`${c.activityType.name} · ${fmtDate(c.beginDate)} to ${fmtDate(c.endDate)} · ${c.place}`}
        actions={
          !approved && (
            <>
              <Button variant="outline" onClick={() => setEditing((e) => !e)}>{editing ? 'Cancel editing' : 'Edit'}</Button>
              <ConfirmButton label="Delete" title="Delete this claim?" onConfirm={async () => { await del(`/me/non-token-claims/${c.id}`); toast.success('Claim deleted'); router.push('/practitioner/portfolio/claims'); }} />
            </>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant={approved ? 'success' : c.status === 'Pending' ? 'warning' : 'destructive'}>{approved ? 'Approved' : c.status}</Badge>
        {approved && c.cpdClaim && <span className="text-sm">{pts(c.cpdClaim.cpdPoints)} points awarded</span>}
      </div>
      {c.comments?.map((m: any) => <Alert key={m.id} variant="destructive" className="mb-3">Officer&apos;s note ({fmtDate(m.date)}): {m.comment}</Alert>)}
      {editing ? (
        <Card>
          <CardContent className="pt-5">
            <NonTokenForm
              initial={c}
              onDone={() => {
                toast.success('Claim updated and resubmitted');
                setEditing(false);
                qc.invalidateQueries({ queryKey: ['my-claim', params.id] });
              }}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-3 pt-5 text-sm">
            <p className="whitespace-pre-wrap">{c.description}</p>
            {c.evidenceSignedUrl && <iframe title="Evidence" src={c.evidenceSignedUrl} className="h-[70vh] w-full rounded border" />}
          </CardContent>
        </Card>
      )}
    </>
  );
}
