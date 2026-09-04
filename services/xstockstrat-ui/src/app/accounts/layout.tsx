import type { Metadata } from 'next';
import { PlatformHeader, PLATFORM_SUBNAV } from '@/components/shared/PlatformHeader';
import { AgentUrlProvider } from './AgentUrlContext';
import { VapidKeyProvider } from './VapidKeyContext';

export const metadata: Metadata = {
  title: 'xstockstrat Accounts',
  description: 'Manage the OAuth apps you have authorized against the xstockstrat MCP agent',
};

// AGENT_PUBLIC_URL is a RUNTIME env var — force dynamic so the layout reads process.env at request
// time; a static prerender bakes it in empty and the connector URL field renders blank in prod.
export const dynamic = 'force-dynamic';

export default function AccountsLayout({ children }: { children: React.ReactNode }) {
  // Server-boundary read of runtime env vars, never NEXT_PUBLIC_*. Only the VAPID *public* key
  // crosses to the browser — the private key stays a notify-only secret.
  const agentUrl = process.env.AGENT_PUBLIC_URL ?? '';
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY ?? '';
  return (
    <AgentUrlProvider value={agentUrl}>
      <VapidKeyProvider value={vapidPublicKey}>
        <PlatformHeader segment="accounts" subNav={PLATFORM_SUBNAV.accounts} />
        <main className="p-4 pb-20 sm:p-6 sm:pb-6">{children}</main>
      </VapidKeyProvider>
    </AgentUrlProvider>
  );
}
