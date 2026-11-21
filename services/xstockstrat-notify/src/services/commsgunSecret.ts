import * as grpc from '@grpc/grpc-js';
import { ConfigServiceClient } from '@xstockstrat/proto/config/v1/config';
import { Environment } from '@xstockstrat/proto/common/v1/common';
import * as mtls from '../mtls';
import { getLogger } from './logger';

const log = getLogger('notify:commsgun-secret');

// `unknown` means no resolve has succeeded yet: neither "configured" nor "not configured".
export type CommsgunKeyState = { kind: 'key'; value: string } | { kind: 'absent' } | { kind: 'unknown' };

// Outbound gRPC deadline for GetSecret — a fixed mechanism constant, not a config key (F-07).
export const COMMSGUN_SECRET_DEADLINE_MS = 2000;

// The config service grants this caller id exactly this key, pinned to notify's mTLS SAN.
const INTERNAL_CALLER = 'notify';
const SECRET_NAMESPACE = 'notify';
const SECRET_KEY = 'commsgun.app_key';

export type CommsgunSecretClient = Pick<ConfigServiceClient, 'getSecret'>;

export interface SecretWatcher {
  on(event: 'update', listener: (snap: { version: string }) => void): unknown;
  off(event: 'update', listener: (snap: { version: string }) => void): unknown;
  getSnapshot(): { version: string } | null;
}

export interface CommsgunSecret {
  start(): Promise<void>;
  stop(): void;
  state(): CommsgunKeyState;
  failures(): { count: number; statusClass: string };
}

/** One GetSecret for this environment's app key. Rejects with the gRPC error; never logs. */
export function resolveCommsgunAppKey(client: CommsgunSecretClient): Promise<{ found: boolean; value: string }> {
  // Same mapping as ConfigWatcher: each environment reads only its own secret row.
  const environment =
    (process.env.APPLICATION_ENV ?? 'development') === 'production'
      ? Environment.ENVIRONMENT_PRODUCTION
      : Environment.ENVIRONMENT_STAGING;
  const metadata = new grpc.Metadata();
  metadata.set('x-internal-caller', INTERNAL_CALLER);
  return new Promise((resolve, reject) => {
    client.getSecret(
      { namespace: SECRET_NAMESPACE, key: SECRET_KEY, environment, userId: '' },
      metadata,
      { deadline: Date.now() + COMMSGUN_SECRET_DEADLINE_MS },
      (err, resp) => (err ? reject(err) : resolve({ found: resp.found, value: resp.value })),
    );
  });
}

export function createCommsgunSecret(
  watcher: SecretWatcher,
  endpoint: string = process.env.CONFIG_ENDPOINT ?? 'xstockstrat-config:50060',
  client?: CommsgunSecretClient,
): CommsgunSecret {
  const config: CommsgunSecretClient =
    client ??
    new ConfigServiceClient(endpoint, mtls.clientCredentials(), mtls.targetOverride('xstockstrat-config'));

  let state: CommsgunKeyState = { kind: 'unknown' };
  let resolvedVersion: string | null = null;
  let lastFailed = false;
  let failureCount = 0;
  let statusClass = '';
  let running: Promise<void> | null = null;
  let dirty = false;

  async function resolveOnce(): Promise<void> {
    // The version this resolve was started for: a rotation landing later still differs from it.
    const version = watcher.getSnapshot()?.version ?? '';
    try {
      const { found, value } = await resolveCommsgunAppKey(config);
      const usable = found && value !== '';
      state = usable ? { kind: 'key', value } : { kind: 'absent' };
      resolvedVersion = version;
      lastFailed = false;
      failureCount = 0;
      statusClass = '';
      log.info('commsgun app key resolved', { found: usable });
    } catch (err: any) {
      // A failure keeps the last resolved state. Only the status name is kept, never the error text.
      lastFailed = true;
      failureCount++;
      statusClass = (typeof err?.code === 'number' && grpc.status[err.code]) || 'UNKNOWN';
      log.warn('commsgun app key resolve failed', { status: statusClass, failures: failureCount });
    }
  }

  function run(): Promise<void> {
    running = (async () => {
      await resolveOnce();
      // An update that landed mid-resolve may be a rotation the answer predates: resolve once more.
      while (dirty) {
        dirty = false;
        await resolveOnce();
      }
    })().finally(() => {
      running = null;
    });
    return running;
  }

  // The config service re-sends its snapshot on every liveness tick: an update is not a change.
  function onUpdate(snap: { version: string }): void {
    if (running) {
      dirty = true;
      return;
    }
    if (lastFailed || snap.version !== resolvedVersion) void run();
  }

  return {
    start() {
      watcher.on('update', onUpdate);
      return run();
    },
    stop() {
      watcher.off('update', onUpdate);
    },
    state: () => state,
    failures: () => ({ count: failureCount, statusClass }),
  };
}
