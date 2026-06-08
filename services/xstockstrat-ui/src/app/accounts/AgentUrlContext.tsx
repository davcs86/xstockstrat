'use client';

import { createContext, useContext } from 'react';

// Carries the server-resolved AGENT_PUBLIC_URL (read in the accounts layout's server scope) down
// to the client "My Authorized Apps" page. This keeps the value off NEXT_PUBLIC_* — it crosses the
// server→client boundary as a prop, not a build-time public env var (feature 051, FR-9).
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
