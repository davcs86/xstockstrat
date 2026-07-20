'use client';

import React from 'react';
import { useAccountContext } from '@/context/AccountContext';
import { BrokerType } from '@xstockstrat/proto/common/v1/common_pb';
import { CredentialStatus } from '@xstockstrat/proto/trading/v1/trading_pb';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Search } from 'lucide-react';
import { AccountRow, AddAccountForm } from './accountShared';

type BrokerFilter = 'all' | 'alpaca' | 'ibkr';
type ActiveFilter = 'all' | 'active' | 'disabled';
type StatusFilter = 'all' | 'ok' | 'unknown' | 'invalid';

/** Full broker-accounts page: filter toolbar + registered-accounts list + add form. */
export function AccountsModule() {
  const { accounts, environmentMode } = useAccountContext();

  // Filter state
  const [search, setSearch] = React.useState('');
  const [brokerFilter, setBrokerFilter] = React.useState<BrokerFilter>('all');
  const [activeFilter, setActiveFilter] = React.useState<ActiveFilter>('all');
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');

  const filteredAccounts = accounts.filter((a) => {
    if (search && !a.displayName.toLowerCase().includes(search.toLowerCase())) return false;
    if (brokerFilter === 'alpaca' && a.brokerType !== BrokerType.ALPACA) return false;
    if (brokerFilter === 'ibkr' && a.brokerType !== BrokerType.IBKR) return false;
    if (activeFilter === 'active' && !a.isActive) return false;
    if (activeFilter === 'disabled' && a.isActive) return false;
    if (statusFilter === 'ok' && a.credentialStatus !== CredentialStatus.OK) return false;
    if (statusFilter === 'unknown' && a.credentialStatus !== CredentialStatus.UNKNOWN) return false;
    if (statusFilter === 'invalid' && a.credentialStatus !== CredentialStatus.INVALID) return false;
    return true;
  });

  const activeFilterCount = [
    brokerFilter !== 'all',
    activeFilter !== 'all',
    statusFilter !== 'all',
    search !== '',
  ].filter(Boolean).length;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Broker Accounts</h1>
        {environmentMode && (
          <p className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
            Environment mode:
            <Badge variant={environmentMode === 'live' ? 'live' : 'paper'} className="uppercase">
              {environmentMode}
            </Badge>
            — new accounts are registered in this mode.
          </p>
        )}
      </div>

      {/* Registered accounts */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <CardTitle>
              Registered Accounts
              {activeFilterCount > 0 && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  ({filteredAccounts.length} of {accounts.length})
                </span>
              )}
            </CardTitle>
            {activeFilterCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7"
                onClick={() => {
                  setSearch('');
                  setBrokerFilter('all');
                  setActiveFilter('all');
                  setStatusFilter('all');
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter toolbar */}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by name…"
                className="pl-8 h-8 text-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Select value={brokerFilter} onValueChange={(v) => setBrokerFilter(v as BrokerFilter)}>
              <SelectTrigger className="w-[110px] h-8 text-sm">
                <SelectValue placeholder="Broker" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All brokers</SelectItem>
                <SelectItem value="alpaca">Alpaca</SelectItem>
                <SelectItem value="ibkr">IBKR</SelectItem>
              </SelectContent>
            </Select>
            <Select value={activeFilter} onValueChange={(v) => setActiveFilter(v as ActiveFilter)}>
              <SelectTrigger className="w-[110px] h-8 text-sm">
                <SelectValue placeholder="State" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All states</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger className="w-[120px] h-8 text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="ok">OK</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
                <SelectItem value="invalid">Invalid</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Account list */}
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No accounts registered.
            </p>
          ) : filteredAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No accounts match the current filters.
            </p>
          ) : (
            <div className="space-y-2">
              {filteredAccounts.map((account) => (
                <AccountRow key={account.id} account={account} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Account */}
      <Card>
        <CardHeader>
          <CardTitle>Add Account</CardTitle>
        </CardHeader>
        <CardContent>
          <AddAccountForm className="space-y-3 max-w-sm" />
        </CardContent>
      </Card>
    </div>
  );
}
