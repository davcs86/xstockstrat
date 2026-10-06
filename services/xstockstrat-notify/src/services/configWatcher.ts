/**
 * services/configWatcher.ts
 * Shared ConfigWatcher for all Node.js services.
 * Subscribes to xstockstrat-config WatchConfig gRPC stream.
 * All services call waitForSnapshot() before accepting traffic.
 */
import * as mtls from '../mtls';
import { EventEmitter } from 'events';
import { ConfigServiceClient, ConfigSnapshot, ConfigValue } from '@xstockstrat/proto/config/v1/config';
import { Environment, TradingMode } from '@xstockstrat/proto/common/v1/common';
import { getLogger } from './logger';

const log = getLogger('config:watcher');

export type { ConfigSnapshot, ConfigValue };

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export class ConfigWatcher extends EventEmitter {
  private stub: InstanceType<typeof ConfigServiceClient>;
  private snapshot: ConfigSnapshot | null = null;
  private snapshotReceived = false;
  private resolveSnapshot!: () => void;
  private snapshotPromise: Promise<void>;
  private call: { cancel(): void } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;

  constructor(
    private readonly endpoint: string,
    private readonly namespace: string,
  ) {
    super();
    this.stub = new ConfigServiceClient(endpoint, mtls.clientCredentials(), mtls.targetOverride('xstockstrat-config'));
    this.snapshotPromise = new Promise((resolve) => {
      this.resolveSnapshot = resolve;
    });
    this.startWatch();
  }

  private startWatch() {
    // Feature 147: config is scoped by environment (production/staging) x global/per-user.
    // paper/live is derived from environment; trading_mode is deprecated and ignored by the server.
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

    stream.on('data', (snap: ConfigSnapshot) => {
      if (stream !== this.call) return;
      this.reconnectAttempt = 0;
      this.snapshot = snap;
      if (!this.snapshotReceived) {
        this.snapshotReceived = true;
        this.resolveSnapshot();
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

  private scheduleReconnect(reason: string) {
    if (this.reconnectTimer) return;
    const call = this.call;
    this.call = null;
    call?.cancel();
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

  getString(key: string, def = ''): string {
    const v = this.snapshot?.values[key];
    return v?.stringVal ?? def;
  }

  getInt(key: string, def = 0): number {
    const v = this.snapshot?.values[key];
    return v?.intVal ?? def;
  }

  getFloat(key: string, def = 0): number {
    const v = this.snapshot?.values[key];
    return v?.floatVal ?? def;
  }

  getBool(key: string, def = false): boolean {
    const v = this.snapshot?.values[key];
    return v?.boolVal ?? def;
  }

  getSnapshot(): ConfigSnapshot | null {
    return this.snapshot;
  }
}
