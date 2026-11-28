import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { MCP_SCOPES_SUPPORTED } from './mcpScopes';

const { prm } = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../scripts/testdata/oidc-issuer-vectors.json', import.meta.url),
    ),
    'utf8',
  ),
) as { prm: { expected: { scopes_supported: string[] } } };

test('MCP_SCOPES_SUPPORTED equals the vector prm.expected.scopes_supported', () => {
  expect([...MCP_SCOPES_SUPPORTED]).toEqual(prm.expected.scopes_supported);
});
