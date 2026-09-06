'use client';

import { createContext, useContext } from 'react';

// Carries the server-resolved AGENT_PUBLIC_URL to the client "My Authorized Apps" page as a prop —
// off NEXT_PUBLIC_*, so it stays a runtime (not build-time public) value.
const AgentUrlContext = createContext<string>('');

export function AgentUrlProvider({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  return <AgentUrlContext.Provider value={value}>{children}</AgentUrlContext.Provider>;
}

export function useAgentUrl(): string {
  return useContext(AgentUrlContext);
}
