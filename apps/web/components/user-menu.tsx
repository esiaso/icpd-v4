'use client';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import Link from 'next/link';
import { CircleUser, LogOut, Moon } from 'lucide-react';
import { post } from '@/lib/api';

export function UserMenu({ name, areas }: { name: string; areas: { href: string; label: string }[] }) {
  async function logout() {
    await post('/auth/logout').catch(() => undefined);
    window.location.href = '/';
  }
  function toggleTheme() {
    const dark = document.documentElement.classList.toggle('dark');
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {}
  }
  const item = 'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none hover:bg-secondary';
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm hover:bg-secondary" aria-label="Account menu">
        <CircleUser className="h-5 w-5" />
        <span className="hidden max-w-[10rem] truncate sm:inline">{name}</span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" className="z-50 min-w-[200px] rounded-md border bg-card p-1 shadow-md">
          {areas.map((a) => (
            <DropdownMenu.Item key={a.href} asChild className={`${item} sm:hidden`}>
              <Link href={a.href}>{a.label}</Link>
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Item asChild className={item}><Link href="/profile">Profile</Link></DropdownMenu.Item>
          <DropdownMenu.Item asChild className={item}><Link href="/change-password">Change password</Link></DropdownMenu.Item>
          <DropdownMenu.Item className={item} onSelect={toggleTheme}><Moon className="h-4 w-4" /> Toggle dark mode</DropdownMenu.Item>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item className={item} onSelect={logout}><LogOut className="h-4 w-4" /> Log out</DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
