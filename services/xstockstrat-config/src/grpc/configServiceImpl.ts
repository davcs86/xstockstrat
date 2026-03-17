import { Pool } from 'pg';
import { getLogger } from '../services/logger';

const log = getLogger('config:impl');

interface Subscriber {
  namespace: string;
  clientId: string;
  call: any;
  lastVersion: string;
}

export class ConfigServiceImpl {
  private subscribers: Map<string, Subscriber> = new Map();
  private snapshots: Map<string, any> = new Map(); // namespace → ConfigSnapshot
  private pgClient: any = null;

  constructor(private readonly pool: Pool) {}

  async initialize() {
    // Load all namespaces from DB into memory
    await this.reloadAll();
    // Subscribe to pg NOTIFY for config changes
    this.pgClient = await this.pool.connect();
    await this.pgClient.query('LISTEN config_changed');
    this.pgClient.on('notification', async (msg: any) => {
      if (!msg.payload) return;
      const { namespace } = JSON.parse(msg.payload);
      await this.reloadNamespace(namespace);
      this.broadcastToSubscribers(namespace, 'DELTA');
    });
    log.info('Config service initialised, listening for config_changed notifications');
  }

  private async reloadAll() {
    const result = await this.pool.query(
      'SELECT namespace, key, value_type, value_data, is_secret, description, default_value FROM config.config_values'
    );
    const byNamespace: Record<string, any> = {};
    for (const row of result.rows) {
      if (!byNamespace[row.namespace]) byNamespace[row.namespace] = {};
      byNamespace[row.namespace][row.key] = buildConfigValue(row);
    }
    for (const [ns, values] of Object.entries(byNamespace)) {
      this.snapshots.set(ns, {
        namespace: ns,
        version: Date.now().toString(),
        updated_at: { seconds: Math.floor(Date.now() / 1000) },
        values,
        update_type: 1, // SNAPSHOT
        changed_keys: [],
      });
    }
  }

  private async reloadNamespace(namespace: string) {
    const result = await this.pool.query(
      'SELECT key, value_type, value_data, is_secret, description, default_value FROM config.config_values WHERE namespace = $1',
      [namespace]
    );
    const values: Record<string, any> = {};
    for (const row of result.rows) {
      values[row.key] = buildConfigValue(row);
    }
    this.snapshots.set(namespace, {
      namespace,
      version: Date.now().toString(),
      updated_at: { seconds: Math.floor(Date.now() / 1000) },
      values,
      update_type: 2, // DELTA
      changed_keys: Object.keys(values),
    });
  }

  private broadcastToSubscribers(namespace: string, updateType: string) {
    const snap = this.snapshots.get(namespace);
    if (!snap) return;
    let count = 0;
    for (const [id, sub] of this.subscribers) {
      if (sub.namespace === namespace) {
        try {
          sub.call.write(snap);
          count++;
        } catch (err) {
          log.warn('Failed to write to subscriber', { clientId: sub.clientId });
          this.subscribers.delete(id);
        }
      }
    }
    log.info(`Broadcast config update namespace=${namespace} subscribers=${count}`);
  }

  /**
   * WatchConfig — server-streaming RPC.
   * Sends initial SNAPSHOT immediately, then streams DELTA updates as config changes.
   * All services call this at startup and maintain the stream indefinitely.
   */
  watchConfig(call: any) {
    const req = call.request;
    const subId = `${req.namespace}:${req.client_id}:${Date.now()}`;

    log.info('New WatchConfig subscriber', { namespace: req.namespace, clientId: req.client_id });

    // Send initial snapshot immediately
    const snap = this.snapshots.get(req.namespace) ?? {
      namespace: req.namespace,
      version: '0',
      updated_at: { seconds: Math.floor(Date.now() / 1000) },
      values: {},
      update_type: 1,
      changed_keys: [],
    };
    call.write({ ...snap, update_type: 1 }); // SNAPSHOT

    // Register subscriber for future updates
    this.subscribers.set(subId, {
      namespace: req.namespace,
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
    const snap = this.snapshots.get(call.request.namespace);
    if (!snap) {
      callback(null, {
        namespace: call.request.namespace,
        version: '0',
        values: {},
        update_type: 1,
        changed_keys: [],
      });
      return;
    }
    callback(null, snap);
  }

  async setConfig(call: any, callback: any) {
    const { namespace, key, value, author, reason } = call.request;
    try {
      await this.pool.query(
        `INSERT INTO config.config_values (namespace, key, value_type, value_data, updated_by, update_reason)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (namespace, key) DO UPDATE
           SET value_data = EXCLUDED.value_data,
               updated_by = EXCLUDED.updated_by,
               update_reason = EXCLUDED.update_reason,
               updated_at = NOW()`,
        [namespace, key, inferValueType(value), JSON.stringify(value), author, reason]
      );
      // pg_notify triggers reloadNamespace + broadcast via LISTEN
      await this.pool.query(`SELECT pg_notify('config_changed', $1)`, [JSON.stringify({ namespace, key })]);
      const version = Date.now().toString();
      callback(null, { version, updated_at: { seconds: Math.floor(Date.now() / 1000) } });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }

  async listKeys(call: any, callback: any) {
    try {
      const result = await this.pool.query(
        'SELECT key, description, default_value, is_secret, consuming_service FROM config.config_values WHERE namespace = $1',
        [call.request.namespace]
      );
      callback(null, {
        keys: result.rows.map((r) => ({
          key: r.key,
          description: r.description ?? '',
          default_value: r.default_value ?? '',
          is_secret: r.is_secret,
          consuming_service: r.consuming_service ?? '',
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
