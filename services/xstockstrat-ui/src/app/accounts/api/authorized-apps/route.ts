import { NextRequest, NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { identityClient, connectCodeToHttp } from '@/lib/connectClients';
import { getSessionFromRequest } from '@/lib/auth';
import { restBackendHeaders } from '@/lib/restBackendHeaders';

function tsToISO(ts?: { seconds: bigint; nanos: number }): string | null {
  if (!ts) return null;
  return new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1e6)).toISOString();
}

// GET /accounts/api/authorized-apps — the calling user's OAuth-authorized apps.
export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const headers = restBackendHeaders(req, claims.user_id, claims.roles);
    const data = await identityClient.listAuthorizedApps({ userId: claims.user_id }, { headers });
    // Return only the non-sensitive AuthorizedApp metadata — never tokens/secrets (FR-7).
    return NextResponse.json({
      apps: data.apps.map((a) => ({
        clientId: a.clientId,
        clientName: a.clientName,
        authorizedAt: tsToISO(a.authorizedAt),
        lastUsedAt: tsToISO(a.lastUsedAt),
        redirectUris: a.redirectUris,
      })),
    });
  } catch (err) {
    const ce = ConnectError.from(err);
    return NextResponse.json(
      { error: ce.rawMessage || 'Failed to list authorized apps' },
      { status: connectCodeToHttp(ce.code) },
    );
  }
}

// POST /accounts/api/authorized-apps — revoke one app: body { action: 'revoke', clientId }.
export async function POST(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const clientId: string = body.clientId ?? '';
  if (!clientId) return NextResponse.json({ error: 'clientId required' }, { status: 400 });
  try {
    const headers = restBackendHeaders(req, claims.user_id, claims.roles);
    const data = await identityClient.revokeAuthorizedApp(
      { userId: claims.user_id, clientId },
      { headers },
    );
    return NextResponse.json({ success: data.success });
  } catch (err) {
    const ce = ConnectError.from(err);
    return NextResponse.json(
      { error: ce.rawMessage || 'Failed to revoke authorized app' },
      { status: connectCodeToHttp(ce.code) },
    );
  }
}
