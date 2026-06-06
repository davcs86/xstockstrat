'use client';

import React from 'react';
import Link from 'next/link';
import { Settings, AlertTriangle } from 'lucide-react';
import { useAccountContext } from '@/context/AccountContext';
import { CredentialStatusBadge } from './CredentialStatusBadge';
import { BrokerType } from '@xstockstrat/proto/common/v1/common_pb';
import { CredentialStatus } from '@xstockstrat/proto/trading/v1/trading_pb';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';

function brokerLabel(brokerType: BrokerType): string {
  return brokerType === BrokerType.IBKR ? 'IBKR' : 'Alpaca';
}

export function AccountSelector() {
  const { accounts, selectedAccountId, setSelectedAccountId } = useAccountContext();
  const activeAccounts = accounts.filter((a) => a.isActive);

  // Surface a warning on the manage-accounts button when any account's keys
  // need attention, so the user notices without opening the panel.
  const hasCredentialIssue = activeAccounts.some(
    (a) =>
      a.credentialStatus === CredentialStatus.INVALID ||
      a.credentialStatus === CredentialStatus.UNKNOWN,
  );
  const selected = activeAccounts.find((a) => a.id === selectedAccountId);

  return (
    <div className="flex items-center gap-1">
      <Select
        value={selectedAccountId ?? ''}
        onValueChange={(id) => setSelectedAccountId(id || null)}
      >
        <SelectTrigger className="w-[180px] h-8 text-xs">
          <SelectValue placeholder="Select account" />
        </SelectTrigger>
        <SelectContent>
          {activeAccounts.map((account) => (
            <SelectItem key={account.id} value={account.id}>
              <span className="flex items-center gap-1">
                {account.credentialStatus === CredentialStatus.INVALID && (
                  <AlertTriangle className="h-3 w-3 text-destructive" />
                )}
                {account.displayName}
                <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                  {brokerLabel(account.brokerType)}
                </Badge>
                <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4">
                  {account.isPaper ? 'Paper' : 'Live'}
                </Badge>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selected && <CredentialStatusBadge status={selected.credentialStatus} />}

      <Button variant="ghost" size="icon" className="h-8 w-8 relative" asChild aria-label="Manage accounts">
        <Link href="/trader/accounts">
          <Settings className="h-4 w-4" />
          {hasCredentialIssue && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-destructive" />
          )}
        </Link>
      </Button>
    </div>
  );
}
