// Watcher-core tests (feature 295 Step 16): FR-11 mismatch / absent-key WARNs for the int, bool
// and string getters, keepalive channel options. Seam contract: spec Deviation Log.
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

const NS = 'identity';
const KEY = 'jwt.access_ttl_seconds';
// The core's fqn() re-prefixes the namespace for WARN text; assert the FQN so a bare substring cannot pass.
const KEY_FQN = `${NS}.${KEY}`;
const FLAGS_FQN = `${NS}.flags.enabled`;
const LABELS_FQN = `${NS}.labels.issuer`;
const ABSENT_FQN = `${NS}.jwt.absent_ttl`;

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

describe('ConfigWatcher getters (FR-11)', () => {
  it('a matching type is returned with no WARN', async () => {
    const w = await seeded({ [KEY]: { intVal: 600 } });
    assert.equal(w.getInt(KEY, 900), 600);
    assert.equal(warnsNaming(KEY_FQN), 0);
  });

  it('each non-widening mismatch returns the default and WARNs naming the FQN', async () => {
    const w = await seeded({
      [KEY]: { stringVal: '600' },
      'flags.enabled': { intVal: 1 },
      'labels.issuer': { boolVal: true },
    });
    assert.equal(w.getInt(KEY, 900), 900);
    assert.equal(w.getBool('flags.enabled', false), false);
    assert.equal(w.getString('labels.issuer', 'xs'), 'xs');
    assert.equal(warnsNaming(KEY_FQN), 1);
    assert.equal(warnsNaming(FLAGS_FQN), 1);
    assert.equal(warnsNaming(LABELS_FQN), 1);
  });

  it('an absent key WARNs naming the FQN, prefixing the namespace onto a bare key', async () => {
    const w = await seeded({ [KEY]: { intVal: 600 } });
    assert.equal(w.getInt('jwt.absent_ttl', 5), 5);
    assert.equal(w.getInt('bare_ttl', 7), 7);
    assert.equal(warnsNaming(ABSENT_FQN), 1);
    assert.equal(warnsNaming('identity.bare_ttl'), 1);
  });

  it('before any snapshot arrives an absent key returns the default without a WARN', () => {
    const w = new ConfigWatcher('xstockstrat-config:50060', NS);
    assert.equal(w.getInt(KEY, 900), 900);
    assert.equal(warnsNaming(KEY_FQN), 0);
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
