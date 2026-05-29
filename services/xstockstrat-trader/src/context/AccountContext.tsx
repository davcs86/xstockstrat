'use client';

import React from 'react';
import { BASE_PATH } from '@/lib/basepath';

export type BrokerAccount = {
  account_id: string;
  display_name: string;
  broker_type: number; // 1=ALPACA, 2=IBKR
  is_paper: boolean;
  is_active: boolean;
};

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
      const res = await fetch(`${BASE_PATH}/api/accounts`);
      const data = await res.json();
      const fetched: BrokerAccount[] = data.accounts ?? [];
      setAccounts(fetched);
      setSelectedAccountId((prev) => {
        if (prev) return prev;
        const firstActive = fetched.find((a) => a.is_active);
        return firstActive?.account_id ?? null;
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
