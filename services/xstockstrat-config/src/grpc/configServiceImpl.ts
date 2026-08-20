import { Pool } from 'pg';
import { getLogger } from '../services/logger';
import {
  ADMIN_SCOPE_ERROR,
  HEADER_INTERNAL_CALLER,
  MISSING_AUTHOR_ERROR,
  SECRET_SCOPE_ERROR,
  first,
  hasAdminAccessScope,
  hasInternalCallerAuthority,
  hasSecretCallerAuthority,
  userIdFrom,
} from './authz';
import { ConfigUpdateType, ValueType } from '@xstockstrat/proto/config/v1/config';
import { Environment } from '@xstockstrat/proto/common/v1/common';
import { decryptSecret, encryptSecret } from '../crypto';

const log = getLogger('config:impl');

// Redaction sentinel — the value_data stored for a secret row and the value served at every
// broadcast/read edge (feature 147). Secret plaintext lives only in value_encrypted and is served
// only via GetSecret. Kept in sync with the migration-017 seed sentinel.
const REDACTED = '[redacted]';

// Canonical environment string values matching the DB CHECK constraint (feature 147:
// dev/production -> staging/production). paper/live is derived from environment, not a config axis.
type EnvStr = 'staging' | 'production';

// Proto enum wire numbers (buf.gen.yaml stringEnums=true, so a decoded request usually carries the
// string constant; the numeric map is the fallback). ENVIRONMENT_DEV(1) is deprecated and treated
// as 'staging'; ENVIRONMENT_STAGING(3) is the new value.
const ENV_MAP: Record<number, EnvStr> = { 0: 'staging', 1: 'staging', 2: 'production', 3: 'staging' };

// Convert the internal snapshot representation to a ts-proto-compatible object that
// ConfigSnapshot.encode() can serialize correctly. Handles both legacy snake_case (update_type,
// changed_keys) and camelCase (updateType, changedKeys). Values are already redacted by
// buildConfigValue, so no plaintext secret can be present here.
function toProtoSnapPayload(snap: any, overrideUpdateType?: ConfigUpdateType): any {
  const env = snap.environment === 'production'
    ? Environment.ENVIRONMENT_PRODUCTION
    : Environment.ENVIRONMENT_STAGING;

  const rawType = snap.update_type ?? snap.updateType ?? 1;
  const updateType = overrideUpdateType ?? (
    rawType === 2 ? ConfigUpdateType.CONFIG_UPDATE_TYPE_DELTA :
    rawType === 3 ? ConfigUpdateType.CONFIG_UPDATE_TYPE_RELOAD :
    ConfigUpdateType.CONFIG_UPDATE_TYPE_SNAPSHOT
  );

  // Convert snake_case ConfigValue fields to the camelCase fields ts-proto encodes.
  // isSecret is carried through deliberately: it is how a consumer knows a value must not be
  // displayed. buildConfigValue already replaced any secret's value with the redaction sentinel.
  const values: Record<string, any> = {};
  for (const [k, v] of Object.entries(snap.values ?? {})) {
    const cv = v as any;
    const isSecret = (cv.is_secret ?? cv.isSecret) === true;
    if (cv.string_val !== undefined) values[k] = { stringVal: cv.string_val, isSecret };
    else if (cv.int_val !== undefined) values[k] = { intVal: cv.int_val, isSecret };
    else if (cv.float_val !== undefined) values[k] = { floatVal: cv.float_val, isSecret };
    else if (cv.bool_val !== undefined) values[k] = { boolVal: cv.bool_val, isSecret };
    else values[k] = { ...cv, isSecret };
  }

  return {
    namespace: snap.namespace,
    version: snap.version,
    values,
    updateType,
    changedKeys: snap.changed_keys ?? snap.changedKeys ?? [],
    environment: env,
  };
}

/**
 * Resolve the request's environment scope. Accepts BOTH the ts-proto string constant
 * ('ENVIRONMENT_PRODUCTION') and the numeric wire value (feature 078 scar — decode both shapes or
 * every request silently collapses to a zero-value). ENVIRONMENT_DEV and ENVIRONMENT_STAGING both
 * map to the 'staging' DB scope (feature 147).
 */
function resolveEnv(v: number | string | undefined): EnvStr {
  if (typeof v === 'string') {
    return v === 'ENVIRONMENT_PRODUCTION' ? 'production' : 'staging';
  }
  return ENV_MAP[v ?? 0] ?? 'staging';
}

