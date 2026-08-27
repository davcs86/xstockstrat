'use client';

import { useMemo, useState } from 'react';
import { EllipsisVertical } from 'lucide-react';
import { ConnectError } from '@connectrpc/connect';
import type { ColumnDef } from '@tanstack/react-table';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { PageBreadcrumb } from '@/components/shared/PageBreadcrumb';
import { DataTable } from '@/components/ui/data-table';
import { useConfigKeys } from '@/app/config-ui/hooks/useConfigKeys';
import { useSetConfig } from '@/app/config-ui/hooks/useSetConfig';

function envToProto(env: string): number {
  // Feature 147: production=2, staging=3 (Environment enum). trading_mode is no longer a config axis.
  return env === 'production' ? 2 : 3;
}
function errMessage(err: unknown): string {
  return err instanceof ConnectError ? err.rawMessage : (err as Error).message;
}

// config.v1.ValueType.VALUE_TYPE_FLOAT_SCALAR (numeric on the es-generated browser client).
// The former VALUE_TYPE_FLOAT_MAP (= 1) validation path was removed with its sole key (feature 161).
const VALUE_TYPE_FLOAT_SCALAR = 2;

// feature 161: a scalar-float key's single numeric value must lie within [min, max]. Pre-validation
// only — the config service enforces the same bounds at the SetConfig write path (authoritative).
function validateScalar(value: string, min: number, max: number): string | null {
  const n = Number(value);
  if (value.trim() === '' || Number.isNaN(n) || n < min || n > max) {
    return `Value must be a number in [${min}, ${max}]`;
  }
  return null;
}

type Props = {
  namespace: string;
  env: string;
  user: string;
  nativeEnv: 'staging' | 'production';
};

