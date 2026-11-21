/**
 * Shared ConfigWatcher core — byte-identical in xstockstrat-{ledger,identity,notify}; edit all three
 * together (scripts/check-watcher-copies.py fails CI on drift). Await waitForSnapshot() before serving.
 */
import * as mtls from '../mtls';
import { EventEmitter } from 'events';
import { ConfigServiceClient, ConfigSnapshot, ConfigValue } from '@xstockstrat/proto/config/v1/config';
import { Environment, TradingMode } from '@xstockstrat/proto/common/v1/common';
import { getLogger } from './logger';

const log = getLogger('config:watcher');

export type { ConfigSnapshot, ConfigValue };

// Fixed invariant (F-07): config cannot configure its own channel, so this is not a config key.
// Matches the servers' keepalive enforcement (30 s / 10 s, pings allowed without a stream).
const KEEPALIVE_OPTIONS = {
  'grpc.keepalive_time_ms': 30_000,
  'grpc.keepalive_timeout_ms': 10_000,
  'grpc.keepalive_permit_without_calls': 1,
};
// Fixed invariant (F-07): a stream silent this long is cancelled and redialled; the config server's
// periodic re-send keeps a healthy stream under it.
const LIVENESS_DEADLINE_MS = 30_000;
// Fixed invariant (F-07): first reconnect backoff base; doubles per failure up to RECONNECT_MAX_MS.
const RECONNECT_BASE_MS = 1_000;
// Fixed invariant (F-07): reconnect backoff ceiling.
const RECONNECT_MAX_MS = 30_000;
// Fixed invariant (F-07): the backoff resets only after a stream delivered for at least half the
// liveness deadline, so a snapshot-then-EOF server never resets it (AC-11).
const BACKOFF_RESET_AFTER_MS = LIVENESS_DEADLINE_MS / 2;
// Fixed invariant (F-07): READ_COVERAGE_INTERVAL_S=21600 — the FR-6 coverage tick that also
// re-emits config.read_key for every key read so far.
const READ_COVERAGE_INTERVAL_MS = 21_600_000;
// Fixed invariant (F-07): at most one FR-11 WARN per FQN and reason in this window.
const WARN_INTERVAL_MS = 5 * 60_000;

function storedKind(v: ConfigValue): string {
  if (v.stringVal !== undefined) return 'string';
  if (v.intVal !== undefined) return 'int';
  if (v.floatVal !== undefined) return 'float';
  if (v.boolVal !== undefined) return 'bool';
  if (v.jsonVal !== undefined) return 'json';
  return 'none';
}

export class ConfigWatcher extends EventEmitter {
  private stub: InstanceType<typeof ConfigServiceClient>;
  private snapshot: ConfigSnapshot | null = null;
  private snapshotReceived = false;
  private resolveSnapshot!: () => void;
  private snapshotPromise: Promise<void>;
  private call: { cancel(): void } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private livenessTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private streamOpenedAt = 0;
  private lastMessageAt = 0;
  private readonly readKeys = new Set<string>();
  private readonly warnedAt = new Map<string, number>();

  constructor(
    private readonly endpoint: string,
    private readonly namespace: string,
  ) {
    super();
    this.stub = new ConfigServiceClient(endpoint, mtls.clientCredentials(), {
      ...KEEPALIVE_OPTIONS,
      ...mtls.targetOverride('xstockstrat-config'),
    });
    this.snapshotPromise = new Promise((resolve) => {
      this.resolveSnapshot = resolve;
    });
    const coverage = setInterval(() => this.logCoverage(true), READ_COVERAGE_INTERVAL_MS);
    coverage.unref?.();
    this.startWatch();
  }

  private startWatch() {
    // Config is scoped by environment; trading_mode is deprecated (server ignores it).
    const appEnv = process.env.APPLICATION_ENV ?? 'development';
    const environment = appEnv === 'production' ? Environment.ENVIRONMENT_PRODUCTION : Environment.ENVIRONMENT_STAGING;

    const stream = this.stub.watchConfig({
      namespace: this.namespace,
      clientId: `node-${this.namespace}-${process.pid}`,
      version: '',
      environment,
      tradingMode: TradingMode.TRADING_MODE_UNSPECIFIED,
      userId: '',
    });
    this.call = stream;
    this.streamOpenedAt = Date.now();
    this.lastMessageAt = this.streamOpenedAt;
    this.armLiveness();

    stream.on('data', (snap: ConfigSnapshot) => {
      if (stream !== this.call) return;
      this.lastMessageAt = Date.now();
      this.armLiveness();
      this.snapshot = snap;
      if (!this.snapshotReceived) {
        this.snapshotReceived = true;
        this.resolveSnapshot();
        this.logCoverage(false);
      }
      this.emit('update', snap);
      log.debug(`Config updated namespace=${snap.namespace} version=${snap.version} keys=${snap.changedKeys?.join(',')}`);
    });

    // grpc-js emits both 'end' and 'error' for one failed server stream; only the current call may
    // trigger a reconnect, else every failure doubles the live streams.
    stream.on('error', (err: Error) => {
      if (stream !== this.call) return;
      this.scheduleReconnect(`Config stream error: ${err.message}`);
    });

    stream.on('end', () => {
      if (stream !== this.call) return;
      this.scheduleReconnect('Config stream ended');
    });
  }

