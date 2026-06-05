'use client';

import React from 'react';
import { useAccountContext } from '@/context/AccountContext';
import { tradingClient } from '@/lib/browserClients/tradingClient';
import { BrokerType } from '@xstockstrat/proto/common/v1/common_pb';
import type { BrokerAccount } from '@xstockstrat/proto/trading/v1/trading_pb';
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

function brokerLabel(brokerType: BrokerType): string {
  return brokerType === BrokerType.IBKR ? 'IBKR' : 'Alpaca';
}

/** Builds the broker-type-specific credentials_json blob from form state. */
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

/** Broker-type-specific secret inputs, shared by the add and edit forms. */
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
        <Input
          type="password"
          placeholder="Consumer Key"
          value={creds.consumerKey}
          onChange={(e) => set({ consumerKey: e.target.value })}
          required
        />
        <Input
          type="password"
          placeholder="Access Token"
          value={creds.accessToken}
          onChange={(e) => set({ accessToken: e.target.value })}
          required
        />
        <Input
          type="password"
          placeholder="Access Token Secret"
          value={creds.accessTokenSecret}
          onChange={(e) => set({ accessTokenSecret: e.target.value })}
          required
        />
        <Input
          placeholder="IBKR Account ID"
          value={creds.ibkrAccountId}
          onChange={(e) => set({ ibkrAccountId: e.target.value })}
          required
        />
      </>
    );
  }
  return (
    <>
      <Input
        type="password"
        placeholder="API Key"
        value={creds.apiKey}
        onChange={(e) => set({ apiKey: e.target.value })}
        required
      />
      <Input
        type="password"
        placeholder="API Secret"
        value={creds.apiSecret}
        onChange={(e) => set({ apiSecret: e.target.value })}
        required
      />
    </>
  );
}

/** Inline form to replace the stored API secrets for an existing account. */
function EditCredentialsForm({
  account,
  onDone,
}: {
  account: BrokerAccount;
  onDone: () => void;
}) {
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
    <form onSubmit={handleSubmit} className="mt-2 space-y-2 rounded-md border border-dashed p-2">
      <p className="text-xs text-muted-foreground">
        Enter new {brokerLabel(account.brokerType)} secrets to replace the stored ones. They are
        validated against the broker on save.
      </p>
      <CredentialFields brokerType={account.brokerType} creds={creds} onChange={setCreds} />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-1">
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? 'Saving...' : 'Save keys'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export function AccountManagementPanel() {
  const {
    accounts,
    selectedAccountId,
    setSelectedAccountId,
    refreshAccounts,
    environmentMode,
  } = useAccountContext();

  const [confirmingId, setConfirmingId] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState(false);

  const [displayName, setDisplayName] = React.useState('');
  const [brokerType, setBrokerType] = React.useState<string>('1');
  const [submitting, setSubmitting] = React.useState(false);
  const [creds, setCreds] = React.useState<CredentialState>(EMPTY_CREDENTIALS);

  React.useEffect(() => () => setCreds(EMPTY_CREDENTIALS), []);

  async function handleRemove(accountId: string) {
    setRemoving(true);
    try {
      await tradingClient.deregisterBrokerAccount({ accountId });
      const remaining = accounts.find((a) => a.isActive && a.id !== accountId);
      await refreshAccounts();
      if (selectedAccountId === accountId) {
        setSelectedAccountId(remaining?.id ?? null);
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
      const brokerTypeNum = parseInt(brokerType, 10) as BrokerType;
      // is_paper is omitted — the server derives it from the deployment environment.
      const { account } = await tradingClient.registerBrokerAccount({
        displayName,
        brokerType: brokerTypeNum,
        credentialsJson: buildCredentialsJson(brokerTypeNum, creds),
      });
      await refreshAccounts();
      if (account?.id) {
        setSelectedAccountId(account.id);
      }
      setDisplayName('');
      setBrokerType('1');
      setCreds(EMPTY_CREDENTIALS);
    } finally {
      setSubmitting(false);
    }
  }

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
              <div
                key={account.id}
                className={`rounded-md border p-2${!account.isActive ? ' opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                    <span className="text-sm font-medium truncate">{account.displayName}</span>
                    <Badge variant="secondary">{brokerLabel(account.brokerType)}</Badge>
                    <Badge variant="secondary">{account.isPaper ? 'Paper' : 'Live'}</Badge>
                    <CredentialStatusBadge status={account.credentialStatus} />
                  </div>
                  {account.isActive && confirmingId !== account.id && (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setEditingId((id) => (id === account.id ? null : account.id))
                        }
                      >
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
                      Deregister {account.displayName}? In-flight orders will complete but no new
                      orders can be placed.
                    </p>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleRemove(account.id)}
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
                )}

                {account.isActive && editingId === account.id && (
                  <EditCredentialsForm account={account} onDone={() => setEditingId(null)} />
                )}
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
          <Select
            value={brokerType}
            onValueChange={(v) => {
              setBrokerType(v);
              setCreds(EMPTY_CREDENTIALS);
            }}
          >
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

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? 'Adding...' : 'Add Account'}
          </Button>
        </form>
      </div>
    </div>
  );
}
