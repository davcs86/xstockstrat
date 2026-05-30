'use client';

import React from 'react';
import { useAccountContext } from '@/context/AccountContext';
import { BASE_PATH } from '@/lib/basepath';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

function brokerLabel(brokerType: number): string {
  return brokerType === 2 ? 'IBKR' : 'Alpaca';
}

export function AccountManagementPanel() {
  const { accounts, selectedAccountId, setSelectedAccountId, refreshAccounts } =
    useAccountContext();

  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState(false);

  const [displayName, setDisplayName] = React.useState('');
  const [brokerType, setBrokerType] = React.useState<string>('1');
  const [isPaper, setIsPaper] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);

  // Alpaca credential fields
  const [apiKey, setApiKey] = React.useState('');
  const [apiSecret, setApiSecret] = React.useState('');

  // IBKR credential fields
  const [consumerKey, setConsumerKey] = React.useState('');
  const [accessToken, setAccessToken] = React.useState('');
  const [accessTokenSecret, setAccessTokenSecret] = React.useState('');
  const [ibkrAccountId, setIbkrAccountId] = React.useState('');

  const clearCredentials = React.useCallback(() => {
    setApiKey('');
    setApiSecret('');
    setConsumerKey('');
    setAccessToken('');
    setAccessTokenSecret('');
    setIbkrAccountId('');
  }, []);

  React.useEffect(() => {
    return () => {
      clearCredentials();
    };
  }, [clearCredentials]);

  async function handleRemove(accountId: string) {
    setRemoving(true);
    try {
      await fetch(`${BASE_PATH}/api/accounts/${accountId}`, { method: 'DELETE' });
      const remaining = accounts.find(
        (a) => a.is_active && a.account_id !== accountId,
      );
      await refreshAccounts();
      if (selectedAccountId === accountId) {
        setSelectedAccountId(remaining?.account_id ?? null);
      }
    } finally {
      setRemoving(false);
      setConfirmingId(null);
    }
  }

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const brokerTypeNum = parseInt(brokerType, 10);
      const credentials_json =
        brokerTypeNum === 2
          ? JSON.stringify({
              consumer_key: consumerKey,
              access_token: accessToken,
              access_token_secret: accessTokenSecret,
              ibkr_account_id: ibkrAccountId,
            })
          : JSON.stringify({ api_key: apiKey, api_secret: apiSecret });

      const res = await fetch(`${BASE_PATH}/api/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName,
          broker_type: brokerTypeNum,
          is_paper: isPaper,
          credentials_json,
        }),
      });
      const data = await res.json();
      await refreshAccounts();
      if (data.account?.account_id) {
        setSelectedAccountId(data.account.account_id);
      }
      setDisplayName('');
      setBrokerType('1');
      setIsPaper(true);
      clearCredentials();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6 py-4">
      {/* Account list */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Registered Accounts</h3>
        {accounts.length === 0 ? (
          <p className="text-xs text-muted-foreground">No accounts registered.</p>
        ) : (
          <div className="space-y-2">
            {accounts.map((account) => (
              <div
                key={account.account_id}
                className={`flex items-center justify-between gap-2 p-2 rounded-md border${!account.is_active ? ' opacity-50' : ''}`}
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-medium truncate">{account.display_name}</span>
                  <Badge variant="secondary">{brokerLabel(account.broker_type)}</Badge>
                  <Badge variant="secondary">{account.is_paper ? 'Paper' : 'Live'}</Badge>
                </div>
                {account.is_active &&
                  (confirmingId === account.account_id ? (
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <p className="text-xs text-destructive text-right max-w-[160px]">
                        Deregister {account.display_name}? In-flight orders will complete but no new orders can be placed.
                      </p>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleRemove(account.account_id)}
                          disabled={removing}
                        >
                          Confirm
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmingId(null)}
                          disabled={removing}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="shrink-0"
                      onClick={() => setConfirmingId(account.account_id)}
                    >
                      Remove
                    </Button>
                  ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Account form */}
      <div>
        <h3 className="text-sm font-semibold mb-3">Add Account</h3>
        <form onSubmit={handleAddAccount} className="space-y-3">
          <Input
            placeholder="Display name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
          />
          <Select value={brokerType} onValueChange={setBrokerType}>
            <SelectTrigger>
              <SelectValue placeholder="Broker" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Alpaca</SelectItem>
              <SelectItem value="2">IBKR</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Mode:</span>
            <Button
              type="button"
              size="sm"
              variant={isPaper ? 'default' : 'ghost'}
              onClick={() => setIsPaper(true)}
            >
              Paper
            </Button>
            <Button
              type="button"
              size="sm"
              variant={!isPaper ? 'default' : 'ghost'}
              onClick={() => setIsPaper(false)}
            >
              Live
            </Button>
          </div>

          {brokerType === '1' ? (
            <>
              <Input
                type="password"
                placeholder="API Key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required
              />
              <Input
                type="password"
                placeholder="API Secret"
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
                required
              />
            </>
          ) : (
            <>
              <Input
                type="password"
                placeholder="Consumer Key"
                value={consumerKey}
                onChange={(e) => setConsumerKey(e.target.value)}
                required
              />
              <Input
                type="password"
                placeholder="Access Token"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                required
              />
              <Input
                type="password"
                placeholder="Access Token Secret"
                value={accessTokenSecret}
                onChange={(e) => setAccessTokenSecret(e.target.value)}
                required
              />
              <Input
                placeholder="IBKR Account ID"
                value={ibkrAccountId}
                onChange={(e) => setIbkrAccountId(e.target.value)}
                required
              />
            </>
          )}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Adding...' : 'Add Account'}
          </Button>
        </form>
      </div>
    </div>
  );
}
