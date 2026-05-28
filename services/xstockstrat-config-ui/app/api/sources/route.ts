/**
 * Sources API route — proxies to xstockstrat-ingest via Connect-RPC.
 *
 * GET  /api/sources?include_inactive=true|false  → ListSignalSources
 * POST /api/sources                               → ManageSignalSource
 */
import { NextRequest, NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { connectCodeToHttp, ingestClient } from '@/app/lib/connectClients';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/app/lib/auth';

function propagationHeaders(
  req: NextRequest,
  claims: { user_id: string; roles: string[] },
): Headers {
  return new Headers({
    'x-user-id': claims.user_id,
    'x-access-scope': String(rolesToAccessScope(claims.roles)),
    'x-trace-id': req.headers.get('x-trace-id') ?? generateTraceId(),
  });
}

function errorResponse(err: unknown): NextResponse {
  if (err instanceof ConnectError) {
    return NextResponse.json({ error: err.rawMessage }, { status: connectCodeToHttp(err.code) });
  }
  return NextResponse.json({ error: (err as Error).message }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const includeInactive = searchParams.get('include_inactive') === 'true';

  try {
    const response = await ingestClient.listSignalSources(
      { includeInactive },
      { headers: propagationHeaders(req, claims) },
    );
    return NextResponse.json(response);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // ManageSignalSource requires an admin API key in addition to the session.
  // config-ui operators must include `x-admin-api-key` or `Authorization` on
  // their request; we forward it as `Authorization: Bearer <key>` to ingest.
  const adminKey = req.headers.get('x-admin-api-key');
  const authHeader = adminKey ? `Bearer ${adminKey}` : req.headers.get('Authorization') ?? '';

  const headers = propagationHeaders(req, claims);
  if (authHeader) headers.set('Authorization', authHeader);

  const body = await req.json();

  try {
    const response = await ingestClient.manageSignalSource(body, { headers });
    return NextResponse.json(response);
  } catch (err) {
    return errorResponse(err);
  }
}
