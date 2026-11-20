import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ClientProviders } from './providers-client';

export const metadata: Metadata = {
  title: { default: 'ICPD', template: '%s · ICPD' },
  description: 'Continuing Professional Development for medical and dental practitioners in Kenya',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0f5132' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen">
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
