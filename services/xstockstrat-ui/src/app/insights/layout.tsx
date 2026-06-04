import type { Metadata } from 'next';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'xstockstrat Insights',
  description: 'Strategy analytics and backtesting dashboard',
};

export default function InsightsLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
