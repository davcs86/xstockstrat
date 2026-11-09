// Watcher-core tests (feature 295 Step 16): @AC-10 stall redial, @AC-11 clean-EOF backoff, @AC-15
// read-key evidence + coverage tick, keepalive channel options. Seam contract: spec Deviation Log.
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

const NS = 'ledger';
const KEY = 'export.enabled';
const COVERAGE_INTERVAL_MS = 21_600_000;

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

async function advance(ms: number, step = 100): Promise<void> {
  await flush();
  for (let t = 0; t < ms; t += step) {
    mock.timers.tick(Math.min(step, ms - t));
    await flush();
  }
}

function snap(values: Record<string, ValueInit>, version = '1'): configProto.ConfigSnapshot {
  const built: Record<string, configProto.ConfigValue> = {};
  for (const [k, v] of Object.entries(values)) built[k] = configProto.ConfigValue.fromPartial(v);
  return configProto.ConfigSnapshot.fromPartial({ namespace: NS, version, values: built });
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const readKeyLine = new RegExp(`^config\\.read_key ns=${NS} key=${esc(KEY)}( |$)`);
const coverageLine = new RegExp(`^config\\.read_coverage ns=${NS}( |$)`);
const countInfo = (recs: LogRecord[], re: RegExp) =>
  recs.filter((r) => r.level === 'info' && re.test(r.msg)).length;

describe('ConfigWatcher liveness (@AC-10)', () => {
  it('abandons a stream silent for 30 s, keeps serving the last snapshot, and applies the post-redial value', async () => {
    const w = new ConfigWatcher('xstockstrat-config:50060', NS);
    await flush();
    assert.equal(opens.length, 1);
    opens[0].stream.emit('data', snap({ [KEY]: { boolVal: false } }));
    assert.equal(w.getBool(KEY, true), false);

    await advance(29_000);
    assert.equal(opens[0].stream.cancelled, 0, 'no cancel before the 30 s deadline');
    assert.equal(opens.length, 1, 'no redial before the 30 s deadline');

    await advance(1_000);
    assert.ok(opens[0].stream.cancelled >= 1, 'the stalled stream is cancelled at 30 s');
    assert.equal(w.getBool(KEY, true), false, 'the last snapshot keeps serving while redialling');

    await advance(1_000);
    assert.equal(opens.length, 2, 'redialled within the first backoff (<= 1 s)');
    opens[1].stream.emit('data', snap({ [KEY]: { boolVal: true } }, '2'));
    assert.equal(w.getBool(KEY, false), true, 'the post-redial value is applied');
  });
});

describe('ConfigWatcher backoff (@AC-11)', () => {
  it('a server that ends every stream right after the snapshot opens at most 5 streams in 10 s', async () => {
    onOpen = (stream) =>
      queueMicrotask(() => {
        stream.emit('data', snap({ [KEY]: { boolVal: true } }));
        stream.emit('end');
      });
    new ConfigWatcher('xstockstrat-config:50060', NS);
    await advance(10_000, 50);

    assert.ok(opens.length >= 2, `expected a reconnect, saw ${opens.length} open(s)`);
    assert.ok(opens.length <= 5, `opened ${opens.length} streams in 10 s`);
    const delays = opens.slice(1).map((o, i) => o.at - opens[i].at);
    for (let i = 1; i < delays.length; i++) {
      assert.ok(delays[i] >= delays[i - 1], `delays decreased: ${delays.join(', ')}`);
    }
  });
});

describe('ConfigWatcher read-key evidence (@AC-15)', () => {
  it('logs one read-key line per key, and the coverage tick logs one coverage line and re-emits it', async () => {
    const w = new ConfigWatcher('xstockstrat-config:50060', NS);
    await flush();
    opens[0].stream.emit('data', snap({ [KEY]: { boolVal: true } }));
    w.getBool(KEY, true);
    w.getBool(KEY, true);
    assert.equal(countInfo(records, readKeyLine), 1, 'exactly one read-key line before the tick');

    const mark = records.length;
    await advance(COVERAGE_INTERVAL_MS + 1_000, 1_000);
    const afterTick = records.slice(mark);
    assert.equal(countInfo(afterTick, coverageLine), 1, 'one coverage line at the tick');
    assert.equal(countInfo(afterTick, readKeyLine), 1, 'the tick re-emits the read-key line');
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
