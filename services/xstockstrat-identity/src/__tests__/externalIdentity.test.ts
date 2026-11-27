// Feature 345 external-identity RPCs. Static imports, no skip guard: a load failure must fail the suite.
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as jwt from 'jsonwebtoken';
import * as grpc from '@grpc/grpc-js';
import bcryptModule = require('bcrypt');
import {
  IdentityServiceImpl,
  SEED_ADMIN_PASSWORD_HASH,
} from '../grpc/identityServiceImpl';
import {
  EXTERNAL_IDENTITIES_ISSUER_USER_KEY,
  EXTERNAL_IDENTITIES_PKEY,
  EXTERNAL_IDENTITY_REFUSALS,
} from '../grpc/externalIdentity';
import { counterValue, install } from './fixtures/collectingReader';
import { fakeConfig } from './fixtures/fakeConfig';
import { callWith } from './fixtures/sanCall';

const reader = install();
const ISSUER = 'https://auth.example.test';
const SUBJECT = 'sub-123';
const ROLE_ADMIN = 1;
const ROLE_TRADER = 2;
const VECTORS = path.resolve(__dirname, '../../../../scripts/testdata/oidc-issuer-vectors.json');
const MIGRATION_007 = path.resolve(__dirname, '../../migrations/007_external_identities.up.sql');

type Step = { rows?: any[]; error?: any };

// A pool that answers each query from `script` in order and records every statement.
function scriptedPool(script: Step[] = []) {
  const queries: string[] = [];
  const params: any[][] = [];
  let i = 0;
  return {
    queries,
    params,
    async query(sql: string, p: any[] = []) {
      queries.push(sql.replace(/\s+/g, ' ').trim());
      params.push(p);
      const step = script[i++] ?? { rows: [] };
      if (step.error) throw step.error;
      return { rows: step.rows ?? [] };
    },
  };
}

function uniqueViolation(constraint: string) {
  return Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint,
  });
}

function recordingAudit() {
  const calls: Array<{ eventType: string; userId: string; metadata: any; payload: any }> = [];
  return {
    calls,
    async append(eventType: string, userId: string, metadata: any, payload: any) {
      calls.push({ eventType, userId, metadata, payload });
    },
  };
}

function impl(pool: any, mode?: string, audit: any = recordingAudit()) {
  const config = fakeConfig(mode === undefined ? {} : { strings: { 'auth.mode': mode } });
  return new IdentityServiceImpl(pool, config, audit);
}

function run(svc: any, method: string, call: any, request: Record<string, unknown>) {
  return new Promise<{ err: any; res: any }>((resolve) =>
    svc[method]({ ...call, request }, (err: any, res: any) => resolve({ err: err ?? null, res })),
  );
}

const UI = callWith('DNS:xstockstrat-ui');
const AGENT = callWith('DNS:xstockstrat-agent');
const linkFailures = (reason: string) =>
  counterValue(reader, 'identity.link.failures', 'reason', reason);
const USER_ROW = {
  user_id: 'u1',
  email: 'u@example.com',
  password_hash: SEED_ADMIN_PASSWORD_HASH,
  roles: ['trader'],
  is_active: true,
};
const LINK_REQ = { userId: 'u1', issuer: ISSUER, subject: SUBJECT, password: 'admin' };

let prevAppEnv: string | undefined;
beforeEach(() => {
  prevAppEnv = process.env.APPLICATION_ENV;
  delete process.env.APPLICATION_ENV;
  process.env.JWT_SECRET = 'feature-345-secret';
});
afterEach(() => {
  if (prevAppEnv === undefined) delete process.env.APPLICATION_ENV;
  else process.env.APPLICATION_ENV = prevAppEnv;
  mock.restoreAll();
});

