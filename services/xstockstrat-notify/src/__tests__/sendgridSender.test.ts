// renderEmail and SendgridSender tests (feature 338). Outbound HTTP is stubbed via globalThis.fetch.
// The logger is replaced before the modules under test load, so every log call they make is captured.
import { describe, it, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import loggerModule = require('../services/logger');
import { counterValue, install } from './fixtures/collectingReader';
import { fakeConfig, type Cfg } from './fixtures/fakeConfig';
import { networkError, stubFetch, type FetchReply, type FetchStub } from './fixtures/stubFetch';

type RenderModule = typeof import('../fanout/emailRender');
type SenderModule = typeof import('../fanout/sendgridSender');

const API_KEY = 'SG.test-key-0123456789';
const FROM = 'alerts@example.com';
const TO = 'ops@example.com';
const ADDRESSES = { 'fanout.sendgrid_from_email': FROM, 'fanout.sendgrid_to_email': TO };
const ALERT_ID = 'alert-338';

interface LogRecord {
  level: string;
  msg: string;
  meta: unknown;
}
const records: LogRecord[] = [];
const capture = (level: string) => (msg: unknown, meta?: unknown) => {
  records.push({ level, msg: String(msg), meta });
};
const fakeLog = { debug: capture('debug'), info: capture('info'), warn: capture('warn'), error: capture('error') };

let renderEmail: RenderModule['renderEmail'];
let SendgridSender: SenderModule['SendgridSender'];
let FANOUT_HTTP_TIMEOUT_MS: number;

before(async () => {
  Object.assign(loggerModule, { getLogger: () => fakeLog });
  ({ renderEmail } = await import('../fanout/emailRender'));
  ({ SendgridSender, FANOUT_HTTP_TIMEOUT_MS } = await import('../fanout/sendgridSender'));
});

let fetchStub: FetchStub | null = null;

afterEach(() => {
  fetchStub?.restore();
  fetchStub = null;
  mock.timers.reset();
  records.length = 0;
});

function useFetch(reply: number | ((call: any, index: number) => FetchReply)): FetchStub {
  fetchStub = stubFetch(reply);
  return fetchStub;
}

/** The credential is read once in the constructor, so the env is set around construction only. */
function makeSender(apiKey: string | undefined, cfg: Cfg): InstanceType<SenderModule['SendgridSender']> {
  const prev = process.env.SENDGRID_API_KEY;
  if (apiKey) process.env.SENDGRID_API_KEY = apiKey;
  else delete process.env.SENDGRID_API_KEY;
  const sender = new SendgridSender(fakeConfig(cfg));
  if (prev === undefined) delete process.env.SENDGRID_API_KEY;
  else process.env.SENDGRID_API_KEY = prev;
  return sender;
}

const PAYLOAD = {
  symbol: 'AAPL',
  source: 'analysis',
  severity: 'ALERT_SEVERITY_WARNING',
  conviction: 0.82,
  title: 'BUY AAPL',
  body: 'Signal fired',
  timestamp: '2026-08-20T14:31:00.000Z',
};
const EMAIL = { subject: '[ALERT_SEVERITY_WARNING] BUY AAPL', text: 'rendered text' };

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}

function warns(): LogRecord[] {
  return records.filter((r) => r.level === 'warn');
}

function assertNoLeak(): void {
  const dump = JSON.stringify(records);
  for (const secret of [API_KEY, FROM, TO, EMAIL.subject, EMAIL.text]) {
    assert.ok(!dump.includes(secret), `a log record contains ${secret}`);
  }
}

describe('sendgridSender test harness', () => {
  it('imports the modules under test', () => {
    assert.equal(typeof renderEmail, 'function');
    assert.equal(typeof SendgridSender, 'function');
  });
});

describe('renderEmail', () => {
  it('renders the subject and every field line (020 @AC-2)', () => {
    const email = renderEmail(PAYLOAD);
    assert.equal(email.subject, '[ALERT_SEVERITY_WARNING] BUY AAPL');
    assert.equal(
      email.text,
      [
        'Symbol: AAPL',
        'Source: analysis',
        'Severity: ALERT_SEVERITY_WARNING',
        'Conviction: 0.82',
        'Timestamp: 2026-08-20T14:31:00.000Z',
        '',
        'BUY AAPL',
        'Signal fired',
      ].join('\n'),
    );
  });

  it('prints (n/a) for a missing symbol and a missing conviction', () => {
    const { symbol: _symbol, conviction: _conviction, ...bare } = PAYLOAD;
    const lines = renderEmail(bare).text.split('\n');
    assert.equal(lines[0], 'Symbol: (n/a)');
    assert.equal(lines[3], 'Conviction: (n/a)');
  });
});

