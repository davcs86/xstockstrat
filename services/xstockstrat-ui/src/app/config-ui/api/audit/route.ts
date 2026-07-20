import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getSessionFromRequest } from '@/lib/auth';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL ?? '',
      // Admin-only audit endpoint, light use. Kept to 1 so the UI fits within
      // DigitalOcean's shared 20-connection budget (see root CLAUDE.md).
      max: parseInt(process.env.DB_POOL_MAX ?? '1', 10),
    });
  }
  return pool;
}

export async function GET(req: NextRequest) {
  const claims = await getSessionFromRequest(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const namespace = searchParams.get('namespace');
  const limit = parseInt(searchParams.get('limit') ?? '50', 10);

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ entries: [] });
  }

  try {
    const db = getPool();
    const query = namespace
      ? `SELECT id, namespace, key, old_value, new_value, changed_by, reason, changed_at, environment, trading_mode
         FROM config.config_audit WHERE namespace = $1 ORDER BY changed_at DESC LIMIT $2`
      : `SELECT id, namespace, key, old_value, new_value, changed_by, reason, changed_at, environment, trading_mode
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
        environment: r.environment ?? 'dev',
        tradingMode: r.trading_mode ?? 'all',
      })),
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown error' }, { status: 500 });
  }
}
