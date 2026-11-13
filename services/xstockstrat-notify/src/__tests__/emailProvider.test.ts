// Provider mode, base-configuration and route predicates (feature 338). Pure functions, no I/O.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  commsgunSettings,
  dispatchAction,
  emailMode,
  workerRoute,
  type DispatchAction,
  type EmailMode,
  type KeyKind,
  type WorkerRoute,
} from '../fanout/emailProvider.js';
import { fakeConfig } from './fixtures/fakeConfig.js';

const BASE = {
  'commsgun.enqueue_url': 'https://comms.example/v1/messages',
  'commsgun.app_id': 'xstockstrat-staging',
  'commsgun.to_email': 'ops@example.com',
};
const KINDS: KeyKind[] = ['key', 'absent', 'unknown'];

describe('emailProvider test harness', () => {
  it('imports the predicates', () => {
    for (const fn of [emailMode, commsgunSettings, dispatchAction, workerRoute]) assert.equal(typeof fn, 'function');
  });
});

describe('emailMode', () => {
  it('@AC-3 an unrecognised, empty or absent value is auto', () => {
    for (const stored of ['mailgun', '', 'AUTO', ' commsgun ', 'auto']) {
      assert.equal(emailMode(fakeConfig({ str: { 'fanout.email_provider': stored } })), 'auto', `stored=${stored}`);
    }
    assert.equal(emailMode(fakeConfig()), 'auto');
  });

  it('commsgun and sendgrid map to themselves', () => {
    assert.equal(emailMode(fakeConfig({ str: { 'fanout.email_provider': 'commsgun' } })), 'commsgun');
    assert.equal(emailMode(fakeConfig({ str: { 'fanout.email_provider': 'sendgrid' } })), 'sendgrid');
  });
});

describe('commsgunSettings', () => {
  it('returns the three values trimmed, with the base set', () => {
    const padded = Object.fromEntries(Object.entries(BASE).map(([k, v]) => [k, `  ${v} `]));
    assert.deepEqual(commsgunSettings(fakeConfig({ str: padded })), {
      url: BASE['commsgun.enqueue_url'],
      appId: BASE['commsgun.app_id'],
      to: BASE['commsgun.to_email'],
      baseSet: true,
    });
  });

  it('@AC-19 the base is not set when any one of the three is empty, whitespace or absent', () => {
    for (const missing of Object.keys(BASE)) {
      for (const blank of ['', '   ']) {
        const settings = commsgunSettings(fakeConfig({ str: { ...BASE, [missing]: blank } }));
        assert.equal(settings.baseSet, false, `${missing}="${blank}"`);
      }
      const { [missing as keyof typeof BASE]: _dropped, ...rest } = BASE;
      assert.equal(commsgunSettings(fakeConfig({ str: rest })).baseSet, false, `${missing} absent`);
    }
    assert.equal(commsgunSettings(fakeConfig()).baseSet, false);
  });
});

describe('dispatchAction', () => {
  // design.md § Readiness, every mode × base × key state.
  const table: Array<[EmailMode, boolean, KeyKind, DispatchAction]> = [
    ['sendgrid', true, 'key', 'sendgrid'],
    ['sendgrid', true, 'absent', 'sendgrid'],
    ['sendgrid', true, 'unknown', 'sendgrid'],
    ['sendgrid', false, 'key', 'sendgrid'],
    ['sendgrid', false, 'absent', 'sendgrid'],
    ['sendgrid', false, 'unknown', 'sendgrid'],
    ['auto', true, 'key', 'queue'],
    ['auto', true, 'absent', 'sendgrid'], // AC-19: secret absent
    ['auto', true, 'unknown', 'sendgrid'], // AC-19: GetSecret fails
    ['auto', false, 'key', 'sendgrid'],
    ['auto', false, 'absent', 'sendgrid'],
    ['auto', false, 'unknown', 'sendgrid'],
    ['commsgun', true, 'key', 'queue'],
    ['commsgun', true, 'absent', 'queue'],
    ['commsgun', true, 'unknown', 'queue'],
    ['commsgun', false, 'key', 'unconfigured'],
    ['commsgun', false, 'absent', 'unconfigured'],
    ['commsgun', false, 'unknown', 'unconfigured'],
  ];

  it('@AC-19 matches the readiness table for all 18 combinations', () => {
    assert.equal(table.length, 3 * 2 * KINDS.length);
    for (const [mode, baseSet, kind, want] of table) {
      assert.equal(dispatchAction(mode, baseSet, kind), want, `${mode} base=${baseSet} key=${kind}`);
    }
  });
});

describe('workerRoute', () => {
  const table: Array<[EmailMode, boolean, KeyKind, WorkerRoute]> = [
    ['commsgun', true, 'key', 'attempt'],
    ['commsgun', true, 'absent', 'attempt'],
    ['commsgun', true, 'unknown', 'attempt'],
    ['commsgun', false, 'key', 'attempt'],
    ['commsgun', false, 'absent', 'attempt'],
    ['commsgun', false, 'unknown', 'attempt'],
    ['sendgrid', true, 'key', 'reroute_deliberate'],
    ['sendgrid', true, 'absent', 'reroute_deliberate'],
    ['sendgrid', true, 'unknown', 'reroute_deliberate'],
    ['sendgrid', false, 'key', 'reroute_deliberate'],
    ['sendgrid', false, 'absent', 'reroute_deliberate'],
    ['sendgrid', false, 'unknown', 'reroute_deliberate'],
    ['auto', true, 'key', 'attempt'],
    ['auto', true, 'absent', 'reroute_lost'],
    ['auto', true, 'unknown', 'hold'],
    ['auto', false, 'key', 'reroute_lost'],
    ['auto', false, 'absent', 'reroute_lost'],
    ['auto', false, 'unknown', 'reroute_lost'], // AC-42: never hold without the base
  ];

  it('@AC-42 matches the route table for all 18 combinations', () => {
    assert.equal(table.length, 3 * 2 * KINDS.length);
    for (const [mode, baseSet, kind, want] of table) {
      assert.equal(workerRoute(mode, baseSet, kind), want, `${mode} base=${baseSet} key=${kind}`);
    }
  });

  it('@AC-3 an unrecognised stored mode gives the auto routes', () => {
    const mode = emailMode(fakeConfig({ str: { 'fanout.email_provider': 'mailgun' } }));
    assert.equal(workerRoute(mode, true, 'key'), 'attempt');
    assert.equal(workerRoute(mode, true, 'unknown'), 'hold');
    assert.equal(workerRoute(mode, false, 'unknown'), 'reroute_lost');
  });
});
