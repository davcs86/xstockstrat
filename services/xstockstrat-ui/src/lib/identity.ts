/**
 * Server-only (Node.js) identity helpers. These wrap the Node-only Connect client
 * (@connectrpc/connect-node). As of feature 128 `middleware.ts` runs in the Node.js
 * runtime and imports `refreshSession` from here for its in-process near-expiry refresh,
 * alongside the auth route handlers (app/api/auth/{refresh,logout}/route.ts). It is no
 * longer confined to route handlers to keep it out of an Edge bundle.
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
