'use client';

import React from 'react';
import { Settings } from 'lucide-react';
import { useAccountContext } from '@/context/AccountContext';
import { AccountManagementPanel } from './AccountManagementPanel';
import { BrokerType } from '@xstockstrat/proto/common/v1/common_pb';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './ui/sheet';

function brokerLabel(brokerType: BrokerType): string {
  return brokerType === BrokerType.IBKR ? 'IBKR' : 'Alpaca';
}

export function AccountSelector() {
  const { accounts, selectedAccountId, setSelectedAccountId } = useAccountContext();
  const activeAccounts = accounts.filter((a) => a.isActive);

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

      <Sheet>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            aria-label="Manage accounts"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-[400px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Broker Accounts</SheetTitle>
          </SheetHeader>
          <AccountManagementPanel />
        </SheetContent>
      </Sheet>
    </div>
  );
}
