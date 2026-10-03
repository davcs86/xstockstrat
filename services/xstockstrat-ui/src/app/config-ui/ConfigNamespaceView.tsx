import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/components/ui/utils';
import { getNativeConfigEnv } from '@/lib/deploymentEnv';
import { configUiHref } from '@/lib/configNamespaces';
import { NamespaceEditor } from './[namespace]/NamespaceEditor';
import { NamespaceSelect } from './NamespaceSelect';
import { ScopeControl } from './ScopeControl';
import { resolveConfigScope } from './scope';

type Props = {
  namespace: string;
  /** Route the header controls navigate within: `/config-ui` or `/config-ui/<namespace>`. */
  basePath: string;
  rawEnv?: string;
  rawUser?: string;
};

/** Shared header (env, scope, namespace) + editor for `/config-ui` and `/config-ui/[namespace]`. */
export async function ConfigNamespaceView({ namespace, basePath, rawEnv, rawUser }: Props) {
  // Environment is production/staging (paper/live derives from it); the second axis is
  // global vs per-user (user_id).
  const env = rawEnv === 'production' ? 'production' : 'staging';
  // Per-user config is owner-only self-service: clamp the scope to the caller's own id.
  const { selfUserId, user } = await resolveConfigScope(rawUser ?? '');
  const nativeEnv = getNativeConfigEnv();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="text-lg font-semibold">Configuration</h1>
        <EnvSwitcher env={env} user={user} nativeEnv={nativeEnv} basePath={basePath} />
        <ScopeControl env={env} user={user} selfUserId={selfUserId} basePath={basePath} />
        <NamespaceSelect namespace={namespace} env={env} user={user} />
      </div>
      {/* Keyed on namespace|env|scope: header controls soft-navigate (client state survives), so
          without a remount an open draft could Save into a different scope. */}
      <NamespaceEditor
        key={`${namespace}|${env}|${user}`}
        namespace={namespace}
        env={env}
        user={user}
        nativeEnv={nativeEnv}
      />
    </div>
  );
}

function EnvSwitcher({
  env,
  user,
  nativeEnv,
  basePath,
}: {
  env: string;
  user: string;
  nativeEnv: 'staging' | 'production';
  basePath: string;
}) {
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
              href={configUiHref(basePath, e, user)}
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
