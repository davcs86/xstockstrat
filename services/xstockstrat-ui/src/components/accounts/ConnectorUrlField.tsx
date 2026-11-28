'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAgentUrl } from '@/app/accounts/AgentUrlContext';

/** The MCP connector URL (AGENT_PUBLIC_URL) with a copy button. */
export function ConnectorUrlField() {
  const agentUrl = useAgentUrl();
  const [copied, setCopied] = useState(false);

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
    <div>
      <label className="mb-1 block text-sm font-medium">MCP connector URL</label>
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={agentUrl}
          aria-label="MCP connector URL"
          className="flex-1 rounded-md border border-input bg-muted px-3 py-2 font-mono text-xs"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={copyAgentUrl}
          disabled={!agentUrl}
        >
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          <span className="ml-1">{copied ? 'Copied' : 'Copy'}</span>
        </Button>
      </div>
    </div>
  );
}
