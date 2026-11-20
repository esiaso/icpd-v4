import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getMe } from '@/lib/session';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui';

export default async function AccountProfile() {
  const me = await getMe();
  if (!me) redirect('/login?next=/profile');
  if (me.practitionerId) redirect('/practitioner/profile');
  return (
    <div className="mx-auto max-w-lg p-6">
      <Card>
        <CardHeader><CardTitle>{me.name}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{me.email} {me.emailVerified ? '(verified)' : '(not verified)'}</p>
          <p>Roles: {me.roles.join(', ')}</p>
          <p><Link className="text-primary underline" href="/change-password">Change password</Link></p>
          {me.permissions.includes('Read Developer Panel') && <p><Link className="text-primary underline" href="/client/dashboard">API tokens</Link></p>}
          {!me.roles.some((r) => r !== 'Public User') && <p><Link className="text-primary underline" href="/practitioner/registration/new">Apply to register as a practitioner</Link></p>}
        </CardContent>
      </Card>
    </div>
  );
}
