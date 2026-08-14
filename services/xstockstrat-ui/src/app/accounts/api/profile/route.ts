import { NextRequest, NextResponse } from 'next/server';
import { ConnectError } from '@connectrpc/connect';
import { identityClient, connectCodeToHttp } from '@/lib/connectClients';
import { getSessionFromRequest } from '@/lib/auth';
import { restBackendHeaders } from '@/lib/restBackendHeaders';

function tsToISO(ts?: { seconds: bigint; nanos: number }): string | null {
  if (!ts) return null;
  return new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1e6)).toISOString();
}

/** Map the gRPC UserMetadata message to the REST JSON shape. */
function toProfileJson(m?: {
  userId?: string;
  email?: string;
  phone?: string;
  displayName?: string;
  metadata?: Record<string, unknown>;
  metadataUpdatedAt?: { seconds: bigint; nanos: number };
}) {
  return {
    userId: m?.userId ?? '',
    email: m?.email ?? '',
    phone: m?.phone ?? null,
    displayName: m?.displayName ?? null,
    metadata: m?.metadata ?? {},
    metadataUpdatedAt: tsToISO(m?.metadataUpdatedAt),
  };
}

// GET /accounts/api/profile — the calling user's own metadata.
export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const headers = restBackendHeaders(req, claims.user_id, claims.roles);
    const data = await identityClient.getUserMetadata({}, { headers });
    return NextResponse.json(toProfileJson(data.userMetadata));
  } catch (err) {
    const ce = ConnectError.from(err);
    return NextResponse.json(
      { error: ce.rawMessage || 'Failed to fetch profile' },
      { status: connectCodeToHttp(ce.code) },
    );
  }
}

// PUT /accounts/api/profile — partial-update the calling user's own metadata.
export async function PUT(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    const headers = restBackendHeaders(req, claims.user_id, claims.roles);
    const data = await identityClient.updateUserMetadata(
      {
        phone: body.phone,
        displayName: body.displayName,
        metadata: body.metadata,
      },
      { headers },
    );
    return NextResponse.json(toProfileJson(data.userMetadata));
  } catch (err) {
    const ce = ConnectError.from(err);
    return NextResponse.json(
      { error: ce.rawMessage || 'Failed to update profile' },
      { status: connectCodeToHttp(ce.code) },
    );
  }
}
