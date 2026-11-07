import { createHash, randomUUID } from 'crypto';
import { Pool, PoolClient } from 'pg';
import { getLogger } from '../services/logger';
import {
  ADMIN_SCOPE_ERROR,
  HEADER_INTERNAL_CALLER,
  MISSING_AUTHOR_ERROR,
  PER_USER_SCOPE_ERROR,
  SECRET_SCOPE_ERROR,
  altSpelling,
  boundReadUserId,
  canonical,
  first,
  hasAdminAccessScope,
  hasInternalCallerAuthority,
  hasPeerDnsSan,
  hasSecretCallerAuthority,
  secretDenialReason,
  userIdFrom,
} from './authz';
import {
  recordListenerReconnect,
  recordWatchTerminated,
  setLastReloadTimestamp,
  setListenerUp,
} from '../telemetry';
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
  pending: boolean;
  missedDelta: boolean;
  traceId?: string;
  lastVersion?: string;
  lastPayload?: any;
  backpressured?: boolean;
}

// Scalar numeric bounds, keyed on the FULL config key path (`${namespace}.${canonical key}`), so either
// stored spelling resolves. Enforced write-side only (rejects out-of-range SetConfig).
const SCALAR_BOUNDS_REGISTRY: Record<string, { minValue: number; maxValue: number }> = {
  'analysis.scoring.signal_decay_half_life_hours': { minValue: 0, maxValue: 8760 },
  // feature 177 FR-1: readiness cache staleness window. < 86400 (the 1d bar cadence) so a
  // served-stale readiness verdict can never outlive a new daily bar. 0 = always stale (min inclusive).
  'analysis.readiness.stale_after_seconds': { minValue: 0, maxValue: 86399 },
  // feature 182: readiness materializer tuning keys, operator-editable in config-ui once seeded
  // (migration 027). Bounds are the write-edge guardrail for those newly-exposed keys.
  'analysis.readiness_materializer.refresh_hour_utc': { minValue: 0, maxValue: 23 },
  'analysis.readiness_materializer.valid_window_hours': { minValue: 1, maxValue: 168 },
  // Ceiling tracks marketdata's PgBouncer pool size (root CLAUDE.md § Connection Pool Budget): an
  // operator raising this above what marketdata can execute re-opens the feature-141 SEV-2 (TimescaleDB
  // "out of shared memory"). min 1 — a Python reader clamps ≤ 0 to the default, so 0 is never "unlimited".
  'analysis.readiness_materializer.max_concurrent_bars_fetches': { minValue: 1, maxValue: 5 },
  // feature 184: opportunity-queue tuning keys, operator-editable in config-ui once seeded
  // (migration 028). Write-edge-only guardrails on the numeric footguns; the 5 cadence/TTL/snooze
  // keys are seeded unbounded. Lower 0 where 0 is a legitimate value (refresh_hour_utc = midnight,
  // signal_rank_weight); lower 1 where the Python reader clamps ≤ 0 to the default.
  // max_concurrent_bars_fetches ceiling = marketdata PgBouncer pool.
  'analysis.opportunity.refresh_hour_utc': { minValue: 0, maxValue: 23 },
  'analysis.opportunity.max_concurrent_bars_fetches': { minValue: 1, maxValue: 5 },
  'analysis.opportunity.signal_rank_weight': { minValue: 0, maxValue: 1 },
  'analysis.opportunity.max_universe_size': { minValue: 1, maxValue: 1000 },
  'analysis.opportunity.max_live_strategies_per_symbol': { minValue: 1, maxValue: 50 },
  'analysis.opportunity.max_live_only_symbols_per_compute': { minValue: 1, maxValue: 500 },
  'analysis.opportunity.max_live_held_symbols_per_compute': { minValue: 1, maxValue: 500 },
  'analysis.opportunity.max_concurrent_candidates': { minValue: 1, maxValue: 50 },
  'analysis.opportunity.sparkline_bars': { minValue: 1, maxValue: 500 },
  'analysis.opportunity.valid_window_hours': { minValue: 1, maxValue: 168 },
  // feature 227: ceilings keep analysis B+3.05+E < 30s (the BFF deadline); the agent floor of 30
  // sits above analysis's own 27.05s worst case.
  'analysis.opportunity.read_db_budget_ms': { minValue: 1000, maxValue: 20000 },
  'analysis.opportunity.live_enrich_timeout_ms': { minValue: 500, maxValue: 4000 },
  'marketdata.price.batch_timeout_ms': { minValue: 500, maxValue: 2500 },
  'agent.opportunities.read_timeout_seconds': { minValue: 30, maxValue: 55 },
  // feature 229: retention floor (31d) must stay above the lookback ceiling (720h); the portfolio quote
  // deadline (default 4000) must exceed max(batch, mark) budget plus the warm read.
  'portfolio.marketdata.quote_timeout_ms': { minValue: 500, maxValue: 8000 },
  'marketdata.quotes.latest_lookback_hours': { minValue: 24, maxValue: 720 },
  'marketdata.quotes.batch_timeout_ms': { minValue: 500, maxValue: 5000 },
  'marketdata.retention.quotes_days': { minValue: 31, maxValue: 3650 },
  // feature 231: mark ceiling = batch_timeout default, so it never extends the cold-path worst case; the 120h
  // floor still covers Friday's 00:00-ET-stamped 1d bar on a holiday Monday evening.
  'marketdata.quotes.mark_timeout_ms': { minValue: 100, maxValue: 2500 },
  'marketdata.quotes.mark_close_max_age_hours': { minValue: 120, maxValue: 720 },
  // feature 240: FR-5 last-close search window for offline marks (default 21 days).
  'portfolio.marketdata.last_close_lookback_days': { minValue: 5, maxValue: 60 },
  // feature 281: mirrors the portfolio reader clamp (60..86400), so no writable value is silently re-clamped.
  'portfolio.watchlist.signal_prune_interval_seconds': { minValue: 60, maxValue: 86400 },
  // feature 282: 24h ceiling stays below marketdata's 48h minIngestLookback; the servability timeout
  // floor/ceiling keeps the check cheap relative to the 4000ms portfolio quote deadline.
  'marketdata.assets.refresh_interval_hours': { minValue: 1, maxValue: 24 },
  'portfolio.marketdata.servability_timeout_ms': { minValue: 500, maxValue: 4000 },
  // feature 282: ceiling = marketdata GetSymbolServability's 1000-symbol request bound, so a within-cap
  // watchlist request can never exceed it and silently fail open.
  'portfolio.watchlist.max_symbols_per_list': { minValue: 1, maxValue: 1000 },
  // feature 295: the agent derives its test_formula deadline from timeout + grace; these ceilings cap it at 45s.
  'indicators.sandbox.timeout_ms': { minValue: 100, maxValue: 33000 },
  'indicators.sandbox.startup_grace_ms': { minValue: 1000, maxValue: 10000 },
  'analysis.compute.max_worker_threads': { minValue: 1, maxValue: 16 },
};

