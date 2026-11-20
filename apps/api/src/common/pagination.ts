import { paginationSchema, type Paged, type Pagination } from '@icpd/shared';
import { Z } from './zod';
import { BadRequest } from './errors';

export const PageQuery = () => Z(paginationSchema.passthrough());

export function pageArgs(p: Pagination) {
  return { skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}

export function paged<T>(data: T[], total: number, p: Pagination): Paged<T> {
  return { data, total, page: p.page, pageSize: p.pageSize };
}

/** Whitelisted sort: returns a Prisma orderBy or the fallback. */
export function sortBy<T extends string>(
  p: Pagination,
  allowed: readonly T[],
  fallback: Record<string, 'asc' | 'desc'>,
): Record<string, 'asc' | 'desc'> {
  if (p.sort && (allowed as readonly string[]).includes(p.sort)) return { [p.sort]: p.order ?? 'asc' };
  return fallback;
}

export function parseId(v: string | number | bigint): bigint {
  try {
    const b = BigInt(v);
    if (b <= 0n) throw new Error();
    return b;
  } catch {
    throw BadRequest('Invalid id');
  }
}
