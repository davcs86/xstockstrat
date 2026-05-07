import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AccountProvider } from '@/context/AccountContext';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'xstockstrat Trader',
  description: 'Trading execution and order management',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-background font-sans antialiased">
        <AccountProvider>{children}</AccountProvider>
      </body>
    </html>
  );
}