function lookupScalarBounds(namespace: string, key: string) {
  return SCALAR_BOUNDS_REGISTRY[`${namespace}.${canonical(namespace, key)}`];
}

// Code constants, not config keys: config cannot watch its own keys.
const LISTENER_BACKOFF_INITIAL_MS = 1000;
const LISTENER_BACKOFF_MAX_MS = 30000;
const LIVENESS_TICK_MS = 10000;
const HEARTBEAT_DEADLINE_MS = 30000;
const CHAIN_STALL_MS = 30000;
const BACKSTOP_INTERVAL_MS = 300000;

// Evaluates to false until migration 040 has run and feature 296 writes the marker row.
const MARKER_ACTIVE_SQL = `CASE WHEN to_regclass('config.config_markers') IS NULL THEN false
         ELSE EXISTS(SELECT 1 FROM config.config_markers WHERE name = 'relative_keys_v1') END AS marker_active`;

const updatedAtString = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? ''));

/** First 16 hex chars of sha256 over the emitted values; secret rows add only their updated_at. */
function contentVersion(values: Record<string, any>, secretUpdatedAts: Record<string, string>): string {
  const h = createHash('sha256');
  for (const k of Object.keys(values).sort()) {
    h.update(JSON.stringify([k, values[k], values[k]?.is_secret === true]) + '\n');
  }
  for (const k of Object.keys(secretUpdatedAts).sort()) {
    h.update(JSON.stringify(['secret_updated_at', k, secretUpdatedAts[k]]) + '\n');
  }
  return h.digest('hex').slice(0, 16);
}

