'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { nairobiYear } from '@icpd/shared';
import { PortfolioView } from '@/components/cpd/portfolio-view';
import { ConfirmButton, Dialog } from '@/components/dialog';
import { Tabs } from '@/components/tabs';
import { Alert, Badge, Button, Card, CardContent, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';
import { ApiError, del, get, post, put } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { useReference } from '@/lib/hooks';
import { fmtDate, pts } from '@/lib/utils';

function EditForm({ p, onSaved }: { p: any; onSaved: () => void }) {
  const { data: ref } = useReference();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const f = (k: string, label: string, type = 'text') => (
    <Field label={label} error={errors[k]}><Input name={k} type={type} defaultValue={type === 'date' ? p[k]?.slice(0, 10) : p[k] ?? ''} /></Field>
  );
  return (
    <form
      className="grid gap-4 sm:grid-cols-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const v: any = Object.fromEntries(new FormData(e.currentTarget));
        for (const k of Object.keys(v)) if (v[k] === '') v[k] = null;
        setBusy(true);
        setErrors({});
        try {
          await put(`/regulator/practitioners/${p.id}`, v);
          toast.success('Saved');
          onSaved();
        } catch (err) {
          if (err instanceof ApiError) setErrors(err.fields);
          applyApiError(null, err);
        } finally {
          setBusy(false);
        }
      }}
    >
      {f('firstName', 'First name')}{f('otherNames', 'Other names')}{f('lastName', 'Last name')}
      {f('regNo', 'Reg. no.')}{f('nationalId', 'ID / passport')}{f('dob', 'Date of birth', 'date')}
      {f('email', 'Email', 'email')}{f('mobile1', 'Mobile')}{f('mobile2', 'Other phone')}
      {f('physicalAddress', 'Physical address')}{f('city', 'City')}{f('nationality', 'Nationality')}
      <Field label="Category"><Select name="categoryId" defaultValue={p.categoryId ?? ''}><option value="">—</option>{ref?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
      <Field label="Primary speciality"><Select name="specializationId" defaultValue={p.specializationId ?? ''}><option value="">—</option>{ref?.specialities.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      <Field label="Status"><Select name="status" defaultValue={p.status}>{['presubmission', 'submitted', 'screening', 'returned', 'approved', 'registered', 'incomplete'].map((s) => <option key={s}>{s}</option>)}</Select></Field>
      <div className="sm:col-span-3"><Button type="submit" loading={busy}>Save changes</Button></div>
    </form>
  );
}

export default function PractitionerDetail({ params }: { params: { id: string } }) {
  const id = params.id;
  const router = useRouter();
  const qc = useQueryClient();
  const { data: p } = useQuery({ queryKey: ['reg-practitioner', id], queryFn: () => get(`/regulator/practitioners/${id}`) });
  const [exempt, setExempt] = useState(false);
  const [temp, setTemp] = useState<string | null>(null);
  const reload = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes(id) || q.queryKey[0] === 'reg-practitioner' });
  if (!p) return null;
  async function act(fn: () => Promise<any>, msg: (r: any) => string) {
    try {
      const r = await fn();
      toast.success(msg(r));
      reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PASSWORD_CONFIRMATION_REQUIRED') router.push(`/confirm-password?next=/regulator/practitioners/${id}`);
      else applyApiError(null, e);
    }
  }
  const base = `/regulator/practitioners/${id}`;
  return (
    <>
      <PageHeader
        title={`${p.firstName} ${p.otherNames ?? ''} ${p.lastName}`}
        description={`Reg. no. ${p.regNo ?? '—'} · ${p.category?.name ?? ''} · ${p.specialization?.name ?? 'no speciality'}`}
        actions={
          <>
            <Badge variant={p.status === 'registered' ? 'success' : 'secondary'} className="self-center">{p.status}</Badge>
            {p.deletedAt && <Badge variant="destructive" className="self-center">in trash</Badge>}
            <Button variant="outline" onClick={() => setExempt(true)}>Exempt for a year</Button>
            <Button variant="outline" onClick={() => act(() => post(`${base}/reprocess-attendance`), (r) => r.message)}>Re-process pending attendance</Button>
            {!p.userId && <Button variant="outline" onClick={() => act(() => post(`${base}/reset-legacy-password`), (r) => { setTemp(r.temporaryPassword); return 'Temporary legacy password created'; })}>Reset legacy password</Button>}
            {p.deletedAt ? (
              <>
                <Button variant="outline" onClick={() => act(() => post(`${base}/restore`), () => 'Restored')}>Restore</Button>
                <ConfirmButton label="Delete permanently" title="Permanently delete this record?" message="Only allowed for records without CPD history. This cannot be undone." onConfirm={() => act(() => del(`${base}/permanent`), () => 'Deleted')} />
              </>
            ) : (
              <ConfirmButton label="Move to trash" title="Move this practitioner to the trash?" onConfirm={() => act(() => del(base), () => 'Moved to trash')} />
            )}
          </>
        }
      />
      {temp && <Alert variant="warning" className="mb-4">Temporary legacy password: <code className="font-mono">{temp}</code>. Give it to the practitioner securely; they use it once on the &quot;Activate old account&quot; page with their reg. no. It is not shown again.</Alert>}
      <Tabs
        tabs={[
          { value: 'cpd', label: 'CPD diary & compliance', content: <PortfolioView base={base} pdfBase={base} /> },
          {
            value: 'profile',
            label: 'Profile',
            content: (
              <div className="grid gap-4 lg:grid-cols-3">
                <Card>
                  <CardContent className="space-y-2 pt-5 text-sm">
                    {p.photoSignedUrl && <img src={p.photoSignedUrl} alt="" className="h-40 w-32 rounded border object-cover" />}
                    <p>Application {p.applicationNo ?? '—'} · registered {fmtDate(p.dateRegistered)}</p>
                    <p>Account: {p.user ? `${p.user.email} (last login ${fmtDate(p.user.lastLoginAt, true)})` : 'none (legacy record)'}</p>
                    <p>Specialities: {p.specialities.map((s: any) => s.speciality.name).join(', ') || '—'}</p>
                    <p>Workplace: {p.facilities.map((f: any) => f.institution).join('; ') || '—'}</p>
                    <p>Points by year: {p.pointsByYear.map((y: any) => `${y.year}: ${pts(y.points)}`).join(' · ') || '—'}</p>
                    <p>Exemptions: {p.exemptions.map((e: any) => `${e.cpdYear} (${e.reason})`).join('; ') || '—'}</p>
                  </CardContent>
                </Card>
                <Card className="lg:col-span-2"><CardContent className="pt-5"><EditForm p={p} onSaved={reload} /></CardContent></Card>
              </div>
            ),
          },
          {
            value: 'logs',
            label: 'Claim log',
            content: (
              <Card className="divide-y">
                {p.logs.map((l: any) => (
                  <div key={l.id} className="p-3 text-sm"><Badge variant={l.logType === 'claim_success' ? 'success' : 'secondary'}>{l.logType}</Badge> <span className="text-muted-foreground">{fmtDate(l.logDate, true)}</span><p>{l.notes}</p></div>
                ))}
                {!p.logs.length && <p className="p-4 text-sm text-muted-foreground">No claim attempts logged.</p>}
              </Card>
            ),
          },
        ]}
      />
      <Dialog open={exempt} onOpenChange={setExempt} title="Exempt for a CPD year">
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const v = Object.fromEntries(new FormData(e.currentTarget));
            await act(() => post('/regulator/exemptions', { ...v, practitionerId: id }), () => 'Exemption recorded');
            setExempt(false);
          }}
        >
          <Field label="CPD year" required><Input name="cpdYear" type="number" defaultValue={nairobiYear()} /></Field>
          <Field label="Reason" required><Textarea name="reason" required minLength={3} /></Field>
          <Button type="submit">Exempt</Button>
        </form>
      </Dialog>
    </>
  );
}
