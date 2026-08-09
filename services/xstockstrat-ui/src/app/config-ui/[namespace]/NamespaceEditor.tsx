'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ConnectError } from '@connectrpc/connect';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { useConfigKeys } from '@/app/config-ui/hooks/useConfigKeys';
import { useSetConfig } from '@/app/config-ui/hooks/useSetConfig';

function envToProto(env: string): number {
  return env === 'production' ? 2 : 1;
}
function modeToProto(mode: string): number {
  return mode === 'live' ? 2 : mode === 'paper' ? 1 : 0;
}
function errMessage(err: unknown): string {
  return err instanceof ConnectError ? err.rawMessage : (err as Error).message;
}

// FR-3/FR-4: every numeric leaf in the JSON weight map must lie within [min, max].
function validateFloatMap(json: string, min: number, max: number): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return 'Value must be valid JSON';
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'Value must be a JSON object';
  }
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const n = Number(v);
    if (isNaN(n) || n < min || n > max) {
      return `Key "${k}": ${v} is outside [${min}, ${max}]`;
    }
  }
  return null;
}

type Props = { namespace: string; env: string; mode: string; nativeEnv: 'dev' | 'production' };

export function NamespaceEditor({ namespace, env, mode, nativeEnv }: Props) {
  const isNativeEnv = env === nativeEnv;

  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);
  const [editReason, setEditReason] = useState('');

  const {
    data: keysData,
    isLoading: loading,
    error: keysError,
  } = useConfigKeys(namespace, env, mode);
  const {
    mutate: setConfigMutate,
    isPending: saving,
    error: saveError,
  } = useSetConfig(namespace, env, mode);

  const keys = (keysData?.keys ?? []) as {
    key: string;
    description: string;
    defaultValue: string;
    currentValue: string;
    isSecret: boolean;
    consumingService: string;
    environment: number;
    tradingMode: number;
    validation?: { valueType: number; minValue: number; maxValue: number };
  }[];

  function handleSave(key: string) {
    const meta = keys.find((kk) => kk.key === key);
    if (meta?.validation?.valueType === 1) {
      const err = validateFloatMap(editValue, meta.validation.minValue, meta.validation.maxValue);
      if (err) {
        setValidationError(err);
        return; // FR-6: no SetConfig call when validation fails
      }
    }
    if (key === 'platform.trading_state' && !editReason.trim()) {
      setValidationError('A reason is required when changing platform.trading_state');
      return; // no SetConfig call when a required reason is missing
    }
    setValidationError(null);
    // Target the row's own registered scope, not the page's viewed (env, mode) filter: a key
    // registered only as trading_mode='all' still shows up while viewing a specific mode (the
    // ListKeys query matches exact-mode OR 'all'), but setConfig's existence gate is exact-scope
    // only — sending the viewed mode for an 'all' row gets refused NOT_FOUND. meta carries the
    // scope ListKeys actually reported for this row, so Save always writes the row that exists.
    setConfigMutate(
      {
        namespace,
        key,
        value: { value: { case: 'stringVal', value: String(editValue) } },
        reason: editReason.trim() || 'Updated via config-ui',
        environment: meta?.environment ?? envToProto(env),
        tradingMode: meta?.tradingMode ?? modeToProto(mode),
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

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/config-ui?env=${env}&mode=${mode}`}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← namespaces
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-base font-semibold">
          <span className="text-primary font-mono">{namespace}</span>
        </h1>
        <div className="flex gap-1.5 ml-1">
          <Badge variant="secondary" className="text-xs">
            {env}
          </Badge>
          <Badge variant={mode === 'paper' ? 'paper' : 'live'} className="text-xs">
            {mode}
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

      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}
      {keysError && <p className="text-destructive text-sm">Error: {errMessage(keysError)}</p>}
      {saveError && <p className="text-destructive text-sm">Save error: {errMessage(saveError)}</p>}

      {!loading && !keysError && (
        <Card>
          <CardContent className="pt-4 p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[220px]">Key</TableHead>
                  <TableHead className="w-[200px]">Value</TableHead>
                  <TableHead className="hidden md:table-cell">Description</TableHead>
                  <TableHead className="w-[120px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((k) => (
                  <TableRow key={k.key}>
                    <TableCell className="font-mono text-primary">{k.key}</TableCell>
                    <TableCell className="font-mono">
                      {editingKey === k.key ? (
                        <>
                          <Input
                            className="h-7 text-xs w-40"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => {
                              if (k.validation?.valueType === 1) {
                                setValidationError(
                                  validateFloatMap(
                                    editValue,
                                    k.validation.minValue,
                                    k.validation.maxValue,
                                  ),
                                );
                              }
                            }}
                            autoFocus
                          />
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
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground text-xs">
                      {k.description}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {!k.isSecret && editingKey !== k.key && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingKey(k.key);
                              setEditValue(k.currentValue);
                              setEditReason('');
                            }}
                            className="h-7 px-2 text-xs text-primary hover:text-primary"
                          >
                            Edit
                          </Button>
                        )}
                        {editingKey === k.key && (
                          <>
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => handleSave(k.key)}
                              disabled={
                                saving ||
                                (editingKey === k.key && !!validationError) ||
                                !isNativeEnv
                              }
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {keys.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">
                No config keys found for this namespace
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