/** The user_id scope field as ts-proto delivers it (camelCase), falling back to snake_case. '' = global. */
function requestUserId(req: any): string {
  return (req?.userId ?? req?.user_id ?? '') as string;
}

// Snapshot cache key for the GLOBAL snapshot of a namespace/environment: "namespace:env".
// Per-user overlays are resolved on demand from the DB, never cached here.
function snapKey(ns: string, env: EnvStr): string {
  return `${ns}:${env}`;
}

interface Subscriber {
  namespace: string;
  environment: EnvStr;
  userId: string; // '' = global subscriber
  clientId: string;
  call: any;
  lastVersion: string;
}

// Known weight-map keys and their [min, max] bounds. Validation is keyed on the
// config key path (semantic type), not the DB `value_type` storage column.
const WEIGHT_KEY_REGISTRY: Record<string, { minValue: number; maxValue: number }> = {
  'analysis.signals.source_weights': { minValue: 0.0, maxValue: 1.0 },
};

export class ConfigServiceImpl {
  private subscribers: Map<string, Subscriber> = new Map();
  // snapKey → global snapshot (keyed by "namespace:env")
  private snapshots: Map<string, any> = new Map();

  constructor(private readonly pool: Pool) {}

  async initialize() {
    await this.reloadAll();
    const pgClient = await this.pool.connect();
    await pgClient.query('LISTEN config_changed');
    pgClient.on('notification', async (msg: any) => {
      if (!msg.payload) return;
      const { namespace, environment } = JSON.parse(msg.payload);
      const env = (environment ?? 'staging') as EnvStr;
      await this.reloadNamespace(namespace, env);
      await this.broadcastToSubscribers(namespace, env);
    });
    log.info('Config service initialised, listening for config_changed notifications');
  }

  private async reloadAll() {
    // Only global rows (user_id IS NULL) populate the shared snapshot cache; per-user overrides are
    // overlaid on demand at read/subscribe time.
    const result = await this.pool.query(
      `SELECT namespace, key, value_type, value_data, is_secret, description, default_value, environment
       FROM config.config_values
       WHERE user_id IS NULL`
    );
    const byKey: Record<string, any> = {};
    for (const row of result.rows) {
      const env = row.environment as EnvStr;
      const k = snapKey(row.namespace, env);
      if (!byKey[k]) byKey[k] = { namespace: row.namespace, environment: env, values: {} };
      byKey[k].values[row.key] = buildConfigValue(row);
    }
    for (const [k, entry] of Object.entries(byKey)) {
      this.snapshots.set(k, {
        namespace: entry.namespace,
        version: Date.now().toString(),
        updatedAt: new Date(),
        values: entry.values,
        updateType: 1, // SNAPSHOT
        changedKeys: [],
        environment: entry.environment,
      });
    }
  }

  private async reloadNamespace(namespace: string, env: EnvStr) {
    const result = await this.pool.query(
      `SELECT key, value_type, value_data, is_secret, description, default_value, environment
       FROM config.config_values
       WHERE namespace = $1 AND environment = $2 AND user_id IS NULL`,
      [namespace, env]
    );
    const values: Record<string, any> = {};
    for (const row of result.rows) {
      values[row.key] = buildConfigValue(row);
    }
    this.snapshots.set(snapKey(namespace, env), {
      namespace,
      version: Date.now().toString(),
      updatedAt: new Date(),
      values,
      updateType: 2, // DELTA
      changedKeys: Object.keys(values),
      environment: env,
    });
  }

  /**
   * Build the effective values map for a caller: the global snapshot overlaid with the caller's
   * per-user rows (feature 147, FR-9). Secrets are global-scope only and already redacted by
   * buildConfigValue, so a per-user overlay never carries secret plaintext (AC-14). Returns a plain
   * values map suitable for toProtoSnapPayload. userId '' returns the global snapshot values as-is.
   */
  private async resolveOverlayValues(namespace: string, env: EnvStr, userId: string): Promise<Record<string, any>> {
    const global = this.snapshots.get(snapKey(namespace, env));
    const base: Record<string, any> = { ...(global?.values ?? {}) };
    if (!userId) return base;
    const result = await this.pool.query(
      `SELECT key, value_type, value_data, is_secret, description, default_value, environment
       FROM config.config_values
       WHERE namespace = $1 AND environment = $2 AND user_id = $3`,
      [namespace, env, userId]
    );
    for (const row of result.rows) {
      base[row.key] = buildConfigValue(row);
    }
    return base;
  }

