import Link from 'next/link';
import { notFound } from 'next/navigation';
import { serverApi } from '@/lib/session';
import { Badge, Card, CardContent, CardHeader, CardTitle } from '@/components/ui';
import { fmtDate, pts } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function ActivityDetail({ params }: { params: { id: string } }) {
  const a = await serverApi<any>(`/public/activities/${params.id}`);
  if (!a) notFound();
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{a.type.name}</Badge>
          <Badge variant="outline">{a.deliveryMode}</Badge>
          {a.specialities.map((s: any) => <Badge key={s.id}>{s.name}</Badge>)}
        </div>
        <h1 className="text-3xl font-bold">{a.name}</h1>
        <p className="text-muted-foreground">
          By <Link href={`/provider-directory/${a.provider.id}`} className="text-primary underline">{a.provider.name}</Link>
        </p>
        {a.posterUrl && <img src={a.posterUrl} alt="" className="max-h-96 rounded-lg border" />}
        {a.topic && <section><h2 className="font-semibold">Topic</h2><p className="whitespace-pre-wrap">{a.topic}</p></section>}
        {a.objectives && <section><h2 className="font-semibold">Objectives</h2><p className="whitespace-pre-wrap">{a.objectives}</p></section>}
        {a.description && <section><h2 className="font-semibold">Description</h2><p className="whitespace-pre-wrap">{a.description}</p></section>}
        {!!a.presenters.length && (
          <section>
            <h2 className="mb-2 font-semibold">Presenters</h2>
            <ul className="space-y-1 text-sm">
              {a.presenters.map((p: any, i: number) => (
                <li key={i}><span className="font-medium">{p.firstName} {p.otherNames ?? ''} {p.lastName}</span>{p.topic ? `: ${p.topic}` : ''}{p.affiliation ? <span className="text-muted-foreground"> ({p.affiliation})</span> : ''}</li>
              ))}
            </ul>
          </section>
        )}
        {!!a.moderators.length && (
          <section>
            <h2 className="mb-2 font-semibold">Moderators</h2>
            <ul className="space-y-1 text-sm">{a.moderators.map((m: any, i: number) => <li key={i}>{m.firstName} {m.middleName ?? ''} {m.lastName}{m.portfolio ? ` (${m.portfolio})` : ''}</li>)}</ul>
          </section>
        )}
      </div>
      <Card className="h-fit">
        <CardHeader><CardTitle>Details</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p><span className="text-muted-foreground">Dates:</span> {fmtDate(a.releaseDate)} to {fmtDate(a.expiryDate)}{a.endTime ? `, ends ${a.endTime}` : ''}</p>
          {a.venue && <p><span className="text-muted-foreground">Venue:</span> {a.venue}{a.city ? `, ${a.city}` : ''}</p>}
          {a.venueOnline && <p><span className="text-muted-foreground">Online:</span> <a className="text-primary underline" href={a.venueOnline} target="_blank" rel="noreferrer">Join link</a></p>}
          <p><span className="text-muted-foreground">Points:</span> {pts(a.cpdPoints)} per session × {a.numSessions} (max {pts(a.maxPoints)})</p>
          {Number(a.type.presenterPoints) > 0 && <p className="text-muted-foreground">Presenters earn +{pts(a.type.presenterPoints)}, moderators +{pts(a.type.moderatorPoints)}.</p>}
          {a.activityCost && <p><span className="text-muted-foreground">Cost:</span> {a.activityCost}</p>}
          <Link href={`/token/${a.id}/claim`} className="mt-3 block rounded-md bg-primary px-4 py-2 text-center font-medium text-primary-foreground">Claim points with a token</Link>
        </CardContent>
      </Card>
    </div>
  );
}
