import type { Metadata } from 'next';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'xstockstrat Trader',
  description: 'Trading execution and order management',
};

export default function TraderLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