/** Adds each key's alternate spelling (a stored spelling always wins); only while relative_keys_v1 is set. */
function withLegacyAliases(values: Record<string, any>, namespace: string): Record<string, any> {
  const out: Record<string, any> = { ...values };
  for (const [k, v] of Object.entries(values)) {
    const alt = altSpelling(namespace, k);
    if (!(alt in out)) out[alt] = v;
  }
  return out;
}

// Header-supplied ids (and the trading-state target) are truncated in every log that carries them.
const LOG_ID_MAX = 64;
function truncateForLog(raw: string): string {
  return raw.slice(0, LOG_ID_MAX);
}

export class ConfigServiceImpl {
  private subscribers: Map<string, Subscriber> = new Map();
  // snapKey → global snapshot (keyed by "namespace:env")
  private snapshots: Map<string, any> = new Map();
  private listener: PoolClient | null = null;
  private connectedOnce = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoffMs = LISTENER_BACKOFF_INITIAL_MS;
  // Serializes reloads and notification work so a stale reloadAll cannot overwrite a newer reloadNamespace.
  private chain: Promise<void> = Promise.resolve();
  private queued = 0;
  private headStartedAt: number | null = null;
  private chainStalled = false;
  // Heartbeat tokens carry this prefix: another config instance's beats on the shared channel never count.
  private readonly instanceId = randomUUID();
  private beatSeq = 0;
  private beatInFlight = false;
  private lastBeatAt = 0;

  constructor(private readonly pool: Pool) {}

  async initialize() {
    await this.connectListener();
    setInterval(() => this.livenessTick(), LIVENESS_TICK_MS).unref?.();
    setInterval(() => this.backstop(), BACKSTOP_INTERVAL_MS).unref?.();
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    this.queued++;
    const run = this.chain.then(() => {
      this.headStartedAt = Date.now();
      return fn();
    });
    const settle = () => {
      this.headStartedAt = null;
      if (--this.queued === 0) this.chainStalled = false;
    };
    this.chain = run.then(settle, settle);
    return run;
  }

  // The heartbeat must use the listener socket, never a pool slot (F-06).
  private livenessTick() {
    try {
      const now = Date.now();
      const c = this.listener;
      if (c && now - this.lastBeatAt > HEARTBEAT_DEADLINE_MS) {
        this.dropListener(c, new Error('change feed heartbeat missed'));
      } else if (c && !this.beatInFlight) {
        this.beatInFlight = true;
        const token = `${this.instanceId}:${++this.beatSeq}`;
        c.query("SELECT pg_notify('config_heartbeat',$1)", [token])
          .catch((err: any) => log.warn('config heartbeat send failed', { error: err?.message }))
          .finally(() => {
            if (this.listener === c) this.beatInFlight = false;
          });
      }
      if (this.headStartedAt !== null && now - this.headStartedAt > CHAIN_STALL_MS && !this.chainStalled) {
        this.chainStalled = true;
        log.error('config serial chain stalled', { headAgeMs: now - this.headStartedAt, queued: this.queued });
      }
      if (!this.chainStalled) this.resendLastPayloads();
    } catch (err: any) {
      log.warn('config liveness tick failed', { error: err?.message });
    }
  }

  private resendLastPayloads() {
    let count = 0;
    for (const [id, sub] of this.subscribers) {
      if (sub.pending || sub.backpressured || !sub.lastPayload) continue;
      try {
        this.writeTo(sub, { ...sub.lastPayload, updateType: ConfigUpdateType.CONFIG_UPDATE_TYPE_DELTA });
        count++;
      } catch (err) {
        this.endSubscriber(id, sub, err);
      }
    }
    log.debug(`Re-sent last config payload subscribers=${count}`);
  }

  private backstop() {
    this.serial(async () => {
      const before = new Map<string, string | undefined>();
      for (const [k, snap] of this.snapshots) before.set(k, snap.version);
      await this.reloadAll();
      const pairs = new Map<string, { ns: string; env: EnvStr; perUser: boolean }>();
      for (const sub of this.subscribers.values()) {
        const k = snapKey(sub.namespace, sub.environment);
        const p = pairs.get(k) ?? { ns: sub.namespace, env: sub.environment, perUser: false };
        p.perUser ||= sub.userId !== '';
        pairs.set(k, p);
      }
      for (const [k, { ns, env, perUser }] of pairs) {
        if (perUser || before.get(k) !== this.snapshots.get(k)?.version) {
          await this.broadcastToSubscribers(ns, env, { skipUnchanged: true });
        }
      }
    }).catch((err) => log.error('config backstop reload failed', { error: err?.message }));
  }

