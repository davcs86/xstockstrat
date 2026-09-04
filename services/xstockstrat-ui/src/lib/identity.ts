/**
 * Server-only (Node.js) identity helpers wrapping the Node-only Connect client
 * (@connectrpc/connect-node). Imported by the Node-runtime `middleware.ts` (in-process near-expiry
 * refresh) and the auth route handlers.
 */
import { identityClient } from '@/lib/connectClients';
import type { JwtClaims } from '@/lib/auth';
import type { AuthTokenResponse } from '@xstockstrat/proto/identity/v1/identity_pb';

export async function refreshSession(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; claims: JwtClaims } | null> {
  try {
    const data: AuthTokenResponse = await identityClient.refreshToken({ refreshToken });
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      claims: data.claims as unknown as JwtClaims,
    };
  } catch {
    return null;
  }
}

export async function revokeToken(token: string): Promise<void> {
  try {
    await identityClient.revokeToken({ token });
  } catch {
    // best-effort revocation
  }
}
