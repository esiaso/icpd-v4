import Link from 'next/link';
import { serverApi } from '@/lib/session';
import { ActivityItem, LoginBox, Panel, ResourcesBox, SearchActivities } from '@/components/public-blocks';

export const dynamic = 'force-dynamic';

/** Home page laid out like icpdkenya.org: search + featured activities, login and resources on the right. */
export default async function Home() {
  const home = await serverApi<{ featured: any[]; recent: any[]; providers: any[] }>('/public/home');
  const activities = home ? [...home.featured, ...home.recent.filter((r) => !home.featured.some((f) => f.id === r.id))].slice(0, 8) : [];
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
      <div className="space-y-5">
        <SearchActivities />
        <Panel title="Featured CPD Activities">
          <div className="space-y-3">
            {activities.map((a) => <ActivityItem key={a.id} a={a} />)}
            {!activities.length && <p className="text-sm text-muted-foreground">No published activities yet.</p>}
          </div>
          <div className="mt-4"><Link href="/activities" className="text-sm font-medium text-primary hover:underline">All CPD activities »</Link></div>
        </Panel>
        {!!home?.providers.length && (
          <Panel title="CPD Providers">
            <div className="flex flex-wrap gap-2">
              {home.providers.map((p) => (
                <Link key={p.id} href={`/provider-directory/${p.id}`} className="rounded-sm border px-3 py-1 text-sm text-primary hover:bg-secondary">{p.name}</Link>
              ))}
            </div>
          </Panel>
        )}
      </div>
      <aside className="space-y-5">
        <LoginBox />
        <Panel title="How to claim" centered>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>Attend an accredited CPD activity.</li>
            <li>Scan the QR code on your token card, or log in and enter the token.</li>
            <li>No token? Upload evidence as a non-token claim.</li>
          </ol>
        </Panel>
        <ResourcesBox />
      </aside>
    </div>
  );
}
