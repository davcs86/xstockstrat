import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { addAuthCookie, BASE_URL, signExpiredTestJwt } from '../helpers/auth';
import { readSsoRecord, resetSsoState, setSsoState, type SsoStubState } from '../helpers/stubIdp';
import {
  SSO_IDENTITY,
  SSO_LINK_CONFIRMATION,
  SSO_LINK_PASSWORD,
  SSO_STAGING_CLIENT_IDS,
  stubIssuer,
} from '../fixtures';
import { LINK_ERROR_MESSAGES, SSO_ERROR_MESSAGES } from '../../src/lib/ssoErrorCodes';

/**
 * Feature 345 SSO e2e. Every case changes the mock's global mode through the stub IdP, so this file
 * is serial and runs only in the one-worker `chromium-sso` project, after `chromium` (D-120).
 */
test.describe.configure({ mode: 'serial' });

const SIBLING = 'https://dashboard.example.test';
const AGENT = 'http://127.0.0.1:9099';
const INVALID_ISSUER = 'http://auth.example.test';
const PRM = '/.well-known/oauth-protected-resource/agent';
const AS = '/.well-known/oauth-authorization-server/agent';

async function state(request: APIRequestContext, patch: Partial<SsoStubState>): Promise<void> {
  await resetSsoState(request);
  await setSsoState(request, patch);
}

test.afterAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  await resetSsoState(ctx);
  await ctx.dispose();
});

const ssoButton = (page: Page) => page.getByRole('button', { name: 'Sign in with SSO' });
const passwordButton = (page: Page) => page.getByRole('button', { name: 'Sign in', exact: true });
const ssoRemember = (page: Page) =>
  page.getByRole('checkbox', { name: 'Keep me signed in for 14 days (SSO)' });

async function ssoSignIn(page: Page, opts: { remember?: boolean } = {}): Promise<void> {
  await page.goto('/auth/login');
  if (opts.remember) await ssoRemember(page).click();
  await ssoButton(page).click();
}

function idpErrorUrl(authorize: URL, error: string): string {
  const back = new URL(authorize.searchParams.get('redirect_uri')!);
  back.searchParams.set('error', error);
  back.searchParams.set('state', authorize.searchParams.get('state')!);
  return back.href;
}

/** Link: the authorize request starts its own navigation, so it can be intercepted (D-64). */
async function idpErrorOnAuthorize(page: Page, error: string): Promise<void> {
  await page.route(`${stubIssuer()}/authorize**`, async (route) => {
    const location = idpErrorUrl(new URL(route.request().url()), error);
    await route.fulfill({ status: 302, headers: { location } });
  });
}

/** Login: authorize is a redirect of /start, which Playwright cannot route, so rewrite /start's Location. */
async function idpErrorOnStart(page: Page, error: string): Promise<void> {
  await page.route('**/api/auth/sso/start', async (route) => {
    const res = await route.fetch({ maxRedirects: 0 });
    const location = idpErrorUrl(new URL(res.headers()['location']), error);
    await route.fulfill({ response: res, headers: { ...res.headers(), location } });
  });
}

const startPost = (request: APIRequestContext, origin: string | null) =>
  request.post('/api/auth/sso/start', {
    form: { redirect: '/trader' },
    headers: origin ? { origin } : {},
    maxRedirects: 0,
  });

