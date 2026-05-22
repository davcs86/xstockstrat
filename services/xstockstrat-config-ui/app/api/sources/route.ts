/**
 * Sources API route — proxies to xstockstrat-ingest via Connect-RPC.
 *
 * GET  /api/sources?include_inactive=true|false  → ListSignalSources
 * POST /api/sources                               → ManageSignalSource
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest, rolesToAccessScope, generateTraceId } from '@/app/lib/auth';

const INGEST_HTTP_ENDPOINT =
  process.env.INGEST_HTTP_ENDPOINT ?? 'http://xstockstrat-ingest:8055';

async function rpc(
  method: string,
  body: object,
  propagationHeaders: Record<string, string>,
  authHeader?: string,
): Promise<Response> {
  return fetch(`${INGEST_HTTP_ENDPOINT}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/connect+json',
      ...(authHeader ? { Authorization: authHeader } : {}),
      ...propagationHeaders,
    },
    body: JSON.stringify(body),
  });
}

export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const propagationHeaders = {
    'x-user-id': claims.user_id,
    'x-access-scope': String(rolesToAccessScope(claims.roles)),
    'x-trace-id': req.headers.get('x-trace-id') ?? generateTraceId(),
  };
  const { searchParams } = new URL(req.url);
  const includeInactive = searchParams.get('include_inactive') === 'true';

  try {
    const res = await rpc(
      'xstockstrat.ingest.v1.IngestService/ListSignalSources',
      { includeInactive },
      propagationHeaders,
    );
    const response = await res.json();
    return NextResponse.json(response);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const propagationHeaders = {
    'x-user-id': claims.user_id,
    'x-access-scope': String(rolesToAccessScope(claims.roles)),
    'x-trace-id': req.headers.get('x-trace-id') ?? generateTraceId(),
  };
  // The Authorization header carries the admin API key for ManageSignalSource auth.
  // config-ui operators must have an admin API key configured in their session or env.
  const authHeader = req.headers.get('x-admin-api-key')
    ? `Bearer ${req.headers.get('x-admin-api-key')}`
    : req.headers.get('Authorization') ?? '';

  const body = await req.json();

  try {
    const res = await rpc(
      'xstockstrat.ingest.v1.IngestService/ManageSignalSource',
      body,
      propagationHeaders,
      authHeader,
    );
    const response = await res.json();
    return NextResponse.json(response);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
