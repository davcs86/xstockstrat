// C-12: issuer and APP_URL strings are scenario one-offs from the shared vector file; no domain object.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { APP_URL_PATTERN, ISSUER_PATTERN, isValidIssuer } from './oidcIssuer';
import { parseAppOrigin } from './sameOrigin';

type Vectors = {
  issuer_pattern: string;
  app_url_pattern: string;
  issuer: { name: string; value: string; valid: boolean }[];
  app_url: { name: string; value: string | null; origin: string | null }[];
};

const VECTORS: Vectors = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../scripts/testdata/oidc-issuer-vectors.json', import.meta.url),
    ),
    'utf8',
  ),
);

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

test('the pattern constants equal the vector literals byte for byte', () => {
  expect(ISSUER_PATTERN).toBe(VECTORS.issuer_pattern);
  expect(APP_URL_PATTERN).toBe(VECTORS.app_url_pattern);
});

test('the vector file carries 66 issuer and 16 app_url rows', () => {
  expect(VECTORS.issuer).toHaveLength(66);
  expect(VECTORS.app_url).toHaveLength(16);
});

test.each(VECTORS.issuer)('issuer row $name → valid=$valid', ({ value, valid }) => {
  expect(isValidIssuer(value)).toBe(valid);
});

test.each(VECTORS.app_url)('app_url row $name → origin=$origin', ({ value, origin }) => {
  expect(parseAppOrigin(value ?? undefined)).toBe(origin);
});

test('@AC-54 a plain-http non-loopback issuer is invalid', () => {
  expect(isValidIssuer('http://auth.example.test')).toBe(false);
});
