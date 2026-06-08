import { NextRequest, NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { identityClient, connectCodeToHttp } from '@/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/lib/auth';

// Platform-internal propagation headers, built exactly like configUiBff.ts:backendHeaders
// (x-user-id / x-access-scope / x-trace-id). The userId is always derived from the verified
// session — never from the request body — so a caller can only ever list/revoke their own
// authorized apps (FR-3 IDOR).
function backendHeaders(req: NextRequest, userId: string, roles: string[]): Headers {
  return new Headers({
    'x-user-id': userId,
    'x-access-scope': String(rolesToAccessScope(roles)),
    'x-trace-id': req.headers.get('x-trace-id') ?? generateTraceId(),
  });
}

function tsToISO(ts?: { seconds: bigint; nanos: number }): string | null {
  if (!ts) return null;
  return new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1e6)).toISOString();
}

// GET /accounts/api/authorized-apps — the calling user's OAuth-authorized apps.
export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const headers = backendHeaders(req, claims.user_id, claims.roles);
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
    const headers = backendHeaders(req, claims.user_id, claims.roles);
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
