'use client';

import { createContext, useContext } from 'react';

// Carries the server-resolved VAPID_PUBLIC_KEY (read in the accounts layout's server scope) down to
// the client push-notification toggle. Like AgentUrlContext, this keeps the value off NEXT_PUBLIC_* —
// it crosses the server→client boundary as a prop, not a build-time public env var (feature 163).
// Only the PUBLIC key ever reaches the browser; the private key is a notify-only server secret.
const VapidKeyContext = createContext<string>('');

export function VapidKeyProvider({
  value,
  children,
}: {
  value: string;
  children: React.ReactNode;
}) {
  return <VapidKeyContext.Provider value={value}>{children}</VapidKeyContext.Provider>;
}

export function useVapidKey(): string {
  return useContext(VapidKeyContext);
}
