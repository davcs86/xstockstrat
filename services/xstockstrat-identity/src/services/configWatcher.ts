/**
 * services/configWatcher.ts
 * Shared ConfigWatcher for all Node.js services.
 * Subscribes to xstockstrat-config WatchConfig gRPC stream.
 * All services call waitForSnapshot() before accepting traffic.
 */
import * as grpc from '@grpc/grpc-js';
import { EventEmitter } from 'events';
import { ConfigServiceClient, ConfigSnapshot, ConfigValue } from '@xstockstrat/proto/config/v1/config';
import { Environment, TradingMode } from '@xstockstrat/proto/common/v1/common';
import { getLogger } from './logger';

const log = getLogger('config:watcher');

export type { ConfigSnapshot, ConfigValue };

export class ConfigWatcher extends EventEmitter {
  private stub: InstanceType<typeof ConfigServiceClient>;
  private snapshot: ConfigSnapshot | null = null;
  private snapshotReceived = false;
  private resolveSnapshot!: () => void;
  private snapshotPromise: Promise<void>;

  constructor(
    private readonly endpoint: string,
    private readonly namespace: string,
  ) {
    super();
    this.stub = new ConfigServiceClient(endpoint, grpc.credentials.createInsecure());
    this.snapshotPromise = new Promise((resolve) => {
      this.resolveSnapshot = resolve;
    });
    this.startWatch();
  }

  private startWatch() {
    const appEnv = process.env.APPLICATION_ENV ?? 'development';
    const tradingModeEnv = process.env.TRADING_MODE ?? 'paper';
    const environment = appEnv === 'production' ? Environment.ENVIRONMENT_PRODUCTION : Environment.ENVIRONMENT_DEV;
    const tradingMode = tradingModeEnv === 'live' ? TradingMode.TRADING_MODE_LIVE : TradingMode.TRADING_MODE_PAPER;

    const stream = this.stub.watchConfig({
      namespace: this.namespace,
      clientId: `node-${this.namespace}-${process.pid}`,
      version: '',
      environment,
      tradingMode,
    });

    stream.on('data', (snap: ConfigSnapshot) => {
      this.snapshot = snap;
      if (!this.snapshotReceived) {
        this.snapshotReceived = true;
        this.resolveSnapshot();
      }
      this.emit('update', snap);
      log.debug(`Config updated namespace=${snap.namespace} version=${snap.version} keys=${snap.changedKeys?.join(',')}`);
    });

    stream.on('error', (err: Error) => {
      log.warn(`Config stream error: ${err.message}, reconnecting in 2s`);
      setTimeout(() => this.startWatch(), 2000);
    });

    stream.on('end', () => {
      log.warn('Config stream ended, reconnecting in 2s');
      setTimeout(() => this.startWatch(), 2000);
    });
  }

  async waitForSnapshot(timeoutMs = 10_000): Promise<void> {
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
