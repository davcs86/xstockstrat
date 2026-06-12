import type { Metadata } from 'next';
import { PlatformHeader, PLATFORM_SUBNAV } from '@/components/shared/PlatformHeader';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'xstockstrat Config UI',
  description: 'Runtime configuration management for the xstockstrat platform',
};

export default function ConfigUILayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <PlatformHeader segment="config" subNav={PLATFORM_SUBNAV.config} />
      <main className="p-4 sm:p-6">{children}</main>
    </Providers>
  );
}
