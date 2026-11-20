import { AppShell } from '@/components/app-shell';

export default function WorkspaceLayout({ children, params }: { children: React.ReactNode; params: { providerId: string } }) {
  const base = `/providers/${params.providerId}`;
  return (
    <AppShell
      title="Provider workspace"
      nav={[
        { items: [{ href: `${base}/dashboard`, label: 'Dashboard' }, { href: `${base}/profile`, label: 'Profile' }] },
        { title: 'Activities', items: [{ href: `${base}/activities`, label: 'Activities', exact: true }, { href: `${base}/activities/new`, label: 'New activity' }, { href: `${base}/activities?archived=true`, label: 'Archived' }] },
        { items: [{ href: '/providers', label: 'Switch provider', exact: true }] },
      ]}
    >
      {children}
    </AppShell>
  );
}
