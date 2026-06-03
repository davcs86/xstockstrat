'use client';

import React from 'react';
import { tradingClient } from '@/lib/browserClients/tradingClient';
import type { BrokerAccount } from '@xstockstrat/proto/trading/v1/trading_pb';

export type { BrokerAccount };

export type AccountContextValue = {
  accounts: BrokerAccount[];
  selectedAccountId: string | null;
  setSelectedAccountId: (id: string | null) => void;
  refreshAccounts: () => Promise<void>;
};

export const AccountContext = React.createContext<AccountContextValue | null>(null);

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = React.useState<BrokerAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = React.useState<string | null>(null);

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

  React.useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const value: AccountContextValue = {
    accounts,
    selectedAccountId,
    setSelectedAccountId,
    refreshAccounts: fetchAccounts,
  };

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccountContext(): AccountContextValue {
  const ctx = React.useContext(AccountContext);
  if (!ctx) throw new Error('useAccountContext must be used within AccountProvider');
  return ctx;
}
