import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as path from 'node:path';
import loggerModule = require('../services/logger');

type AuthModeModule = typeof import('../authMode');
interface ModeVector {
  name: string;
  value: string | null;
  expected: string;
  logs: boolean;
}

const VECTORS = path.resolve(__dirname, '../../../../scripts/testdata/oidc-issuer-vectors.json');
const modeRows: ModeVector[] = JSON.parse(fs.readFileSync(VECTORS, 'utf8')).mode;

const warns: Array<{ msg: string; meta: unknown }> = [];
const fakeLog = {
  debug: () => {},
  info: () => {},
  warn: (msg: unknown, meta?: unknown) => {
    warns.push({ msg: String(msg), meta });
  },
  error: () => {},
};
const invalidLogs = () => warns.filter((w) => w.msg === 'auth_mode_invalid').length;

// A config stub whose stored value is `stored`; undefined means the key is absent (default returned).
function stub(stored: () => string | undefined) {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    getString(_key: string, def = ''): string {
      calls++;
      const v = stored();
      return v === undefined ? def : v;
    },
  };
}

let m: AuthModeModule;

before(async () => {
  Object.assign(loggerModule, { getLogger: () => fakeLog });
  m = await import('../authMode');
});

beforeEach(() => {
  warns.length = 0;
  m.__resetAuthModeLogOnce();
});

describe('parseAuthMode', () => {
  it('every shared mode vector maps to its expected mode and invalid flag', () => {
    assert.equal(modeRows.length, 10);
    for (const row of modeRows) {
      const got = m.parseAuthMode(row.value ?? undefined);
      assert.deepEqual(got, { mode: row.expected, invalid: row.logs }, row.name);
    }
  });
});

describe('readAuthMode', () => {
  it('@AC-72 logs auth_mode_invalid once per distinct invalid value', () => {
    const cfg = stub(() => 'sso');
    assert.equal(m.readAuthMode(cfg), 'local');
    assert.equal(m.readAuthMode(cfg), 'local');
    assert.equal(invalidLogs(), 1);
    assert.deepEqual(warns[0].meta, { value: 'sso' });
    assert.equal(m.readAuthMode(stub(() => 'OIDC')), 'local');
    assert.equal(invalidLogs(), 2);
  });

  it('@AC-31 an absent row reads as local with no auth_mode_invalid', () => {
    assert.equal(m.readAuthMode(stub(() => undefined)), 'local');
    assert.equal(invalidLogs(), 0);
  });

  it('reads the namespace-relative key with local as the default', () => {
    const seen: Array<[string, string | undefined]> = [];
    m.readAuthMode({
      getString(key: string, def?: string) {
        seen.push([key, def]);
        return 'both';
      },
    });
    assert.deepEqual(seen, [['auth.mode', 'local']]);
  });
});

describe('watchAuthMode', () => {
  it('@AC-71 @AC-44 parses at once and again on every watcher update', () => {
    let value: string | undefined = 'both';
    const cfg = stub(() => value);
    const watcher = Object.assign(new EventEmitter(), { getString: cfg.getString.bind(cfg) });
    m.watchAuthMode(watcher);
    assert.equal(cfg.calls, 1);
    value = 'oidc';
    watcher.emit('update');
    assert.equal(cfg.calls, 2);
    assert.equal(invalidLogs(), 0);
    value = 'oidcc';
    watcher.emit('update');
    assert.equal(cfg.calls, 3);
    assert.equal(invalidLogs(), 1);
  });
});
