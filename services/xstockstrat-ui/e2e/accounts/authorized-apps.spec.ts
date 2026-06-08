import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * E2E for the /accounts "My Authorized Apps" page (feature 051 — covers Steps 6 + 7).
 *
 * The mock backend (globalSetup, port 9091) stubs IdentityService.listAuthorizedApps /
 * revokeAuthorizedApp, so Test 2 exercises the real BFF→gRPC path. Tests that need a state
 * transition (revoke → row disappears) or a specific agent-health result override the BFF at
 * the browser level with page.route, which is deterministic per-test.
 */

const APPS_BFF = '/accounts/api/authorized-apps';
const AGENT_HEALTH_BFF = '/accounts/api/agent-health';

// Stub the agent-health probe so the reachable/unreachable indicator is deterministic.
async function stubAgentHealth(page: Page, reachable: boolean): Promise<void> {
  await page.route(AGENT_HEALTH_BFF, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reachable }) }),
  );
}

test.describe('Accounts — My Authorized Apps', () => {
  test('unauthenticated visit redirects to /auth/login', async ({ page }) => {
    const res = await page.request.get('/accounts/authorized-apps', { maxRedirects: 0 });
    expect([302, 307]).toContain(res.status());
    expect(res.headers()['location'] ?? '').toContain('/auth/login');
  });

  test('authenticated session renders the authorized-apps table via the real BFF', async ({ page }) => {
    await addAuthCookie(page);
    await stubAgentHealth(page, false);
    await page.goto('/accounts/authorized-apps');

    // App name + client id from the mock backend row.
    await expect(page.getByText('Claude.ai (E2E)')).toBeVisible();
    await expect(page.getByText('oauthc_e2e')).toBeVisible();
    // The "Last refreshed" column is labeled per Step 4/7 semantics (not "Last used").
    await expect(page.getByRole('columnheader', { name: 'Last refreshed' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Disconnect' })).toBeVisible();
  });

  test('Disconnect → confirm → row disappears after revoke', async ({ page }) => {
    await addAuthCookie(page);
    await stubAgentHealth(page, false);

    // First list call returns one app; after revoke the refetch returns none.
    let listCalls = 0;
    await page.route(APPS_BFF, async (route) => {
      const method = route.request().method();
      if (method === 'POST') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) });
      }
      listCalls += 1;
      const apps = listCalls === 1
        ? [{ clientId: 'oauthc_e2e', clientName: 'Claude.ai (E2E)', authorizedAt: new Date().toISOString(), lastUsedAt: null, redirectUris: ['https://claude.ai/cb'] }]
        : [];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ apps }) });
    });

    page.on('dialog', (dialog) => dialog.accept());
    await page.goto('/accounts/authorized-apps');
    await expect(page.getByText('Claude.ai (E2E)')).toBeVisible();

    await page.getByRole('button', { name: 'Disconnect' }).click();
    await expect(page.getByText('Claude.ai (E2E)')).toHaveCount(0);
    await expect(page.getByText("haven't authorized any apps")).toBeVisible();
  });

  test('Connect section shows the agent URL, a copy control, and a reachable indicator', async ({ page }) => {
    await addAuthCookie(page);
    await stubAgentHealth(page, true);
    await page.goto('/accounts/authorized-apps');

    const urlField = page.getByLabel('MCP connector URL');
    await expect(urlField).toHaveValue('http://127.0.0.1:9099');
    await expect(page.getByRole('button', { name: /Copy/ })).toBeVisible();
    await expect(page.getByText('Reachable')).toBeVisible();
  });

  test('no token/secret strings appear in the rendered page', async ({ page }) => {
    await addAuthCookie(page);
    await stubAgentHealth(page, false);
    await page.goto('/accounts/authorized-apps');
    await expect(page.getByText('Claude.ai (E2E)')).toBeVisible();

    const html = await page.content();
    expect(html).not.toContain('test-refresh-token');
    expect(html.toLowerCase()).not.toContain('token_hash');
  });
});
