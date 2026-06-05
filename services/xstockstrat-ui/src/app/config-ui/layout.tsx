import type { Metadata } from 'next';
import { PlatformHeader, type SubNavItem } from '@/components/shared/PlatformHeader';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'xstockstrat Config UI',
  description: 'Runtime configuration management for the xstockstrat platform',
};

const CONFIG_SUBNAV: SubNavItem[] = [
  { label: 'Namespaces', href: '/config-ui', match: 'exact' },
  { label: 'Audit Log', href: '/config-ui/audit' },
  { label: 'Sources', href: '/config-ui/sources' },
];

export default function ConfigUILayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <PlatformHeader segment="config" subNav={CONFIG_SUBNAV} />
      <main className="p-4 sm:p-6">{children}</main>
    </Providers>
  );
}
