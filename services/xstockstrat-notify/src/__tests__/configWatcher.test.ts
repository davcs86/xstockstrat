// Watcher-core tests (feature 295 Step 16): @AC-27 int->float widening and the FR-11 mismatch /
// absent-key WARNs, keepalive channel options. Seam contract: spec Deviation Log.
import { describe, it, before, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as grpc from '@grpc/grpc-js';
import configProto = require('@xstockstrat/proto/config/v1/config');
import mtlsModule = require('../mtls');
import loggerModule = require('../services/logger');

type Watcher = import('../services/configWatcher').ConfigWatcher;
type ValueInit = { stringVal?: string; intVal?: number; floatVal?: number; boolVal?: boolean };
interface LogRecord {
  level: string;
  msg: string;
}

const NS = 'notify';
const KEY = 'notify.fanout.min_confidence_threshold';

const records: LogRecord[] = [];
const capture = (level: string) => (msg: unknown) => {
  records.push({ level, msg: String(msg) });
};
const fakeLog = {
  debug: capture('debug'),
  info: capture('info'),
  warn: capture('warn'),
  error: capture('error'),
};

class FakeStream extends EventEmitter {
  cancelled = 0;
  cancel(): void {
    this.cancelled++;
  }
}

const opens: { at: number; stream: FakeStream }[] = [];
const dials: { endpoint: string; options: grpc.ChannelOptions }[] = [];
let onOpen: (stream: FakeStream) => void = () => {};

class FakeConfigServiceClient {
  constructor(endpoint: string, _creds: unknown, options: grpc.ChannelOptions = {}) {
    dials.push({ endpoint, options });
  }
  watchConfig(): FakeStream {
    const stream = new FakeStream();
    opens.push({ at: Date.now(), stream });
    onOpen(stream);
    return stream;
  }
  close(): void {}
}

let ConfigWatcher: new (endpoint: string, namespace: string) => Watcher;

before(async () => {
  Object.assign(configProto, { ConfigServiceClient: FakeConfigServiceClient });
  Object.assign(mtlsModule, { clientCredentials: () => grpc.credentials.createInsecure() });
  Object.assign(loggerModule, { getLogger: () => fakeLog });
  ({ ConfigWatcher } = await import('../services/configWatcher'));
});

beforeEach(() => {
  records.length = 0;
  opens.length = 0;
  dials.length = 0;
  onOpen = () => {};
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 0 });
});

afterEach(() => {
  mock.timers.reset();
});

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function snap(values: Record<string, ValueInit>, version = '1'): configProto.ConfigSnapshot {
  const built: Record<string, configProto.ConfigValue> = {};
  for (const [k, v] of Object.entries(values)) built[k] = configProto.ConfigValue.fromPartial(v);
  return configProto.ConfigSnapshot.fromPartial({ namespace: NS, version, values: built });
}

const warnsNaming = (fqn: string) =>
  records.filter((r) => r.level === 'warn' && r.msg.includes(fqn)).length;

async function seeded(values: Record<string, ValueInit>): Promise<Watcher> {
  const w = new ConfigWatcher('xstockstrat-config:50060', NS);
  await flush();
  opens[0].stream.emit('data', snap(values));
  return w;
}

describe('ConfigWatcher getters (@AC-27, FR-11)', () => {
  it('@AC-27: a key stored as int 7 reads as 7 through getFloat, with no WARN', async () => {
    const w = await seeded({ [KEY]: { intVal: 7 } });
    assert.equal(w.getFloat(KEY, 1.5), 7);
    assert.equal(warnsNaming(KEY), 0);
  });

  it('a type mismatch returns the default and WARNs once (rate-limited) naming the FQN', async () => {
    const w = await seeded({ [KEY]: { stringVal: 'high' } });
    assert.equal(w.getFloat(KEY, 1.5), 1.5);
    assert.equal(w.getFloat(KEY, 1.5), 1.5);
    assert.equal(warnsNaming(KEY), 1);
  });

  it('a key absent from a received snapshot returns the default and WARNs naming the FQN', async () => {
    const absent = 'notify.fanout.absent_threshold';
    const w = await seeded({ [KEY]: { floatVal: 0.7 } });
    assert.equal(w.getFloat(absent, 1.5), 1.5);
    assert.equal(warnsNaming(absent), 1);
  });
});

describe('ConfigWatcher channel options', () => {
  it('dials with client keepalive and the xstockstrat-config target override', () => {
    new ConfigWatcher('xstockstrat-config:50060', NS);
    assert.equal(dials.length, 1);
    const opts = dials[0].options;
    assert.equal(opts['grpc.keepalive_time_ms'], 30_000);
    assert.equal(opts['grpc.keepalive_timeout_ms'], 10_000);
    assert.equal(opts['grpc.keepalive_permit_without_calls'], 1);
    assert.equal(opts['grpc.ssl_target_name_override'], 'xstockstrat-config');
  });
});
