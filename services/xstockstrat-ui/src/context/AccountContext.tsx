'use client';

import React from 'react';
import { tradingClient } from '@/lib/browserClients/tradingClient';
import type { BrokerAccount } from '@xstockstrat/proto/trading/v1/trading_pb';
import { TradingMode } from '@xstockstrat/proto/common/v1/common_pb';

export type { BrokerAccount };

/** UI-facing trading mode derived from the deployment environment. */
export type EnvironmentMode = 'paper' | 'live';

export type AccountContextValue = {
  accounts: BrokerAccount[];
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
  refreshAccounts: () => Promise<void>;
  /**
   * The trading mode this deployment routes to. Fixed per environment — users
   * cannot switch. `null` until the environment has been fetched.
   */
  environmentMode: EnvironmentMode | null;
};

export const AccountContext = React.createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = React.useState<BrokerAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = React.useState<string | null>(null);
  const [environmentMode, setEnvironmentMode] = React.useState<EnvironmentMode | null>(null);

  const fetchAccounts = React.useCallback(async () => {
    try {
      const { accounts: fetched } = await tradingClient.listBrokerAccounts({});
      setAccounts(fetched);
      setSelectedAccountId((prev) => {
        if (prev) return prev;
        const firstActive = fetched.find((a) => a.isActive);
        return firstActive?.id ?? null;
      });
    } catch {
      // non-fatal — leave existing state intact
    }
  }, []);

  const fetchEnvironment = React.useCallback(async () => {
    try {
      const { tradingMode } = await tradingClient.getTradingEnvironment({});
      setEnvironmentMode(tradingMode === TradingMode.LIVE ? 'live' : 'paper');
    } catch {
      // non-fatal — leave mode unknown
    }
  }, []);

  React.useEffect(() => {
    fetchAccounts();
    fetchEnvironment();
  }, [fetchAccounts, fetchEnvironment]);

  const value: AccountContextValue = {
    accounts,
    selectedAccountId,
    setSelectedAccountId,
    refreshAccounts: fetchAccounts,
    environmentMode,
  };

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccountContext(): AccountContextValue {
  const ctx = React.useContext(AccountContext);
  if (!ctx) throw new Error('useAccountContext must be used within AccountProvider');
  return ctx;
}
