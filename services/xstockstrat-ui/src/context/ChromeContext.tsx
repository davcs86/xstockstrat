'use client';
import React from 'react';

/**
 * Chrome (app-shell) UI state shared across every segment via the PlatformHeader (feature 083,
 * FR-19). Presently just the Copilot rail toggle — default OFF (FR-4). Mounted inside
 * PlatformHeader so all four segments (trader/insights/config-ui/accounts) get it without a
 * per-layout provider.
 */
interface ChromeContextValue {
  showCopilot: boolean;
  toggleCopilot: () => void;
  setShowCopilot: (v: boolean) => void;
}

const ChromeContext = React.createContext<ChromeContextValue | null>(null);

export function ChromeProvider({ children }: { children: React.ReactNode }) {
  const [showCopilot, setShowCopilot] = React.useState(false);
  const value = React.useMemo(
    () => ({ showCopilot, setShowCopilot, toggleCopilot: () => setShowCopilot((v) => !v) }),
    [showCopilot],
  );
  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

export function useChrome(): ChromeContextValue {
  const ctx = React.useContext(ChromeContext);
  if (!ctx) throw new Error('useChrome must be used within a ChromeProvider');
  return ctx;
}
