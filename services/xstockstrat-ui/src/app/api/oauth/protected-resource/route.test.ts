// C-12: the PRM contract comes from the shared vector file; config results are scenario one-offs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { loadAuthMode, loadAgentIssuer } = vi.hoisted(() => ({
  loadAuthMode: vi.fn(),
  loadAgentIssuer: vi.fn(),
}));
vi.mock('@/lib/oidcConfig', () => ({ loadAuthMode, loadAgentIssuer }));

const { GET } = await import('./route');

const { prm } = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../../../../scripts/testdata/oidc-issuer-vectors.json', import.meta.url),
    ),
    'utf8',
  ),
) as { prm: { agent_public_url: string; issuer: string; expected: Record<string, unknown> } };

const AGENT = prm.agent_public_url;
const TODAY = { resource: AGENT, authorization_servers: [AGENT] };

beforeEach(() => {
  vi.stubEnv('AGENT_PUBLIC_URL', AGENT);
  loadAuthMode.mockReset();
  loadAgentIssuer.mockReset();
  loadAgentIssuer.mockResolvedValue({ issuer: prm.issuer, valid: true });
});
afterEach(() => vi.unstubAllEnvs());

describe('local and both serve today’s document', () => {
  test.each(['local', 'both'])('%s', async (mode) => {
    loadAuthMode.mockResolvedValue(mode);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(TODAY);
    expect(loadAgentIssuer).not.toHaveBeenCalled();
  });
});

test('@AC-49/@AC-11 oidc + a valid agent issuer → deep-equals prm.expected', async () => {
  loadAuthMode.mockResolvedValue('oidc');
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(prm.expected);
});

test.each([
  ['@AC-55 an invalid issuer', { issuer: 'http://auth.example.test', valid: false }],
  ['an empty issuer', { issuer: '', valid: false }],
  ['@AC-78 an unreadable agent namespace', 'error'],
])('oidc + %s → 503 no-store', async (_, issuer) => {
  loadAuthMode.mockResolvedValue('oidc');
  loadAgentIssuer.mockResolvedValue(issuer);
  const res = await GET();
  expect(res.status).toBe(503);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(await res.text()).toBe('');
});

test('@AC-46 (guard) an unreadable mode → today’s document', async () => {
  loadAuthMode.mockResolvedValue('error');
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ resource: AGENT, authorization_servers: [AGENT] });
});