describe('peer SAN gates (FR-4): denied before any pool access, headers ignored', () => {
  const cases: Array<[string, string, any, Record<string, unknown>]> = [
    ['@AC-27 Resolve from notify with an admin scope header', 'resolveExternalIdentity',
      callWith('DNS:xstockstrat-notify', { 'x-access-scope': '15' }), { issuer: ISSUER, subject: SUBJECT }],
    ['@AC-38 IssueSession from the agent', 'issueSessionForUser', AGENT, { userId: 'u1' }],
    ['@AC-70 Link from the agent', 'linkExternalIdentity', AGENT, LINK_REQ],
    ['@AC-73 GetLinks from the agent', 'getExternalIdentityLinks', AGENT, { userId: 'u1' }],
    ['Resolve from a prefix-extended SAN', 'resolveExternalIdentity',
      callWith('DNS:xstockstrat-uix'), { issuer: ISSUER, subject: SUBJECT }],
    ['Link with no auth context and spoofed headers', 'linkExternalIdentity',
      callWith(undefined, { 'x-user-id': 'u1', 'x-internal-caller': 'xstockstrat-ui' }, true), LINK_REQ],
  ];
  for (const [label, method, call, req] of cases) {
    it(label, async () => {
      const pool = scriptedPool();
      const { err } = await run(impl(pool, 'both'), method, call, req);
      assert.equal(err?.code, grpc.status.PERMISSION_DENIED);
      assert.match(err.message, /^peer not authorized for /);
      assert.equal(pool.queries.length, 0, 'no pool access before the SAN gate');
    });
  }

  it('the allowed peers pass the gate', async () => {
    for (const call of [UI, AGENT]) {
      const { err } = await run(impl(scriptedPool([{ rows: [] }])), 'resolveExternalIdentity', call, {
        issuer: ISSUER,
        subject: SUBJECT,
      });
      assert.equal(err.code, 9);
    }
  });
});

describe('ResolveExternalIdentity', () => {
  const req = { issuer: ISSUER, subject: SUBJECT };

  it('@AC-1 a linked active user resolves to its id and roles', async () => {
    const pool = scriptedPool([{ rows: [{ user_id: 'u1', roles: ['admin', 'trader'], is_active: true }] }]);
    const { err, res } = await run(impl(pool), 'resolveExternalIdentity', AGENT, req);
    assert.equal(err, null);
    assert.deepEqual(res, { userId: 'u1', roles: [ROLE_ADMIN, ROLE_TRADER], isActive: true });
  });

  it('@AC-2 the only statement is the JOIN select and the request carries no email', async () => {
    const pool = scriptedPool([{ rows: [{ user_id: 'u1', roles: [], is_active: true }] }]);
    await run(impl(pool), 'resolveExternalIdentity', UI, req);
    assert.equal(pool.queries.length, 1);
    assert.match(pool.queries[0], /^SELECT .* FROM identity\.external_identities e JOIN identity\.users u/);
    assert.deepEqual(pool.params[0], [ISSUER, SUBJECT]);
    assert.ok(!/email/i.test(pool.queries[0]), 'resolve never matches by email');
  });

  it('@AC-3 no link → 9 not linked', async () => {
    const { err } = await run(impl(scriptedPool([{ rows: [] }])), 'resolveExternalIdentity', UI, req);
    assert.deepEqual({ code: err.code, message: err.message }, { code: 9, message: 'not linked' });
  });

  it('@AC-6 in production an unknown subject is still not linked and nothing is written', async () => {
    process.env.APPLICATION_ENV = 'production';
    const pool = scriptedPool([{ rows: [] }]);
    const { err } = await run(impl(pool), 'resolveExternalIdentity', UI, req);
    assert.equal(err.message, 'not linked');
    assert.ok(pool.queries.every((q) => q.startsWith('SELECT')), 'resolve writes nothing');
  });

  it('@AC-7 an inactive linked user → 9 account inactive', async () => {
    const pool = scriptedPool([{ rows: [{ user_id: 'u1', roles: ['trader'], is_active: false }] }]);
    const { err } = await run(impl(pool), 'resolveExternalIdentity', UI, req);
    assert.deepEqual({ code: err.code, message: err.message }, { code: 9, message: 'account inactive' });
  });
});

describe('IssueSessionForUser', () => {
  it('an unknown user → 5', async () => {
    const { err } = await run(impl(scriptedPool([{ rows: [] }])), 'issueSessionForUser', UI, { userId: 'nope' });
    assert.equal(err.code, 5);
  });

  it('an inactive user → 9 and no refresh token', async () => {
    const pool = scriptedPool([{ rows: [{ ...USER_ROW, is_active: false }] }]);
    const { err } = await run(impl(pool), 'issueSessionForUser', UI, { userId: 'u1' });
    assert.deepEqual({ code: err.code, message: err.message }, { code: 9, message: 'account inactive' });
    assert.ok(!pool.queries.some((q) => /refresh_tokens/.test(q)));
  });

  it('@AC-4 @feature-265 mints the stored email, no aud, refresh client_id NULL', async () => {
    const pool = scriptedPool([{ rows: [USER_ROW] }, { rows: [] }]);
    const { err, res } = await run(impl(pool), 'issueSessionForUser', UI, { userId: 'u1' });
    assert.equal(err, null);
    assert.equal(res.claims.email, 'u@example.com');
    const decoded: any = (jwt as any).verify(res.accessToken, process.env.JWT_SECRET);
    assert.equal(decoded.email, 'u@example.com');
    assert.ok(!('aud' in decoded));
    const insert = pool.queries.findIndex((q) => /INSERT INTO identity\.refresh_tokens/.test(q));
    assert.ok(insert >= 0);
    assert.equal(pool.params[insert][3], null);
  });
});

