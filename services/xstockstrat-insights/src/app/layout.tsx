import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'xstockstrat Insights',
  description: 'Strategy analytics and backtesting dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
