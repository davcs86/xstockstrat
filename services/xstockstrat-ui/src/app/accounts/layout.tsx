import type { Metadata } from 'next';
import { PlatformHeader, type SubNavItem } from '@/components/shared/PlatformHeader';
import { AgentUrlProvider } from './AgentUrlContext';

export const metadata: Metadata = {
  title: 'xstockstrat Accounts',
  description: 'Manage the OAuth apps you have authorized against the xstockstrat MCP agent',
};

const ACCOUNTS_SUBNAV: SubNavItem[] = [
  { label: 'Authorized Apps', href: '/accounts/authorized-apps', match: 'exact' },
];

export default function AccountsLayout({ children }: { children: React.ReactNode }) {
  // Server-boundary read: AGENT_PUBLIC_URL is a runtime server env var, never NEXT_PUBLIC_* (FR-9).
  const agentUrl = process.env.AGENT_PUBLIC_URL ?? '';
  return (
    <AgentUrlProvider value={agentUrl}>
      <PlatformHeader segment="accounts" subNav={ACCOUNTS_SUBNAV} />
      <main className="p-4 sm:p-6">{children}</main>
    </AgentUrlProvider>
  );
}
