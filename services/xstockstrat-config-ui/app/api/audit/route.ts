/**
 * Audit API route — fetches config audit history from the config DB.
 *
 * GET /api/audit?namespace=<ns>&limit=50
 *
 * Queries config.config_audit directly via the config service's DB.
 * In production, this should be exposed as a proper gRPC/Connect RPC
 * on the config service. For now, it falls back to a direct DB query
 * if DATABASE_URL is available, or returns mock data for development.
 */
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { getSessionFromRequest } from '@/app/lib/auth';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL ?? '',
      max: 2,
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
    // Return empty list if no DB configured (dev without DB)
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
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
