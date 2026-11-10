// Feature 305 Step 14: the dead-row migration is pinned to the sha256 its operator rehearsal records (F-01).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { findOne } from './migrationSql';

const SIGNOFF = path.resolve(__dirname, '../../../../scripts/config-heal/signoff.md');
const SIGNOFF_HEADING = '# Feature 305 — dead-row sign-off';
const SUFFIX = '_config_dead_rows_prune';

function recordedSha(): string {
  const text = fs.readFileSync(SIGNOFF, 'utf8');
  const at = text.indexOf(SIGNOFF_HEADING);
  assert.notEqual(at, -1, `${SIGNOFF_HEADING} is missing from signoff.md`);
  const match = /^- Migration file sha256: `([0-9a-f]{64})`/m.exec(text.slice(at));
  assert.ok(match, 'the sign-off section records no "Migration file sha256"');
  return match[1];
}

describe('feature 305 dead-row migration', () => {
  it('matches the sha256 recorded in its operator rehearsal', () => {
    assert.equal(crypto.createHash('sha256').update(findOne(SUFFIX, 'up')).digest('hex'), recordedSha(), 'up file changed after the rehearsal');
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
