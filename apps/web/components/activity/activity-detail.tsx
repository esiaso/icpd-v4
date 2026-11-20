'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { activityDescriptionSchema } from '@icpd/shared';
import { ActivityForm } from '../activity-form';
import { ConfirmButton } from '../dialog';
import { Tabs } from '../tabs';
import { Alert, Badge, Button, Card, CardContent, Field, Input, PageHeader, Stat, Textarea } from '../ui';
import { del, download, get, patch, post, put, upload } from '@/lib/api';
import { applyApiError, useZodForm } from '@/lib/forms';
import { fmtDate, pts } from '@/lib/utils';
import { People } from './people';
import { Tokens } from './tokens';
import { Attendees } from './attendees';

function Description({ base, a, onSaved }: { base: string; a: any; onSaved: () => void }) {
  const form = useZodForm<any>(activityDescriptionSchema, { defaultValues: a });
  const submit = form.handleSubmit(async (v) => {
    try {
      await patch(`${base}/description`, v);
      toast.success('Description saved');
      onSaved();
    } catch (e) {
      applyApiError(form, e);
    }
  });
  return (
    <Card>
      <CardContent className="pt-5">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Topic"><Textarea rows={2} {...form.register('topic')} /></Field>
          <Field label="Objectives"><Textarea rows={4} {...form.register('objectives')} /></Field>
          <Field label="Description"><Textarea rows={6} {...form.register('description')} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Coordinator"><Input {...form.register('coordinator')} /></Field>
            <Field label="Primary audience"><Input {...form.register('primaryAudience')} /></Field>
            <Field label="Hashtag"><Input {...form.register('hashtag')} /></Field>
            <Field label="Cost"><Input {...form.register('activityCost')} /></Field>
            <Field label="Sub-unit / department"><Input {...form.register('subProviderUnit')} /></Field>
          </div>
          <Button type="submit" loading={form.formState.isSubmitting}>Save description</Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Activity workspace page shared by coordinators and regulators (overview, description, people, tokens, attendees). */
export function ActivityDetail({ providerId, activityId, backHref }: { providerId: string; activityId: string; backHref: string }) {
  const base = `/providers/${providerId}/activities/${activityId}`;
  const router = useRouter();
  const tab = useSearchParams().get('tab') ?? 'overview';
  const qc = useQueryClient();
  const { data: a, error } = useQuery({ queryKey: [base], queryFn: () => get(base) });
  const reload = () => qc.invalidateQueries({ queryKey: [base] });
  if (error) return <Alert variant="destructive">{(error as Error).message}</Alert>;
  if (!a) return null;

  async function act(fn: () => Promise<any>, msg: string) {
    try {
      await fn();
      toast.success(msg);
      reload();
    } catch (e) {
      applyApiError(null, e);
    }
  }

  return (
    <>
      <PageHeader
        title={a.name}
        description={`${a.activityNo ?? ''} · ${a.type.name} · ${fmtDate(a.releaseDate)} to ${fmtDate(a.expiryDate)}`}
        actions={
          <>
            {a.published ? <Badge variant="success" className="self-center">published</Badge> : <Badge variant="secondary" className="self-center">draft</Badge>}
            {a.archived && <Badge variant="warning" className="self-center">archived</Badge>}
            {a.published ? (
              <Button variant="outline" onClick={() => act(() => post(`${base}/unpublish`), 'Unpublished')}>Unpublish</Button>
            ) : (
              !a.archived && <Button onClick={() => act(() => post(`${base}/publish`), 'Published')}>Publish</Button>
            )}
          </>
        }
      />
      <Tabs
        defaultValue={tab}
        tabs={[
          {
            value: 'overview',
            label: 'Overview',
            content: (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Points" value={`${pts(a.cpdPoints)} × ${a.numSessions}`} hint={`max ${pts(a.maxPoints)} per attendee`} />
                  <Stat label="Tokens" value={a.stats.tokens} hint={`${a.stats.claimedTokens} claimed`} />
                  <Stat label="Claims" value={a.stats.claims} />
                  <Stat label="Imported attendees" value={Object.values(a.stats.imports as Record<string, number>).reduce((s, n) => s + n, 0)} hint={a.stats.imports.unprocessed ? `${a.stats.imports.unprocessed} to process` : undefined} />
                </div>
                <Card>
                  <CardContent className="flex flex-wrap items-center gap-4 pt-5 text-sm">
                    <img src={`/api${base}/qr`} alt="QR code to claim points" className="h-28 w-28 rounded border" />
                    <div className="space-y-1">
                      <p className="font-medium">Quick claim link</p>
                      <p className="break-all font-mono text-xs">{a.claimUrl}</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => download(`${base}/qr`, `activity-${a.id}-qr.png`)}>Download QR</Button>
                        <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(a.claimUrl).then(() => toast.success('Link copied'))}>Copy link</Button>
                      </div>
                    </div>
                    <div className="ml-auto space-y-1">
                      {a.posterSignedUrl && <img src={a.posterSignedUrl} alt="Poster" className="h-28 rounded border" />}
                      <label className="block text-xs text-muted-foreground">
                        Poster image
                        <input
                          type="file"
                          accept="image/*"
                          className="block text-xs"
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const fd = new FormData();
                            fd.set('file', f);
                            await act(() => upload(`${base}/poster`, fd), 'Poster uploaded');
                          }}
                        />
                      </label>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-5">
                    <ActivityForm initial={a} onSubmit={async (v) => { await put(base, v); toast.success('Activity saved'); reload(); }} />
                  </CardContent>
                </Card>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => act(() => post(`${base}/archive`, { archived: !a.archived }), a.archived ? 'Restored' : 'Archived')}>{a.archived ? 'Restore from archive' : 'Archive'}</Button>
                  <ConfirmButton
                    label="Delete activity"
                    title="Delete this activity?"
                    message="It will be removed from listings. Claims already made stay in practitioners' diaries."
                    onConfirm={async () => {
                      await del(base);
                      router.push(backHref);
                    }}
                  />
                </div>
              </div>
            ),
          },
          { value: 'description', label: 'Description', content: <Description base={base} a={a} onSaved={reload} /> },
          { value: 'presenters', label: 'Presenters', content: <People base={base} kind="presenter" /> },
          { value: 'moderators', label: 'Moderators', content: <People base={base} kind="moderator" /> },
          { value: 'tokens', label: 'Tokens', content: <Tokens base={base} activity={a} /> },
          { value: 'attendees', label: 'Attendees', content: <Attendees base={base} activity={a} /> },
        ]}
      />
    </>
  );
}
