import type { Metadata } from 'next';
import { Roboto } from 'next/font/google';
import './globals.css';
import { cn } from '@/components/ui/utils';

const roboto = Roboto({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'xstockstrat',
  description: 'xstockstrat trading platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn('font-sans', roboto.variable)}>
      <body className="min-h-screen bg-background font-sans antialiased">{children}</body>
    </html>
  );
}