describe('SendgridSender.send', () => {
  it("@AC-1 a 202 is one mail-send request with today's shape, and counts as sent", async () => {
    const reader = install();
    const fetched = useFetch(202);
    const sender = makeSender(API_KEY, { str: ADDRESSES });
    assert.equal(await sender.send(EMAIL, ALERT_ID), true);
    assert.equal(fetched.calls.length, 1);
    const call = fetched.calls[0];
    assert.equal(call.url, 'https://api.sendgrid.com/v3/mail/send');
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers.Authorization, `Bearer ${API_KEY}`);
    assert.equal(call.init.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(call.init.body), {
      personalizations: [{ to: [{ email: TO }] }],
      from: { email: FROM },
      subject: EMAIL.subject,
      content: [{ type: 'text/plain', value: EMAIL.text }],
    });
    assert.equal(await counterValue(reader, 'notify.delivery', 'outcome', 'sent'), 1);
    assert.equal(await counterValue(reader, 'notify.delivery', 'channel', 'sendgrid'), 1);
    assert.equal(warns().length, 0);
  });

  it('a 500 returns false, counts http_error and logs one WARN without content', async () => {
    const reader = install();
    useFetch(500);
    const sender = makeSender(API_KEY, { str: ADDRESSES });
    assert.equal(await sender.send(EMAIL, ALERT_ID), false);
    assert.equal(await counterValue(reader, 'notify.delivery', 'outcome', 'http_error'), 1);
    assert.equal(warns().length, 1);
    assert.deepEqual(warns()[0].meta, { alertId: ALERT_ID, channel: 'sendgrid', error: 'HTTP 500' });
    assertNoLeak();
  });

  it('a hang is aborted after the fixed timeout, returns false and counts timeout', async () => {
    const reader = install();
    mock.timers.enable({ apis: ['setTimeout'] });
    const fetched = useFetch(() => ({ hang: true }));
    const sender = makeSender(API_KEY, { str: ADDRESSES });
    const sent = sender.send(EMAIL, ALERT_ID);
    await settle();
    assert.equal(fetched.calls[0].init.signal.aborted, false);
    mock.timers.tick(FANOUT_HTTP_TIMEOUT_MS);
    assert.equal(await sent, false);
    assert.equal(fetched.calls[0].init.signal.aborted, true);
    assert.equal(await counterValue(reader, 'notify.delivery', 'outcome', 'timeout'), 1);
    assert.equal(warns().length, 1);
    assertNoLeak();
  });

  it('a network error returns false, counts error and logs one WARN with the alert id and channel', async () => {
    const reader = install();
    useFetch(() => ({ throws: networkError('ECONNRESET') }));
    const sender = makeSender(API_KEY, { str: ADDRESSES });
    assert.equal(await sender.send(EMAIL, ALERT_ID), false);
    assert.equal(await counterValue(reader, 'notify.delivery', 'outcome', 'error'), 1);
    assert.equal(warns().length, 1);
    const meta = warns()[0].meta as Record<string, unknown>;
    assert.equal(meta.alertId, ALERT_ID);
    assert.equal(meta.channel, 'sendgrid');
    assertNoLeak();
  });
});

describe('SendgridSender.enabled / hasCredential', () => {
  it('@AC-22 without SENDGRID_API_KEY the sender is not enabled and has no credential', () => {
    const sender = makeSender(undefined, { str: ADDRESSES });
    assert.equal(sender.hasCredential(), false);
    assert.equal(sender.enabled(), false);
  });

  it('is not enabled while either address key is empty, and hasCredential ignores the addresses', () => {
    for (const missing of Object.keys(ADDRESSES)) {
      const sender = makeSender(API_KEY, { str: { ...ADDRESSES, [missing]: '' } });
      assert.equal(sender.enabled(), false, `${missing} empty`);
      assert.equal(sender.hasCredential(), true);
    }
  });

  it('sees a later change of an address key without a new instance', () => {
    const str: Record<string, string> = { ...ADDRESSES, 'fanout.sendgrid_to_email': '' };
    const sender = makeSender(API_KEY, { str });
    assert.equal(sender.enabled(), false);
    str['fanout.sendgrid_to_email'] = TO;
    assert.equal(sender.enabled(), true);
  });
});
