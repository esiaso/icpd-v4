import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Route protection by role/permission (UX only; the API enforces RBAC itself).
 * The access token carries roles/perms claims; an expired token with a refresh cookie is let
 * through so the client can refresh silently.
 */
const RULES: { prefix: string; perm?: string[] }[] = [
  { prefix: '/regulator', perm: ['Read Admin Panel'] },
  { prefix: '/auth', perm: ['Read Admin Panel'] },
  { prefix: '/providers', perm: ['Read Provider Panel', 'Manage Activities'] },
  { prefix: '/client', perm: ['Read Developer Panel'] },
  { prefix: '/practitioner' },
  { prefix: '/profile' },
  { prefix: '/change-password' },
  { prefix: '/confirm-password' },
];

const secret = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret');

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Note: the public provider directory lives at /provider-directory because /providers is the
  // coordinator workspace (both are specified under /providers in the brief).
  const rule = RULES.find((r) => pathname === r.prefix || pathname.startsWith(`${r.prefix}/`));
  if (!rule) return NextResponse.next();

  const at = req.cookies.get('icpd_at')?.value;
  const hasRefresh = !!req.cookies.get('icpd_rt')?.value || !!req.cookies.get('icpd_csrf')?.value;
  const login = () => {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  };
  if (!at) return hasRefresh ? NextResponse.next() : login();
  try {
    const { payload } = await jwtVerify(at, secret);
    const roles = (payload.roles as string[]) ?? [];
    const perms = (payload.perms as string[]) ?? [];
    if (roles.includes('Super Admin')) return NextResponse.next();
    if (rule.perm && !rule.perm.some((p) => perms.includes(p))) {
      const url = req.nextUrl.clone();
      url.pathname = '/forbidden';
      url.search = '';
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  } catch {
    return hasRefresh ? NextResponse.next() : login();
  }
}

export const config = {
  matcher: ['/regulator/:path*', '/auth/:path*', '/providers/:path*', '/client/:path*', '/practitioner/:path*', '/profile/:path*', '/profile', '/change-password', '/confirm-password'],
};
