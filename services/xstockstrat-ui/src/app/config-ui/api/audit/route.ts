import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getSessionFromRequest, hasAdminScope } from '@/lib/auth';
import { resolveDbConnection } from '@/lib/dbTls';
import { HEADER_TRACE_ID } from '@/lib/headers';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const dbConn = resolveDbConnection(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT);
    pool = new Pool({
      connectionString: dbConn.connectionString,
      // Admin-only audit endpoint, light use. Kept to 1 so the UI fits within
      // DigitalOcean's shared 20-connection budget (see root CLAUDE.md).
      max: parseInt(process.env.DB_POOL_MAX ?? '1', 10),
      ssl: dbConn.ssl,
    });
  }
  return pool;
}

export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Admin-only: the audit log is cross-user, cross-namespace config-change history (who changed
  // what, old/new values, per-user scope). A non-admin session must not read it — mirrors the
  // requireAdminScope gate the config-ui BFF applies to setConfig/user-management (configUiBff.ts).
  if (!hasAdminScope(claims.roles)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const namespace = searchParams.get('namespace');
  const limit = parseInt(searchParams.get('limit') ?? '50', 10);

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ entries: [] });
  }

  try {
    const db = getPool();
    // config.config_audit has user_id (NULL = global).
    const query = namespace
      ? `SELECT id, namespace, key, old_value, new_value, changed_by, reason, changed_at, environment, user_id
         FROM config.config_audit WHERE namespace = $1 ORDER BY changed_at DESC LIMIT $2`
      : `SELECT id, namespace, key, old_value, new_value, changed_by, reason, changed_at, environment, user_id
         FROM config.config_audit ORDER BY changed_at DESC LIMIT $1`;
    const params = namespace ? [namespace, limit] : [limit];
    const result = await db.query(query, params);

    return NextResponse.json({
      entries: result.rows.map((r) => ({
        id: String(r.id),
        namespace: r.namespace,
        key: r.key,
        oldValue: r.old_value ?? '',
        newValue: r.new_value ?? '',
        changedBy: r.changed_by ?? '',
        reason: r.reason ?? '',
        changedAt: r.changed_at,
        environment: r.environment ?? 'staging',
        userId: r.user_id ?? '',
      })),
    });
  } catch (err: unknown) {
    console.error('config-ui audit: database error', {
      traceId: req.headers.get(HEADER_TRACE_ID) ?? '',
      code: (err as { code?: string })?.code,
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: 'Audit log unavailable' }, { status: 500 });
  }
}
