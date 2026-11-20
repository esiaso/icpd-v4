'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRightCircle, Calendar, ChevronRight, GraduationCap, Layers, Monitor } from 'lucide-react';
import { Button, Input } from './ui';
import { get, post } from '@/lib/api';
import { applyApiError } from '@/lib/forms';
import { fmtDate, pts } from '@/lib/utils';

/** White panel with a thin border, as used for every block on icpdkenya.org. */
export function Panel({ title, centered, children, className = '' }: { title?: string; centered?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-sm border bg-card p-4 ${className}`}>
      {title && (centered ? <h2 className="mb-3 text-center text-2xl font-bold text-foreground">{title}</h2> : <h2 className="section-title mb-3">{title}</h2>)}
      {children}
    </section>
  );
}

/** One activity in the listing style of icpdkenya.org: title, blurb, meta row with credits. */
export function ActivityItem({ a }: { a: any }) {
  const online = a.deliveryMode === 'online';
  return (
    <article className="rounded-sm border bg-card p-3">
      <Link href={`/activities/${a.id}`} className="font-heading text-lg font-bold leading-snug text-primary hover:underline">{a.name}</Link>
      {(a.topic || a.description) && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{a.topic || a.description}</p>}
      {a.venue && !online && <p className="mt-1 text-xs text-muted-foreground">Venue: {a.venue}{a.city ? `, ${a.city}` : ''}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" /> {fmtDate(a.releaseDate)}</span>
        <span className="inline-flex items-center gap-1 text-primary"><GraduationCap className="h-3 w-3" /> CPD</span>
        <span className="inline-flex items-center gap-1">{online ? <Monitor className="h-3 w-3" /> : <Layers className="h-3 w-3" />} {a.type?.name}</span>
        <span className="inline-flex items-center gap-1">Credits: {pts(a.cpdPoints)}{a.numSessions > 1 ? ` × ${a.numSessions}` : ''}</span>
        {a.provider && <span>CPD Provider: <Link className="text-primary hover:underline" href={`/provider-directory/${a.provider.id}`}>{a.provider.name}</Link></span>}
        <Link href={`/activities/${a.id}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><ArrowRightCircle className="h-3 w-3" /> Proceed to activity</Link>
      </div>
    </article>
  );
}

/** Sidebar login box (shown to signed-out visitors on public pages). */
export function LoginBox() {
  const router = useRouter();
  const { data: me, isLoading } = useQuery({ queryKey: ['me-optional'], queryFn: () => get('/auth/me').catch(() => null), staleTime: 60_000 });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  if (isLoading) return null;
  if (me) {
    return (
      <Panel title={`Welcome, ${me.name.split(' ')[0]}`} centered>
        <div className="flex flex-col items-center gap-2 text-sm">
          {me.practitionerId && <Link className="text-primary hover:underline" href="/practitioner/portfolio">Go to my CPD portfolio</Link>}
          <Link className="text-primary hover:underline" href="/practitioner/portfolio/claim">Claim points</Link>
        </div>
      </Panel>
    );
  }
  return (
    <Panel title="Login" centered>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await post('/auth/login', { email, password });
            const perms: string[] = r.permissions;
            router.push(perms.includes('*') || perms.includes('Read Admin Panel') ? '/regulator' : r.practitionerId ? '/practitioner/portfolio' : perms.includes('Read Provider Panel') ? '/providers' : '/practitioner/registration/new');
            router.refresh();
          } catch (err) {
            applyApiError(null, err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-center text-sm">Have an account?</p>
        <Input type="email" placeholder="Email Address" aria-label="Email address" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input type="password" placeholder="Password" aria-label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <div className="text-center">
          <Button type="submit" loading={busy} className="bg-gold text-foreground hover:bg-gold/90">Signin <ChevronRight className="h-4 w-4" /></Button>
        </div>
        <p className="text-center text-xs"><Link className="text-primary hover:underline" href="/forgot-password">Forgot Password?</Link></p>
        <div className="pt-1 text-center">
          <Link href="/register" className="inline-block rounded bg-primary px-4 py-2 text-xs font-bold uppercase text-primary-foreground">Register now</Link>
        </div>
      </form>
    </Panel>
  );
}

export function ResourcesBox() {
  const { data } = useQuery({ queryKey: ['home-resources'], queryFn: () => get('/public/resources?pageSize=6') });
  return (
    <Panel title="Resources" centered>
      <ul className="space-y-1 text-sm">
        {data?.data.map((r: any) => (
          <li key={r.id} className="flex items-start gap-1">
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-navy dark:text-foreground" />
            <a className="hover:text-primary hover:underline" href={r.fileUrl ?? r.link ?? '/resources'} target={r.fileUrl || r.link ? '_blank' : undefined} rel="noreferrer">{r.title}</a>
          </li>
        ))}
        <li className="flex items-start gap-1"><ChevronRight className="mt-0.5 h-4 w-4 shrink-0" /><Link className="hover:text-primary hover:underline" href="/resources">All resources</Link></li>
      </ul>
    </Panel>
  );
}

/** "Search CPD Activities" box with View activities / Claim points actions. */
export function SearchActivities({ initial = '' }: { initial?: string }) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  return (
    <Panel title="Search CPD Activities">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <form className="flex flex-1" onSubmit={(e) => { e.preventDefault(); router.push(`/activities?search=${encodeURIComponent(q)}`); }} role="search">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="SEARCH" aria-label="Search CPD activities" className="rounded-r-none" />
          <button type="submit" className="rounded-r-sm border border-l-0 px-3 text-xs uppercase text-muted-foreground hover:bg-secondary">Search</button>
        </form>
        <div className="flex gap-2">
          <Link href="/activities" className="rounded border border-primary px-3 py-2 text-xs font-bold uppercase text-primary hover:bg-secondary">View activities</Link>
          <Link href="/practitioner/portfolio/claim" className="rounded bg-primary px-3 py-2 text-xs font-bold uppercase text-primary-foreground hover:opacity-90">Claim points</Link>
        </div>
      </div>
    </Panel>
  );
}
