/**
 * Server-only identity helpers. NEVER import this file from middleware.ts
 * or from any module middleware.ts transitively imports — it pulls in
 * @connectrpc/connect-node which uses Node-only APIs and breaks the Edge
 * runtime bundle.
 */
import { identityClient } from '@/lib/connectClients';
import type { JwtClaims } from '@/lib/auth';

export async function refreshSession(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; claims: JwtClaims } | null> {
  try {
    const data = (await identityClient.refreshToken({ refreshToken })) as any;
    return {
      accessToken: data.access_token ?? data.accessToken,
      refreshToken: data.refresh_token ?? data.refreshToken,
      claims: data.claims,
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
