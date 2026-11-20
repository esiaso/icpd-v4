import { SiteHeader } from '@/components/site-header';

export default function ProvidersRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader compact />
      {children}
    </>
  );
}
