import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Lato, Rokkitt } from 'next/font/google';
import { ClientProviders } from './providers-client';

const sans = Lato({ subsets: ['latin'], weight: ['400', '700'], variable: '--font-sans', display: 'swap' });
const heading = Rokkitt({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-heading', display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'ICPD · Integrated CPD Management System', template: '%s · ICPD' },
  description: 'Continuing Professional Development for medical and dental practitioners in Kenya',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#00335F' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${heading.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen font-sans">
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
