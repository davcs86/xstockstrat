import { describe, it, expect } from 'vitest';
import { resolveDbConnection } from './dbTls';

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
      expect(result.ssl).toEqual({ rejectUnauthorized: true, ca: CA });
      expect(sslParams(result.connectionString)).toEqual([]);
    });
  }

  it('AC-6: missing sslmode requires a CA', () => {
    expect(() => resolveDbConnection(BASE, undefined)).toThrow(/DATABASE_CA_CERT/);
  });

  it('sslmode=require with an empty CA throws', () => {
    expect(() => resolveDbConnection(`${BASE}?sslmode=require`, '')).toThrow(/DATABASE_CA_CERT/);
  });

  it('sslmode=disabled is not treated as disable', () => {
    expect(() => resolveDbConnection(`${BASE}?sslmode=disabled`, undefined)).toThrow();
  });

  for (const [key, url] of [
    ['ssl', `${BASE}?ssl=0`],
    ['sslrootcert', `${BASE}?sslmode=require&sslrootcert=/x`],
    ['uselibpqcompat', `${BASE}?uselibpqcompat=true&sslmode=require`],
  ]) {
    it(`URL parameter ${key} is refused`, () => {
      expect(() => resolveDbConnection(url, CA)).toThrow(`"${key}"`);
    });
  }

  it('repeated sslmode is refused', () => {
    expect(() => resolveDbConnection(`${BASE}?sslmode=disable&sslmode=no-verify`, CA)).toThrow(
      /more than once/,
    );
  });

  it('sslmode=disable does not exempt an ssl parameter', () => {
    expect(() => resolveDbConnection(`${BASE}?sslmode=disable&ssl=true`, undefined)).toThrow(
      '"ssl"',
    );
  });

  it('AC-3/AC-8: sslmode=disable connects without a CA', () => {
    const input = `${BASE}?sslmode=disable`;
    expect(resolveDbConnection(input, undefined)).toEqual({ connectionString: input, ssl: false });
  });

  for (const input of ['', 'not a url secretpw']) {
    it(`invalid DATABASE_URL ${JSON.stringify(input)} throws without echoing it`, () => {
      let message = '';
      try {
        resolveDbConnection(input, CA);
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toBe('db-tls: DATABASE_URL is unset or invalid');
      expect(message).not.toContain('secretpw');
    });
  }
});
