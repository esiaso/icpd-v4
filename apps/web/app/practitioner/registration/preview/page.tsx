'use client';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useApplication } from '@/components/registration/forms';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { post } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { fmtDate } from '@/lib/utils';

const STATUS: Record<string, string> = {
  presubmission: 'Not yet submitted',
  submitted: 'Submitted, waiting for screening',
  screening: 'Being screened',
  returned: 'Returned for changes',
  approved: 'Screening complete, awaiting registration',
  registered: 'Registered',
  incomplete: 'Incomplete',
};

export default function PreviewStep() {
  const qc = useQueryClient();
  const { data: a, isLoading } = useApplication();
  if (isLoading) return null;
  if (!a) return <Alert>No application yet. <Link className="underline" href="/practitioner/registration/new">Start one</Link>.</Alert>;
  async function act(path: string) {
    try {
      const r = await post(path);
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ['application'] });
    } catch (e) {
      applyApiError(null, e);
    }
  }
  const row = (k: string, v: any) => <div className="grid grid-cols-3 gap-2 py-1 text-sm"><span className="text-muted-foreground">{k}</span><span className="col-span-2">{v || '—'}</span></div>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={a.status === 'registered' ? 'success' : a.status === 'returned' ? 'warning' : 'secondary'}>{STATUS[a.status] ?? a.status}</Badge>
        <span className="text-sm text-muted-foreground">Application {a.applicationNo}{a.dateOfApplication ? ` · submitted ${fmtDate(a.dateOfApplication)}` : ''}</span>
      </div>
      {!!a.missing.length && a.editable && <Alert variant="warning">Still to complete: {a.missing.join(', ')}.</Alert>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col items-center gap-2 pt-5">
            {a.photoSignedUrl ? <img src={a.photoSignedUrl} alt="" className="h-40 w-32 rounded border object-cover" /> : <div className="flex h-40 w-32 items-center justify-center rounded border text-xs text-muted-foreground">No photo</div>}
            <p className="font-semibold">{a.firstName} {a.otherNames ?? ''} {a.lastName}</p>
            <p className="font-mono text-sm">{a.regNo}</p>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="divide-y">
            {row('Category', a.category?.name)}
            {row('Email', a.email)}
            {row('Phone', [a.mobile1, a.mobile2].filter(Boolean).join(', '))}
            {row('ID / passport', a.nationalId)}
            {row('Address', [a.physicalAddress, a.city].filter(Boolean).join(', '))}
            {row('Academics', a.academics.map((x: any) => `${x.qualification} (${x.institution}${x.year ? `, ${x.year}` : ''})`).join('; '))}
            {row('Specialities', a.specialities.map((s: any) => `${s.speciality.name}${s.isPrimary ? ' (primary)' : ''}`).join(', '))}
            {row('Workplace', a.facilities.map((f: any) => `${f.institution}${f.position ? `, ${f.position}` : ''}`).join('; '))}
          </CardContent>
        </Card>
      </div>
      {a.status === 'presubmission' && <Button size="lg" disabled={!!a.missing.length} onClick={() => act('/me/application/submit')}>Submit application</Button>}
      {a.status === 'returned' && <Button size="lg" onClick={() => act('/me/application/resubmit')}>Resubmit application</Button>}
      {a.status === 'registered' && <Link className="text-primary underline" href="/practitioner/portfolio">Go to your CPD portfolio</Link>}
    </div>
  );
}
