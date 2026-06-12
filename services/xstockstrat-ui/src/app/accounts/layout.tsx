import type { Metadata } from 'next';
import { PlatformHeader, PLATFORM_SUBNAV } from '@/components/shared/PlatformHeader';
import { AgentUrlProvider } from './AgentUrlContext';

export const metadata: Metadata = {
  title: 'xstockstrat Accounts',
  description: 'Manage the OAuth apps you have authorized against the xstockstrat MCP agent',
};

// AGENT_PUBLIC_URL is a RUNTIME env var (set in the DO app spec / compose, not a Docker build arg).
// Without this, Next.js statically prerenders the /accounts segment during `next build` — when the
// var is unset — and bakes `agentUrl` in as empty, so the connector URL field renders blank in prod
// even though the runtime agent-health route (a dynamic Route Handler) still sees the value.
// Forcing dynamic rendering makes the layout read process.env at request time. (feature 051)
export const dynamic = 'force-dynamic';

export default function AccountsLayout({ children }: { children: React.ReactNode }) {
  // Server-boundary read: AGENT_PUBLIC_URL is a runtime server env var, never NEXT_PUBLIC_* (FR-9).
  const agentUrl = process.env.AGENT_PUBLIC_URL ?? '';
  return (
    <AgentUrlProvider value={agentUrl}>
      <PlatformHeader segment="accounts" subNav={PLATFORM_SUBNAV.accounts} />
      <main className="p-4 sm:p-6">{children}</main>
    </AgentUrlProvider>
  );
}
