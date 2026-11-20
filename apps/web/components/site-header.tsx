import Link from 'next/link';
import { getMe, can } from '@/lib/session';
import { UserMenu } from './user-menu';

export async function SiteHeader() {
  const me = await getMe();
  const links = [
    { href: '/activities', label: 'Activities' },
    { href: '/provider-directory', label: 'Providers' },
    { href: '/resources', label: 'Resources' },
    { href: '/about/about', label: 'About' },
    { href: '/contact', label: 'Contact' },
  ];
  const areas = me
    ? [
        me.practitionerId || me.roles.includes('Practitioner') ? { href: '/practitioner/portfolio', label: 'My CPD' } : null,
        !me.practitionerId && !me.roles.some((r) => r !== 'Public User') ? { href: '/practitioner/registration/new', label: 'Apply' } : null,
        can(me, 'Read Provider Panel') ? { href: '/providers', label: 'Provider workspace' } : null,
        can(me, 'Read Admin Panel') ? { href: '/regulator', label: 'Regulator' } : null,
      ].filter(Boolean) as { href: string; label: string }[]
    : [];
  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <Link href="/" className="text-lg font-bold text-primary">ICPD</Link>
        <nav className="hidden flex-1 gap-4 text-sm md:flex">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-muted-foreground hover:text-foreground">{l.label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {areas.map((a) => (
            <Link key={a.href} href={a.href} className="hidden rounded-md px-2 py-1 text-sm font-medium hover:bg-secondary sm:inline">{a.label}</Link>
          ))}
          {me ? (
            <UserMenu name={me.name} areas={areas} />
          ) : (
            <>
              <Link href="/login" className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-secondary">Log in</Link>
              <Link href="/register" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Sign up</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t py-8 text-sm text-muted-foreground">
      <div className="mx-auto flex max-w-7xl flex-wrap gap-4 px-4">
        <span>© {new Date().getFullYear()} ICPD</span>
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
        <Link href="/contact">Contact</Link>
      </div>
    </footer>
  );
}