test.describe('SSO login', () => {
  test('@AC-1 Sign in with SSO lands on /trader', async ({ page, request }) => {
    await state(request, { mode: 'oidc' });
    await ssoSignIn(page);
    await expect(page).toHaveURL(/\/trader(\/|$|\?)/);
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'access_token')?.value).toBeTruthy();
  });

  test('@AC-29 the SSO remember box → 14-day cookies; remember=1 only when checked', async ({
    page,
    request,
  }) => {
    await state(request, { mode: 'oidc' });
    const bodies: string[] = [];
    await page.route('**/api/auth/sso/start', async (route) => {
      bodies.push(route.request().postData() ?? '');
      await route.continue();
    });

    await ssoSignIn(page, { remember: true });
    await expect(page).toHaveURL(/\/trader/);
    let cookies = await page.context().cookies();
    const access = cookies.find((c) => c.name === 'access_token')!;
    expect(access.expires).toBeGreaterThan(Date.now() / 1000 + 13 * 86_400);
    expect(cookies.find((c) => c.name === 'remember_me')?.value).toBe('1');

    await page.context().clearCookies();
    await ssoSignIn(page);
    await expect(page).toHaveURL(/\/trader/);
    cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'access_token')!.expires).toBe(-1);

    expect(new URLSearchParams(bodies[0]).get('remember')).toBe('1');
    expect(new URLSearchParams(bodies[1]).get('remember')).toBeNull();
  });

  test('@AC-16 oidc → only the SSO button and checkbox', async ({ page, request }) => {
    await state(request, { mode: 'oidc' });
    await page.goto('/auth/login');
    await expect(ssoButton(page)).toBeVisible();
    await expect(ssoRemember(page)).toBeVisible();
    await expect(passwordButton(page)).toHaveCount(0);
    await expect(page.getByPlaceholder('Password')).toHaveCount(0);
  });

  test('@AC-17 both → both forms', async ({ page, request }) => {
    await state(request, { mode: 'both' });
    await page.goto('/auth/login');
    await expect(ssoButton(page)).toBeVisible();
    await expect(passwordButton(page)).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
  });

  for (const mode of ['both', 'oidc'] as const) {
    test(`@AC-3 not linked → the ${mode} message`, async ({ page, request }) => {
      await state(request, { mode, resolveRefusal: 'not linked' });
      await ssoSignIn(page);
      await expect(page).toHaveURL(/\/auth\/login\?error=not_linked/);
      await expect(page.getByText(SSO_ERROR_MESSAGES.not_linked[mode])).toBeVisible();
      expect((await page.context().cookies()).some((c) => c.name === 'access_token')).toBe(false);
    });
  }

  test('@AC-7 account inactive → the inactive message', async ({ page, request }) => {
    await state(request, { mode: 'oidc', resolveRefusal: 'account inactive' });
    await ssoSignIn(page);
    await expect(page.getByText(SSO_ERROR_MESSAGES.inactive)).toBeVisible();
  });

  test('@AC-51 access_denied → the no-access message', async ({ page, request }) => {
    await state(request, { mode: 'oidc' });
    await idpErrorOnStart(page, 'access_denied');
    await ssoSignIn(page);
    await expect(page).toHaveURL(/\/auth\/login\?error=no_access/);
    await expect(page.getByText(SSO_ERROR_MESSAGES.no_access)).toBeVisible();
  });

  test('@AC-59 a cross-origin POST → failed; GET → 405', async ({ request }) => {
    await state(request, { mode: 'oidc' });
    const res = await startPost(request, SIBLING);
    expect(res.status()).toBe(303);
    expect(res.headers()['location']).toBe(`${BASE_URL}/auth/login?error=failed`);
    expect((await request.get('/api/auth/sso/start', { maxRedirects: 0 })).status()).toBe(405);
  });

  test('@AC-54 an http non-loopback ui issuer → not_configured', async ({ page, request }) => {
    await state(request, { mode: 'oidc', uiIssuer: INVALID_ISSUER });
    const res = await startPost(request, BASE_URL);
    expect(res.headers()['location']).toBe(`${BASE_URL}/auth/login?error=not_configured`);
    await ssoSignIn(page);
    await expect(page.getByText(SSO_ERROR_MESSAGES.not_configured)).toBeVisible();
    expect((await readSsoRecord(request)).authorize).toEqual([]);
  });

  test('@AC-47 local with issuers set → /start and /callback 404', async ({ request }) => {
    await state(request, { mode: 'local' });
    expect((await startPost(request, BASE_URL)).status()).toBe(404);
    const cb = await request.get('/api/auth/sso/callback?code=c&state=s', { maxRedirects: 0 });
    expect(cb.status()).toBe(404);
  });

  test('@AC-60 config unreachable → failed', async ({ request }) => {
    await state(request, { mode: 'oidc', getConfigFails: true });
    const res = await startPost(request, BASE_URL);
    expect(res.headers()['location']).toBe(`${BASE_URL}/auth/login?error=failed`);
  });
});

test.describe('local and global fallbacks', () => {
  test('@AC-31 mode row absent → the password form only', async ({ page, request }) => {
    await resetSsoState(request);
    await page.goto('/auth/login');
    await expect(passwordButton(page)).toBeVisible();
    await expect(ssoButton(page)).toHaveCount(0);
  });

  test('@AC-44 oidc → local flips the next render', async ({ page, request }) => {
    await state(request, { mode: 'oidc' });
    await page.goto('/auth/login');
    await expect(ssoButton(page)).toBeVisible();
    await setSsoState(request, { mode: 'local' });
    await page.reload();
    await expect(passwordButton(page)).toBeVisible();
    await expect(ssoButton(page)).toHaveCount(0);
  });

  test('@AC-45 both with the issuer down → password login lands on /trader', async ({
    page,
    request,
  }) => {
    await state(request, { mode: 'both', down: true });
    await page.goto('/auth/login');
    await page.getByPlaceholder('Email').fill('test@example.com');
    await page.getByPlaceholder('Password').fill('test-password');
    await passwordButton(page).click();
    await expect(page).toHaveURL(/\/trader/);
  });

  test('@AC-46 config unreachable → password form and today’s discovery documents', async ({
    page,
    request,
  }) => {
    await state(request, { getConfigFails: true });
    await page.goto('/auth/login');
    await expect(passwordButton(page)).toBeVisible();
    await expect(ssoButton(page)).toHaveCount(0);
    const as = await request.get(AS);
    expect(as.status()).toBe(200);
    expect((await as.json()).issuer).toBe(AGENT);
    const prm = await request.get(PRM);
    expect((await prm.json()).authorization_servers).toEqual([AGENT]);
  });
});

