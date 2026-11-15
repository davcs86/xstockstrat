/**
 * AC-49 (feature 294): the startup "delivery channels" line names channels only. Real dispatchers are
 * built under the stated env and the line is captured from winston, without booting the server.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import webpush from 'web-push';
import { transports } from 'winston';

import { FanoutDispatcher } from '../fanout/fanout.js';
import { SendgridSender } from '../fanout/sendgridSender.js';
import { workerRoute, type EmailMode, type KeyKind } from '../fanout/emailProvider.js';
import { fakeCommsgun } from './fixtures/fakeCommsgun.js';
import { WebPushDispatcher } from '../fanout/webPush.js';
import { describeDeliveryChannels } from '../fanout/deliveryChannels.js';
import { getLogger } from '../services/logger.js';

const SLACK_URL = 'https://hooks.slack.test/T000/B000/secretpath';
const VAPID = webpush.generateVAPIDKeys();
const ENV_KEYS = [
  'SLACK_WEBHOOK_URL',
  'SENDGRID_API_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_PUBLIC_KEY',
  'VAPID_SUBJECT',
];

test('AC-49: Slack set, SendGrid unset, VAPID configured -> one INFO line naming channels only', () => {
  const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const records: Record<string | symbol, unknown>[] = [];
  const originalLog = transports.Console.prototype.log;
  transports.Console.prototype.log = function (
    info: Record<string | symbol, unknown>,
    next: () => void,
  ) {
    records.push(info);
    next();
  };
  try {
    process.env.SLACK_WEBHOOK_URL = SLACK_URL;
    delete process.env.SENDGRID_API_KEY;
    process.env.VAPID_PRIVATE_KEY = VAPID.privateKey;
    process.env.VAPID_PUBLIC_KEY = VAPID.publicKey;
    process.env.VAPID_SUBJECT = 'mailto:ops@xstockstrat.test';

    type Deps = ConstructorParameters<typeof WebPushDispatcher>;
    const fanout = new FanoutDispatcher(
      {} as Deps[1],
      new SendgridSender({ getString: () => '' }),
      fakeCommsgun({ route: 'reroute_lost' }),
    );
    const webPush = new WebPushDispatcher({} as Deps[0], {} as Deps[1], {} as Deps[2]);
    // The same call src/index.ts makes after the three constructions.
    getLogger('notify:server').info('delivery channels', describeDeliveryChannels(fanout, webPush));
  } finally {
    transports.Console.prototype.log = originalLog;
    for (const k of ENV_KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }

  const lines = records.filter((r) => r.message === 'delivery channels');
  assert.equal(lines.length, 1);
  assert.equal(lines[0][Symbol.for('level')], 'info');
  assert.equal(lines[0].enabled, 'slack,push');
  assert.equal(lines[0].disabled, 'sendgrid,commsgun');
  const dump = JSON.stringify(records);
  for (const secret of [SLACK_URL, VAPID.privateKey, VAPID.publicKey]) {
    assert.equal(dump.includes(secret), false, 'a webhook or VAPID value reached the log');
  }
});

test('AC-49: src/index.ts writes the delivery channels line exactly once, after the dispatchers', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'src', 'index.ts'), 'utf8');
  const line = "log.info('delivery channels', describeDeliveryChannels(fanout, webPush));";
  assert.equal(src.split(line).length - 1, 1);
  assert.ok(src.indexOf(line) > src.indexOf('new NotifyServiceImpl('));
});

// Feature 338 AC-17: commsgun is listed from the worker's route at boot, by name only.
const ENQUEUE_URL = 'https://comms.ts.example.net/v1/messages';
const APP_KEY = 'k-0123456789abcdef0123456789abcdef';

for (const [mode, key, state] of [
  ['auto', 'key', 'enabled'],
  ['auto', 'unknown', 'disabled'],
  ['commsgun', 'absent', 'enabled'],
] as Array<[EmailMode, KeyKind, 'enabled' | 'disabled']>) {
  test(`AC-17 (338): mode ${mode}, base set, key ${key} -> commsgun is ${state}`, () => {
    const prev = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    try {
      type Deps = ConstructorParameters<typeof WebPushDispatcher>;
      // The route the real worker would report for this mode, base and key state.
      const commsgun = fakeCommsgun({ keyKind: key, route: workerRoute(mode, true, key) });
      const fanout = new FanoutDispatcher({} as Deps[1], new SendgridSender({ getString: () => '' }), commsgun);
      const webPush = new WebPushDispatcher({} as Deps[0], {} as Deps[1], {} as Deps[2]);
      const line = describeDeliveryChannels(fanout, webPush);
      assert.ok(line[state].split(',').includes('commsgun'), `${state}: ${JSON.stringify(line)}`);
      const other = state === 'enabled' ? 'disabled' : 'enabled';
      assert.ok(!line[other].split(',').includes('commsgun'));
      const dump = JSON.stringify(line);
      assert.ok(!dump.includes(ENQUEUE_URL) && !dump.includes(APP_KEY), 'a URL or key reached the line');
    } finally {
      for (const k of ENV_KEYS) {
        if (prev[k] === undefined) delete process.env[k];
        else process.env[k] = prev[k];
      }
    }
  });
}

test('338: src/index.ts wires the commsgun worker in boot and shutdown order', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'src', 'index.ts'), 'utf8');
  const at = (needle: string) => {
    const i = src.indexOf(needle);
    assert.ok(i >= 0, `index.ts does not contain: ${needle}`);
    return i;
  };
  // The key is resolved after the DB probe (NOTIFY-9 boot order) and before the dispatcher exists.
  assert.ok(at("pool.query('SELECT 1')") < at('await commsgunSecret.start()'));
  assert.ok(at('await commsgunSecret.start()') < at('new FanoutDispatcher('));
  assert.ok(src.includes('new CommsgunWorker(pool, configWatcher,'), 'the worker is built on pool and configWatcher');
  assert.ok(at('new CommsgunWorker(') < at('new FanoutDispatcher('));
  assert.ok(at('grpcServer.start()') < at('commsgunWorker.start()'));
  // AC-36: the stop promise is taken before the pool closes, and awaited before pool.end().
  const stop = at('commsgunWorker.stop()');
  const end = at('pool.end()');
  assert.ok(stop < end);
  assert.match(src.slice(stop, end), /await commsgunStopped/);
  assert.equal(src.split('new Pool(').length - 1, 1);
});
