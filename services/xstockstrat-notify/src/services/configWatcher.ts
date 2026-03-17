/**
 * services/configWatcher.ts
 * Shared ConfigWatcher for all Node.js services.
 * Subscribes to xstockstrat-config WatchConfig gRPC stream.
 * All services call waitForSnapshot() before accepting traffic.
 */
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'path';
import { EventEmitter } from 'events';
import { getLogger } from './logger';

const log = getLogger('config:watcher');

const PROTO_PATH = path.resolve(
  __dirname,
  '../../../packages/proto/config/v1/config.proto'
);

const packageDef = protoLoader.loadSync(PROTO_PATH, {
  keepCase: false,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const proto = grpc.loadPackageDefinition(packageDef) as any;

export type ConfigValue =
  | { string_val: string }
  | { int_val: number }
  | { float_val: number }
  | { bool_val: boolean };

export interface ConfigSnapshot {
  namespace: string;
  version: string;
  values: Record<string, ConfigValue>;
  update_type: number;
  changed_keys: string[];
}

export class ConfigWatcher extends EventEmitter {
  private stub: any;
  private snapshot: ConfigSnapshot | null = null;
  private snapshotReceived = false;
  private resolveSnapshot!: () => void;
  private snapshotPromise: Promise<void>;

  constructor(
    private readonly endpoint: string,
    private readonly namespace: string,
  ) {
    super();
    const channel = new proto.xstockstrat.config.v1.ConfigService(
      endpoint,
      grpc.credentials.createInsecure(),
    );
    this.stub = channel;
    this.snapshotPromise = new Promise((resolve) => {
      this.resolveSnapshot = resolve;
    });
    this.startWatch();
  }

  private startWatch() {
    const stream = this.stub.watchConfig({ namespace: this.namespace, client_id: `node-${this.namespace}-${process.pid}` });

    stream.on('data', (snap: ConfigSnapshot) => {
      this.snapshot = snap;
      if (!this.snapshotReceived) {
        this.snapshotReceived = true;
        this.resolveSnapshot();
      }
      this.emit('update', snap);
      log.debug(`Config updated namespace=${snap.namespace} version=${snap.version} keys=${snap.changed_keys?.join(',')}`);
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
    const v = this.snapshot?.values[key] as any;
    return v?.string_val ?? def;
  }

  getInt(key: string, def = 0): number {
    const v = this.snapshot?.values[key] as any;
    return v?.int_val ?? def;
  }

  getFloat(key: string, def = 0): number {
    const v = this.snapshot?.values[key] as any;
    return v?.float_val ?? def;
  }

  getBool(key: string, def = false): boolean {
    const v = this.snapshot?.values[key] as any;
    return v?.bool_val ?? def;
  }

  getSnapshot(): ConfigSnapshot | null {
    return this.snapshot;
  }
}
