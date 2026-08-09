'use client';

// Shared broker-account building blocks used by both AccountManagementPanel (compact
// trader-dashboard panel) and AccountsModule (full accounts page). Extracted so the
// credential helpers, the per-account row, and the add-account form exist in exactly one
// place (DRY guard rail — see docs/patterns/dry-guard-rail.md).

import React from 'react';
import { useForm, Controller, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAccountContext } from '@/context/AccountContext';
import { tradingClient } from '@/lib/browserClients/tradingClient';
import { BrokerType } from '@xstockstrat/proto/common/v1/common_pb';
import type { BrokerAccount } from '@xstockstrat/proto/trading/v1/trading_pb';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Field, FieldError } from '../ui/field';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '../ui/alert-dialog';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';
import { CredentialStatusBadge } from './CredentialStatusBadge';
import { brokerLabel } from '@/lib/brokers';

export interface CredentialState {
  apiKey: string;
  apiSecret: string;
  consumerKey: string;
  accessToken: string;
  accessTokenSecret: string;
  ibkrAccountId: string;
}

export const EMPTY_CREDENTIALS: CredentialState = {
  apiKey: '',
  apiSecret: '',
  consumerKey: '',
  accessToken: '',
  accessTokenSecret: '',
  ibkrAccountId: '',
};

/** Builds the broker-type-specific credentials_json blob from form state. */
export function buildCredentialsJson(brokerType: BrokerType, creds: CredentialState): string {
  return brokerType === BrokerType.IBKR
    ? JSON.stringify({
        consumer_key: creds.consumerKey,
        access_token: creds.accessToken,
        access_token_secret: creds.accessTokenSecret,
        ibkr_account_id: creds.ibkrAccountId,
      })
    : JSON.stringify({ api_key: creds.apiKey, api_secret: creds.apiSecret });
}

// feature 122 FR-3/FR-4: the single zod-schema expression of CredentialState's broker-conditional
// required fields, shared by AddAccountForm and EditCredentialsForm (DRY guard rail — do not write
// an independent schema at either consumer's call site). Fields outside the given broker's branch
// stay unconstrained `z.string()` rather than absent, so the schema's inferred type always matches
// the full `CredentialState` shape.
export function credentialSchema(brokerType: BrokerType) {
  const requiredMsg = 'This field is required';
  return brokerType === BrokerType.IBKR
    ? z.object({
        apiKey: z.string(),
        apiSecret: z.string(),
        consumerKey: z.string().min(1, requiredMsg),
        accessToken: z.string().min(1, requiredMsg),
        accessTokenSecret: z.string().min(1, requiredMsg),
        ibkrAccountId: z.string().min(1, requiredMsg),
      })
    : z.object({
        apiKey: z.string().min(1, requiredMsg),
        apiSecret: z.string().min(1, requiredMsg),
        consumerKey: z.string(),
        accessToken: z.string(),
        accessTokenSecret: z.string(),
        ibkrAccountId: z.string(),
      });
}

