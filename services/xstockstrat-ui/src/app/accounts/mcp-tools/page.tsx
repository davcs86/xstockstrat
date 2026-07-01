'use client';

import { useCallback, useEffect, useState } from 'react';
import { Wrench } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useAgentUrl } from '../AgentUrlContext';

interface JsonSchemaProperty {
  type?: string;
  description?: string;
}

interface JsonSchema {
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

interface AgentTool {
  name: string;
  description: string;
  inputSchema?: JsonSchema;
}

function ToolParameters({ schema }: { schema?: JsonSchema }) {
  const entries = Object.entries(schema?.properties ?? {});
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No parameters.</p>;
  }
  const required = new Set(schema?.required ?? []);
  return (
    <ul className="space-y-1.5">
      {entries.map(([name, prop]) => (
        <li key={name} className="text-sm">
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{name}</code>
          {prop.type && <span className="ml-2 text-xs text-muted-foreground">{prop.type}</span>}
          {required.has(name) && (
            <Badge variant="outline" className="ml-2 align-middle text-[10px]">
              required
            </Badge>
          )}
          {prop.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{prop.description}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function McpToolsPage() {
  const agentUrl = useAgentUrl();
  const [tools, setTools] = useState<AgentTool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);

  const loadTools = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/accounts/api/mcp-tools');
      if (!res.ok) throw new Error(`Failed to load MCP tools (${res.status})`);
      const data = await res.json();
      setTools(data.tools ?? []);
      setReachable(Boolean(data.reachable));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load MCP tools');
      setReachable(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTools();
  }, [loadTools]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-2">
        <Wrench className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">MCP Tools</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Available tools</CardTitle>
          <CardDescription>
            Tools the xstockstrat MCP agent exposes to connected AI clients (e.g. Claude.ai) at{' '}
            <code className="font-mono text-xs">{agentUrl || 'the connector URL'}</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : tools.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {reachable === false
                ? 'The agent is unreachable — tool list unavailable.'
                : 'No tools are currently registered.'}
            </p>
          ) : (
            <div className="space-y-3">
              {tools.map((tool) => (
                <details key={tool.name} className="rounded-md border border-border p-3">
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-mono text-sm font-medium">{tool.name}</span>
                      <span className="text-sm text-muted-foreground">{tool.description}</span>
                    </div>
                  </summary>
                  <div className="mt-3 border-t border-border pt-3">
                    <ToolParameters schema={tool.inputSchema} />
                  </div>
                </details>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
