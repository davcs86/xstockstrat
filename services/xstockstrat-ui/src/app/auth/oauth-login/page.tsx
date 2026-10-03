import { Suspense } from 'react';
import { resolveAgentCallback } from '@/lib/oauthCallback';
import { OAuthLoginForm } from './OAuthLoginForm';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string | null {
  return typeof v === 'string' ? v : null;
}

export default async function OAuthLoginPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  // Server-boundary read of the runtime AGENT_PUBLIC_URL: the client-supplied agent_cb is never
  // followed, only compared against the agent's own callback.
  const agentCallback = resolveAgentCallback(first(params.agent_cb), process.env.AGENT_PUBLIC_URL);
  return (
    <Suspense fallback={null}>
      <OAuthLoginForm agentCallback={agentCallback} />
    </Suspense>
  );
}
