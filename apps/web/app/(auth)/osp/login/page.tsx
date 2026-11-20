'use client';
import { useEffect } from 'react';

/** Hands off to the API, which redirects to the OSP authorization server with a fresh state. */
export default function OspLogin() {
  useEffect(() => {
    window.location.href = '/api/auth/osp/login';
  }, []);
  return <p className="text-center text-sm text-muted-foreground">Redirecting to OSP sign-in…</p>;
}
