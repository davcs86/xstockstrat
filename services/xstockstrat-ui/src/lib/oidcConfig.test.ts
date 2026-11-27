// C-12: config snapshots, issuers and secret values are scenario one-offs; no domain object.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Code, ConnectError } from '@connectrpc/connect';
import { Environment } from '@xstockstrat/proto/common/v1/common_pb';
import { __resetLogOnce } from './serverLog';

const getConfig = vi.fn();
const getSecret = vi.fn();
vi.mock('@/lib/connectClients', () => ({ configClient: { getConfig, getSecret } }));

const { loadAgentIssuer, loadAuthMode, loadOidcClientSecret, loadOidcConfig, parseAuthMode } =
  await import('./oidcConfig');

const VECTORS = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../scripts/testdata/oidc-issuer-vectors.json', import.meta.url),
    ),
    'utf8',
  ),
) as { mode: { name: string; value: string | null; expected: string; logs: boolean }[] };

const ISSUER = 'https://auth.example.test';
const APP = 'https://xstockstrat-staging.example.test';

const str = (value: string) => ({ value: { case: 'stringVal', value } });
type Snapshot = Record<string, Record<string, unknown>>;

function serve(snap: Snapshot) {
  getConfig.mockImplementation(async (req: { namespace: string }) => ({
    namespace: req.namespace,
    values: snap[req.namespace] ?? {},
  }));
}

const UI_OK = {
  'oidc.issuer': str(ISSUER),
  'oidc.client_id': str('xstockstrat-staging-web'),
};

const logged = (level: 'warn' | 'error', message: string) =>
  vi.mocked(console[level]).mock.calls.filter((c) => c[0] === message);

