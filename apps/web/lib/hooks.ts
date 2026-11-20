'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { get } from './api';

export interface Reference {
  specialities: { id: number; name: string }[];
  categories: { id: number; name: string; prefixLetter: string; minimumLength: number }[];
  titles: { id: number; name: string }[];
  countries: { id: number; name: string; code: string | null }[];
  qualifications: { id: number; name: string }[];
  activityTypes: any[];
}

export function useReference() {
  return useQuery({ queryKey: ['reference'], queryFn: () => get<Reference>('/reference'), staleTime: 5 * 60_000 });
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => get('/auth/me'), staleTime: 60_000 });
}

/** Mutation that toasts the outcome and invalidates queries whose first key starts with any prefix. */
export function useAction<TVars = void, TRes = any>(fn: (v: TVars) => Promise<TRes>, opts: { success?: string | ((r: TRes) => string); invalidate?: string[] } = {}) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      const msg = typeof opts.success === 'function' ? opts.success(r) : opts.success;
      if (msg) toast.success(msg);
      for (const k of opts.invalidate ?? []) {
        qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith(k) });
      }
    },
    onError: (e: any) => toast.error(e?.message ?? 'Something went wrong'),
  });
}
