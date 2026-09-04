import { cookies } from 'next/headers';
import { verifyAccessToken } from '@/lib/auth';

/**
 * Resolve the config-ui per-user scope for a server-rendered config page. Per-user config is
 * owner-only self-service: the effective scope is clamped to the authenticated session user, and a
 * requested `user` other than the caller's own id collapses to global (never renders someone else's).
 *
 * Returns `selfUserId` (the caller's own id, `''` with no session) and `user` (the clamped scope).
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
