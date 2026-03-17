import { Pool } from 'pg';
import { getLogger } from '../services/logger';

const log = getLogger('config:impl');

// Canonical string values matching DB CHECK constraints
type EnvStr = 'dev' | 'production';
type ModeStr = 'paper' | 'live' | 'all';

// Proto enum values (wire numbers from generated stubs)
const ENV_MAP: Record<number, EnvStr> = { 0: 'dev', 1: 'dev', 2: 'production' };
const MODE_MAP: Record<number, ModeStr> = { 0: 'all', 1: 'paper', 2: 'live' };

function resolveEnv(v: number | undefined): EnvStr {
  return ENV_MAP[v ?? 0] ?? 'dev';
}
function resolveMode(v: number | undefined): ModeStr {
  return MODE_MAP[v ?? 0] ?? 'all';
}

// Snapshot cache key: "namespace:env:mode"
function snapKey(ns: string, env: EnvStr, mode: ModeStr): string {
  return `${ns}:${env}:${mode}`;
}

interface Subscriber {
  namespace: string;
  environment: EnvStr;
  trading_mode: ModeStr;
  clientId: string;
  call: any;
  lastVersion: string;
}

export class ConfigServiceImpl {
  private subscribers: Map<string, Subscriber> = new Map();
  // snapKey → ConfigSnapshot (keyed by "namespace:env:mode")
  private snapshots: Map<string, any> = new Map();

  constructor(private readonly pool: Pool) {}

  async initialize() {
    await this.reloadAll();
    const pgClient = await this.pool.connect();
    await pgClient.query('LISTEN config_changed');
    pgClient.on('notification', async (msg: any) => {
      if (!msg.payload) return;
      const { namespace, environment, trading_mode } = JSON.parse(msg.payload);
      const env = (environment ?? 'dev') as EnvStr;
      const mode = (trading_mode ?? 'all') as ModeStr;
      await this.reloadNamespace(namespace, env, mode);
      this.broadcastToSubscribers(namespace, env, mode);
    });
    log.info('Config service initialised, listening for config_changed notifications');
  }

  private async reloadAll() {
    const result = await this.pool.query(
      `SELECT namespace, key, value_type, value_data, is_secret, description, default_value,
              environment, trading_mode
       FROM config.config_values`
    );
    // Group by snapKey; rows with trading_mode='all' merge into paper, live, and all buckets
    const byKey: Record<string, any> = {};
    for (const row of result.rows) {
      const env = row.environment as EnvStr;
      const rowMode = row.trading_mode as ModeStr;
      const modes: ModeStr[] = rowMode === 'all' ? ['paper', 'live', 'all'] : [rowMode];
      for (const m of modes) {
        const k = snapKey(row.namespace, env, m);
        if (!byKey[k]) byKey[k] = { namespace: row.namespace, environment: env, trading_mode: m, values: {} };
        byKey[k].values[row.key] = buildConfigValue(row);
      }
    }
    for (const [k, entry] of Object.entries(byKey)) {
      this.snapshots.set(k, {
        namespace: entry.namespace,
        version: Date.now().toString(),
        updated_at: { seconds: Math.floor(Date.now() / 1000) },
        values: entry.values,
        update_type: 1, // SNAPSHOT
        changed_keys: [],
        environment: entry.environment,
        trading_mode: entry.trading_mode,
      });
    }
  }

  private async reloadNamespace(namespace: string, env: EnvStr, mode: ModeStr) {
    // Load rows matching env + (exact mode OR 'all')
    const result = await this.pool.query(
      `SELECT key, value_type, value_data, is_secret, description, default_value, environment, trading_mode
       FROM config.config_values
       WHERE namespace = $1 AND environment = $2 AND (trading_mode = $3 OR trading_mode = 'all')`,
      [namespace, env, mode]
    );
    const values: Record<string, any> = {};
    for (const row of result.rows) {
      values[row.key] = buildConfigValue(row);
    }
    this.snapshots.set(snapKey(namespace, env, mode), {
      namespace,
      version: Date.now().toString(),
      updated_at: { seconds: Math.floor(Date.now() / 1000) },
      values,
      update_type: 2, // DELTA
      changed_keys: Object.keys(values),
      environment: env,
      trading_mode: mode,
    });
  }

  private broadcastToSubscribers(namespace: string, env: EnvStr, mode: ModeStr) {
    const snap = this.snapshots.get(snapKey(namespace, env, mode));
    if (!snap) return;
    let count = 0;
    for (const [id, sub] of this.subscribers) {
      if (sub.namespace === namespace && sub.environment === env && sub.trading_mode === mode) {
        try {
          sub.call.write(snap);
          count++;
        } catch (err) {
          log.warn('Failed to write to subscriber', { clientId: sub.clientId });
          this.subscribers.delete(id);
        }
      }
    }
    log.info(`Broadcast config update namespace=${namespace} env=${env} mode=${mode} subscribers=${count}`);
  }

