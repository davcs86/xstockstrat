import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'xstockstrat Trader',
  description: 'Trading execution and order management',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
