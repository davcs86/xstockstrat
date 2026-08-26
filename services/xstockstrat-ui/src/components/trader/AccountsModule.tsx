'use client';

import React from 'react';
import { Plus } from 'lucide-react';
import { useAccountContext } from '@/context/AccountContext';
import { BrokerType } from '@xstockstrat/proto/common/v1/common_pb';
import { CredentialStatus } from '@xstockstrat/proto/trading/v1/trading_pb';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { FilterToolbar } from '../shared/FilterToolbar';
import { FormDialog } from '../shared/FormDialog';
import { AccountRow, AddAccountForm } from './accountShared';

type BrokerFilter = 'all' | 'alpaca' | 'ibkr' | 'offline';
type ActiveFilter = 'all' | 'active' | 'disabled';
type StatusFilter = 'all' | 'ok' | 'unknown' | 'invalid';

/** Full broker-accounts page: filter toolbar + registered-accounts list + add form. */
export function AccountsModule() {
  const { accounts, environmentMode } = useAccountContext();

  const [addOpen, setAddOpen] = React.useState(false);

  // Filter state
  const [search, setSearch] = React.useState('');
  const [brokerFilter, setBrokerFilter] = React.useState<BrokerFilter>('all');
  const [activeFilter, setActiveFilter] = React.useState<ActiveFilter>('all');
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');

  const filteredAccounts = accounts.filter((a) => {
    if (search && !a.displayName.toLowerCase().includes(search.toLowerCase())) return false;
    if (brokerFilter === 'alpaca' && a.brokerType !== BrokerType.ALPACA) return false;
    if (brokerFilter === 'ibkr' && a.brokerType !== BrokerType.IBKR) return false;
    if (brokerFilter === 'offline' && a.brokerType !== BrokerType.OFFLINE) return false;
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
            <div className="flex items-center gap-2">
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
              <FormDialog
                open={addOpen}
                onOpenChange={setAddOpen}
                trigger={
                  <Button size="sm">
                    <Plus className="mr-1.5 h-4 w-4" />
                    Add account
                  </Button>
                }
                title="Add account"
                description="Register a broker account. Credentials are validated against the broker on save."
              >
                <AddAccountForm className="space-y-3" onDone={() => setAddOpen(false)} />
              </FormDialog>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filter toolbar */}
          <FilterToolbar
            search={{ value: search, onChange: setSearch, placeholder: 'Search by name…' }}
            filters={[
              {
                value: brokerFilter,
                onValueChange: (v) => setBrokerFilter(v as BrokerFilter),
                options: [
                  { value: 'all', label: 'All brokers' },
                  { value: 'alpaca', label: 'Alpaca' },
                  { value: 'ibkr', label: 'IBKR' },
                  { value: 'offline', label: 'Offline' },
                ],
                ariaLabel: 'Broker',
                className: 'w-[110px] h-8 text-sm',
              },
              {
                value: activeFilter,
                onValueChange: (v) => setActiveFilter(v as ActiveFilter),
                options: [
                  { value: 'all', label: 'All states' },
                  { value: 'active', label: 'Active' },
                  { value: 'disabled', label: 'Disabled' },
                ],
                ariaLabel: 'State',
                className: 'w-[110px] h-8 text-sm',
              },
              {
                value: statusFilter,
                onValueChange: (v) => setStatusFilter(v as StatusFilter),
                options: [
                  { value: 'all', label: 'All statuses' },
                  { value: 'ok', label: 'OK' },
                  { value: 'unknown', label: 'Unknown' },
                  { value: 'invalid', label: 'Invalid' },
                ],
                ariaLabel: 'Status',
                className: 'w-[120px] h-8 text-sm',
              },
            ]}
            activeFilterCount={activeFilterCount}
            onClear={() => {
              setSearch('');
              setBrokerFilter('all');
              setActiveFilter('all');
              setStatusFilter('all');
            }}
            clearPlacement="inline"
          />

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
                <AccountRow key={account.id} account={account} showId />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