beforeEach(() => {
  __resetLogOnce();
  getConfig.mockReset();
  getSecret.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubEnv('APP_URL', APP);
  vi.stubEnv('APPLICATION_ENV', 'production');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('loadAuthMode', () => {
  test.each(VECTORS.mode)('vector row $name → $expected (logs=$logs) (@AC-72)', async (row) => {
    serve({ identity: row.value === null ? {} : { 'auth.mode': str(row.value) } });
    expect(await loadAuthMode()).toBe(row.expected);
    expect(logged('warn', 'auth_mode_invalid')).toHaveLength(row.logs ? 1 : 0);
  });

  test('@AC-31 an absent auth.mode reads as local with no log', async () => {
    serve({ identity: {} });
    expect(await loadAuthMode()).toBe('local');
    expect(console.warn).not.toHaveBeenCalled();
  });

  test('parseAuthMode follows identity: undefined → local, unknown → local + invalid', () => {
    expect(parseAuthMode(undefined)).toEqual({ mode: 'local', invalid: false });
    expect(parseAuthMode('oidc')).toEqual({ mode: 'oidc', invalid: false });
    expect(parseAuthMode('sso')).toEqual({ mode: 'local', invalid: true });
  });
});

describe('@AC-46/@AC-60 a rejection or timeout of each loader → error', () => {
  const faults = [
    new ConnectError('down', Code.Unavailable),
    new ConnectError('slow', Code.DeadlineExceeded),
  ];
  test.each(faults)('getConfig %s', async (err) => {
    getConfig.mockRejectedValue(err);
    expect(await loadAuthMode()).toBe('error');
    expect(await loadOidcConfig()).toBe('error');
    expect(await loadAgentIssuer()).toBe('error');
  });
  test.each(faults)('getSecret %s', async (err) => {
    getSecret.mockRejectedValue(err);
    expect(await loadOidcClientSecret()).toBe('error');
  });
});

describe('loadOidcConfig', () => {
  test('a valid issuer, client id and APP_URL → valid:true, no log', async () => {
    serve({ ui: UI_OK });
    expect(await loadOidcConfig()).toEqual({
      issuer: ISSUER,
      clientId: 'xstockstrat-staging-web',
      mcpClientIds: { claude: '', claudeReadonly: '', claudeCode: '', claudeCodeReadonly: '' },
      valid: true,
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  test('@AC-54 an http non-loopback issuer → valid:false + one sso_issuer_invalid', async () => {
    serve({ ui: { ...UI_OK, 'oidc.issuer': str('http://auth.example.test') } });
    expect(await loadOidcConfig()).toMatchObject({ valid: false });
    await loadOidcConfig();
    expect(logged('error', 'sso_issuer_invalid')).toEqual([
      ['sso_issuer_invalid', { reason: 'ui_issuer' }],
    ]);
  });

  test('an empty client_id → valid:false', async () => {
    serve({ ui: { ...UI_OK, 'oidc.client_id': str('') } });
    expect(await loadOidcConfig()).toMatchObject({ valid: false });
  });

  test('an invalid APP_URL → valid:false with only app_url_invalid', async () => {
    vi.stubEnv('APP_URL', `${APP}/`);
    serve({ ui: UI_OK });
    expect(await loadOidcConfig()).toMatchObject({ valid: false });
    expect(vi.mocked(console.error).mock.calls.map((c) => c[0])).toEqual(['app_url_invalid']);
  });

  test('@AC-48 the four mcp_client_id* values come back verbatim', async () => {
    serve({
      ui: {
        ...UI_OK,
        'oidc.mcp_client_id': str('claude-full'),
        'oidc.mcp_client_id_readonly': str('claude-ro'),
        'oidc.mcp_client_id_claude_code': str('cc-full'),
        'oidc.mcp_client_id_claude_code_readonly': str('cc-ro'),
      },
    });
    expect(await loadOidcConfig()).toMatchObject({
      mcpClientIds: {
        claude: 'claude-full',
        claudeReadonly: 'claude-ro',
        claudeCode: 'cc-full',
        claudeCodeReadonly: 'cc-ro',
      },
    });
  });
});

describe('every read', () => {
  test('production environment, global scope, a 10 s deadline and GetConfig with no headers', async () => {
    serve({ ui: UI_OK, identity: {}, agent: {} });
    getSecret.mockResolvedValue({ found: true, value: 's3cret' });
    await loadAuthMode();
    await loadOidcConfig();
    await loadAgentIssuer();
    await loadOidcClientSecret();
    expect(getConfig.mock.calls.map(([req]) => req.namespace)).toEqual(['identity', 'ui', 'agent']);
    for (const [req, opts] of getConfig.mock.calls) {
      expect(req).toMatchObject({ environment: Environment.PRODUCTION, userId: '' });
      expect(opts).toEqual({ timeoutMs: 10_000 });
    }
    const [[secretReq, secretOpts]] = getSecret.mock.calls;
    expect(secretReq).toMatchObject({
      namespace: 'ui',
      key: 'oidc.client_secret',
      environment: Environment.PRODUCTION,
      userId: '',
    });
    expect(secretOpts.timeoutMs).toBe(10_000);
  });

  test('an unset APPLICATION_ENV reads staging', async () => {
    vi.stubEnv('APPLICATION_ENV', undefined);
    serve({ identity: {} });
    await loadAuthMode();
    expect(getConfig.mock.calls[0][0].environment).toBe(Environment.STAGING);
  });
});

describe('loadOidcClientSecret', () => {
  test('@AC-35 getSecret carries exactly the x-internal-caller: ui header', async () => {
    getSecret.mockResolvedValue({ found: true, value: 's3cret' });
    expect(await loadOidcClientSecret()).toEqual({ found: true, value: 's3cret' });
    expect(getSecret.mock.calls[0][1].headers).toEqual({ 'x-internal-caller': 'ui' });
    const out = [...vi.mocked(console.warn).mock.calls, ...vi.mocked(console.error).mock.calls];
    expect(JSON.stringify(out)).not.toContain('s3cret');
  });

  test.each([
    { found: false, value: '' },
    { found: true, value: '' },
  ])('$found/$value → found:false', async (reply) => {
    getSecret.mockResolvedValue(reply);
    expect(await loadOidcClientSecret()).toEqual({ found: false });
  });
});

describe('loadAgentIssuer', () => {
  test('a valid agent issuer', async () => {
    serve({ agent: { 'oidc.issuer': str(ISSUER) } });
    expect(await loadAgentIssuer()).toEqual({ issuer: ISSUER, valid: true });
  });

  test('an invalid agent issuer logs sso_issuer_invalid with reason agent_issuer', async () => {
    serve({ agent: { 'oidc.issuer': str(`${ISSUER}/`) } });
    expect(await loadAgentIssuer()).toEqual({ issuer: `${ISSUER}/`, valid: false });
    expect(logged('error', 'sso_issuer_invalid')).toEqual([
      ['sso_issuer_invalid', { reason: 'agent_issuer' }],
    ]);
  });
});
