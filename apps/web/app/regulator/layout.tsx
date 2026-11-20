import { SiteHeader } from '@/components/site-header';
import { AppShell, type NavGroup } from '@/components/app-shell';

const NAV: NavGroup[] = [
  { items: [{ href: '/regulator', label: 'Dashboard', exact: true }] },
  {
    title: 'Practitioners',
    items: [
      { href: '/regulator/practitioners', label: 'All practitioners' },
      { href: '/regulator/applications', label: 'Applications' },
      { href: '/regulator/duplicates', label: 'Duplicates' },
      { href: '/regulator/exemptions', label: 'Exemptions' },
    ],
  },
  {
    title: 'CPD',
    items: [
      { href: '/regulator/activities', label: 'Activities' },
      { href: '/regulator/claims', label: 'Non-token claims' },
      { href: '/regulator/compliance', label: 'Compliance report' },
      { href: '/regulator/reports/points-by-type', label: 'Points by activity type' },
    ],
  },
  { title: 'Providers', items: [{ href: '/regulator/providers', label: 'Providers' }, { href: '/regulator/apps', label: 'API consumer apps' }] },
  {
    title: 'Settings',
    items: [
      { href: '/regulator/settings/specialities', label: 'Specializations' },
      { href: '/regulator/settings/activity-types', label: 'Activity types' },
      { href: '/regulator/settings/user-categories', label: 'User categories' },
      { href: '/regulator/settings/compliance', label: 'Compliance rules' },
      { href: '/regulator/settings/general', label: 'General' },
    ],
  },
  { title: 'Website', items: [{ href: '/regulator/cms/pages', label: 'Pages' }, { href: '/regulator/cms/resources', label: 'Resources' }, { href: '/regulator/cms/contacts', label: 'Contact messages' }] },
  {
    title: 'Access',
    items: [
      { href: '/regulator/users', label: 'Users' },
      { href: '/regulator/roles', label: 'Roles & permissions' },
      { href: '/regulator/audit', label: 'Audit log' },
    ],
  },
];

export default function RegulatorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <AppShell title="Regulator" nav={NAV}>{children}</AppShell>
    </>
  );
}
