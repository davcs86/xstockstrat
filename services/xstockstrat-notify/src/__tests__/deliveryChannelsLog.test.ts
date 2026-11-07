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
    const fanout = new FanoutDispatcher({} as Deps[1]);
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
  assert.equal(lines[0].disabled, 'sendgrid');
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
