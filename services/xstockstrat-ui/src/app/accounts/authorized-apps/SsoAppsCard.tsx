'use client';

import { KeyRound } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConnectorUrlField } from '@/components/accounts/ConnectorUrlField';

type ClientIds = {
  claude: string;
  claudeReadonly: string;
  claudeCode: string;
  claudeCodeReadonly: string;
};

const CLIENT_ID_ROWS: { key: keyof ClientIds; label: string }[] = [
  { key: 'claude', label: 'Claude.ai (full access)' },
  { key: 'claudeReadonly', label: 'Claude.ai (read-only)' },
  { key: 'claudeCode', label: 'Claude Code (full access)' },
  { key: 'claudeCodeReadonly', label: 'Claude Code (read-only)' },
];

export function SsoAppsCard({
  issuerUrl,
  clientIds,
}: {
  issuerUrl: string | null;
  clientIds: ClientIds;
}) {
  const rows = CLIENT_ID_ROWS.filter((r) => clientIds[r.key] !== '');
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <KeyRound className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold">My Authorized Apps</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Connected apps are managed at your sign-in provider</CardTitle>
          <CardDescription>
            Apps such as Claude.ai connect to the xstockstrat MCP agent through your single sign-on
            provider. Review or remove their access there.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {issuerUrl && (
            <a
              href={issuerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary underline underline-offset-4"
            >
              Open your sign-in provider
            </a>
          )}
          <ConnectorUrlField />
          {rows.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Paste the client ID for your app into the connector&apos;s OAuth settings.
              </p>
              <dl className="space-y-1 text-sm">
                {rows.map((r) => (
                  <div key={r.key} className="flex flex-wrap items-center gap-2">
                    <dt className="text-muted-foreground">{r.label}</dt>
                    <dd className="font-mono text-xs">{clientIds[r.key]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
