'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/**
 * Per-user scope control for the Config UI (feature 147). Empty user = the global values; a
 * non-empty user id layers that user's per-user overrides over the global values. Navigates by
 * updating the `user` URL search param so the selected scope carries through namespace links.
 */
export function ScopeControl({
  env,
  user,
  basePath = '/config-ui',
}: {
  env: string;
  user: string;
  basePath?: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(user);

  function go(nextUser: string) {
    const params = new URLSearchParams({ env });
    if (nextUser) params.set('user', nextUser);
    router.push(`${basePath}?${params.toString()}`);
  }

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
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          go(draft.trim());
        }}
      >
        <Input
          className="h-7 text-xs w-40"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="user id (per-user)"
          aria-label="Per-user scope user id"
        />
        <Button type="submit" variant="outline" size="sm" className="h-7 px-2 text-xs">
          apply
        </Button>
      </form>
    </div>
  );
}
