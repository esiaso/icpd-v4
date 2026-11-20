'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/dialog';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, PageHeader, Textarea } from '@/components/ui';
import { del, get, post } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { fmtDate } from '@/lib/utils';

function SectionBody({ slug, p }: { slug: string; p: any }) {
  const row = (k: string, v: any) => <p className="text-sm"><span className="text-muted-foreground">{k}:</span> {v || '—'}</p>;
  switch (slug) {
    case 'profile':
      return <div className="grid gap-1 sm:grid-cols-2">{row('Name', `${p.firstName} ${p.otherNames ?? ''} ${p.lastName}`)}{row('Reg. no.', p.regNo)}{row('Category', p.category?.name)}{row('ID / passport', p.nationalId)}{row('Email', p.email)}{row('Phone', p.mobile1)}{row('Nationality', p.nationality)}{row('Address', `${p.physicalAddress ?? ''}, ${p.city ?? ''}`)}</div>;
    case 'photo':
      return p.photoSignedUrl ? <img src={p.photoSignedUrl} alt="Applicant" className="h-40 w-32 rounded border object-cover" /> : <p className="text-sm text-destructive">No photo uploaded.</p>;
    case 'academic':
      return <ul className="list-disc pl-5 text-sm">{p.academics.map((a: any) => <li key={a.id}>{a.qualification}, {a.institution}{a.year ? ` (${a.year})` : ''}{a.country ? `, ${a.country}` : ''}</li>)}</ul>;
    case 'specialization':
      return <p className="text-sm">{p.specialities.map((s: any) => `${s.speciality.name}${s.isPrimary ? ' (primary)' : ''}`).join(', ') || '—'}{p.specializationOther ? `; other: ${p.specializationOther}` : ''}</p>;
    case 'workplace':
      return <ul className="list-disc pl-5 text-sm">{p.facilities.map((f: any) => <li key={f.id}>{f.institution}{f.position ? `, ${f.position}` : ''}{f.current ? ' (current)' : ''}</li>)}</ul>;
    default:
      return null;
  }
}

function Section({ s, p, id, active, onChange }: { s: any; p: any; id: string; active: boolean; onChange: () => void }) {
  const [notes, setNotes] = useState(s.notes ?? '');
  async function act(fn: () => Promise<any>) {
    try {
      await fn();
      onChange();
    } catch (e) {
      applyApiError(null, e);
    }
  }
  return (
    <Card className={s.recommendation === 'Incomplete' ? 'border-amber-400' : s.recommendation === 'Complete' ? 'border-emerald-400' : ''}>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">{s.item}</CardTitle>
        <div className="flex gap-1">
          {s.recommendation && <Badge variant={s.recommendation === 'Complete' ? 'success' : 'warning'}>{s.recommendation}</Badge>}
          {s.documentRequested && <Badge variant="destructive">document requested</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <SectionBody slug={s.slug} p={p} />
        {active && (
          <>
            <Textarea placeholder="Notes for the applicant (shown if returned)" value={notes} onChange={(e) => setNotes(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => act(() => post(`/regulator/applications/${id}/sections/${s.slug}`, { recommendation: 'Complete', notes }))}>Complete</Button>
              <Button size="sm" variant="outline" onClick={() => act(() => post(`/regulator/applications/${id}/sections/${s.slug}`, { recommendation: 'Incomplete', notes }))}>Incomplete</Button>
              {s.documentRequested ? (
                <Button size="sm" variant="ghost" onClick={() => act(() => del(`/regulator/applications/${id}/sections/${s.slug}/request-document`))}>Remove document request</Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => act(() => post(`/regulator/applications/${id}/sections/${s.slug}/request-document`, { notes }))}>Request document</Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default function ScreeningPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: d } = useQuery({ queryKey: ['screening', params.id], queryFn: () => get(`/regulator/applications/${params.id}`) });
  const [comment, setComment] = useState('');
  const reload = () => qc.invalidateQueries({ queryKey: ['screening', params.id] });
  if (!d) return null;
  const p = d.practitioner;
  async function act(path: string, body?: any) {
    try {
      const r = await post(`/regulator/applications/${params.id}/${path}`, body);
      toast.success(r.message ?? 'Done');
      reload();
    } catch (e) {
      applyApiError(null, e);
    }
  }
  return (
    <>
      <PageHeader
        title={`${p.firstName} ${p.lastName}`}
        description={`Application ${p.applicationNo} · ${p.regNo ?? ''} · submitted ${fmtDate(p.dateOfApplication)}`}
        actions={
          <>
            <Badge variant="secondary" className="self-center">{p.status}</Badge>
            {d.actions.canStart && <Button onClick={() => act('start')}>Start screening</Button>}
            {d.actions.canReturn && <ConfirmButton variant="default" label="Return to applicant" title="Return this application?" message="The applicant gets an email listing the incomplete sections and your notes." confirmLabel="Return" onConfirm={() => act('return')} />}
            {d.actions.canAdvance && <Button onClick={() => act('complete-screening')}>Complete screening</Button>}
            {d.actions.canApprove && <ConfirmButton variant="default" label="Approve and register" title="Register this practitioner?" confirmLabel="Register" onConfirm={() => act('approve')} />}
            {d.actions.canDelete && <ConfirmButton label="Delete application" title="Delete this unsubmitted application?" onConfirm={async () => { await del(`/regulator/applications/${params.id}`); router.push('/regulator/applications'); }} />}
          </>
        }
      />
      {p.status === 'screening' && !d.actions.canReturn && !d.actions.canAdvance && <Alert className="mb-4">Mark every section Complete or Incomplete. If any is Incomplete you can return the application; if all are Complete you can move it to the next stage.</Alert>}
      <div className="grid gap-4 lg:grid-cols-2">
        {d.sections.map((s: any) => <Section key={s.slug} s={s} p={p} id={params.id} active={p.status === 'screening'} onChange={reload} />)}
      </div>
      {(p.status === 'approved' || d.verification?.approvalComment) && (
        <Card className="mt-4">
          <CardHeader><CardTitle className="text-base">Chairman&apos;s review</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {d.verification?.approvalComment && <p className="text-sm">{d.verification.approvalComment}</p>}
            {p.status === 'approved' && (
              <>
                <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional comment" />
                <Button size="sm" variant="outline" disabled={comment.trim().length < 2} onClick={() => act('chairman-review', { comment })}>Save comment</Button>
              </>
            )}
          </CardContent>
        </Card>
      )}
      <Card className="mt-4">
        <CardHeader><CardTitle className="text-base">History</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {d.history.map((h: any) => <p key={h.id}><span className="text-muted-foreground">{fmtDate(h.createdAt, true)}</span> · {h.event}</p>)}
        </CardContent>
      </Card>
    </>
  );
}
