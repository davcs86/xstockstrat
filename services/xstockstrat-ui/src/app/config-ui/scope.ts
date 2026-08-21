import { cookies } from 'next/headers';
import { verifyAccessToken } from '@/lib/auth';

/**
 * Resolve the config-ui per-user scope for a server-rendered config page.
 *
 * Per-user config is **owner-only self-service** (feature 147 / PR #994): an operator may view and
 * edit ONLY their own per-user overrides — never another user's, and an admin bit grants no
 * override there (the backend `SetConfig` gate rejects any per-user write whose target `user_id` is
 * not the caller's own). So the config UI must not let anyone *target* an arbitrary user: the
 * effective per-user scope is clamped to the authenticated session user, and a requested `user`
 * that is anything other than the caller's own id (e.g. a hand-edited URL) collapses to the global
 * scope rather than silently rendering someone else's overlay.
 *
 * Returns:
 *  - `selfUserId` — the authenticated caller's own user id (`''` when there is no valid session);
 *    the only per-user scope the UI may offer.
 *  - `user` — the clamped effective scope: `selfUserId` when the request asked for the caller's own
 *    per-user scope, otherwise `''` (global).
 */
export async function resolveConfigScope(
  requestedUser: string,
): Promise<{ selfUserId: string; user: string }> {
  const token = (await cookies()).get('access_token')?.value;
  const claims = token ? await verifyAccessToken(token) : null;
  const selfUserId = claims?.user_id ?? '';
  const user = selfUserId && requestedUser === selfUserId ? selfUserId : '';
  return { selfUserId, user };
}
