import { SiteFooter, SiteHeader } from '@/components/site-header';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 py-8">{children}</main>
      <SiteFooter />
    </>
  );
}