/** Broker-type-specific secret inputs, shared by the add and edit forms. */
export function CredentialFields({
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
export function EditCredentialsForm({
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

/**
 * One registered-account row: identity badges + edit-keys / remove (with inline confirm)
 * actions + the edit-credentials form. Owns its own confirm/edit/remove state so it can be
 * dropped into any account list. `className` tunes the row padding per host layout.
 */
export function AccountRow({
  account,
  className = 'p-3',
}: {
  account: BrokerAccount;
  className?: string;
}) {
  const { accounts, selectedAccountId, setSelectedAccountId, refreshAccounts } =
    useAccountContext();
  const [editing, setEditing] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

  async function handleRemove() {
    setRemoving(true);
    try {
      await tradingClient.deregisterBrokerAccount({ accountId: account.id });
      const remaining = accounts.find((a) => a.isActive && a.id !== account.id);
      await refreshAccounts();
      if (selectedAccountId === account.id) {
        setSelectedAccountId(remaining?.id ?? null);
      }
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Collapsible
      open={editing}
      onOpenChange={setEditing}
      data-testid={`account-row-${account.id}`}
      className={`rounded-md border ${className}${!account.isActive ? ' opacity-50' : ''}`}
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
        {account.isActive && (
          <div className="flex gap-1 shrink-0">
            <CollapsibleTrigger asChild>
              <Button size="sm" variant="ghost">
                Edit keys
              </Button>
            </CollapsibleTrigger>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost">
                  Remove
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogDescription>
                  Deregister {account.displayName}? In-flight orders will complete but no new orders
                  can be placed.
                </AlertDialogDescription>
                <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  disabled={removing}
                  onClick={(e) => {
                    e.preventDefault();
                    handleRemove();
                  }}
                >
                  Confirm
                </AlertDialogAction>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </div>

      <CollapsibleContent>
        {account.isActive && (
          <EditCredentialsForm account={account} onDone={() => setEditing(false)} />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The "Add Account" form (display name + broker select + credential fields). Self-contained:
 * owns its form state and registers via the trading client. `className` tunes the form layout
 * per host.
 */
type AddAccountValues = { displayName: string; brokerType: string } & CredentialState;

function addAccountSchema(brokerType: BrokerType) {
  return z
    .object({
      displayName: z.string().min(1, 'Display name is required'),
      brokerType: z.string(),
    })
    .merge(credentialSchema(brokerType));
}

export function AddAccountForm({ className = 'space-y-3' }: { className?: string }) {
  const { setSelectedAccountId, refreshAccounts } = useAccountContext();
  const [error, setError] = React.useState<string | null>(null);
  // The broker select determines which credential fields are required, so the resolver schema is
  // broker-dependent. Read via a ref (updated by the Select's onValueChange below) rather than
  // baking the initial broker into the schema passed to useForm: the resolver function is invoked
  // fresh on every validation, so this always validates against the currently-selected broker
  // without needing to reconstruct/rewire the form instance when the broker changes.
  const brokerTypeRef = React.useRef<BrokerType>(BrokerType.ALPACA);
  const {
    control,
    handleSubmit,
    setValue,
    reset,
    formState: { isSubmitting },
  } = useForm<AddAccountValues>({
    resolver: (values, context, options) =>
      zodResolver(addAccountSchema(brokerTypeRef.current))(values, context, options),
    defaultValues: { displayName: '', brokerType: '1', ...EMPTY_CREDENTIALS },
  });

  // Watched only to drive CredentialFields' rendered field set — validation reads brokerTypeRef
  // above, not this value, so a re-render lag between the two is harmless.
  const brokerType = useWatch({ control, name: 'brokerType' });
  const creds = useWatch({
    control,
    name: [
      'apiKey',
      'apiSecret',
      'consumerKey',
      'accessToken',
      'accessTokenSecret',
      'ibkrAccountId',
    ],
  });

  React.useEffect(
    () => () => reset({ displayName: '', brokerType: '1', ...EMPTY_CREDENTIALS }),
    [reset],
  );

  function handleCredsChange(next: CredentialState) {
    setValue('apiKey', next.apiKey);
    setValue('apiSecret', next.apiSecret);
    setValue('consumerKey', next.consumerKey);
    setValue('accessToken', next.accessToken);
    setValue('accessTokenSecret', next.accessTokenSecret);
    setValue('ibkrAccountId', next.ibkrAccountId);
  }

  async function onSubmit(values: AddAccountValues) {
    setError(null);
    try {
      const brokerTypeNum = parseInt(values.brokerType, 10) as BrokerType;
      // is_paper is omitted — the server derives it from the deployment environment.
      const { account } = await tradingClient.registerBrokerAccount({
        displayName: values.displayName,
        brokerType: brokerTypeNum,
        credentialsJson: buildCredentialsJson(brokerTypeNum, values),
      });
      await refreshAccounts();
      if (account?.id) {
        setSelectedAccountId(account.id);
      }
      reset({ displayName: '', brokerType: '1', ...EMPTY_CREDENTIALS });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add account');
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className={className}>
      <Controller
        control={control}
        name="displayName"
        render={({ field, fieldState }) => (
          <Field>
            <Input placeholder="Display name" required disabled={isSubmitting} {...field} />
            <FieldError errors={[fieldState.error]} />
          </Field>
        )}
      />
      <Controller
        control={control}
        name="brokerType"
        render={({ field }) => (
          <Select
            value={field.value}
            onValueChange={(v) => {
              field.onChange(v);
              brokerTypeRef.current = parseInt(v, 10) as BrokerType;
              handleCredsChange(EMPTY_CREDENTIALS);
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
        )}
      />

      <CredentialFields
        brokerType={parseInt(brokerType ?? '1', 10) as BrokerType}
        creds={{
          apiKey: creds[0] ?? '',
          apiSecret: creds[1] ?? '',
          consumerKey: creds[2] ?? '',
          accessToken: creds[3] ?? '',
          accessTokenSecret: creds[4] ?? '',
          ibkrAccountId: creds[5] ?? '',
        }}
        onChange={handleCredsChange}
      />

      {error && <p className="text-xs text-destructive">{error}</p>}

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Adding...' : 'Add Account'}
      </Button>
    </form>
  );
}
