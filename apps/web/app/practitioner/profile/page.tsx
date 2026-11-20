'use client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { PhotoForm, SpecialitiesForm, WorkplaceForm } from '@/components/registration/forms';
import { Tabs } from '@/components/tabs';
import { Alert, Button, Card, CardContent, Field, Input, PageHeader } from '@/components/ui';
import { put } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { useQuery } from '@tanstack/react-query';
import { get } from '@/lib/api';

export default function ProfilePage() {
  const qc = useQueryClient();
  const { data: p } = useQuery({ queryKey: ['my-profile'], queryFn: () => get('/me/profile') });
  const reload = () => qc.invalidateQueries({ queryKey: ['my-profile'] });
  if (p === null) return <Alert>No practitioner profile yet.</Alert>;
  if (!p) return null;
  return (
    <>
      <PageHeader title={`${p.firstName} ${p.lastName}`} description={`Reg. no. ${p.regNo ?? '—'} · ${p.category?.name ?? ''} · ${p.specialization?.name ?? 'No speciality set'}`} />
      <Tabs
        tabs={[
          {
            value: 'contact',
            label: 'Contact details',
            content: (
              <Card>
                <CardContent className="pt-5">
                  <form
                    className="grid gap-4 sm:grid-cols-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      try {
                        await put('/me/profile/contact', Object.fromEntries(new FormData(e.currentTarget)));
                        toast.success('Saved');
                        reload();
                      } catch (err) {
                        applyApiError(null, err);
                      }
                    }}
                  >
                    <Field label="Mobile" required><Input name="mobile1" defaultValue={p.mobile1 ?? ''} /></Field>
                    <Field label="Other phone"><Input name="mobile2" defaultValue={p.mobile2 ?? ''} /></Field>
                    <Field label="Physical address" required><Input name="physicalAddress" defaultValue={p.physicalAddress ?? ''} /></Field>
                    <Field label="City / town" required><Input name="city" defaultValue={p.city ?? ''} /></Field>
                    <Field label="Postal address"><Input name="postalAddress" defaultValue={p.postalAddress ?? ''} /></Field>
                    <Field label="Postal code"><Input name="postalCode" defaultValue={p.postalCode ?? ''} /></Field>
                    <div className="sm:col-span-2"><Button type="submit">Save</Button></div>
                    <p className="text-xs text-muted-foreground sm:col-span-2">Name, registration number and ID can only be changed by the regulator.</p>
                  </form>
                </CardContent>
              </Card>
            ),
          },
          { value: 'speciality', label: 'Speciality', content: <Card><CardContent className="pt-5"><SpecialitiesForm initial={p} submitLabel="Save" onSubmit={async (v) => { await put('/me/profile/specialities', v); toast.success('Saved'); reload(); }} /></CardContent></Card> },
          { value: 'workplace', label: 'Workplace', content: <Card><CardContent className="pt-5"><WorkplaceForm initial={p.facilities} submitLabel="Save" onSubmit={async (rows) => { await put('/me/profile/workplace', { rows }); toast.success('Saved'); reload(); }} /></CardContent></Card> },
          { value: 'photo', label: 'Photo', content: <Card><CardContent className="pt-5"><PhotoForm current={p.photoSignedUrl} endpoint="/me/profile/photo" onDone={() => { toast.success('Photo updated'); reload(); }} /></CardContent></Card> },
        ]}
      />
    </>
  );
}
