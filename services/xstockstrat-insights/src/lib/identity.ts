/**
 * Server-only identity helpers. NEVER import this file from middleware.ts
 * or from any module middleware.ts transitively imports — it pulls in
 * @connectrpc/connect-node which uses Node-only APIs and breaks the Edge
 * runtime bundle.
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
