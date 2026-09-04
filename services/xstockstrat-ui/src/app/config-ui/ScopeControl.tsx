'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';

/**
 * Per-user scope control for the Config UI. Per-user config is owner-only self-service, so this
 * offers exactly two scopes and takes NO free-form user id: `global` and `my overrides` (the
 * caller's own layer, `selfUserId`). Navigates via the `user` URL param; `my overrides` hides when
 * there is no resolvable session user.
 */
export function ScopeControl({
  env,
  user,
  selfUserId,
  basePath = '/config-ui',
}: {
  env: string;
  user: string;
  selfUserId: string;
  basePath?: string;
}) {
  const router = useRouter();

  function go(nextUser: string) {
    const params = new URLSearchParams({ env });
    if (nextUser) params.set('user', nextUser);
    router.push(`${basePath}?${params.toString()}`);
  }

  const onSelf = Boolean(selfUserId) && user === selfUserId;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-muted-foreground font-medium">SCOPE:</span>
      <Button
        type="button"
        variant={user ? 'ghost' : 'default'}
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => go('')}
        aria-pressed={!user}
      >
        global
      </Button>
      {selfUserId && (
        <Button
          type="button"
          variant={onSelf ? 'default' : 'ghost'}
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => go(selfUserId)}
          aria-pressed={onSelf}
          title="Your own per-user overrides for this environment"
        >
          my overrides
        </Button>
      )}
    </div>
  );
}
