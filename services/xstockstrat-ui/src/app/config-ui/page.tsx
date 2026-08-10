import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/components/ui/utils';
import { getNativeConfigEnv } from '@/lib/deploymentEnv';

const KNOWN_NAMESPACES = [
  'platform',
  'trading',
  'portfolio',
  'marketdata',
  'indicators',
  'ingest',
  'analysis',
  'ledger',
  'identity',
  'notify',
];

type SearchParams = { env?: string; mode?: string };

export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const resolvedSearchParams = await searchParams;
  if (!resolvedSearchParams.env && !resolvedSearchParams.mode) {
    redirect('/config-ui?env=dev&mode=paper');
  }
  const env = resolvedSearchParams.env ?? 'dev';
  const mode = resolvedSearchParams.mode ?? 'paper';
  const nativeEnv = getNativeConfigEnv();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-lg font-semibold">Configuration Namespaces</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Select a namespace to view and edit config values
          </p>
        </div>
        <EnvModeSwitcher env={env} mode={mode} nativeEnv={nativeEnv} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {KNOWN_NAMESPACES.map((ns) => (
          <Link key={ns} href={`/config-ui/${ns}?env=${env}&mode=${mode}`}>
            <Card className="hover:border-primary/50 hover:bg-card/80 transition-all cursor-pointer h-full">
              <CardContent className="pt-4 pb-4">
                <div className="text-sm font-semibold text-primary font-mono">{ns}</div>
                <div className="text-xs text-muted-foreground mt-1">namespace</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

function EnvModeSwitcher({
  env,
  mode,
  nativeEnv,
}: {
  env: string;
  mode: string;
  nativeEnv: 'dev' | 'production';
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground font-medium">ENV:</span>
      {/* Not wrapped in ui/tabs.tsx (feature 121 FR-5): Radix Tabs.Trigger hardcodes role="tab"
          (@radix-ui/react-tabs@1.1.21 index.mjs:114) which asChild merges onto the child <Link>,
          overriding its implicit role="link" — semantically wrong here since a click does a full
          page navigation via the href's query params, not a client-side tab-panel switch. Found via
          Step 27's e2e run (e2e/config-ui/env-mode-switcher.spec.ts's role="link" assertions all
          failed against the Tabs-wrapped version); reverted per that step's own instruction to fix
          the markup, not the test. See 121-shadcn-migration-medium-confidence context.md Step 26/27
          and design.md's parallel FR-9 Accordion→Collapsible primitive-fit finding. */}
      <div className="flex gap-1">
        {['dev', 'production'].map((e) =>
          e === nativeEnv ? (
            <Link
              key={e}
              href={`/config-ui?env=${e}&mode=${mode}`}
              className={cn(
                'px-2.5 py-1 rounded-md border text-xs font-medium transition-colors',
                env === e
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-border/80 hover:text-foreground',
              )}
            >
              {e}
            </Link>
          ) : (
            <Badge
              key={e}
              variant="outline"
              className="px-2.5 py-1 rounded-md text-xs font-medium cursor-not-allowed opacity-60"
              title={`This deployment's native environment is ${nativeEnv}; SetConfig requests scoped to a different environment are rejected.`}
            >
              {e}
            </Badge>
          ),
        )}
      </div>
      <span className="text-muted-foreground font-medium ml-1">MODE:</span>
      <div className="flex gap-1">
        {['paper', 'live'].map((m) => (
          <Link
            key={m}
            href={`/config-ui?env=${env}&mode=${m}`}
            className={cn(
              'px-2.5 py-1 rounded-md border text-xs font-medium transition-colors',
              mode === m
                ? m === 'paper'
                  ? 'border-paper/50 bg-paper/10 text-paper'
                  : 'border-buy/50 bg-buy/10 text-buy'
                : 'border-border text-muted-foreground hover:border-border/80 hover:text-foreground',
            )}
          >
            {m}
          </Link>
        ))}
      </div>
    </div>
  );
}
