// Feature 296 Step 17: R is pinned to the sha256 its operator sign-off records; an edit after merge fails here (F-01).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MIGRATIONS_DIR } from './migrationSql';

const SIGNOFF = path.resolve(__dirname, '../../../../scripts/config-heal/signoff.md');
const SIGNOFF_HEADING = '# Feature 296 — R sign-off';
const CONTRACT_OF = '-- contract-of: services/xstockstrat-config/migrations/040_config_markers.up.sql';

function renameMigration(): { name: string; sql: string } {
  const found = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.up.sql'))
    .map((name) => ({ name, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8') }))
    .filter(({ sql }) => sql.split('\n').slice(0, 5).some((line) => line.trim() === CONTRACT_OF));
  assert.equal(found.length, 1, `expected one contract-of 040 migration, got ${found.map((m) => m.name)}`);
  return found[0];
}

function recordedSha(): string {
  const text = fs.readFileSync(SIGNOFF, 'utf8');
  const at = text.indexOf(SIGNOFF_HEADING);
  assert.notEqual(at, -1, `${SIGNOFF_HEADING} is missing from signoff.md`);
  const match = /^- R file sha256: `([0-9a-f]{64})`/m.exec(text.slice(at));
  assert.ok(match, 'the sign-off section records no "R file sha256"');
  return match[1];
}

describe('feature 296 rename migration R', () => {
  it('matches the sha256 recorded in its operator sign-off', () => {
    const { name, sql } = renameMigration();
    assert.equal(crypto.createHash('sha256').update(sql).digest('hex'), recordedSha(), `${name} changed after sign-off`);
  });

  it('holds no transaction statement (golang-migrate wraps the file)', () => {
    const { name, sql } = renameMigration();
    assert.doesNotMatch(sql, /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im, `${name} issues its own transaction statement`);
  });

  it('carries exactly one contract-of header, naming 040', () => {
    const { name, sql } = renameMigration();
    assert.equal(sql.split('\n').filter((line) => line.startsWith('-- contract-of:')).length, 1, name);
  });
});