  /**
   * WatchConfig — server-streaming RPC.
   * Sends initial SNAPSHOT immediately, then streams DELTA updates as config changes.
   * All services call this at startup and maintain the stream indefinitely.
   */
  watchConfig(call: any) {
    const req = call.request;
    const env = resolveEnv(req.environment);
    const mode = resolveMode(req.trading_mode);
    const subId = `${req.namespace}:${env}:${mode}:${req.client_id}:${Date.now()}`;

    log.info('New WatchConfig subscriber', { namespace: req.namespace, clientId: req.client_id, env, mode });

    const k = snapKey(req.namespace, env, mode);
    const snap = this.snapshots.get(k) ?? {
      namespace: req.namespace,
      version: '0',
      updated_at: { seconds: Math.floor(Date.now() / 1000) },
      values: {},
      update_type: 1,
      changed_keys: [],
      environment: env,
      trading_mode: mode,
    };
    call.write({ ...snap, update_type: 1 }); // SNAPSHOT

    this.subscribers.set(subId, {
      namespace: req.namespace,
      environment: env,
      trading_mode: mode,
      clientId: req.client_id,
      call,
      lastVersion: snap.version,
    });

    call.on('cancelled', () => {
      log.info('Subscriber disconnected', { subId });
      this.subscribers.delete(subId);
    });
    call.on('error', () => {
      this.subscribers.delete(subId);
    });
  }

  async getConfig(call: any, callback: any) {
    const env = resolveEnv(call.request.environment);
    const mode = resolveMode(call.request.trading_mode);
    const snap = this.snapshots.get(snapKey(call.request.namespace, env, mode));
    if (!snap) {
      callback(null, {
        namespace: call.request.namespace,
        version: '0',
        values: {},
        update_type: 1,
        changed_keys: [],
        environment: env,
        trading_mode: mode,
      });
      return;
    }
    callback(null, snap);
  }

  async setConfig(call: any, callback: any) {
    const { namespace, key, value, author, reason } = call.request;
    const env = resolveEnv(call.request.environment);
    const mode = resolveMode(call.request.trading_mode);
    try {
      await this.pool.query(
        `INSERT INTO config.config_values (namespace, key, value_type, value_data, updated_by, update_reason, environment, trading_mode)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (namespace, key, environment, trading_mode) DO UPDATE
           SET value_data = EXCLUDED.value_data,
               updated_by = EXCLUDED.updated_by,
               update_reason = EXCLUDED.update_reason,
               updated_at = NOW()`,
        [namespace, key, inferValueType(value), JSON.stringify(value), author, reason, env, mode]
      );
      await this.pool.query(`SELECT pg_notify('config_changed', $1)`, [
        JSON.stringify({ namespace, key, environment: env, trading_mode: mode }),
      ]);
      const version = Date.now().toString();
      callback(null, { version, updated_at: { seconds: Math.floor(Date.now() / 1000) } });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }

  async listKeys(call: any, callback: any) {
    const env = resolveEnv(call.request.environment);
    const mode = resolveMode(call.request.trading_mode);
    try {
      const result = await this.pool.query(
        `SELECT key, description, default_value, is_secret, consuming_service, environment, trading_mode
         FROM config.config_values
         WHERE namespace = $1 AND environment = $2 AND (trading_mode = $3 OR trading_mode = 'all')`,
        [call.request.namespace, env, mode]
      );
      callback(null, {
        keys: result.rows.map((r) => ({
          key: r.key,
          description: r.description ?? '',
          default_value: r.default_value ?? '',
          is_secret: r.is_secret,
          consuming_service: r.consuming_service ?? '',
          environment: r.environment === 'production' ? 2 : 1,
          trading_mode: r.trading_mode === 'live' ? 2 : r.trading_mode === 'paper' ? 1 : 0,
        })),
      });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }
}

function buildConfigValue(row: any): any {
  switch (row.value_type) {
    case 'string':  return { string_val: row.value_data };
    case 'int':     return { int_val: parseInt(row.value_data, 10) };
    case 'float':   return { float_val: parseFloat(row.value_data) };
    case 'bool':    return { bool_val: row.value_data === 'true' };
    default:        return { string_val: row.value_data };
  }
}

function inferValueType(v: any): string {
  if (v.string_val !== undefined) return 'string';
  if (v.int_val !== undefined) return 'int';
  if (v.float_val !== undefined) return 'float';
  if (v.bool_val !== undefined) return 'bool';
  return 'string';
}
