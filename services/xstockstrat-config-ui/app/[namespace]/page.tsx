/**
 * Config UI — Key-value table for a given namespace.
 * Fetches config keys from the API route (which calls xstockstrat-config via Connect-RPC).
 * Allows inline editing of non-secret values.
 */
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ConnectError } from '@connectrpc/connect';
import { Card, CardContent } from '@components/ui/card';
import { Badge } from '@components/ui/badge';
import { Button } from '@components/ui/button';
import { Input } from '@components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@components/ui/table';
import { configClient } from '@/app/lib/browserClients';

interface ConfigKey {
  key: string;
  description: string;
  defaultValue: string;
  isSecret: boolean;
  consumingService: string;
  environment: number;
  tradingMode: number;
}

function envToProto(env: string): number {
  return env === 'production' ? 2 : 1;
}
function modeToProto(mode: string): number {
  return mode === 'live' ? 2 : mode === 'paper' ? 1 : 0;
}
function errMessage(err: unknown): string {
  return err instanceof ConnectError ? err.rawMessage : (err as Error).message;
}

type Props = {
  params: { namespace: string };
  searchParams: { env?: string; mode?: string };
};

export default function NamespacePage({ params, searchParams }: Props) {
  const { namespace } = params;
  const env = searchParams.env ?? 'dev';
  const mode = searchParams.mode ?? 'paper';

  const [keys, setKeys] = useState<ConfigKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setLoading(true);
    configClient
      .listKeys({
        namespace,
        environment: envToProto(env),
        tradingMode: modeToProto(mode),
      })
      .then((data) => {
        setKeys((data.keys ?? []) as ConfigKey[]);
        setLoading(false);
      })
      .catch((e) => {
        setError(errMessage(e));
        setLoading(false);
      });
  }, [namespace, env, mode]);

  async function handleSave(key: string) {
    setSaving(true);
    try {
      await configClient.setConfig({
        namespace,
        key,
        value: { value: { case: 'stringVal', value: String(editValue) } },
        reason: 'Updated via config-ui',
        environment: envToProto(env),
        tradingMode: modeToProto(mode),
      });
      setEditingKey(null);
      const data = await configClient.listKeys({
        namespace,
        environment: envToProto(env),
        tradingMode: modeToProto(mode),
      });
      setKeys((data.keys ?? []) as ConfigKey[]);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/?env=${env}&mode=${mode}`} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← namespaces
        </Link>
        <span className="text-muted-foreground">/</span>
        <h1 className="text-base font-semibold">
          <span className="text-primary font-mono">{namespace}</span>
        </h1>
        <div className="flex gap-1.5 ml-1">
          <Badge variant="secondary" className="text-xs">{env}</Badge>
          <Badge variant={mode === 'paper' ? 'paper' : 'live'} className="text-xs">{mode}</Badge>
        </div>
      </div>

      {loading && <p className="text-muted-foreground text-sm">Loading…</p>}
      {error && <p className="text-destructive text-sm">Error: {error}</p>}

      {!loading && !error && (
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
                        <Input
                          className="h-7 text-xs w-40"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          autoFocus
                        />
                      ) : k.isSecret ? (
                        <span className="text-muted-foreground italic text-xs">[secret]</span>
                      ) : (
                        <span className="text-foreground/80">{k.defaultValue || '—'}</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-muted-foreground text-xs">{k.description}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {!k.isSecret && editingKey !== k.key && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setEditingKey(k.key); setEditValue(k.defaultValue); }}
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
                              disabled={saving}
                              className="h-7 px-2 text-xs"
                            >
                              {saving ? 'Saving…' : 'Save'}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setEditingKey(null)}
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
              <p className="text-sm text-muted-foreground text-center py-8">No config keys found for this namespace</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