  private async snapshotForSubscriber(sub: Subscriber, updateType: ConfigUpdateType): Promise<any> {
    const global = this.snapshots.get(snapKey(sub.namespace, sub.environment));
    const values = await this.resolveOverlayValues(sub.namespace, sub.environment, sub.userId);
    return toProtoSnapPayload(
      {
        namespace: sub.namespace,
        version: global?.version ?? '0',
        values,
        changedKeys: Object.keys(values),
        environment: sub.environment,
      },
      updateType,
    );
  }

  private async broadcastToSubscribers(namespace: string, env: EnvStr) {
    let count = 0;
    for (const [id, sub] of this.subscribers) {
      if (sub.namespace !== namespace || sub.environment !== env) continue;
      try {
        const payload = await this.snapshotForSubscriber(sub, ConfigUpdateType.CONFIG_UPDATE_TYPE_DELTA);
        sub.call.write(payload);
        count++;
      } catch (err) {
        log.warn('Failed to write to subscriber', { clientId: sub.clientId });
        this.subscribers.delete(id);
      }
    }
    log.info(`Broadcast config update namespace=${namespace} env=${env} subscribers=${count}`);
  }

  /**
   * WatchConfig — server-streaming RPC.
   * Sends initial SNAPSHOT immediately, then streams DELTA updates as config changes.
   * A request may carry user_id to receive the per-user overlay (global overlaid with the user's
   * own values); an empty user_id yields the global snapshot (the common case for services).
   */
  watchConfig(call: any) {
    const req = call.request;
    const env = resolveEnv(req.environment);
    const userId = requestUserId(req);
    const subId = `${req.namespace}:${env}:${userId}:${req.client_id}:${Date.now()}`;

    log.info('New WatchConfig subscriber', { namespace: req.namespace, clientId: req.client_id, env, userId });

    call.on('cancelled', () => {
      log.info('Subscriber disconnected', { subId });
      this.subscribers.delete(subId);
    });
    call.on('error', () => {
      this.subscribers.delete(subId);
    });

    const sub: Subscriber = {
      namespace: req.namespace,
      environment: env,
      userId,
      clientId: req.client_id,
      call,
      lastVersion: '0',
    };

    this.snapshotForSubscriber(sub, ConfigUpdateType.CONFIG_UPDATE_TYPE_SNAPSHOT)
      .then((payload) => {
        call.write(payload);
        this.subscribers.set(subId, sub);
      })
      .catch((err) => {
        log.warn('Failed to send initial snapshot', { subId, error: err?.message });
      });
  }

  async getConfig(call: any, callback: any) {
    const env = resolveEnv(call.request.environment);
    const userId = requestUserId(call.request);
    const namespace = call.request.namespace;
    const values = await this.resolveOverlayValues(namespace, env, userId);
    const global = this.snapshots.get(snapKey(namespace, env));
    callback(null, toProtoSnapPayload({
      namespace,
      version: global?.version ?? '0',
      values,
      changedKeys: [],
      environment: env,
    }));
  }

