'use client';

import React from 'react';
import { useAccountContext } from '@/context/AccountContext';
import { tradingClient } from '@/lib/browserClients/tradingClient';
import { BrokerType } from '@xstockstrat/proto/common/v1/common_pb';
import type { BrokerAccount } from '@xstockstrat/proto/trading/v1/trading_pb';
import { CredentialStatus } from '@xstockstrat/proto/trading/v1/trading_pb';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import { CredentialStatusBadge } from './CredentialStatusBadge';
import { Card, CardHeader, CardTitle, CardContent } from '../ui/card';
import { Search } from 'lucide-react';

type BrokerFilter = 'all' | 'alpaca' | 'ibkr';
type ActiveFilter = 'all' | 'active' | 'disabled';
type StatusFilter = 'all' | 'ok' | 'unknown' | 'invalid';

function brokerLabel(brokerType: BrokerType): string {
  return brokerType === BrokerType.IBKR ? 'IBKR' : 'Alpaca';
}

function buildCredentialsJson(brokerType: BrokerType, creds: CredentialState): string {
  return brokerType === BrokerType.IBKR
    ? JSON.stringify({
        consumer_key: creds.consumerKey,
        access_token: creds.accessToken,
        access_token_secret: creds.accessTokenSecret,
        ibkr_account_id: creds.ibkrAccountId,
      })
    : JSON.stringify({ api_key: creds.apiKey, api_secret: creds.apiSecret });
}

interface CredentialState {
  apiKey: string;
  apiSecret: string;
  consumerKey: string;
  accessToken: string;
  accessTokenSecret: string;
  ibkrAccountId: string;
}

const EMPTY_CREDENTIALS: CredentialState = {
  apiKey: '',
  apiSecret: '',
  consumerKey: '',
  accessToken: '',
  accessTokenSecret: '',
  ibkrAccountId: '',
};

function CredentialFields({
  brokerType,
  creds,
  onChange,
}: {
  brokerType: BrokerType;
  creds: CredentialState;
  onChange: (next: CredentialState) => void;
}) {
  const set = (patch: Partial<CredentialState>) => onChange({ ...creds, ...patch });

  if (brokerType === BrokerType.IBKR) {
    return (
      <>
        <Input type="password" placeholder="Consumer Key" value={creds.consumerKey} onChange={(e) => set({ consumerKey: e.target.value })} required />
        <Input type="password" placeholder="Access Token" value={creds.accessToken} onChange={(e) => set({ accessToken: e.target.value })} required />
        <Input type="password" placeholder="Access Token Secret" value={creds.accessTokenSecret} onChange={(e) => set({ accessTokenSecret: e.target.value })} required />
        <Input placeholder="IBKR Account ID" value={creds.ibkrAccountId} onChange={(e) => set({ ibkrAccountId: e.target.value })} required />
      </>
    );
  }
  return (
    <>
      <Input type="password" placeholder="API Key" value={creds.apiKey} onChange={(e) => set({ apiKey: e.target.value })} required />
      <Input type="password" placeholder="API Secret" value={creds.apiSecret} onChange={(e) => set({ apiSecret: e.target.value })} required />
    </>
  );
}

function EditCredentialsForm({ account, onDone }: { account: BrokerAccount; onDone: () => void }) {
  const { refreshAccounts } = useAccountContext();
  const [creds, setCreds] = React.useState<CredentialState>(EMPTY_CREDENTIALS);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => () => setCreds(EMPTY_CREDENTIALS), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await tradingClient.updateBrokerAccountCredentials({
        accountId: account.id,
        credentialsJson: buildCredentialsJson(account.brokerType, creds),
      });
      setCreds(EMPTY_CREDENTIALS);
      await refreshAccounts();
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update credentials');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-2 rounded-md border border-dashed p-3">
      <p className="text-xs text-muted-foreground">
        Enter new {brokerLabel(account.brokerType)} secrets to replace the stored ones. They are validated against the broker on save.
      </p>
      <CredentialFields brokerType={account.brokerType} creds={creds} onChange={setCreds} />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={submitting}>{submitting ? 'Saving...' : 'Save keys'}</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={submitting}>Cancel</Button>
      </div>
    </form>
  );
}

