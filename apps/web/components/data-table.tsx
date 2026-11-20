'use client';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { get, qs } from '@/lib/api';
import { Button, Input } from './ui';

export type Col<T> = ColumnDef<T, any> & { sortKey?: string };

/** Server-side paginated, sortable, searchable table (replaces DataTables). */
export function DataTable<T>({
  endpoint,
  columns,
  params = {},
  queryKey,
  searchPlaceholder = 'Search…',
  pageSize = 25,
  toolbar,
  empty = 'No records found.',
}: {
  endpoint: string;
  columns: Col<T>[];
  params?: Record<string, unknown>;
  queryKey?: unknown[];
  searchPlaceholder?: string;
  pageSize?: number;
  toolbar?: React.ReactNode;
  empty?: string;
}) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sort, setSort] = useState<{ key: string; order: 'asc' | 'desc' } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const q = qs({ ...params, page, pageSize, search: debounced, sort: sort?.key, order: sort?.order });
  const { data, isFetching, error } = useQuery({
    queryKey: [...(queryKey ?? [endpoint]), q],
    queryFn: () => get<{ data: T[]; total: number }>(`${endpoint}${q}`),
    placeholderData: keepPreviousData,
  });

  const table = useReactTable({ data: data?.data ?? [], columns, getCoreRowModel: getCoreRowModel(), manualPagination: true });
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Input placeholder={searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} className="sm:max-w-xs" aria-label="Search" />
        {toolbar && <div className="flex flex-wrap gap-2">{toolbar}</div>}
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-secondary/60 text-left">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => {
                  const sk = (h.column.columnDef as Col<T>).sortKey;
                  return (
                    <th key={h.id} className="whitespace-nowrap px-3 py-2 font-medium">
                      {sk ? (
                        <button
                          className="inline-flex items-center gap-1"
                          onClick={() => setSort((s) => (s?.key === sk ? { key: sk, order: s.order === 'asc' ? 'desc' : 'asc' } : { key: sk, order: 'asc' }))}
                        >
                          {flexRender(h.column.columnDef.header, h.getContext())}
                          {sort?.key === sk && (sort.order === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
                        </button>
                      ) : (
                        flexRender(h.column.columnDef.header, h.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className={isFetching ? 'opacity-60' : ''}>
            {table.getRowModel().rows.map((r) => (
              <tr key={r.id} className="border-t hover:bg-secondary/30">
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} className="px-3 py-2 align-top">{flexRender(c.column.columnDef.cell, c.getContext())}</td>
                ))}
              </tr>
            ))}
            {!isFetching && !table.getRowModel().rows.length && (
              <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">{error ? (error as Error).message : empty}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{total} record{total === 1 ? '' : 's'}</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span>Page {page} of {pages}</span>
          <Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}
