import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * E2E for the /accounts "MCP Tools" page — displays the tool catalog exposed by the agent's
 * GET /api/tools route. Stubbed at the browser level (page.route) since there's no mock HTTP
 * agent server in e2e, matching the agent-health stubbing pattern in authorized-apps.spec.ts.
 */

const TOOLS_BFF = '/accounts/api/mcp-tools';

const SAMPLE_TOOLS = [
  {
    name: 'ingest_signal',
    description: 'Ingest a trading signal into xstockstrat-ingest.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: "Ticker symbol e.g. 'NVDA'." },
        direction: { type: 'string' },
      },
      required: ['source', 'symbol', 'direction', 'valid_from'],
    },
  },
  {
    name: 'emit_alert',
    description: 'Emit an alert via xstockstrat-notify.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function stubMcpTools(page: Page, body: unknown): Promise<void> {
  await page.route(TOOLS_BFF, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

test.describe('Accounts — MCP Tools', () => {
  test('unauthenticated visit redirects to /auth/login', async ({ page }) => {
    const res = await page.request.get('/accounts/mcp-tools', { maxRedirects: 0 });
    expect([302, 307]).toContain(res.status());
    expect(res.headers()['location'] ?? '').toContain('/auth/login');
  });

  test('authenticated session renders the tool catalog', async ({ page }) => {
    await addAuthCookie(page);
    await stubMcpTools(page, { tools: SAMPLE_TOOLS, reachable: true });
    await page.goto('/accounts/mcp-tools');

    await expect(page.getByText('ingest_signal')).toBeVisible();
    await expect(page.getByText('Ingest a trading signal into xstockstrat-ingest.')).toBeVisible();
    await expect(page.getByText('emit_alert')).toBeVisible();
  });

  test('expanding a tool reveals its parameters', async ({ page }) => {
    await addAuthCookie(page);
    await stubMcpTools(page, { tools: SAMPLE_TOOLS, reachable: true });
    await page.goto('/accounts/mcp-tools');

    await page.getByText('ingest_signal').click();
    await expect(page.getByText('symbol', { exact: true })).toBeVisible();
    await expect(page.getByText('required').first()).toBeVisible();
  });

  test('unreachable agent shows an empty-state message instead of an empty list', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await stubMcpTools(page, { tools: [], reachable: false });
    await page.goto('/accounts/mcp-tools');

    await expect(page.getByText('The agent is unreachable')).toBeVisible();
  });
});
