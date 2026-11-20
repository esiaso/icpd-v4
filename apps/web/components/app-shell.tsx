'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
}
export interface NavGroup {
  title?: string;
  items: NavItem[];
}

/** Sidebar layout for the regulator, provider and practitioner areas (collapses on mobile). */
export function AppShell({ title, nav, children, header }: { title: string; nav: NavGroup[]; children: React.ReactNode; header?: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const active = (i: NavItem) => (i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`));
  const sidebar = (
    <nav className="space-y-5 p-4" aria-label={title}>
      {nav.map((g, gi) => (
        <div key={gi}>
          {g.title && <p className="mb-1 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</p>}
          <ul className="space-y-0.5">
            {g.items.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href}
                  onClick={() => setOpen(false)}
                  className={cn('block rounded-md px-2 py-1.5 text-sm', active(i) ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-secondary')}
                >
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)]">
      <aside className="hidden w-60 shrink-0 border-r bg-secondary/20 lg:block">
        <p className="px-6 pt-5 text-sm font-semibold">{title}</p>
        {sidebar}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-72 overflow-y-auto bg-background" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 pt-4">
              <p className="text-sm font-semibold">{title}</p>
              <button onClick={() => setOpen(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
            </div>
            {sidebar}
          </aside>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 border-b px-4 py-2 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="rounded p-1 hover:bg-secondary"><Menu className="h-5 w-5" /></button>
          <span className="text-sm font-medium">{title}</span>
        </div>
        {header}
        <div className="mx-auto max-w-6xl p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