  private writeTo(sub: Subscriber, payload: any) {
    const ok = sub.call.write(payload);
    sub.lastPayload = payload;
    sub.lastVersion = payload.version;
    if (ok === false && !sub.backpressured) {
      sub.backpressured = true;
      sub.call.once?.('drain', () => {
        sub.backpressured = false;
      });
    }
  }

  private async connectListener(): Promise<void> {
    let c: PoolClient | undefined;
    try {
      c = await this.pool.connect();
      const client = c;
      client.on('error', (e: Error) => this.dropListener(client, e));
      client.on('end', () => this.dropListener(client, new Error('LISTEN connection ended')));
      client.on('notification', (msg: { channel?: string; payload?: string }) => this.onNotification(client, msg));
      this.listener = client;
      this.lastBeatAt = Date.now();
      this.beatInFlight = false;
      // LISTEN before the reload, so a change committed during the reload is not lost.
      await client.query('LISTEN config_changed');
      await client.query('LISTEN config_heartbeat');
      const reconnected = this.connectedOnce;
      await this.serial(() => (this.connectedOnce ? this.resyncAll() : this.reloadAll()));
      this.connectedOnce = true;
      this.backoffMs = LISTENER_BACKOFF_INITIAL_MS;
      // A client that errored mid-reload was already dropped; never report it as up.
      if (this.listener === client) {
        setListenerUp(true);
        if (reconnected) recordListenerReconnect();
      }
      log.info('Config service initialised, listening for config_changed notifications', {
        reconnected,
      });
    } catch (err: any) {
      if (c) this.dropListener(c, err);
      else if (this.connectedOnce) this.scheduleReconnect();
      if (!this.connectedOnce) throw err;
    }
  }

