'use client';

import { createContext, useContext } from 'react';

// Carries the server-resolved VAPID_PUBLIC_KEY to the client push toggle as a prop (off NEXT_PUBLIC_*).
// Only the PUBLIC key reaches the browser; the private key is a notify-only server secret.
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