export function NamespaceEditor({ namespace, env, user, nativeEnv }: Props) {
  const isNativeEnv = env === nativeEnv;

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [editReason, setEditReason] = useState('');

  const {
    data: keysData,
    isLoading: loading,
    error: keysError,
  } = useConfigKeys(namespace, env, user);
  const {
    mutate: setConfigMutate,
    isPending: saving,
    error: saveError,
  } = useSetConfig(namespace, env, user);

  const keys = (keysData?.keys ?? []) as {
    key: string;
    description: string;
    defaultValue: string;
    currentValue: string;
    isSecret: boolean;
    consumingService: string;
    environment: number;
    validation?: { valueType: number; minValue: number; maxValue: number };
  }[];
  type ConfigKeyRow = (typeof keys)[number];

  function handleSave(key: string) {
    const meta = keys.find((kk) => kk.key === key);
    if (meta?.isSecret && user) {
      // Secrets are global-scope only (feature 147) — the backend rejects a per-user secret write.
      setValidationError('Secret keys are global-scope only; switch to the global scope to edit.');
      return;
    }
    if (meta?.validation?.valueType === VALUE_TYPE_FLOAT_SCALAR) {
      const err = validateScalar(editValue, meta.validation.minValue, meta.validation.maxValue);
      if (err) {
        setValidationError(err);
        return; // no SetConfig call when validation fails (the server also enforces this)
      }
    }
    if (key === 'platform.trading_state' && !editReason.trim()) {
      setValidationError('A reason is required when changing platform.trading_state');
      return; // no SetConfig call when a required reason is missing
    }
    setValidationError(null);
    // Target the row's own registered environment when ListKeys reported one, else the viewed env.
    // The scope is (namespace, key, environment, user_id) — feature 147; the viewed per-user scope
    // is carried on the request so a per-user override edits the user's row, not the global one.
    setConfigMutate(
      {
        namespace,
        key,
        value: { value: { case: 'stringVal', value: String(editValue) } },
        reason: editReason.trim() || 'Updated via config-ui',
        environment: meta?.environment ?? envToProto(env),
        userId: user,
      },
      {
        onSuccess: () => {
          setEditingKey(null);
          setValidationError(null);
          setEditReason('');
        },
      },
    );
  }

  const columns = useMemo<ColumnDef<ConfigKeyRow>[]>(
    () => [
      {
        accessorKey: 'key',
        header: 'Key',
        meta: { className: 'w-[220px] font-mono text-primary' },
      },
      {
        id: 'value',
        header: 'Value',
        enableSorting: false,
        meta: { className: 'w-[200px] font-mono' },
        cell: ({ row }) => {
          const k = row.original;
          return editingKey === k.key ? (
            <>
              <Input
                className="h-7 text-xs w-40"
                value={editValue}
                type={k.isSecret ? 'password' : 'text'}
                placeholder={k.isSecret ? 'Enter new secret value' : undefined}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={() => {
                  if (k.validation?.valueType === VALUE_TYPE_FLOAT_SCALAR) {
                    setValidationError(
                      validateScalar(editValue, k.validation.minValue, k.validation.maxValue),
                    );
                  }
                }}
                autoFocus
              />
              {k.isSecret && (
                <p className="text-muted-foreground text-xs mt-0.5">
                  Encrypted at rest; the current value is never shown. Saving stores exactly what
                  you type as the new secret.
                </p>
              )}
              {k.validation?.valueType === VALUE_TYPE_FLOAT_SCALAR && (
                <p className="text-muted-foreground text-xs mt-0.5">
                  Must be a number in [{k.validation.minValue}, {k.validation.maxValue}].
                </p>
              )}
              <Input
                className="h-7 text-xs w-40 mt-1"
                value={editReason}
                onChange={(e) => setEditReason(e.target.value)}
                placeholder="Reason for this change"
              />
              {validationError && editingKey === k.key && (
                <p className="text-destructive text-xs mt-0.5">{validationError}</p>
              )}
            </>
          ) : k.isSecret ? (
            <span className="text-muted-foreground italic text-xs">[secret]</span>
          ) : (
            <span className="text-foreground/80">{k.currentValue || '—'}</span>
          );
        },
      },
      {
        accessorKey: 'description',
        header: 'Description',
        meta: { className: 'hidden md:table-cell text-muted-foreground text-xs' },
      },
      {
        id: 'actions',
        header: 'Actions',
        enableSorting: false,
        meta: { className: 'w-[120px]' },
        cell: ({ row }) => {
          const k = row.original;
          return (
            <div className="flex items-center gap-1">
              {editingKey !== k.key && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label="Actions"
                      data-testid={`actions-${k.key}`}
                    >
                      <EllipsisVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={() => {
                        setEditingKey(k.key);
                        // Never seed a secret's editor with its redacted placeholder — a secret
                        // write is always a fresh plaintext the operator types (feature 147).
                        setEditValue(k.isSecret ? '' : k.currentValue);
                        setEditReason('');
                      }}
                    >
                      Edit
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {editingKey === k.key && (
                <>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleSave(k.key)}
                    disabled={saving || (editingKey === k.key && !!validationError) || !isNativeEnv}
                    className="h-7 px-2 text-xs"
                  >
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditingKey(null);
                      setValidationError(null);
                    }}
                    className="h-7 px-2 text-xs text-muted-foreground"
                  >
                    Cancel
                  </Button>
                </>
              )}
            </div>
          );
        },
      },
    ],
    [editingKey, editValue, editReason, validationError, saving, isNativeEnv, handleSave],
  );

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-2">
        <PageBreadcrumb
          ariaLabel="Namespace path"
          items={[
            {
              label: '← namespaces',
              href: `/config-ui?env=${env}${user ? `&user=${encodeURIComponent(user)}` : ''}`,
            },
            { label: namespace },
          ]}
        />
        <div className="flex gap-1.5 ml-1">
          <Badge variant="secondary" className="text-xs">
            {env}
          </Badge>
          <Badge variant="outline" className="text-xs">
            {user ? `user:${user}` : 'global'}
          </Badge>
        </div>
      </div>

      {!isNativeEnv && (
        <p className="text-xs text-muted-foreground border border-border rounded-md px-3 py-2 bg-muted/30">
          This deployment&apos;s native environment is{' '}
          <span className="font-mono">{nativeEnv}</span>. Viewing{' '}
          <span className="font-mono">{env}</span> config is read-only here — edits are rejected by
          the backend.
        </p>
      )}

      {user && (
        <p className="text-xs text-muted-foreground border border-border rounded-md px-3 py-2 bg-muted/30">
          Editing <span className="font-medium">your own</span> per-user overrides for{' '}
          <span className="font-mono">{env}</span>. Per-user config is self-service — you can only
          edit your own account&apos;s overrides, never another user&apos;s. These layer over the
          global value; switch to the <span className="font-medium">global</span> scope to change
          the shared value.
        </p>
      )}

      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}
      {keysError && <p className="text-destructive text-sm">Error: {errMessage(keysError)}</p>}
      {saveError && <p className="text-destructive text-sm">Save error: {errMessage(saveError)}</p>}

      {!loading && !keysError && (
        <Card>
          <CardContent className="pt-4 p-0">
            <DataTable
              columns={columns}
              data={keys}
              getRowId={(k) => k.key}
              emptyMessage="No config keys found for this namespace"
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
