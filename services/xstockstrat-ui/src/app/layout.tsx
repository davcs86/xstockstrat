import type { Metadata, Viewport } from 'next';
import { Roboto } from 'next/font/google';
import './globals.css';
import { cn } from '@/components/ui/utils';
import { ServiceWorkerRegistrar } from './ServiceWorkerRegistrar';

const roboto = Roboto({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'xstockstrat',
  description: 'xstockstrat trading platform',
  // PWA (feature 162): the manifest makes the app installable; icons back the install/home-screen UI.
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icon-192.png',
    apple: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0e14',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn('font-sans', roboto.variable)}>
      <body className="min-h-screen bg-background font-sans antialiased">
        <ServiceWorkerRegistrar />
        {children}
      </body>
    </html>
  );
}
