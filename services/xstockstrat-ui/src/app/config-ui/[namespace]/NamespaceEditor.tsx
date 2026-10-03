'use client';

import { createContext, useContext, useMemo, useState } from 'react';
import { EllipsisVertical } from 'lucide-react';
import { ConnectError } from '@connectrpc/connect';
import type { CellContext, ColumnDef } from '@tanstack/react-table';
import type { ConfigKeyMeta } from '@xstockstrat/proto/config/v1/config_pb';
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
import { timestampToDate } from '@/lib/protoTime';
import { envToProto, useConfigKeys } from '@/app/config-ui/hooks/useConfigKeys';
import { useSetConfig } from '@/app/config-ui/hooks/useSetConfig';

function errMessage(err: unknown): string {
  return err instanceof ConnectError ? err.rawMessage : (err as Error).message;
}

// config.v1.ValueType.VALUE_TYPE_FLOAT_SCALAR (numeric on the es-generated browser client).
const VALUE_TYPE_FLOAT_SCALAR = 2;

// A scalar-float key's value must lie within [min, max]. Pre-validation only — the config service
// enforces the same bounds at the SetConfig write path (authoritative).
function validateScalar(value: string, min: number, max: number): string | null {
  const n = Number(value);
  if (value.trim() === '' || Number.isNaN(n) || n < min || n > max) {
    return `Value must be a number in [${min}, ${max}]`;
  }
  return null;
}

type EditState = {
  editingKey: string | null;
  editValue: string;
  setEditValue: (v: string) => void;
  editReason: string;
  setEditReason: (v: string) => void;
  validationError: string | null;
  setValidationError: (v: string | null) => void;
  saving: boolean;
  isNativeEnv: boolean;
  startEdit: (k: ConfigKeyMeta) => void;
  cancelEdit: () => void;
  handleSave: (key: string) => void;
};

const EditContext = createContext<EditState | null>(null);

function useEditContext(): EditState {
  const ctx = useContext(EditContext);
  if (!ctx) throw new Error('NamespaceEditor cells must render inside EditContext');
  return ctx;
}

type RowProps = CellContext<ConfigKeyMeta, unknown>;

function KeyCell({ row }: RowProps) {
  const k = row.original;
  return (
    <>
      <span>{k.key}</span>
      {k.description && (
        <p
          title={k.description}
          className="font-sans whitespace-normal max-w-[280px] text-xs text-muted-foreground line-clamp-2"
        >
          {k.description}
        </p>
      )}
    </>
  );
}

function ValueCell({ row }: RowProps) {
  const {
    editingKey,
    editValue,
    setEditValue,
    editReason,
    setEditReason,
    validationError,
    setValidationError,
  } = useEditContext();
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
          Encrypted at rest; the current value is never shown. Saving stores exactly what you type
          as the new secret.
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
}

function UpdatedCell({ row }: RowProps) {
  const d = timestampToDate(row.original.updatedAt);
  return d ? <span title={d.toISOString()}>{d.toLocaleString()}</span> : <span>—</span>;
}

function ActionsCell({ row }: RowProps) {
  const { editingKey, validationError, saving, isNativeEnv, startEdit, cancelEdit, handleSave } =
    useEditContext();
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
            <DropdownMenuItem onClick={() => startEdit(k)}>Edit</DropdownMenuItem>
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
            onClick={cancelEdit}
            className="h-7 px-2 text-xs text-muted-foreground"
          >
            Cancel
          </Button>
        </>
      )}
    </div>
  );
}

// Columns and cells must stay at module scope — an inline `cell` arrow is a new component type per
// render, which remounts the edit inputs on every keystroke (AC-11).
const COLUMNS: ColumnDef<ConfigKeyMeta>[] = [
  {
    accessorKey: 'key',
    header: 'Key',
    meta: { className: 'w-[220px] font-mono text-primary' },
    cell: KeyCell,
  },
  {
    id: 'value',
    header: 'Value',
    enableSorting: false,
    meta: { className: 'w-[200px] font-mono' },
    cell: ValueCell,
  },
  {
    id: 'updated',
    header: () => <span title="Row last modified">Updated</span>,
    enableSorting: false,
    meta: { className: 'text-xs text-muted-foreground' },
    cell: UpdatedCell,
  },
  {
    id: 'actions',
    header: 'Actions',
    enableSorting: false,
    meta: { className: 'w-[120px]' },
    cell: ActionsCell,
  },
];

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

  const keys = useMemo(() => keysData?.keys ?? [], [keysData]);

  function handleSave(key: string) {
    const meta = keys.find((kk) => kk.key === key);
    if (meta?.isSecret && user) {
      // Secrets are global-scope only — the backend rejects a per-user secret write.
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
      return;
    }
    setValidationError(null);
    // Target the row's own registered environment when ListKeys reported one, else the viewed env.
    // The per-user scope is carried so a per-user override edits the user's row, not the global one.
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

  const editState: EditState = {
    editingKey,
    editValue,
    setEditValue,
    editReason,
    setEditReason,
    validationError,
    setValidationError,
    saving,
    isNativeEnv,
    startEdit: (k) => {
      setEditingKey(k.key);
      // Never seed a secret's editor with its redacted placeholder — a secret
      // write is always a fresh plaintext the operator types.
      setEditValue(k.isSecret ? '' : k.currentValue);
      setEditReason('');
    },
    cancelEdit: () => {
      setEditingKey(null);
      setValidationError(null);
    },
    handleSave,
  };

  return (
    <EditContext.Provider value={editState}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <PageBreadcrumb
            ariaLabel="Namespace path"
            items={[{ label: 'Config' }, { label: namespace }]}
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
            <span className="font-mono">{env}</span> config is read-only here — edits are rejected
            by the backend.
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
        {saveError && (
          <p className="text-destructive text-sm">Save error: {errMessage(saveError)}</p>
        )}

        {!loading && !keysError && (
          <Card>
            <CardContent className="pt-4 p-0">
              <DataTable
                columns={COLUMNS}
                data={keys}
                getRowId={(k) => k.key}
                emptyMessage="No config keys found for this namespace"
              />
            </CardContent>
          </Card>
        )}
      </div>
    </EditContext.Provider>
  );
}