describe('LinkExternalIdentity', () => {
  for (const mode of ['local', 'oidc', undefined]) {
    it(`@AC-75 auth.mode ${mode ?? 'absent'} → 9 link disabled, no pool access, no bcrypt`, async () => {
      const compare = mock.method(bcryptModule, 'compare');
      const pool = scriptedPool();
      const before = await linkFailures('link_disabled');
      const { err } = await run(impl(pool, mode), 'linkExternalIdentity', UI, LINK_REQ);
      assert.deepEqual({ code: err.code, message: err.message }, { code: 9, message: 'link disabled' });
      assert.equal(pool.queries.length, 0);
      assert.equal(compare.mock.callCount(), 0);
      assert.equal(await linkFailures('link_disabled'), before + 1);
    });
  }

  it('@AC-65 links with one INSERT and audits user_id, issuer, outcome under the caller x-user-id', async () => {
    const audit = recordingAudit();
    const pool = scriptedPool([{ rows: [USER_ROW] }, { rows: [] }]);
    const call = callWith('DNS:xstockstrat-ui', { 'x-user-id': 'u1' });
    const { err, res } = await run(impl(pool, 'both', audit), 'linkExternalIdentity', call, LINK_REQ);
    assert.equal(err, null);
    assert.deepEqual(res, {});
    const inserts = pool.queries.filter((q) => q.startsWith('INSERT'));
    assert.deepEqual(inserts, ['INSERT INTO identity.external_identities (issuer, subject, user_id) VALUES ($1, $2, $3)']);
    assert.deepEqual(pool.params[1], [ISSUER, SUBJECT, 'u1']);
    await new Promise(setImmediate);
    assert.equal(audit.calls.length, 1);
    assert.equal(audit.calls[0].eventType, 'identity.external.linked');
    assert.deepEqual(Object.keys(audit.calls[0].payload).sort(), ['issuer', 'outcome', 'user_id']);
    assert.deepEqual(audit.calls[0].metadata.get('x-user-id'), ['u1']);
  });

  it('@AC-66 a wrong password → 9 invalid credentials and no INSERT', async () => {
    const pool = scriptedPool([{ rows: [USER_ROW] }]);
    const before = await linkFailures('invalid_credentials');
    const { err } = await run(impl(pool, 'both'), 'linkExternalIdentity', UI, { ...LINK_REQ, password: 'wrong' });
    assert.deepEqual({ code: err.code, message: err.message }, { code: 9, message: 'invalid credentials' });
    assert.ok(!pool.queries.some((q) => q.startsWith('INSERT')));
    assert.equal(await linkFailures('invalid_credentials'), before + 1);
  });

  it('the blocked seed admin in production → invalid credentials', async () => {
    process.env.APPLICATION_ENV = 'production';
    const { err } = await run(impl(scriptedPool([{ rows: [USER_ROW] }]), 'both'), 'linkExternalIdentity', UI, LINK_REQ);
    assert.equal(err.message, 'invalid credentials');
  });

  it('an inactive account → 9 account inactive', async () => {
    const pool = scriptedPool([{ rows: [{ ...USER_ROW, is_active: false }] }]);
    const { err } = await run(impl(pool, 'both'), 'linkExternalIdentity', UI, LINK_REQ);
    assert.equal(err.message, 'account inactive');
  });

  it('@AC-67 a duplicate (issuer, user) → already linked to this issuer', async () => {
    const pool = scriptedPool([{ rows: [USER_ROW] }, { error: uniqueViolation(EXTERNAL_IDENTITIES_ISSUER_USER_KEY) }]);
    const { err } = await run(impl(pool, 'both'), 'linkExternalIdentity', UI, LINK_REQ);
    assert.deepEqual({ code: err.code, message: err.message }, { code: 9, message: 'already linked to this issuer' });
  });

  it('@AC-4 @AC-25 a subject owned by another user → account already linked, never mapDbError', async () => {
    const pool = scriptedPool([
      { rows: [USER_ROW] },
      { error: uniqueViolation(EXTERNAL_IDENTITIES_PKEY) },
      { rows: [{ user_id: 'u2' }] },
    ]);
    const before = await linkFailures('already_linked');
    const { err } = await run(impl(pool, 'both'), 'linkExternalIdentity', UI, LINK_REQ);
    assert.deepEqual({ code: err.code, message: err.message }, { code: 9, message: 'account already linked' });
    assert.equal(await linkFailures('already_linked'), before + 1);
  });

  it('a subject already owned by the same user → already linked to this issuer', async () => {
    const pool = scriptedPool([
      { rows: [USER_ROW] },
      { error: uniqueViolation(EXTERNAL_IDENTITIES_PKEY) },
      { rows: [{ user_id: 'u1' }] },
    ]);
    const { err } = await run(impl(pool, 'both'), 'linkExternalIdentity', UI, LINK_REQ);
    assert.equal(err.message, 'already linked to this issuer');
  });

  it('a vanished owner row → the INSERT is retried once', async () => {
    const pool = scriptedPool([
      { rows: [USER_ROW] },
      { error: uniqueViolation(EXTERNAL_IDENTITIES_PKEY) },
      { rows: [] },
      { rows: [] },
    ]);
    const { err } = await run(impl(pool, 'both'), 'linkExternalIdentity', UI, LINK_REQ);
    assert.equal(err, null);
    assert.equal(pool.queries.filter((q) => q.startsWith('INSERT')).length, 2);
  });

  it('a second unique violation after the retry → 13', async () => {
    const pool = scriptedPool([
      { rows: [USER_ROW] },
      { error: uniqueViolation(EXTERNAL_IDENTITIES_PKEY) },
      { rows: [] },
      { error: uniqueViolation(EXTERNAL_IDENTITIES_PKEY) },
      { rows: [] },
    ]);
    const { err } = await run(impl(pool, 'both'), 'linkExternalIdentity', UI, LINK_REQ);
    assert.equal(err.code, 13);
  });
});

