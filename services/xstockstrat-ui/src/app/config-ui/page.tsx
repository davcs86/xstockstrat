import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/components/ui/utils';
import { getNativeConfigEnv } from '@/lib/deploymentEnv';
import { ScopeControl } from './ScopeControl';
import { resolveConfigScope } from './scope';

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

type SearchParams = { env?: string; user?: string };

function nsHref(ns: string | null, env: string, user: string): string {
  const params = new URLSearchParams({ env });
  if (user) params.set('user', user);
  const base = ns ? `/config-ui/${ns}` : '/config-ui';
  return `${base}?${params.toString()}`;
}

export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const resolvedSearchParams = await searchParams;
  if (!resolvedSearchParams.env) {
    redirect('/config-ui?env=staging');
  }
  // Environment is production/staging (paper/live derives from it); the second axis is
  // global vs per-user (user_id).
  const env = resolvedSearchParams.env === 'production' ? 'production' : 'staging';
  // Per-user config is owner-only self-service: clamp the scope to the caller's own id.
  const { selfUserId, user } = await resolveConfigScope(resolvedSearchParams.user ?? '');
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
        <EnvSwitcher env={env} user={user} nativeEnv={nativeEnv} />
        <ScopeControl env={env} user={user} selfUserId={selfUserId} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {KNOWN_NAMESPACES.map((ns) => (
          <Link key={ns} href={nsHref(ns, env, user)}>
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

function EnvSwitcher({
  env,
  user,
  nativeEnv,
}: {
  env: string;
  user: string;
  nativeEnv: 'staging' | 'production';
}) {
  const userQuery = user ? `&user=${encodeURIComponent(user)}` : '';
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground font-medium">ENV:</span>
      {/* Not wrapped in ui/tabs.tsx: Radix Tabs.Trigger hardcodes role="tab", overriding the child
          <Link>'s role="link" — wrong here, since a click does a full page navigation, not a tab switch. */}
      <div className="flex gap-1">
        {['staging', 'production'].map((e) =>
          e === nativeEnv ? (
            <Link
              key={e}
              href={`/config-ui?env=${e}${userQuery}`}
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
    </div>
  );
}