test.describe('Sign out', () => {
  for (const mode of ['both', 'oidc'] as const) {
    test(`@AC-53/@AC-63 ${mode}: Sign out clears cookies and goes to the issuer portal`, async ({
      page,
      request,
    }) => {
      await state(request, { mode });
      await addAuthCookie(page);
      let portal = '';
      await page.route(`${stubIssuer()}/logout**`, async (route) => {
        portal = route.request().url();
        await route.fulfill({ status: 200, contentType: 'text/html', body: 'signed out' });
      });
      await page.goto('/trader');
      await page.getByRole('button', { name: 'Sign out' }).click();
      await expect.poll(() => portal).not.toBe('');
      expect(portal).toBe(
        `${stubIssuer()}/logout?rd=${encodeURIComponent(`${BASE_URL}/auth/login`)}`,
      );
      const cookies = await page.context().cookies(BASE_URL);
      expect(cookies.find((c) => c.name === 'access_token')).toBeUndefined();
    });
  }

  test('@AC-56 an invalid issuer → /auth/login', async ({ page, request }) => {
    await state(request, { mode: 'both', uiIssuer: INVALID_ISSUER });
    await addAuthCookie(page);
    await page.goto('/trader');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/auth\/login$/);
  });

  test('@AC-62 config unreachable → /auth/login', async ({ page, request }) => {
    await state(request, { mode: 'oidc', getConfigFails: true });
    await addAuthCookie(page);
    await page.goto('/trader');
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/auth\/login$/);
  });

  for (const mode of ['both', 'oidc'] as const) {
    test(`@AC-57 ${mode}: a cross-origin logout POST → 403, cookies unchanged`, async ({
      page,
      request,
    }) => {
      await state(request, { mode });
      await addAuthCookie(page);
      const before = (await page.context().cookies()).find((c) => c.name === 'access_token');
      const res = await page.request.post('/api/auth/logout', { headers: { origin: SIBLING } });
      expect(res.status()).toBe(403);
      const after = (await page.context().cookies()).find((c) => c.name === 'access_token');
      expect(after?.value).toBe(before?.value);
    });
  }

  test('@AC-64 an expired access token + refresh cookie → 200 JSON ok', async ({
    page,
    request,
  }) => {
    await state(request, { mode: 'both' });
    await page.context().addCookies([
      { name: 'access_token', value: await signExpiredTestJwt(), url: BASE_URL },
      { name: 'refresh_token', value: 'test-refresh-token', url: BASE_URL },
    ]);
    const res = await page.request.post('/api/auth/logout', { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test('D-63 mobile 375 px /trader: no overflow and Sign out reachable in the menu', async ({
    page,
    request,
  }) => {
    await state(request, { mode: 'oidc' });
    await addAuthCookie(page);
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/trader');
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Open menu' }).click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeInViewport();
  });
});

test.describe('accounts', () => {
  test('@AC-34/@AC-48 oidc → issuer link, connector URL, four client ids, no revoke', async ({
    page,
    request,
  }) => {
    await state(request, { mode: 'oidc' });
    await addAuthCookie(page);
    await page.goto('/accounts/authorized-apps');
    await expect(page.getByRole('link', { name: 'Open your sign-in provider' })).toHaveAttribute(
      'href',
      stubIssuer(),
    );
    await expect(page.getByRole('textbox', { name: 'MCP connector URL' })).toHaveValue(AGENT);
    await expect(page.getByRole('button', { name: 'Copy' })).toBeVisible();
    for (const id of Object.values(SSO_STAGING_CLIENT_IDS)) {
      await expect(page.getByText(id, { exact: true })).toBeVisible();
    }
    for (const label of [
      'Claude.ai (full access)',
      'Claude.ai (read-only)',
      'Claude Code (full access)',
      'Claude Code (read-only)',
    ]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole('button', { name: /Actions for/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Connect a new app' })).toHaveCount(0);
  });

  test('@AC-49 oidc → the PRM names the issuer and the AS document is 404', async ({ request }) => {
    await state(request, { mode: 'oidc' });
    const prm = await request.get(PRM);
    expect(prm.status()).toBe(200);
    expect((await prm.json()).authorization_servers).toEqual([stubIssuer()]);
    expect((await request.get(AS)).status()).toBe(404);
  });

  test('@AC-49 both → today’s documents', async ({ request }) => {
    await state(request, { mode: 'both' });
    expect(await (await request.get(PRM)).json()).toEqual({
      resource: AGENT,
      authorization_servers: [AGENT],
    });
    expect((await (await request.get(AS)).json()).issuer).toBe(AGENT);
  });
});

test.describe('Link SSO', () => {
  async function startLink(page: Page): Promise<void> {
    await page.goto('/accounts/sso');
    await Promise.all([
      page.waitForURL(/\/accounts\/sso/, { waitUntil: 'load' }),
      page.waitForResponse((r) => r.url().includes('/api/auth/sso/callback')),
      page.getByRole('button', { name: 'Link SSO' }).click(),
    ]);
  }

  test('@AC-65 Link SSO → confirm with the password → linked; then SSO sign-in works', async ({
    page,
    request,
  }) => {
    await state(request, { mode: 'both' });
    await addAuthCookie(page);
    await page.goto('/accounts/sso');
    await expect(page.getByTestId('sso-link-status')).toHaveText(/not linked/);
    await startLink(page);
    const { authorize } = await readSsoRecord(request);
    expect(authorize.at(-1)).toEqual({ prompt: 'login', max_age: '1' });

    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText(SSO_LINK_CONFIRMATION)).toBeVisible();
    await dialog.getByLabel('Your xstockstrat password').fill(SSO_LINK_PASSWORD);
    await dialog.getByRole('button', { name: 'Confirm link' }).click();
    await expect(page.getByTestId('sso-link-status')).toHaveText(/is linked/);
    await expect(dialog).toHaveCount(0);
    expect((await readSsoRecord(request)).links).toEqual([
      { userId: SSO_IDENTITY.userId, issuer: stubIssuer(), subject: SSO_IDENTITY.subject },
    ]);

    await page.context().clearCookies();
    await ssoSignIn(page);
    await expect(page).toHaveURL(/\/trader/);
  });

  test('@AC-66 a wrong password → "Incorrect password."', async ({ page, request }) => {
    await state(request, { mode: 'both' });
    await addAuthCookie(page);
    await startLink(page);
    const dialog = page.getByRole('alertdialog');
    await dialog.getByLabel('Your xstockstrat password').fill('wrong-password');
    await dialog.getByRole('button', { name: 'Confirm link' }).click();
    await expect(dialog.getByText(LINK_ERROR_MESSAGES.invalid_credentials)).toBeVisible();
  });

  for (const [ac, detail, code] of [
    ['@AC-67', 'already linked to this issuer', 'already_linked_self'],
    ['@AC-4', 'account already linked', 'already_linked_other'],
  ] as const) {
    test(`${ac} ${detail} → the ${code} message`, async ({ page, request }) => {
      await state(request, { mode: 'both', linkRefusal: detail });
      await addAuthCookie(page);
      await startLink(page);
      const dialog = page.getByRole('alertdialog');
      await dialog.getByLabel('Your xstockstrat password').fill(SSO_LINK_PASSWORD);
      await dialog.getByRole('button', { name: 'Confirm link' }).click();
      await expect(page.getByText(LINK_ERROR_MESSAGES[code])).toBeVisible();
      await expect(dialog).toHaveCount(0);
    });
  }

  for (const authTime of ['absent', 'stale'] as const) {
    test(`@AC-74 auth_time ${authTime} → failed, no confirmation`, async ({ page, request }) => {
      await state(request, { mode: 'both', authTime });
      await addAuthCookie(page);
      await startLink(page);
      await expect(page).toHaveURL(/\/accounts\/sso\?error=failed/);
      await expect(page.getByText(LINK_ERROR_MESSAGES.failed)).toBeVisible();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
    });
  }

  for (const [error, code] of [
    ['access_denied', 'no_access'],
    ['server_error', 'failed'],
  ] as const) {
    test(`@AC-76 ${error} on the link request → /accounts/sso ${code}`, async ({
      page,
      request,
    }) => {
      await state(request, { mode: 'both' });
      await addAuthCookie(page);
      await idpErrorOnAuthorize(page, error);
      await startLink(page);
      await expect(page).toHaveURL(new RegExp(`/accounts/sso\\?error=${code}`));
      await expect(page.getByText(LINK_ERROR_MESSAGES[code])).toBeVisible();
    });
  }

  for (const mode of ['local', 'oidc'] as const) {
    test(`@AC-69 ${mode} → status shown, no Link SSO, /link → 404`, async ({ page, request }) => {
      await state(request, { mode });
      await addAuthCookie(page);
      await page.goto('/accounts/sso');
      await expect(page.getByTestId('sso-link-status')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Link SSO' })).toHaveCount(0);
      const res = await page.request.post('/accounts/api/sso/link', {
        headers: { origin: BASE_URL },
      });
      expect(res.status()).toBe(404);
    });
  }
});
