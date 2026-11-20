import { cookies } from 'next/headers';

export interface Me {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  roles: string[];
  permissions: string[];
  practitionerId: string | null;
}

const API = process.env.API_URL ?? 'http://localhost:4000';

/** Server-side fetch to the API, forwarding the user's cookies. */
export async function serverApi<T = any>(path: string): Promise<T | null> {
  const cookie = cookies().toString();
  const res = await fetch(`${API}/api${path}`, { headers: { cookie }, cache: 'no-store' });
  if (!res.ok) return null;
  return res.json();
}

export async function getMe(): Promise<Me | null> {
  return serverApi<Me>('/auth/me');
}

export function can(me: Me | null, permission: string) {
  return !!me && (me.permissions.includes('*') || me.permissions.includes(permission));
}
