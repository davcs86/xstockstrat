'use client';

import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Copy, Check } from 'lucide-react';
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { useAgentUrl } from '../AgentUrlContext';

interface AuthorizedApp {
  clientId: string;
  clientName: string;
  authorizedAt: string | null;
  lastUsedAt: string | null;
  redirectUris: string[];
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export default function AuthorizedAppsPage() {
  const agentUrl = useAgentUrl();
  const [apps, setApps] = useState<AuthorizedApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);

  const loadApps = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/accounts/api/authorized-apps');
      if (!res.ok) throw new Error(`Failed to load authorized apps (${res.status})`);
      const data = await res.json();
      setApps(data.apps ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load authorized apps');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApps();
  }, [loadApps]);

  useEffect(() => {
    let active = true;
    fetch('/accounts/api/agent-health')
      .then((r) => r.json())
      .then((d) => {
        if (active) setReachable(Boolean(d.reachable));
      })
      .catch(() => {
        if (active) setReachable(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleDisconnect(app: AuthorizedApp) {
    if (!window.confirm(`Disconnect "${app.clientName}"? It will lose access until you re-authorize it.`)) {
      return;
    }
    setRevoking(app.clientId);
    try {
      const res = await fetch('/accounts/api/authorized-apps', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'revoke', clientId: app.clientId }),
      });
      if (!res.ok) throw new Error(`Failed to disconnect (${res.status})`);
      await loadApps();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect');
    } finally {
      setRevoking(null);
    }
  }

  async function copyAgentUrl() {
    try {
      await navigator.clipboard.writeText(agentUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — the value is still visible in the field for manual copy.
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">My Authorized Apps</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Authorized apps</CardTitle>
          <CardDescription>
            OAuth apps (e.g. Claude.ai) you have connected to the xstockstrat MCP agent. Disconnecting
            an app revokes its refresh token; its existing access token expires shortly after.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : apps.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You haven&apos;t authorized any apps yet. Use the section below to connect one.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>App</TableHead>
                  <TableHead>Client ID</TableHead>
                  <TableHead>Authorized</TableHead>
                  <TableHead>Last refreshed</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apps.map((app) => (
                  <TableRow key={app.clientId}>
                    <TableCell className="font-medium">{app.clientName}</TableCell>
                    <TableCell className="font-mono text-xs">{app.clientId}</TableCell>
                    <TableCell>{formatDate(app.authorizedAt)}</TableCell>
                    <TableCell>{formatDate(app.lastUsedAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={revoking === app.clientId}
                        onClick={() => handleDisconnect(app)}
                      >
                        {revoking === app.clientId ? 'Disconnecting…' : 'Disconnect'}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connect a new app</CardTitle>
          <CardDescription>
            Add xstockstrat as a custom connector in your OAuth client. The agent handles
            authorization, discovery, and token exchange.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Agent status:</span>
            {reachable === null ? (
              <span className="text-sm text-muted-foreground">Checking…</span>
            ) : reachable ? (
              <span className="inline-flex items-center gap-1 text-sm text-green-600">
                <span className="h-2 w-2 rounded-full bg-green-600" /> Reachable
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-sm text-destructive">
                <span className="h-2 w-2 rounded-full bg-destructive" /> Unreachable
              </span>
            )}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">MCP connector URL</label>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={agentUrl}
                aria-label="MCP connector URL"
                className="flex-1 rounded-md border border-input bg-muted px-3 py-2 font-mono text-xs"
              />
              <Button type="button" variant="outline" size="sm" onClick={copyAgentUrl} disabled={!agentUrl}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="ml-1">{copied ? 'Copied' : 'Copy'}</span>
              </Button>
            </div>
          </div>

          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>Open Claude.ai → Settings → Connectors → Add custom connector.</li>
            <li>Paste the MCP connector URL above.</li>
            <li>Complete the OAuth sign-in; the app will then appear in your authorized list.</li>
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
