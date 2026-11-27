// C-12: the agent URL comes from the shared vector file; modes are scenario one-offs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { loadAuthMode } = vi.hoisted(() => ({ loadAuthMode: vi.fn() }));
vi.mock('@/lib/oidcConfig', () => ({ loadAuthMode }));

const { GET } = await import('./route');

const { prm } = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../../../../scripts/testdata/oidc-issuer-vectors.json', import.meta.url),
    ),
    'utf8',
  ),
) as { prm: { agent_public_url: string } };

const AGENT = prm.agent_public_url;
const TODAY = {
  issuer: AGENT,
  authorization_endpoint: `${AGENT}/oauth/authorize`,
  token_endpoint: `${AGENT}/oauth/token`,
  registration_endpoint: `${AGENT}/oauth/register`,
  code_challenge_methods_supported: ['S256'],
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
};

beforeEach(() => {
  vi.stubEnv('AGENT_PUBLIC_URL', AGENT);
  loadAuthMode.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('local and both serve today’s document', () => {
  test.each(['local', 'both'])('%s', async (mode) => {
    loadAuthMode.mockResolvedValue(mode);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(TODAY);
  });
});

test('@AC-49 oidc → 404', async () => {
  loadAuthMode.mockResolvedValue('oidc');
  expect((await GET()).status).toBe(404);
});

test('@AC-46 (guard) an unreadable mode → today’s document with issuer = AGENT_PUBLIC_URL', async () => {
  loadAuthMode.mockResolvedValue('error');
  const res = await GET();
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual(TODAY);
  expect(body.issuer).toBe(AGENT);
});
