import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveDbConnection } from '../dbTls';

const CA = '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----';
const BASE = 'postgres://u:secretpw@db.example:25060/xstockstrat';

function sslParams(connectionString: string): string[] {
  return [...new URL(connectionString).searchParams.keys()].filter((key) => {
    const k = key.toLowerCase();
    return k.startsWith('ssl') || k === 'uselibpqcompat';
  });
}

describe('resolveDbConnection', () => {
  for (const [name, url] of [
    ['sslmode=require', `${BASE}?sslmode=require`],
    ['AC-6: missing sslmode', BASE],
    ['sslmode=verify-full', `${BASE}?sslmode=verify-full`],
  ]) {
    it(`${name} with a CA verifies against it and strips ssl params`, () => {
      const result = resolveDbConnection(url, CA);
      assert.deepEqual(result.ssl, { rejectUnauthorized: true, ca: CA });
      assert.deepEqual(sslParams(result.connectionString), []);
    });
  }

  it('AC-6: missing sslmode requires a CA', () => {
    assert.throws(() => resolveDbConnection(BASE, undefined), /DATABASE_CA_CERT/);
  });

  it('sslmode=require with an empty CA throws', () => {
    assert.throws(() => resolveDbConnection(`${BASE}?sslmode=require`, ''), /DATABASE_CA_CERT/);
  });

  it('sslmode=disabled is not treated as disable', () => {
    assert.throws(() => resolveDbConnection(`${BASE}?sslmode=disabled`, undefined));
  });

  for (const [key, url] of [
    ['ssl', `${BASE}?ssl=0`],
    ['sslrootcert', `${BASE}?sslmode=require&sslrootcert=/x`],
    ['uselibpqcompat', `${BASE}?uselibpqcompat=true&sslmode=require`],
  ]) {
    it(`URL parameter ${key} is refused`, () => {
      assert.throws(() => resolveDbConnection(url, CA), new RegExp(`"${key}"`));
    });
  }

  it('repeated sslmode is refused', () => {
    assert.throws(
      () => resolveDbConnection(`${BASE}?sslmode=disable&sslmode=no-verify`, CA),
      /more than once/,
    );
  });

  it('sslmode=disable does not exempt an ssl parameter', () => {
    assert.throws(
      () => resolveDbConnection(`${BASE}?sslmode=disable&ssl=true`, undefined),
      /"ssl"/,
    );
  });

  it('AC-3/AC-8: sslmode=disable connects without a CA', () => {
    const input = `${BASE}?sslmode=disable`;
    assert.deepEqual(resolveDbConnection(input, undefined), {
      connectionString: input,
      ssl: false,
    });
  });

  for (const input of ['', 'not a url secretpw']) {
    it(`invalid DATABASE_URL ${JSON.stringify(input)} throws without echoing it`, () => {
      assert.throws(
        () => resolveDbConnection(input, CA),
        (err: Error) =>
          err.message === 'db-tls: DATABASE_URL is unset or invalid' &&
          !err.message.includes('secretpw'),
      );
    });
  }
});
