import { Pool } from 'pg';
import { getLogger } from '../services/logger';
import {
  ADMIN_SCOPE_ERROR,
  HEADER_INTERNAL_CALLER,
  MISSING_AUTHOR_ERROR,
  PER_USER_SCOPE_ERROR,
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

// Redaction sentinel stored in value_data for secret rows; must match the migration-017 seed.
const REDACTED = '[redacted]';

// Environment string values must match the DB CHECK constraint.
type EnvStr = 'staging' | 'production';

// Proto enum wire numbers → env string (fallback when a decoded request isn't the string constant).
// ENVIRONMENT_DEV(1) and ENVIRONMENT_STAGING(3) both map to 'staging'.
const ENV_MAP: Record<number, EnvStr> = { 0: 'staging', 1: 'staging', 2: 'production', 3: 'staging' };

// Accepts both snake_case and camelCase field shapes; values are already redacted by buildConfigValue.
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

  // snake_case ConfigValue fields → camelCase ts-proto; isSecret rides through so it's never displayed.
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
 * Accept both the ts-proto string constant and the numeric wire value — decode both or every
 * request silently collapses to the zero-value (scar).
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

// GLOBAL-snapshot cache key ("namespace:env"). Per-user overlays are resolved on demand, never cached.
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

// Scalar-float bounds, keyed on the FULL config key path (namespace.key), NOT the namespace-stripped
// DB `key` column — a bare `key` lookup would miss the registry and skip validation.
const SCALAR_BOUNDS_REGISTRY: Record<string, { minValue: number; maxValue: number }> = {
  'analysis.scoring.signal_decay_half_life_hours': { minValue: 0, maxValue: 8760 },
  // feature 177 FR-1: readiness cache staleness window. < 86400 (the 1d bar cadence) so a
  // served-stale readiness verdict can never outlive a new daily bar. 0 = always stale (min inclusive).
  'analysis.readiness.stale_after_seconds': { minValue: 0, maxValue: 86399 },
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
    // Only global rows (user_id IS NULL) populate the shared cache; per-user rows are overlaid on demand.
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
   * Effective values for a caller: the global snapshot overlaid with the caller's per-user rows.
   * Secrets are global-only (already redacted), so an overlay never carries plaintext. '' = global.
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
   * WatchConfig — server-streaming RPC: initial SNAPSHOT, then DELTA on each change. A user_id yields
   * the per-user overlay; empty user_id yields the global snapshot.
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
   * GetSecret — resolve a secret's decrypted plaintext, gated to allow-listed internal callers.
   * Distinguishes an unset secret (found=false) from a decrypt failure (INTERNAL); global-scope only.
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
    // Scope-aware write gate: GLOBAL needs admin scope OR internal-caller authority; PER-USER is
    // self-service (owner only) — an ADMIN bit grants no override for another user's row.
    const userId = requestUserId(call.request); // '' = global
    const userIdParam = userId === '' ? null : userId;
    const callerUserId = userIdFrom(call.metadata); // propagated x-user-id (edge-injected)

    if (userIdParam === null) {
      const rawValue = call.request?.value?.string_val ?? call.request?.value?.stringVal ?? '';
      const internalCallerAuthorized = hasInternalCallerAuthority(
        call.metadata,
        call.request?.namespace,
        call.request?.key,
        rawValue,
      );
      if (!hasAdminAccessScope(call.metadata) && !internalCallerAuthorized) {
        log.warn('SetConfig denied — global write without admin scope or internal-caller authority', {
          namespace: call.request?.namespace,
          key: call.request?.key,
        });
        callback(ADMIN_SCOPE_ERROR);
        return;
      }
    } else if (!callerUserId || callerUserId !== userId) {
      // Per-user write to a row the caller does not own — refused even for an admin.
      log.warn('SetConfig denied — per-user write must target the caller\'s own user_id', {
        namespace: call.request?.namespace,
        key: call.request?.key,
        target_user_id: userId,
        caller_user_id: callerUserId || null,
      });
      callback(PER_USER_SCOPE_ERROR);
      return;
    }
    const callerIdentity = first(call.metadata, HEADER_INTERNAL_CALLER) || null;

    const { namespace, key, value, reason } = call.request;
    const env = resolveEnv(call.request.environment);

    const author = call.request.author || userIdFrom(call.metadata);
    if (!author) {
      callback(MISSING_AUTHOR_ERROR);
      return;
    }

    // platform.trading_state is a closed 3-literal string enum.
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

    // Server-side scalar-float bounds — the authoritative gate. Parse via extractValueData (all oneof
    // shapes), NOT string-only: the agent writes float_val, and 0 is valid (no falsy-zero trap).
    const scalarBounds = SCALAR_BOUNDS_REGISTRY[`${namespace}.${key}`];
    if (scalarBounds) {
      const n = Number(extractValueData(value));
      if (Number.isNaN(n) || n < scalarBounds.minValue || n > scalarBounds.maxValue) {
        callback({
          code: 3, // INVALID_ARGUMENT
          message: `${namespace}.${key} must be a number in [${scalarBounds.minValue}, ${scalarBounds.maxValue}] (got: ${extractValueData(value)})`,
        });
        return;
      }
    }

    // Existence gate + row-authoritative is_secret: encryption is decided by the STORED flag, never
    // a request field, so a secret key can never land plaintext in value_data.
    const createKey = call.request.createKey ?? call.request.create_key ?? false;
    const existing = await this.pool.query(
      `SELECT is_secret FROM config.config_values
       WHERE namespace = $1 AND key = $2 AND environment = $3 AND COALESCE(user_id,'') = COALESCE($4,'') LIMIT 1`,
      [namespace, key, env, userIdParam]
    );

    // A first per-user override of an already-registered GLOBAL key is legitimate: when no exact per-user
    // row exists, fall back to the global (user_id IS NULL) row; create_key covers a key absent at BOTH.
    let globalRow: any = null;
    if (existing.rows.length === 0 && userIdParam !== null) {
      const globalExisting = await this.pool.query(
        `SELECT is_secret FROM config.config_values
         WHERE namespace = $1 AND key = $2 AND environment = $3 AND user_id IS NULL LIMIT 1`,
        [namespace, key, env]
      );
      globalRow = globalExisting.rows[0] ?? null;
    }

    const keyRegistered = existing.rows.length > 0 || globalRow !== null;
    if (!keyRegistered && !createKey) {
      callback({
        code: 5, // NOT_FOUND
        message: `config key not registered: ${namespace}.${key} (env=${env}, user=${userId || 'global'}); pass create_key=true to register it`,
      });
      return;
    }

    // Row-authoritative secret flag: exact-scope row wins, else the global row (so a per-user write to a
    // secret key still hits the global-only guard below), else the request flag on a genuine create.
    const requestIsSecret = (value?.is_secret ?? value?.isSecret) === true;
    const isSecret =
      existing.rows.length > 0
        ? existing.rows[0].is_secret === true
        : globalRow !== null
          ? globalRow.is_secret === true
          : requestIsSecret;

    // Secrets are global-scope only — reject a per-user secret write.
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
      // Global keys overlaid with the caller's per-user rows (per-user wins over global for the same key).
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
          // Index the registry with the FULL key path: the DB `key` column is namespace-stripped, so a
          // bare `r.key` lookup would miss the full-path registry key and skip validation.
          const scalarBounds = SCALAR_BOUNDS_REGISTRY[`${call.request.namespace}.${r.key}`];
          const secret = r.is_secret === true;
          return {
            key: r.key,
            description: r.description ?? '',
            defaultValue: r.default_value ?? '',
            // Secret rows never expose their value at this edge — redact defensively (value_data is already the sentinel).
            currentValue: secret ? REDACTED : (r.value_data ?? ''),
            isSecret: secret,
            consumingService: r.consuming_service ?? '',
            environment:
              r.environment === 'production'
                ? Environment.ENVIRONMENT_PRODUCTION
                : Environment.ENVIRONMENT_STAGING,
            validation: scalarBounds
              ? {
                  valueType: ValueType.VALUE_TYPE_FLOAT_SCALAR,
                  minValue: scalarBounds.minValue,
                  maxValue: scalarBounds.maxValue,
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
  // Redaction choke point: a secret row never yields its value here, so plaintext never enters the
  // broadcast cache or any snapshot. is_secret rides along; plaintext is resolved only via GetSecret.
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
