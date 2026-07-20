'use client';

import React from 'react';
import { useAccountContext } from '@/context/AccountContext';
import { Badge } from '../ui/badge';
import { AccountRow, AddAccountForm } from './accountShared';

/** Compact broker-account management panel for the trader dashboard. */
export function AccountManagementPanel() {
  const { accounts, environmentMode } = useAccountContext();

  return (
    <div className="space-y-6 py-4">
      {/* Environment trading mode — fixed, not selectable */}
      {environmentMode && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Environment mode:</span>
          <Badge variant={environmentMode === 'live' ? 'live' : 'paper'} className="uppercase">
            {environmentMode}
          </Badge>
          <span>— new accounts are registered in this mode.</span>
        </div>
      )}

      {/* Account list */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Registered Accounts</h3>
        {accounts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No accounts registered.</p>
        ) : (
          <div className="space-y-2">
            {accounts.map((account) => (
              <AccountRow key={account.id} account={account} className="p-2" />
            ))}
          </div>
        )}
      </div>

      {/* Add Account form */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Add Account</h3>
        <AddAccountForm />
      </div>
    </div>
  );
}
