import Link from 'next/link';
import { serverApi } from '@/lib/session';
import { Card, CardContent } from '@/components/ui';
import { fmtDate, pts } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const home = await serverApi<{ featured: any[]; recent: any[]; providers: any[] }>('/public/home');
  const activities = home ? [...home.featured, ...home.recent.filter((r) => !home.featured.some((f) => f.id === r.id))].slice(0, 6) : [];
  return (
    <div className="space-y-12">
      <section className="rounded-2xl bg-primary px-6 py-12 text-primary-foreground sm:px-10">
        <h1 className="max-w-2xl text-3xl font-bold sm:text-4xl">Continuing Professional Development for doctors and dentists in Kenya</h1>
        <p className="mt-3 max-w-xl text-primary-foreground/80">Find accredited CPD activities, claim your points with a token or QR code, and track your annual compliance.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/activities" className="rounded-md bg-white px-4 py-2 font-medium text-primary">Browse activities</Link>
          <Link href="/practitioner/portfolio/claim" className="rounded-md border border-white/50 px-4 py-2 font-medium">Claim points</Link>
        </div>
      </section>
      <section>
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-xl font-semibold">Upcoming and recent activities</h2>
          <Link href="/activities" className="text-sm text-primary">View all</Link>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {activities.map((a) => (
            <Link key={a.id} href={`/activities/${a.id}`}>
              <Card className="h-full transition-shadow hover:shadow-md">
                <CardContent className="space-y-1 p-4">
                  <p className="text-xs text-muted-foreground">{a.type?.name} · {pts(a.cpdPoints)} pts/session</p>
                  <p className="font-semibold">{a.name}</p>
                  <p className="text-sm text-muted-foreground">{a.provider?.name}</p>
                  <p className="text-xs text-muted-foreground">{fmtDate(a.releaseDate)} to {fmtDate(a.expiryDate)}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
          {!activities.length && <p className="text-sm text-muted-foreground">No published activities yet.</p>}
        </div>
      </section>
      {!!home?.providers.length && (
        <section>
          <h2 className="mb-4 text-xl font-semibold">CPD providers</h2>
          <div className="flex flex-wrap gap-2">
            {home.providers.map((p) => (
              <Link key={p.id} href={`/provider-directory/${p.id}`} className="rounded-full border px-3 py-1 text-sm hover:bg-secondary">{p.name}</Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
