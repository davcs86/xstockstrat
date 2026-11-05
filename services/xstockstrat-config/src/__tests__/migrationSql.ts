// Test-only helper (not a suite: the test glob matches *.test.js only); MIGRATIONS_DIR resolves from dist/__tests__/.
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations');

export function findOne(suffix: string, ext: 'up' | 'down'): string {
  const matches = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(`${suffix}.${ext}.sql`));
  assert.equal(
    matches.length,
    1,
    `expected exactly one *${suffix}.${ext}.sql, got ${JSON.stringify(matches)}`,
  );
  return fs.readFileSync(path.join(MIGRATIONS_DIR, matches[0]), 'utf8');
}

// Drops `--` comments and collapses whitespace, both only outside single-quoted literals.
export function splitStatements(sql: string): string[] {
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
