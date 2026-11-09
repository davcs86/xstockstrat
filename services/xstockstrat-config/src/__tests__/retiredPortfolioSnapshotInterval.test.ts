import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Compiled into dist/__tests__/, so two levels up is the service root.
const MIGRATIONS = join(__dirname, '..', '..', 'migrations');
const KEY_LITERALS = ["'portfolio.snapshot.interval_minutes'", "'snapshot.interval_minutes'"];

interface UpMigration {
  name: string;
  num: number;
  statements: string[];
}

function normalise(stmt: string): string {
  return stmt
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function loadUpMigrations(): UpMigration[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.up.sql'))
    .map((name) => ({
      name,
      num: parseInt(name.slice(0, 3), 10),
      statements: readFileSync(join(MIGRATIONS, name), 'utf8').split(';').map(normalise),
    }))
    .sort((a, b) => a.num - b.num);
}

const namesKey = (stmt: string): boolean => KEY_LITERALS.some((k) => stmt.includes(k));

describe('retired portfolio snapshot interval key', () => {
  it('@AC-5 portfolio.snapshot.interval_minutes is retired by the config migration set', () => {
    const ups = loadUpMigrations();
    const matching = ups.filter((m) => m.statements.some(namesKey));
    assert.ok(matching.length > 0, `no up migration in ${MIGRATIONS} names the key`);

    const highest = matching[matching.length - 1];
    const deletes = highest.statements.filter(
      (s) =>
        s.startsWith('delete from config.config_values') &&
        s.includes("namespace = 'portfolio'") &&
        namesKey(s),
    );
    assert.ok(
      deletes.length > 0,
      `${highest.name}: highest-numbered match must DELETE the key from config.config_values in namespace 'portfolio'`,
    );

    for (const m of ups.filter((u) => u.num >= highest.num)) {
      const reinserts = m.statements.filter(
        (s) => s.startsWith('insert into config.config_values') && namesKey(s),
      );
      assert.equal(reinserts.length, 0, `${m.name}: re-inserts the retired key at or after ${highest.name}`);
    }
  });
});