export function AccountsModule() {
  const { accounts, selectedAccountId, setSelectedAccountId, refreshAccounts, environmentMode } = useAccountContext();

  // Filter state
  const [search, setSearch] = React.useState('');
  const [brokerFilter, setBrokerFilter] = React.useState<BrokerFilter>('all');
  const [activeFilter, setActiveFilter] = React.useState<ActiveFilter>('all');
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');

  // Account action state
  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState(false);

  // Add Account form state
  const [displayName, setDisplayName] = React.useState('');
  const [brokerType, setBrokerType] = React.useState<string>('1');
  const [submitting, setSubmitting] = React.useState(false);
  const [addError, setAddError] = React.useState<string | null>(null);
  const [creds, setCreds] = React.useState<CredentialState>(EMPTY_CREDENTIALS);

  React.useEffect(() => () => setCreds(EMPTY_CREDENTIALS), []);

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

  async function handleRemove(accountId: string) {
    setRemoving(true);
    try {
      await tradingClient.deregisterBrokerAccount({ accountId });
      const remaining = accounts.find((a) => a.isActive && a.id !== accountId);
      await refreshAccounts();
      if (selectedAccountId === accountId) setSelectedAccountId(remaining?.id ?? null);
    } finally {
      setRemoving(false);
      setConfirmingId(null);
    }
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setAddError(null);
    try {
      const brokerTypeNum = parseInt(brokerType, 10) as BrokerType;
      const { account } = await tradingClient.registerBrokerAccount({
        displayName,
        brokerType: brokerTypeNum,
        credentialsJson: buildCredentialsJson(brokerTypeNum, creds),
      });
      await refreshAccounts();
      if (account?.id) setSelectedAccountId(account.id);
      setDisplayName('');
      setBrokerType('1');
      setCreds(EMPTY_CREDENTIALS);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Failed to add account');
    } finally {
      setSubmitting(false);
    }
  }

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
                onClick={() => { setSearch(''); setBrokerFilter('all'); setActiveFilter('all'); setStatusFilter('all'); }}
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
            <p className="text-sm text-muted-foreground py-4 text-center">No accounts registered.</p>
          ) : filteredAccounts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No accounts match the current filters.</p>
          ) : (
            <div className="space-y-2">
              {filteredAccounts.map((account) => (
                <div
                  key={account.id}
                  className={`rounded-md border p-3${!account.isActive ? ' opacity-50' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <span className="text-sm font-medium truncate">{account.displayName}</span>
                      <Badge variant="secondary">{brokerLabel(account.brokerType)}</Badge>
                      <Badge variant={account.isPaper ? 'paper' : 'live'}>
                        {account.isPaper ? 'Paper' : 'Live'}
                      </Badge>
                      <CredentialStatusBadge status={account.credentialStatus} />
                    </div>
                    {account.isActive && confirmingId !== account.id && (
                      <div className="flex gap-1 shrink-0">
                        <Button size="sm" variant="ghost" onClick={() => setEditingId((id) => (id === account.id ? null : account.id))}>
                          Edit keys
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmingId(account.id)}>
                          Remove
                        </Button>
                      </div>
                    )}
                  </div>

                  {account.isActive && confirmingId === account.id && (
                    <div className="mt-2 flex flex-col items-end gap-1">
                      <p className="text-xs text-destructive text-right">
                        Deregister {account.displayName}? In-flight orders will complete but no new orders can be placed.
                      </p>
                      <div className="flex gap-1">
                        <Button size="sm" variant="destructive" onClick={() => handleRemove(account.id)} disabled={removing}>Confirm</Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmingId(null)} disabled={removing}>Cancel</Button>
                      </div>
                    </div>
                  )}

                  {account.isActive && editingId === account.id && (
                    <EditCredentialsForm account={account} onDone={() => setEditingId(null)} />
                  )}
                </div>
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
          <form onSubmit={handleAddAccount} className="space-y-3 max-w-sm">
            <Input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            <Select value={brokerType} onValueChange={(v) => { setBrokerType(v); setCreds(EMPTY_CREDENTIALS); }}>
              <SelectTrigger>
                <SelectValue placeholder="Broker" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Alpaca</SelectItem>
                <SelectItem value="2">IBKR</SelectItem>
              </SelectContent>
            </Select>
            <CredentialFields
              brokerType={parseInt(brokerType, 10) as BrokerType}
              creds={creds}
              onChange={setCreds}
            />
            {addError && <p className="text-xs text-destructive">{addError}</p>}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Adding...' : 'Add Account'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
