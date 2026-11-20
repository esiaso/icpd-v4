import Link from 'next/link';
import { Home, Mail, Phone, Search } from 'lucide-react';
import { getMe, can } from '@/lib/session';
import { UserMenu } from './user-menu';

const CONTACT_PHONE = process.env.NEXT_PUBLIC_CONTACT_PHONE;
const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL;
const LOGO_URL = process.env.NEXT_PUBLIC_LOGO_URL || '/brand/icpd-logo.png';
const REGULATOR_LOGO_URL = process.env.NEXT_PUBLIC_REGULATOR_LOGO_URL || '/brand/kmpdc-logo.png';

/** ICPD logo (override with NEXT_PUBLIC_LOGO_URL). */
export function Wordmark({ className = '' }: { className?: string }) {
  return <img src={LOGO_URL} alt="ICPD" width={73} height={86} className={`h-16 w-auto shrink-0 ${className}`} />;
}

/** Regulator (KMPDC) seal shown on the right of the brand row and in the footer. */
export function RegulatorLogo({ className = '' }: { className?: string }) {
  return <img src={REGULATOR_LOGO_URL} alt="Kenya Medical Practitioners and Dentists Council" width={96} height={96} className={`h-20 w-20 shrink-0 ${className}`} />;
}

const NAV = [
  { href: '/activities', label: 'CPD Activities' },
  { href: '/provider-directory', label: 'Providers' },
  { href: '/migrate', label: 'Account activation' },
  { href: '/resources', label: 'Resources' },
];

/**
 * Header modelled on icpdkenya.org: utility bar (contacts, links, Migrate / Login / Register),
 * brand row, then the navy navigation bar with search. `compact` drops the brand row in the
 * signed-in work areas.
 */
export async function SiteHeader({ compact = false }: { compact?: boolean }) {
  const me = await getMe();
  const areas = me
    ? ([
        me.practitionerId || me.roles.includes('Practitioner') ? { href: '/practitioner/portfolio', label: 'My CPD' } : null,
        !me.practitionerId && !me.roles.some((r) => r !== 'Public User') ? { href: '/practitioner/registration/new', label: 'Apply' } : null,
        can(me, 'Read Provider Panel') ? { href: '/providers', label: 'Provider workspace' } : null,
        can(me, 'Read Admin Panel') ? { href: '/regulator', label: 'Regulator' } : null,
      ].filter(Boolean) as { href: string; label: string }[])
    : [];

  return (
    <header className="z-30 bg-card">
      {/* utility bar */}
      <div className="border-b text-xs">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-1.5">
          {CONTACT_PHONE && <a href={`tel:${CONTACT_PHONE}`} className="hidden items-center gap-1 text-navy hover:underline md:flex"><Phone className="h-3 w-3" /> Call: {CONTACT_PHONE}</a>}
          {CONTACT_EMAIL && <a href={`mailto:${CONTACT_EMAIL}`} className="hidden items-center gap-1 text-navy hover:underline md:flex"><Mail className="h-3 w-3" /> {CONTACT_EMAIL}</a>}
          <nav className="hidden gap-4 text-navy sm:flex" aria-label="Site">
            <Link href="/" className="hover:underline">Home</Link>
            <Link href="/client/dashboard" className="hover:underline">Developer</Link>
            <Link href="/about/about" className="hover:underline">About Us</Link>
            <Link href="/contact" className="hover:underline">Contact Us</Link>
            <Link href="/about/how-to-claim" className="hover:underline">Help &amp; Support</Link>
          </nav>
          <div className="ml-auto flex items-center gap-1.5">
            {me ? (
              <>
                {areas.map((a) => (
                  <Link key={a.href} href={a.href} className="hidden rounded px-2 py-1 font-bold uppercase text-primary hover:bg-secondary sm:inline">{a.label}</Link>
                ))}
                <UserMenu name={me.name} areas={areas} />
              </>
            ) : (
              <>
                <Link href="/migrate" className="rounded bg-destructive px-3 py-1.5 font-bold uppercase text-white hover:opacity-90">Migrate</Link>
                <Link href="/login" className="rounded bg-gold px-3 py-1.5 font-bold uppercase text-primary hover:opacity-90">Login</Link>
                <Link href="/register" className="rounded bg-primary px-3 py-1.5 font-bold uppercase text-primary-foreground hover:opacity-90">Register now</Link>
              </>
            )}
          </div>
        </div>
      </div>

      {/* brand row */}
      {!compact && (
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <Link href="/" className="flex flex-1 items-center gap-4">
            <Wordmark />
            <span>
              <span className="block font-heading text-lg font-bold uppercase leading-tight text-muted-foreground sm:text-2xl">Integrated CPD Management System</span>
              <span className="block font-heading text-base italic text-gold sm:text-lg">A National CPD Program</span>
            </span>
          </Link>
          <RegulatorLogo className="hidden sm:block" />
        </div>
      )}

      {/* navy navigation bar */}
      <div className="bg-navy text-white">
        <div className="mx-auto flex max-w-7xl items-center gap-1 px-2 sm:px-4">
          <nav className="flex flex-1 items-center overflow-x-auto" aria-label="Main">
            <Link href="/" aria-label="Home" className="flex items-center gap-2 px-3 py-3.5 hover:bg-white/10">
              {compact ? <img src={LOGO_URL} alt="ICPD" className="h-7 w-auto rounded-sm bg-white p-0.5" /> : <Home className="h-4 w-4" />}
            </Link>
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="whitespace-nowrap px-3 py-3.5 text-sm font-bold uppercase tracking-wide hover:bg-white/10">{n.label}</Link>
            ))}
          </nav>
          <form action="/activities" className="hidden items-stretch md:flex" role="search">
            <input name="search" placeholder="SEARCH" aria-label="Search CPD activities" className="h-9 w-56 rounded-l border-0 px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none" />
            <button type="submit" aria-label="Search" className="flex h-9 w-10 items-center justify-center rounded-r border-l border-navy bg-white text-navy hover:bg-secondary"><Search className="h-4 w-4" /></button>
          </form>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const cols = [
    { title: 'About', links: [['About ICPD', '/about/about'], ['Contact Us', '/contact'], ['Privacy Policy', '/privacy'], ['Terms of Use', '/terms']] },
    { title: 'CPD', links: [['CPD Activities', '/activities'], ['Providers', '/provider-directory'], ['Resources', '/resources'], ['How to claim', '/about/how-to-claim']] },
    { title: 'Account', links: [['Login', '/login'], ['Register', '/register'], ['Account activation', '/migrate'], ['Developer', '/client/dashboard']] },
  ];
  return (
    <footer className="mt-16 border-t bg-card">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex items-start gap-3">
          <Wordmark />
          <p className="text-sm text-muted-foreground">Integrated CPD Management System. A National CPD Program for medical and dental practitioners in Kenya.</p>
        </div>
        {cols.map((c) => (
          <div key={c.title} className="text-center sm:text-left">
            <p className="mb-2 font-heading text-sm font-bold uppercase text-navy dark:text-foreground">{c.title}</p>
            <ul className="space-y-1 text-sm">
              {c.links.map(([label, href]) => <li key={href}><Link className="text-muted-foreground hover:text-primary" href={href}>{label}</Link></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-7xl justify-center px-4 pb-6 lg:justify-end"><RegulatorLogo /></div>
      <div className="border-t">
        <p className="mx-auto max-w-7xl px-4 py-4 text-xs text-muted-foreground">All material on this website is protected by copyright. ICPD © {new Date().getFullYear()}.</p>
      </div>
    </footer>
  );
}
