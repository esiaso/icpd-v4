import { SiteHeader } from '@/components/site-header';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl p-6">{children}</main>
    </>
  );
}
