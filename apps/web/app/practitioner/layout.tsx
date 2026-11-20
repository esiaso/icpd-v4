import { SiteHeader } from '@/components/site-header';
import { AppShell } from '@/components/app-shell';

export default function PractitionerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <AppShell
        title="My CPD"
        nav={[
          {
            items: [
              { href: '/practitioner/portfolio', label: 'Portfolio', exact: true },
              { href: '/practitioner/portfolio/claim', label: 'Claim points' },
              { href: '/practitioner/portfolio/claims', label: 'My non-token claims' },
              { href: '/practitioner/portfolio/diary', label: 'Diary & downloads' },
            ],
          },
          { title: 'Profile', items: [{ href: '/practitioner/profile', label: 'My profile' }, { href: '/practitioner/registration/preview', label: 'Registration application' }] },
        ]}
      >
        {children}
      </AppShell>
    </>
  );
}