  private dropListener(c: PoolClient, err: Error) {
    if (this.listener !== c) return;
    setListenerUp(false);
    this.listener = null;
    c.removeAllListeners('notification');
    try {
      c.release(err);
    } catch {
      /* already released */
    }
    log.error('config LISTEN connection lost', { error: err.message });
    if (this.connectedOnce) this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, LISTENER_BACKOFF_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectListener().catch(() => {
        /* every failure path reschedules itself */
      });
    }, delay);
  }

  private async resyncAll() {
    await this.reloadAll();
    const pairs = new Map<string, { ns: string; env: EnvStr }>();
    for (const sub of this.subscribers.values()) {
      pairs.set(snapKey(sub.namespace, sub.environment), { ns: sub.namespace, env: sub.environment });
    }
    for (const { ns, env } of pairs.values()) {
      await this.broadcastToSubscribers(ns, env);
    }
  }

  private onNotification(c: PoolClient, msg: { channel?: string; payload?: string }) {
    if (this.listener !== c || !msg.payload) return;
    if (msg.channel === 'config_heartbeat') {
      if (msg.payload.startsWith(`${this.instanceId}:`)) this.lastBeatAt = Date.now();
      return;
    }
    let parsed: any;
    try {
      parsed = JSON.parse(msg.payload);
    } catch {
      return; /* malformed payload */
    }
    if (parsed !== null && typeof parsed === 'object' && 'marker' in parsed) {
      this.serial(() => this.resyncAll()).catch((err) =>
        log.error('config marker resync failed', { error: err?.message }),
      );
      return;
    }
    const { namespace, environment } = (parsed ?? {}) as { namespace?: unknown; environment?: unknown };
    if (typeof namespace !== 'string' || !namespace) return; /* payload without a namespace */
    const ns = namespace;
    const env = (environment ?? 'staging') as EnvStr;
    this.serial(async () => {
      await this.reloadNamespace(ns, env);
      await this.broadcastToSubscribers(ns, env, { skipUnchanged: true });
    }).catch((err) => log.error('config_changed handling failed', { namespace: ns, env, error: err?.message }));
  }

  private async reloadAll() {
    // Only global rows (user_id IS NULL) populate the shared cache; per-user rows are overlaid on demand.
    const result = await this.pool.query(
      `SELECT namespace, key, value_type, value_data, is_secret, description, default_value, environment, updated_at,
       ${MARKER_ACTIVE_SQL}
       FROM config.config_values
       WHERE user_id IS NULL`
    );
    const byKey: Record<string, any> = {};
    for (const row of result.rows) {
      const env = row.environment as EnvStr;
      const k = snapKey(row.namespace, env);
      if (!byKey[k]) byKey[k] = { namespace: row.namespace, environment: env, rows: [] };
      byKey[k].rows.push(row);
    }
    for (const [k, entry] of Object.entries(byKey)) {
      this.snapshots.set(k, buildGlobalSnapshot(entry.namespace, entry.environment, entry.rows, 1 /* SNAPSHOT */));
    }
    setLastReloadTimestamp(Date.now());
  }

  private async reloadNamespace(namespace: string, env: EnvStr) {
    const result = await this.pool.query(
      `SELECT key, value_type, value_data, is_secret, description, default_value, environment, updated_at,
       ${MARKER_ACTIVE_SQL}
       FROM config.config_values
       WHERE namespace = $1 AND environment = $2 AND user_id IS NULL`,
      [namespace, env]
    );
    this.snapshots.set(snapKey(namespace, env), buildGlobalSnapshot(namespace, env, result.rows, 2 /* DELTA */));
    setLastReloadTimestamp(Date.now());
  }

  /**
   * Effective values for a caller: the global snapshot overlaid with the caller's per-user rows.
   * Per-user secret rows pass through buildConfigValue, so an overlay never carries plaintext. '' = global.
   */
  private async resolveOverlayValues(
    namespace: string,
    env: EnvStr,
    userId: string,
  ): Promise<{ values: Record<string, any>; version: string }> {
    const global = this.snapshots.get(snapKey(namespace, env));
    const base: Record<string, any> = { ...(global?.values ?? {}) };
    const secretUpdatedAts: Record<string, string> = { ...(global?.secretUpdatedAts ?? {}) };
    let markerActive = global?.markerActive === true;
    if (userId) {
      const result = await this.pool.query(
        `SELECT key, value_type, value_data, is_secret, description, default_value, environment, updated_at,
         ${MARKER_ACTIVE_SQL}
         FROM config.config_values
         WHERE namespace = $1 AND environment = $2 AND user_id = $3`,
        [namespace, env, userId]
      );
      for (const row of result.rows) {
        base[row.key] = buildConfigValue(row);
        if (row.is_secret === true) secretUpdatedAts[row.key] = updatedAtString(row.updated_at);
        else delete secretUpdatedAts[row.key];
        markerActive ||= row.marker_active === true;
      }
    }
    const values = markerActive ? withLegacyAliases(base, namespace) : base;
    return { values, version: contentVersion(values, secretUpdatedAts) };
  }

  private async snapshotForSubscriber(sub: Subscriber, updateType: ConfigUpdateType): Promise<any> {
    const { values, version } = await this.resolveOverlayValues(sub.namespace, sub.environment, sub.userId);
    return toProtoSnapPayload(
      {
        namespace: sub.namespace,
        version,
        values,
        changedKeys: Object.keys(values),
        environment: sub.environment,
      },
      updateType,
    );
  }

  // Only NOTIFY and backstop broadcasts set skipUnchanged; a reconnect resync and direct calls always deliver.
  private async broadcastToSubscribers(namespace: string, env: EnvStr, opts: { skipUnchanged?: boolean } = {}) {
    let count = 0;
    for (const [id, sub] of this.subscribers) {
      if (sub.namespace !== namespace || sub.environment !== env) continue;
      if (sub.pending) {
        sub.missedDelta = true;
        continue;
      }
      try {
        const payload = await this.snapshotForSubscriber(sub, ConfigUpdateType.CONFIG_UPDATE_TYPE_DELTA);
        if (opts.skipUnchanged && payload.version === sub.lastVersion) continue;
        this.writeTo(sub, payload);
        count++;
      } catch (err) {
        this.endSubscriber(id, sub, err);
      }
    }
    log.info(`Broadcast config update namespace=${namespace} env=${env} subscribers=${count}`);
  }

  // Ends only the registration it was given; a replaced or cancelled subscriber is left alone.
  private endSubscriber(id: string, sub: Subscriber, err: any) {
    if (this.subscribers.get(id) !== sub) return;
    this.subscribers.delete(id);
    recordWatchTerminated('server_error');
    log.error('WatchConfig subscriber terminated', {
      subId: id,
      clientId: sub.clientId,
      traceId: sub.traceId,
      error: err?.message,
    });
    try {
      sub.call.destroy({ code: 13, message: `Internal error: ${err?.message}` });
    } catch {
      /* call already closed */
    }
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
    call.on('error', (err: any) => {
      log.warn('WatchConfig subscriber error', { subId, error: err?.message });
      recordWatchTerminated('client_error');
      this.subscribers.delete(subId);
    });

    const sub: Subscriber = {
      namespace: req.namespace,
      environment: env,
      userId,
      clientId: req.client_id,
      call,
      pending: true,
      missedDelta: false,
      traceId: first(call.metadata, 'x-trace-id') || undefined,
    };
    // Registered before the snapshot read so a change landing mid-read is recorded as missedDelta.
    this.subscribers.set(subId, sub);

    (async () => {
      const snap = await this.snapshotForSubscriber(sub, ConfigUpdateType.CONFIG_UPDATE_TYPE_SNAPSHOT);
      if (this.subscribers.get(subId) !== sub) return;
      this.writeTo(sub, snap);
      while (sub.missedDelta && this.subscribers.get(subId) === sub) {
        sub.missedDelta = false;
        const d = await this.snapshotForSubscriber(sub, ConfigUpdateType.CONFIG_UPDATE_TYPE_DELTA);
        if (this.subscribers.get(subId) !== sub) break;
        this.writeTo(sub, d);
      }
      sub.pending = false;
    })().catch((err) => this.endSubscriber(subId, sub, err));
  }

  async getConfig(call: any, callback: any) {
    const env = resolveEnv(call.request.environment);
    const userId = boundReadUserId(call, requestUserId(call.request));
    const namespace = call.request.namespace;
    let values: Record<string, any>;
    let version: string;
    try {
      ({ values, version } = await this.resolveOverlayValues(namespace, env, userId));
    } catch (err: any) {
      log.error('getConfig failed', { namespace, env, userId, error: err.message });
      callback({ code: 13, message: err.message });
      return;
    }
    callback(null, toProtoSnapPayload({
      namespace,
      version,
      values,
      changedKeys: [],
      environment: env,
    }));
  }

  /**
   * GetSecret — resolve a secret's decrypted plaintext, gated to allow-listed internal callers.
   * Distinguishes an unset secret (found=false) from a decrypt failure (INTERNAL). Exact scope: empty
   * user_id reads only the global row, a user_id only that user's row — never a cross-scope fallback.
   */
  async getSecret(call: any, callback: any) {
    const { namespace, key } = call.request;
    const callerId = truncateForLog(first(call.metadata, HEADER_INTERNAL_CALLER));
    if (!hasSecretCallerAuthority(call, namespace, key)) {
      log.warn('GetSecret denied — caller not on the secret allow-list', {
        callerId,
        namespace,
        key,
        reason: secretDenialReason(call, namespace, key),
        hadPeerSan: hasPeerDnsSan(call),
      });
      callback(SECRET_SCOPE_ERROR);
      return;
    }
    const env = resolveEnv(call.request.environment);
    const userIdParam = requestUserId(call.request) || null;
    try {
      const result = await this.pool.query(
        `SELECT value_encrypted FROM config.config_values
         WHERE namespace = $1 AND key = $2 AND environment = $3 AND COALESCE(user_id,'') = COALESCE($4,'') LIMIT 1`,
        [namespace, key, env, userIdParam]
      );
      const ciphertext: Buffer | null = result.rows[0]?.value_encrypted ?? null;
      if (!ciphertext || ciphertext.length === 0) {
        // Unset secret (never written, or seeded with NULL ciphertext).
        log.info('GetSecret served', { callerId, namespace, key, found: false });
        callback(null, { value: '', found: false });
        return;
      }
      let plaintext: string;
      try {
        plaintext = decryptSecret(ciphertext);
      } catch (err: any) {
        // A decrypt failure (wrong master key / corruption) must NOT masquerade as "unset".
        log.error('GetSecret decrypt failed', { namespace, key, env, userId: userIdParam });
        callback({ code: 13 /* INTERNAL */, message: 'secret decrypt failed' });
        return;
      }
      log.info('GetSecret served', { callerId, namespace, key, found: true });
      callback(null, { value: plaintext, found: true });
    } catch (err: any) {
      log.error('GetSecret DB error', { callerId, namespace, key, error: err.message });
      callback({ code: 13, message: err.message });
    }
  }

  async setConfig(call: any, callback: any) {
    // Scope-aware write gate: GLOBAL needs admin scope OR internal-caller authority; PER-USER is
    // self-service (owner only) — an ADMIN bit grants no override for another user's row.
    const userId = requestUserId(call.request); // '' = global
    const userIdParam = userId === '' ? null : userId;
    const callerUserId = userIdFrom(call.metadata); // propagated x-user-id (edge-injected)

    const rawValue = call.request?.value?.string_val ?? call.request?.value?.stringVal ?? '';
    const internalCallerAuthorized =
      userIdParam === null &&
      hasInternalCallerAuthority(
        call.metadata,
        call.request?.namespace,
        call.request?.key,
        rawValue,
      );
    if (userIdParam === null) {
      if (!hasAdminAccessScope(call.metadata) && !internalCallerAuthorized) {
        const internalCaller = first(call.metadata, HEADER_INTERNAL_CALLER);
        const fields: Record<string, unknown> = {
          namespace: call.request?.namespace,
          key: call.request?.key,
          reason: 'no_admin_or_internal_grant',
        };
        const msg =
          'SetConfig denied — global write without admin scope or internal-caller authority';
        if (internalCaller) {
          // Only the closed-enum trading state is logged as a value; never any other config value.
          if (
            call.request?.namespace === 'platform' &&
            call.request?.key === 'platform.trading_state'
          ) {
            fields.targetState = truncateForLog(rawValue);
          }
          log.error(msg, { ...fields, internalCaller: truncateForLog(internalCaller) });
        } else {
          log.warn(msg, fields);
        }
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
        reason: 'not_owner',
      });
      callback(PER_USER_SCOPE_ERROR);
      return;
    }
    const callerIdentity = first(call.metadata, HEADER_INTERNAL_CALLER) || null;

    const { namespace, key, value, reason } = call.request;
    const env = resolveEnv(call.request.environment);

    const author = callerUserId || (internalCallerAuthorized ? (callerIdentity ?? '') : '');
    if (!author) {
      callback(MISSING_AUTHOR_ERROR);
      return;
    }

    // platform.trading_state is a closed 3-literal string enum, matched in either key spelling.
    if (namespace === 'platform' && canonical(namespace, key) === 'trading_state') {
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
    const scalarBounds = lookupScalarBounds(namespace, key);
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
    const alt = altSpelling(namespace, key);
    let existing: any;
    let globalRows: any[] = [];
    try {
      existing = await this.pool.query(
        `SELECT key, is_secret FROM config.config_values
         WHERE namespace = $1 AND key IN ($2,$3) AND environment = $4 AND COALESCE(user_id,'') = COALESCE($5,'')`,
        [namespace, key, alt, env, userIdParam]
      );

      // A first per-user override of a registered GLOBAL key is legitimate; a per-user request always
      // probes the global row too, so a per-user spelling that differs from it is refused below.
      if (userIdParam !== null) {
        const globalExisting = await this.pool.query(
          `SELECT key, is_secret FROM config.config_values
           WHERE namespace = $1 AND key IN ($2,$3) AND environment = $4 AND user_id IS NULL`,
          [namespace, key, alt, env]
        );
        globalRows = globalExisting.rows;
      }
    } catch (err: any) {
      log.error('setConfig existence gate failed', { namespace, key, env, error: err.message });
      callback({ code: 13, message: err.message });
      return;
    }

    const exactRow = existing.rows[0] ?? null;
    const globalRow = globalRows[0] ?? null;
    const ambiguous =
      existing.rows.length > 1
        ? [existing.rows[0].key, existing.rows[1].key]
        : globalRows.length > 1
          ? [globalRows[0].key, globalRows[1].key]
          : exactRow && globalRow && exactRow.key !== globalRow.key
            ? [globalRow.key, exactRow.key]
            : null;
    if (ambiguous) {
      callback({
        code: 9, // FAILED_PRECONDITION
        message: `ambiguous config key spelling: ${ambiguous[0]} and ${ambiguous[1]} both exist in namespace ${namespace} (env=${env}, user=${userId || 'global'}); the duplicate must be healed first (feature 296)`,
      });
      return;
    }
    // The stored row decides the spelling written; env and user scope always come from the request.
    const writeKey: string = exactRow?.key ?? globalRow?.key ?? key;

    const keyRegistered = exactRow !== null || globalRow !== null;
    if (!keyRegistered && !createKey) {
      callback({
        code: 5, // NOT_FOUND
        message: `config key not registered: ${namespace}.${key} (env=${env}, user=${userId || 'global'}); pass create_key=true to register it`,
      });
      return;
    }

    // Row-authoritative secret flag: exact-scope row wins, else the global row (so a per-user write to a
    // secret key is still encrypted), else the request flag on a genuine create.
    const requestIsSecret = (value?.is_secret ?? value?.isSecret) === true;
    const isSecret =
      exactRow !== null
        ? exactRow.is_secret === true
        : globalRow !== null
          ? globalRow.is_secret === true
          : requestIsSecret;

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
        [namespace, writeKey, inferValueType(value), valueData, valueEncrypted, isSecret, author, reason, env, userIdParam, callerIdentity]
      );
      await this.pool.query(`SELECT pg_notify('config_changed', $1)`, [
        JSON.stringify({ namespace, key: writeKey, environment: env, user_id: userId || null }),
      ]);
      const version = Date.now().toString();
      callback(null, { version, updatedAt: new Date() });
    } catch (err: any) {
      // CHECK (23514) / UNIQUE (23505) violations are caller errors → INVALID_ARGUMENT.
      const invalid = err?.code === '23514' || err?.code === '23505';
      callback({ code: invalid ? 3 : 13, message: err.message });
    }
  }

  async listKeys(call: any, callback: any) {
    const env = resolveEnv(call.request.environment);
    const userId = boundReadUserId(call, requestUserId(call.request));
    try {
      // Global keys overlaid with the caller's per-user rows (per-user wins over global for the same key).
      const result = await this.pool.query(
        `SELECT DISTINCT ON (key)
                key, description, default_value, value_data, is_secret, consuming_service, environment, updated_at
         FROM config.config_values
         WHERE namespace = $1 AND environment = $2 AND (user_id IS NULL OR user_id = $3)
         ORDER BY key, (user_id = $3) DESC NULLS LAST`,
        [call.request.namespace, env, userId]
      );
      callback(null, {
        keys: result.rows.map((r) => {
          // Resolve the registry entry via the two-operand lookup (feature 182): a full-dotted `key`
          // column matches directly, a namespace-stripped one via the `${namespace}.${key}` form — so
          // the config-ui validation hint fires for both column forms.
          const scalarBounds = lookupScalarBounds(call.request.namespace, r.key);
          const secret = r.is_secret === true;
          return {
            key: r.key,
            description: r.description ?? '',
            defaultValue: r.default_value ?? '',
            // Secret rows never expose their value at this edge — redact defensively (value_data is already the sentinel).
            currentValue: secret ? REDACTED : (r.value_data ?? ''),
            updatedAt: r.updated_at ?? undefined,
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

function buildGlobalSnapshot(namespace: string, env: EnvStr, rows: any[], updateType: number): any {
  const values: Record<string, any> = {};
  const secretUpdatedAts: Record<string, string> = {};
  for (const row of rows) {
    values[row.key] = buildConfigValue(row);
    if (row.is_secret === true) secretUpdatedAts[row.key] = updatedAtString(row.updated_at);
  }
  const markerActive = rows.some((r) => r.marker_active === true);
  const emitted = markerActive ? withLegacyAliases(values, namespace) : values;
  return {
    namespace,
    version: contentVersion(emitted, secretUpdatedAts),
    updatedAt: new Date(),
    values,
    secretUpdatedAts,
    markerActive,
    updateType,
    changedKeys: updateType === 2 ? Object.keys(values) : [],
    environment: env,
  };
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