describe('GetExternalIdentityLinks', () => {
  it('returns the issuers in order, and [] for an unknown user', async () => {
    const pool = scriptedPool([{ rows: [{ issuer: 'https://a.test' }, { issuer: 'https://b.test' }] }]);
    const { res } = await run(impl(pool), 'getExternalIdentityLinks', UI, { userId: 'u1' });
    assert.deepEqual(res, { issuers: ['https://a.test', 'https://b.test'] });
    assert.match(pool.queries[0], /ORDER BY issuer$/);
    const empty = await run(impl(scriptedPool([{ rows: [] }])), 'getExternalIdentityLinks', UI, { userId: 'x' });
    assert.deepEqual(empty.res, { issuers: [] });
  });

  it('@AC-50 identity leg: once the link rows are gone, Resolve is not linked and a new Link succeeds', async () => {
    const resolve = await run(impl(scriptedPool([{ rows: [] }])), 'resolveExternalIdentity', UI, {
      issuer: ISSUER,
      subject: SUBJECT,
    });
    assert.equal(resolve.err.message, 'not linked');
    const link = await run(impl(scriptedPool([{ rows: [USER_ROW] }, { rows: [] }]), 'both'), 'linkExternalIdentity', UI, LINK_REQ);
    assert.equal(link.err, null);
  });
});

describe('refusal contract (D-118, D-123)', () => {
  it('the refusal sets equal the shared vector file', () => {
    const vectors = JSON.parse(fs.readFileSync(VECTORS, 'utf8'));
    assert.deepEqual(EXTERNAL_IDENTITY_REFUSALS, vectors.refusals);
  });

  it('both constraint names are the CONSTRAINT names of migration 007', () => {
    const sql = fs.readFileSync(MIGRATION_007, 'utf8');
    for (const name of [EXTERNAL_IDENTITIES_PKEY, EXTERNAL_IDENTITIES_ISSUER_USER_KEY]) {
      assert.ok(sql.includes(`CONSTRAINT ${name} `), `migration 007 lacks CONSTRAINT ${name}`);
    }
  });
});
