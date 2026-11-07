/**
 * Server-only (Node.js) identity helpers wrapping the Node-only Connect client
 * (@connectrpc/connect-node). Imported by the Node-runtime `middleware.ts` (in-process near-expiry
 * refresh) and the auth route handlers.
 */
import { Code, ConnectError } from '@connectrpc/connect';
import { identityClient } from '@/lib/connectClients';
import { recordAuthEvent } from '@/lib/bffMetrics';
import { serverLog } from '@/lib/serverLog';
import type { JwtClaims } from '@/lib/auth';
import { REFRESH_TIMEOUT_MS } from '@/lib/deadlines';
import type { AuthTokenResponse } from '@xstockstrat/proto/identity/v1/identity_pb';

export async function refreshSession(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string; claims: JwtClaims } | null> {
  try {
    const data: AuthTokenResponse = await identityClient.refreshToken(
      { refreshToken },
      { timeoutMs: REFRESH_TIMEOUT_MS },
    );
    recordAuthEvent('refresh_ok');
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      claims: data.claims as unknown as JwtClaims,
    };
  } catch (err) {
    // Connect code only — never the refresh token.
    const code = ConnectError.from(err).code;
    if (code === Code.Unauthenticated) {
      recordAuthEvent('refresh_rejected');
      serverLog.warn('[refresh] refresh token rejected', { code: Code[code] });
    } else {
      recordAuthEvent('refresh_error');
      serverLog.error('[refresh] identity service error', { code: Code[code] });
    }
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
