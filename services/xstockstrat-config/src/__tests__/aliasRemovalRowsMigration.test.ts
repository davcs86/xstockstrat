// Feature 306 Step 11: the alias-removal row migration is pinned to the sha256 its operator rehearsal records (F-01).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { findOne } from './migrationSql';

const SIGNOFF = path.resolve(__dirname, '../../../../scripts/config-heal/signoff.md');
const SIGNOFF_HEADING = '# Feature 306 — alias-removal row deletion';
const SUFFIX = '_config_alias_removal_rows';

function section(): string {
  const text = fs.readFileSync(SIGNOFF, 'utf8');
  const at = text.indexOf(SIGNOFF_HEADING);
  assert.notEqual(at, -1, `${SIGNOFF_HEADING} is missing from signoff.md`);
  return text.slice(at);
}

function recordedSha(): string {
  const match = /^- Migration file sha256: `([0-9a-f]{64})`/m.exec(section());
  assert.ok(match, 'the sign-off section records no "Migration file sha256"');
  return match[1];
}

describe('feature 306 alias-removal row migration', () => {
  it('matches the sha256 recorded in its operator rehearsal', () => {
    assert.equal(crypto.createHash('sha256').update(findOne(SUFFIX, 'up')).digest('hex'), recordedSha(), 'up file changed after the rehearsal');
  });

  it('records rehearsal counts per environment within the one-row-per-key bound', () => {
    const match = /^- Rehearsal counts \(DO dev, rolled back\): staging deleted (\d+), production deleted (\d+), out-of-scope (\d+)/m.exec(section());
    assert.ok(match, 'the sign-off section records no rehearsal counts');
    for (const n of [match[1], match[2]].map(Number)) assert.ok(Number.isInteger(n) && n >= 0 && n <= 3, `deleted count ${n} outside 0..3`);
  });

  it('names exactly the three target keys between the alias_removal_306 markers', () => {
    const sql = findOne(SUFFIX, 'up');
    const block = /-- alias_removal_306:begin([\s\S]*?)-- alias_removal_306:end/.exec(sql);
    assert.ok(block, 'the target block markers are missing');
    const pairs = [...block[1].matchAll(/\('([^']+)',\s*'([^']+)'\)/g)].map((m) => `${m[1]}/${m[2]}`).sort();
    assert.deepEqual(pairs, ['ledger/stream.notify_enabled', 'platform/log_level', 'trading/risk.daily_loss_limit']);
  });

  it('holds no transaction statement (golang-migrate wraps the file)', () => {
    for (const ext of ['up', 'down'] as const) {
      assert.doesNotMatch(findOne(SUFFIX, ext), /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im, `${ext} issues its own transaction statement`);
    }
  });

  it('is not a contract-of migration', () => {
    const head = findOne(SUFFIX, 'up').split('\n').slice(0, 5);
    assert.ok(!head.some((l) => l.startsWith('-- contract-of:')));
  });

  it('carries a number-free actor', () => {
    for (const ext of ['up', 'down'] as const) {
      assert.doesNotMatch(findOne(SUFFIX, ext), /config-migration-\d/, `${ext} embeds a migration number`);
    }
  });
});
