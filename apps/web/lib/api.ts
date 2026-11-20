'use client';
/**
 * Browser API client. Calls go through the Next.js /api rewrite (same origin), so the
 * httpOnly session cookies are sent automatically. Unsafe methods carry the CSRF header.
 * A 401 triggers one silent refresh and a retry.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any,
  ) {
    super(message);
  }
  get fields(): Record<string, string> {
    return this.details?.fields ?? {};
  }
}

function csrf(): string {
  if (typeof document === 'undefined') return '';
  const m = document.cookie.match(/(?:^|; )icpd_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}, retry = true): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(init.json);
  }
  if (method !== 'GET' && method !== 'HEAD') headers.set('x-csrf-token', csrf());
  const res = await fetch(`/api${path}`, { ...init, method, headers, body, credentials: 'include' });
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refresh()) return api<T>(path, init, false);
    if (typeof window !== 'undefined') window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
  }
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    const j = type.includes('json') ? await res.json().catch(() => ({})) : {};
    const e = j?.error ?? {};
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? res.statusText, e.details);
  }
  if (type.includes('json')) return res.json();
  return (await res.blob()) as unknown as T;
}

export const get = <T = any>(p: string) => api<T>(p);
export const post = <T = any>(p: string, json?: unknown) => api<T>(p, { method: 'POST', json: json ?? {} });
export const put = <T = any>(p: string, json?: unknown) => api<T>(p, { method: 'PUT', json: json ?? {} });
export const patch = <T = any>(p: string, json?: unknown) => api<T>(p, { method: 'PATCH', json: json ?? {} });
export const del = <T = any>(p: string) => api<T>(p, { method: 'DELETE' });
export const upload = <T = any>(p: string, form: FormData, method = 'POST') => api<T>(p, { method, body: form });

/** Trigger a browser download for a file endpoint. */
export async function download(path: string, filename: string) {
  const blob = await api<Blob>(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function qs(params: Record<string, unknown>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const str = s.toString();
  return str ? `?${str}` : '';
}
