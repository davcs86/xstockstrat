// C-12: the refusal details come from the shared vector file; no domain object.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { SSO_REFUSALS } from './ssoRefusals';

const VECTORS = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../scripts/testdata/oidc-issuer-vectors.json', import.meta.url),
    ),
    'utf8',
  ),
) as { refusals: Record<string, string[]> };

test('SSO_REFUSALS deep-equals the vector refusals (identity, agent and UI share them, D-123)', () => {
  expect(SSO_REFUSALS).toEqual(VECTORS.refusals);
});
