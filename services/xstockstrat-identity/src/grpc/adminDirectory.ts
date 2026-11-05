// No relative imports (loads under strip-types). Header-blind by design: authorization is the mTLS
// peer SAN only; never read x-access-scope / x-user-id / x-internal-caller here.
import * as grpc from '@grpc/grpc-js';
import type { Pool } from 'pg';

const ADMIN_DIRECTORY_PEER_SANS = ['xstockstrat-notify'] as const;

interface AdminDirectoryCall {
  getAuthContext?: () => { sslPeerCertificate?: { subjectaltname?: string } } | undefined;
}

function peerDnsSans(call: AdminDirectoryCall): string[] {
  const raw = call.getAuthContext?.()?.sslPeerCertificate?.subjectaltname ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.startsWith('DNS:'))
    .map((s) => s.slice('DNS:'.length));
}

function hasAdminDirectoryPeer(call: AdminDirectoryCall): boolean {
  return peerDnsSans(call).some((s) =>
    (ADMIN_DIRECTORY_PEER_SANS as readonly string[]).includes(s),
  );
}

const PEER_SAN_ERROR = {
  code: grpc.status.PERMISSION_DENIED,
  message: 'peer not authorized for ListAdminUserIds',
};

export async function listAdminUserIds(
  pool: Pool,
  call: AdminDirectoryCall,
  callback: grpc.sendUnaryData<{ userIds: string[] }>,
): Promise<void> {
  if (!hasAdminDirectoryPeer(call)) {
    callback(PEER_SAN_ERROR);
    return;
  }
  try {
    const r = await pool.query(
      "SELECT user_id::text AS user_id FROM identity.users WHERE is_active = true AND 'admin' = ANY(roles)",
    );
    callback(null, { userIds: r.rows.map((x) => x.user_id) });
  } catch {
    callback({ code: grpc.status.INTERNAL, message: 'admin directory lookup failed' });
  }
}
