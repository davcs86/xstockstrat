// Platform check housed in the UI suite: reads repo-root .do specs and the five DB services' src/ trees,
// so a deploy-spec or resolver-wiring drift in any of them fails this vitest run.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

const DB_SERVICES = [
  'xstockstrat-ledger',
  'xstockstrat-identity',
  'xstockstrat-notify',
  'xstockstrat-config',
  'xstockstrat-ui',
];
const CA_BINDING = '${xstockstrat.CA_CERT}';

const DBTLS_COPIES = [
  'services/xstockstrat-ledger/src/dbTls.ts',
  'services/xstockstrat-identity/src/dbTls.ts',
  'services/xstockstrat-notify/src/dbTls.ts',
  'services/xstockstrat-config/src/dbTls.ts',
  'services/xstockstrat-ui/src/lib/dbTls.ts',
];

const ENTRY_FILES = [
  'services/xstockstrat-ledger/src/index.ts',
  'services/xstockstrat-identity/src/index.ts',
  'services/xstockstrat-notify/src/index.ts',
  'services/xstockstrat-config/src/index.ts',
  'services/xstockstrat-ui/src/app/config-ui/api/audit/route.ts',
];
const LEDGER_ENTRY = 'services/xstockstrat-ledger/src/index.ts';

const RESOLVE_CALL = 'resolveDbConnection(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT)';
const SSL_ASSIGN = /\bssl:\s*([^,}\s]+)/g;
const ALLOWED_OTHER_SSL = [
  { file: 'services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts', text: 'ssl: opts.ssl' },
  {
    file: 'services/xstockstrat-ledger/src/services/eventRowResolver.ts',
    text: "ssl: ClientConfig['ssl']",
  },
];

type Env = { key?: unknown; value?: unknown };
type Component = { name?: unknown; envs?: Env[] };

function missingCa(spec: unknown): string[] {
  const doc = spec as Record<string, Component[] | undefined>;
  const components = [...(doc.services ?? []), ...(doc.workers ?? []), ...(doc.jobs ?? [])];
  return components
    .filter((c) => typeof c.name === 'string' && DB_SERVICES.includes(c.name))
    .filter((c) => (c.envs ?? []).some((e) => e.key === 'DATABASE_URL'))
    .filter(
      (c) => !(c.envs ?? []).some((e) => e.key === 'DATABASE_CA_CERT' && e.value === CA_BINDING),
    )
    .map((c) => c.name as string);
}

function readSpec(rel: string): unknown {
  return parse(readFileSync(ROOT + rel, 'utf8'));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(ROOT + dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sourceFiles(rel);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [rel] : [];
  });
}

function hasInlineTls(source: string): boolean {
  return source.includes('rejectUnauthorized') || source.includes("includes('sslmode");
}

function sslCaptures(source: string): string[] {
  return [...source.matchAll(SSL_ASSIGN)].map((m) => m[1]);
}

const SCANNED = DB_SERVICES.flatMap((svc) => sourceFiles(`services/${svc}/src`)).filter(
  (rel) => !rel.endsWith('/dbTls.ts'),
);
const read = (rel: string): string => readFileSync(ROOT + rel, 'utf8');

describe('AC-5: every direct-DB component binds DATABASE_CA_CERT', () => {
  it.each(['.do/app.yaml', '.do/app.dev.yaml'])('%s binds the CA for all five services', (rel) => {
    expect(missingCa(readSpec(rel))).toEqual([]);
  });

  it('flags xstockstrat-ui once its DATABASE_CA_CERT env is removed', () => {
    const clone = structuredClone(readSpec('.do/app.yaml')) as Record<string, Component[]>;
    const ui = clone.services.find((c) => c.name === 'xstockstrat-ui');
    expect(ui).toBeDefined();
    ui!.envs = (ui!.envs ?? []).filter((e) => e.key !== 'DATABASE_CA_CERT');
    expect(missingCa(clone)).toEqual(['xstockstrat-ui']);
  });
});

describe('C-18: dbTls.ts copies stay byte-identical', () => {
  it('the five copies hash to one SHA-256', () => {
    const hashes = new Set(
      DBTLS_COPIES.map((rel) => createHash('sha256').update(read(rel)).digest('hex')),
    );
    expect(hashes.size).toBe(1);
  });
});

describe('AC-2: DB TLS is wired only through resolveDbConnection', () => {
  it('no source file outside dbTls.ts builds TLS options inline', () => {
    expect(SCANNED.filter((rel) => hasInlineTls(read(rel)))).toEqual([]);
  });

  it.each(ENTRY_FILES)('%s resolves first and passes only dbConn.ssl', (rel) => {
    const source = read(rel);
    expect(source).toContain(RESOLVE_CALL);
    const captures = sslCaptures(source);
    expect(captures.length).toBeGreaterThan(0);
    expect(captures.every((c) => c === 'dbConn.ssl')).toBe(true);
  });

  it('ledger wires the Pool and the LISTEN client from dbConn', () => {
    const source = read(LEDGER_ENTRY);
    expect(sslCaptures(source)).toHaveLength(1);
    expect(source).toContain(
      'makeListenerClient(dbConn.connectionString, dbConn.ssl, configWatcher)',
    );
  });

  it('the only other ssl: hits are the two ledger allow-list entries', () => {
    const others = SCANNED.filter((rel) => !ENTRY_FILES.includes(rel)).flatMap((rel) =>
      read(rel)
        .split('\n')
        .filter((line) => sslCaptures(line).length > 0)
        .map((line) => ({ file: rel, line: line.trim() })),
    );
    expect(others).toHaveLength(ALLOWED_OTHER_SSL.length);
    for (const allowed of ALLOWED_OTHER_SSL) {
      expect(others.some((o) => o.file === allowed.file && o.line.includes(allowed.text))).toBe(
        true,
      );
    }
  });

  it('the inline-TLS scan flags the pre-fix pattern', () => {
    expect(
      hasInlineTls('ssl: sslDisabled ? false : { rejectUnauthorized: !!caCert, ca: caCert }'),
    ).toBe(true);
  });
});
