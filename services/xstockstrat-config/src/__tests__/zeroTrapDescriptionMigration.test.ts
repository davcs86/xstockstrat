/**
 * @AC-11 (feature 244): the *_analysis_zero_trap_descriptions migration only rewrites descriptions,
 * every up UPDATE matches the 027/028 source text verbatim (no silent no-op), and down inverts up.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');
const SUFFIX = '_analysis_zero_trap_descriptions';
const SOURCE_FILES = [
  '027_analysis_readiness_materializer_keys.up.sql',
  '028_analysis_opportunity_keys.up.sql',
];
const LIT = "'((?:[^']|'')*)'";
const STATEMENT_RE = new RegExp(
  `^UPDATE config\\.config_values SET description = ${LIT} WHERE namespace = 'analysis' AND key = ${LIT} AND description = ${LIT}$`,
);
const FORBIDDEN = [/INSERT/i, /DELETE/i, /value_data/i, /value_type/i, /SET\s+key/i];

interface Update {
  raw: string;
  set: string;
  key: string;
  where: string;
}

function findOne(ext: 'up' | 'down'): string {
  const matches = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(`${SUFFIX}.${ext}.sql`));
  assert.equal(
    matches.length,
    1,
    `expected exactly one *${SUFFIX}.${ext}.sql, got ${JSON.stringify(matches)}`,
  );
  return fs.readFileSync(path.join(MIGRATIONS_DIR, matches[0]), 'utf8');
}

// Drops `--` comments and collapses whitespace, both only outside single-quoted literals.
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (inQuote) {
      cur += c;
      if (c === "'") {
        if (sql[i + 1] === "'") {
          cur += "'";
          i++;
        } else {
          inQuote = false;
        }
      }
    } else if (c === "'") {
      inQuote = true;
      cur += c;
    } else if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      cur += ' ';
    } else if (c === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else if (/\s/.test(c)) {
      if (!cur.endsWith(' ')) cur += ' ';
    } else {
      cur += c;
    }
  }
  assert.equal(inQuote, false, 'unterminated string literal');
  assert.equal(cur.trim(), '', `trailing statement without ';': ${cur.trim()}`);
  return out;
}

function parse(sql: string): Update[] {
  return splitStatements(sql).map((raw) => {
    const m = STATEMENT_RE.exec(raw);
    assert.ok(m, `statement is not a description-only UPDATE: ${raw}`);
    return { raw, set: m[1], key: m[2], where: m[3] };
  });
}

describe('zero-trap description migration (@AC-11)', () => {
  const up = parse(findOne('up'));
  const down = parse(findOne('down'));

  it('has four statements per direction, one per key', () => {
    assert.equal(up.length, 4);
    assert.equal(down.length, 4);
    assert.equal(new Set(up.map((u) => u.key)).size, 4);
    assert.equal(new Set(down.map((d) => d.key)).size, 4);
  });

  it('touches nothing but the description column', () => {
    for (const s of [...up, ...down]) {
      for (const re of FORBIDDEN) {
        assert.doesNotMatch(s.raw, re, `forbidden ${re} in: ${s.raw}`);
      }
      assert.notEqual(s.set, s.where, `no-op UPDATE for ${s.key}`);
    }
  });

  it('matches each up WHERE description verbatim against the 027/028 source text', () => {
    const sources = SOURCE_FILES.map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
    for (const u of up) {
      assert.ok(
        sources.some((src) => src.includes(`'${u.where}'`)),
        `WHERE description for ${u.key} not found verbatim in 027/028`,
      );
    }
  });

  it('down is the exact inverse of up for every key', () => {
    for (const u of up) {
      const d = down.find((x) => x.key === u.key);
      assert.ok(d, `no down statement for ${u.key}`);
      assert.equal(d.set, u.where, `down SET != up WHERE for ${u.key}`);
      assert.equal(d.where, u.set, `down WHERE != up SET for ${u.key}`);
    }
  });
});