  /**
   * GetSecret — resolve a secret's decrypted plaintext (feature 147). Gated to allow-listed
   * internal callers (x-internal-caller). Distinguishes an unset secret (row absent OR ciphertext
   * NULL → found=false) from a decrypt failure (INTERNAL, never a partial value). Secrets are
   * global-scope only, so this reads the user_id IS NULL row.
   */
  async getSecret(call: any, callback: any) {
    const { namespace, key } = call.request;
    if (!hasSecretCallerAuthority(call.metadata, namespace, key)) {
      log.warn('GetSecret denied — caller not on the secret allow-list', { namespace, key });
      callback(SECRET_SCOPE_ERROR);
      return;
    }
    const env = resolveEnv(call.request.environment);
    try {
      const result = await this.pool.query(
        `SELECT value_encrypted FROM config.config_values
         WHERE namespace = $1 AND key = $2 AND environment = $3 AND user_id IS NULL LIMIT 1`,
        [namespace, key, env]
      );
      const ciphertext: Buffer | null = result.rows[0]?.value_encrypted ?? null;
      if (!ciphertext || ciphertext.length === 0) {
        // Unset secret (never written, or seeded with NULL ciphertext).
        callback(null, { value: '', found: false });
        return;
      }
      let plaintext: string;
      try {
        plaintext = decryptSecret(ciphertext);
      } catch (err: any) {
        // A decrypt failure (wrong master key / corruption) must NOT masquerade as "unset".
        log.error('GetSecret decrypt failed', { namespace, key, env });
        callback({ code: 13 /* INTERNAL */, message: 'secret decrypt failed' });
        return;
      }
      callback(null, { value: plaintext, found: true });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }

  async setConfig(call: any, callback: any) {
    // Admin gate FIRST (feature 074/102) — an admin write OR an internal-caller-authorized write.
    const rawValue = call.request?.value?.string_val ?? call.request?.value?.stringVal ?? '';
    const internalCallerAuthorized = hasInternalCallerAuthority(
      call.metadata,
      call.request?.namespace,
      call.request?.key,
      rawValue,
    );
    if (!hasAdminAccessScope(call.metadata) && !internalCallerAuthorized) {
      log.warn('SetConfig denied — caller lacks admin scope and internal-caller authority', {
        namespace: call.request?.namespace,
        key: call.request?.key,
      });
      callback(ADMIN_SCOPE_ERROR);
      return;
    }
    const callerIdentity = first(call.metadata, HEADER_INTERNAL_CALLER) || null;

    const { namespace, key, value, reason } = call.request;
    const env = resolveEnv(call.request.environment);
    const userId = requestUserId(call.request); // '' = global
    const userIdParam = userId === '' ? null : userId;

    const author = call.request.author || userIdFrom(call.metadata);
    if (!author) {
      callback(MISSING_AUTHOR_ERROR);
      return;
    }

    // Feature 100: platform.trading_state is a closed 3-literal string enum.
    if (namespace === 'platform' && key === 'trading_state') {
      const raw = value?.string_val ?? value?.stringVal ?? '';
      const ALLOWED = ['ACTIVE', 'REDUCE_ONLY', 'HALTED'];
      if (!ALLOWED.includes(raw)) {
        callback({
          code: 3, // INVALID_ARGUMENT
          message: `platform.trading_state must be one of ${ALLOWED.join(', ')} (got: ${JSON.stringify(raw)})`,
        });
        return;
      }
    }

    // Feature 091 existence gate + feature 147 row-authoritative is_secret: read the exact-scope
    // row's is_secret so encryption is decided by the STORED flag, never a request field (a request
    // that omitted is_secret on a secret key must still encrypt — never land plaintext in value_data).
    const createKey = call.request.createKey ?? call.request.create_key ?? false;
    const existing = await this.pool.query(
      `SELECT is_secret FROM config.config_values
       WHERE namespace = $1 AND key = $2 AND environment = $3 AND COALESCE(user_id,'') = COALESCE($4,'') LIMIT 1`,
      [namespace, key, env, userIdParam]
    );
    if (existing.rows.length === 0 && !createKey) {
      callback({
        code: 5, // NOT_FOUND
        message: `config key not registered: ${namespace}.${key} (env=${env}, user=${userId || 'global'}); pass create_key=true to register it`,
      });
      return;
    }

    // Row-authoritative secret flag: existing row's flag wins; on create, honor the request flag.
    const requestIsSecret = (value?.is_secret ?? value?.isSecret) === true;
    const isSecret = existing.rows.length > 0 ? existing.rows[0].is_secret === true : requestIsSecret;

    // Secrets are global-scope only (feature 147). Reject a per-user secret write.
    if (isSecret && userIdParam !== null) {
      callback({ code: 3, message: 'secret keys are global-scope only; per-user secret overrides are not supported' });
      return;
    }

    const plaintext = extractValueData(value);
    let valueData: string;
    let valueEncrypted: Buffer | null;
    if (isSecret) {
      try {
        valueEncrypted = encryptSecret(plaintext);
      } catch (err: any) {
        callback({ code: 13, message: `secret encryption failed: ${err.message}` });
        return;
      }
      valueData = REDACTED; // the sentinel is what audit + every read edge sees
    } else {
      valueData = plaintext;
      valueEncrypted = null;
    }

    try {
      await this.pool.query(
        `INSERT INTO config.config_values
           (namespace, key, value_type, value_data, value_encrypted, is_secret, updated_by, update_reason, environment, user_id, caller_identity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO UPDATE
           SET value_data = EXCLUDED.value_data,
               value_encrypted = EXCLUDED.value_encrypted,
               is_secret = EXCLUDED.is_secret,
               updated_by = EXCLUDED.updated_by,
               update_reason = EXCLUDED.update_reason,
               caller_identity = EXCLUDED.caller_identity,
               updated_at = NOW()`,
        [namespace, key, inferValueType(value), valueData, valueEncrypted, isSecret, author, reason, env, userIdParam, callerIdentity]
      );
      await this.pool.query(`SELECT pg_notify('config_changed', $1)`, [
        JSON.stringify({ namespace, key, environment: env, user_id: userId || null }),
      ]);
      const version = Date.now().toString();
      callback(null, { version, updatedAt: new Date() });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }

  async listKeys(call: any, callback: any) {
    const env = resolveEnv(call.request.environment);
    const userId = requestUserId(call.request);
    try {
      // Global keys, overlaid with the caller's per-user rows when user_id is set (per-user row
      // wins over the global row for the same key).
      const result = await this.pool.query(
        `SELECT DISTINCT ON (key)
                key, description, default_value, value_data, is_secret, consuming_service, environment
         FROM config.config_values
         WHERE namespace = $1 AND environment = $2 AND (user_id IS NULL OR user_id = $3)
         ORDER BY key, (user_id = $3) DESC NULLS LAST`,
        [call.request.namespace, env, userId]
      );
      callback(null, {
        keys: result.rows.map((r) => {
          const weightBounds = WEIGHT_KEY_REGISTRY[r.key];
          const secret = r.is_secret === true;
          return {
            key: r.key,
            description: r.description ?? '',
            defaultValue: r.default_value ?? '',
            // Secret rows never expose their value at this edge — the sentinel, not value_data
            // (which is already the sentinel, but redact defensively).
            currentValue: secret ? REDACTED : (r.value_data ?? ''),
            isSecret: secret,
            consumingService: r.consuming_service ?? '',
            environment:
              r.environment === 'production'
                ? Environment.ENVIRONMENT_PRODUCTION
                : Environment.ENVIRONMENT_STAGING,
            validation: weightBounds
              ? {
                  valueType: ValueType.VALUE_TYPE_FLOAT_MAP,
                  minValue: weightBounds.minValue,
                  maxValue: weightBounds.maxValue,
                }
              : undefined,
          };
        }),
      });
    } catch (err: any) {
      callback({ code: 13, message: err.message });
    }
  }
}

function buildConfigValue(row: any): any {
  // Redaction choke point (feature 147): a secret row never yields its value here, so plaintext
  // never enters the in-memory broadcast cache or any snapshot. is_secret rides along so consumers
  // know the value must not be displayed and must be resolved via GetSecret.
  const secret = row.is_secret === true;
  if (secret) {
    return { string_val: REDACTED, is_secret: true };
  }
  switch (row.value_type) {
    case 'int':     return { int_val: parseInt(row.value_data, 10), is_secret: false };
    case 'float':   return { float_val: parseFloat(row.value_data), is_secret: false };
    case 'bool':    return { bool_val: row.value_data === 'true', is_secret: false };
    case 'string':
    default:        return { string_val: row.value_data, is_secret: false };
  }
}

/**
 * Classify an inbound ConfigValue. ts-proto delivers camelCase fields over the wire; accept both
 * camelCase and snake_case so a write is typed correctly whichever shape the caller used.
 */
function inferValueType(v: any): string {
  if (v == null) return 'string';
  if (v.string_val !== undefined || v.stringVal !== undefined) return 'string';
  if (v.int_val !== undefined || v.intVal !== undefined) return 'int';
  if (v.float_val !== undefined || v.floatVal !== undefined) return 'float';
  if (v.bool_val !== undefined || v.boolVal !== undefined) return 'bool';
  if (v.json_val !== undefined || v.jsonVal !== undefined) return 'json';
  return 'string';
}

/**
 * Extract the bare scalar a ConfigValue carries, for storage in config_values.value_data (or, for
 * a secret, for encryption into value_encrypted before value_data is overwritten with the sentinel).
 */
function extractValueData(v: any): string {
  if (v == null) return '';
  const scalar =
    v.string_val ?? v.stringVal ??
    v.int_val ?? v.intVal ??
    v.float_val ?? v.floatVal ??
    v.bool_val ?? v.boolVal;
  if (scalar !== undefined && scalar !== null) return String(scalar);
  const json = v.json_val ?? v.jsonVal;
  if (json !== undefined && json !== null) return JSON.stringify(json);
  return '';
}