  private armLiveness() {
    if (this.livenessTimer) clearTimeout(this.livenessTimer);
    this.livenessTimer = setTimeout(() => {
      this.livenessTimer = null;
      this.scheduleReconnect(`Config stream silent for ${LIVENESS_DEADLINE_MS}ms`);
    }, LIVENESS_DEADLINE_MS);
  }

  private scheduleReconnect(reason: string) {
    if (this.reconnectTimer) return;
    if (this.livenessTimer) {
      clearTimeout(this.livenessTimer);
      this.livenessTimer = null;
    }
    const call = this.call;
    this.call = null;
    call?.cancel();
    if (this.lastMessageAt - this.streamOpenedAt >= BACKOFF_RESET_AFTER_MS) this.reconnectAttempt = 0;
    const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt);
    const delay = Math.round(ceiling / 2 + Math.random() * (ceiling / 2));
    this.reconnectAttempt++;
    log.warn(`${reason}, reconnecting in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.startWatch();
    }, delay);
  }

  async waitForSnapshot(timeoutMs = 90_000): Promise<void> {
    return Promise.race([
      this.snapshotPromise,
      new Promise<void>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Config snapshot timeout after ${timeoutMs}ms for namespace=${this.namespace} at ${this.endpoint}`)),
          timeoutMs,
        )
      ),
    ]);
  }

  // Logs config.read_coverage and, at a tick, re-emits every read key (FR-6).
  private logCoverage(reemit: boolean) {
    log.info(`config.read_coverage ns=${this.namespace} keys=${this.readKeys.size}`);
    if (!reemit) return;
    for (const key of [...this.readKeys].sort()) {
      log.info(`config.read_key ns=${this.namespace} key=${key}`);
    }
  }

  private fqn(key: string): string {
    return key.startsWith(`${this.namespace}.`) ? key : `${this.namespace}.${key}`;
  }

  private warn(key: string, reason: string, detail = '') {
    const name = this.fqn(key);
    const id = `${name}|${reason}`;
    const now = Date.now();
    const last = this.warnedAt.get(id);
    if (last !== undefined && now - last < WARN_INTERVAL_MS) return;
    this.warnedAt.set(id, now);
    log.warn(`config value ${reason}; using the code default fqn=${name}${detail}`);
  }

  private lookup(key: string): ConfigValue | undefined {
    if (!this.readKeys.has(key)) {
      this.readKeys.add(key);
      log.info(`config.read_key ns=${this.namespace} key=${key}`);
    }
    const v = this.snapshot?.values[key];
    if (v === undefined && this.snapshotReceived) this.warn(key, 'absent from the received snapshot');
    return v;
  }

  private mismatch<T>(key: string, want: string, v: ConfigValue, def: T): T {
    this.warn(key, 'type mismatch', ` want=${want} stored=${storedKind(v)}`);
    return def;
  }

  // FR-11 getters: the stored type or the default, with a rate-limited WARN naming the FQN.
  getString(key: string, def = ''): string {
    const v = this.lookup(key);
    if (v === undefined) return def;
    return v.stringVal ?? this.mismatch(key, 'string', v, def);
  }

  getInt(key: string, def = 0): number {
    const v = this.lookup(key);
    if (v === undefined) return def;
    return v.intVal ?? this.mismatch(key, 'int', v, def);
  }

  // An int widens losslessly to a float (AC-27).
  getFloat(key: string, def = 0): number {
    const v = this.lookup(key);
    if (v === undefined) return def;
    return v.floatVal ?? v.intVal ?? this.mismatch(key, 'float', v, def);
  }

  getBool(key: string, def = false): boolean {
    const v = this.lookup(key);
    if (v === undefined) return def;
    return v.boolVal ?? this.mismatch(key, 'bool', v, def);
  }

  getSnapshot(): ConfigSnapshot | null {
    return this.snapshot;
  }
}
