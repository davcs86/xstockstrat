import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import {
  SIGNAL_SOURCE_SYSTEM,
  SIGNAL_SOURCE_WEIGHTED,
  SIGNAL_SOURCES,
  TEST_USER_ID,
} from '../fixtures';

/**
 * Feature 224 — Engine → Signal sources (/insights/signal-sources): each user manages their OWN
 * sources; system sources are listed read-only. Every call below traverses the real insights BFF
 * router to the mock backend (9093), whose ManageSignalSource enforces owner semantics and whose
 * SetConfig echoes the scope/secrecy flags it received.
 *
 * The @feature-161 @AC-4/@AC-5 guidance assertions were re-homed here from /config-ui/sources
 * (C-16 CHANGE, signed off 2026-10-06): same selectors and text, new route.
 */

const PAGE = '/insights/signal-sources';
const SET_CONFIG_BFF = '/insights/api/xstockstrat.config.v1.ConfigService/SetConfig';
const MANAGE_SOURCE_BFF = '/insights/api/xstockstrat.ingest.v1.IngestService/ManageSignalSource';
const isManage = (url: string) => url.includes('/ManageSignalSource');

async function callBff(
  page: Page,
  url: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return page.evaluate(
    async ({ url, body }) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
    { url, body },
  );
}

async function openPage(page: Page) {
  await addAuthCookie(page);
  await page.goto(PAGE);
  await expect(page.getByRole('heading', { name: 'Signal Sources' })).toBeVisible({
    timeout: 15000,
  });
}

test.describe('Own signal sources — list', () => {
  test('lists the caller’s sources and the system source with health + fed counts', async ({
    page,
  }) => {
    await openPage(page);
    for (const src of SIGNAL_SOURCES) {
      await expect(page.getByRole('cell', { name: src.slug, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('cell', { name: '128', exact: true })).toBeVisible();
    await expect(page.getByText('Sources live')).toBeVisible();
  });

  test('the system source row is read-only (no actions, no inline weight editor)', async ({
    page,
  }) => {
    await openPage(page);
    const slug = SIGNAL_SOURCE_SYSTEM.slug;
    const row = page.getByRole('row', { name: new RegExp(slug) });
    await expect(row.getByText('System', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: `Actions for ${slug}` })).toHaveCount(0);
    await page.getByTestId(`weight-${slug}`).click();
    await expect(page.getByLabel(`Weight for ${slug}`)).toHaveCount(0);
    // An owned row keeps its actions menu.
    await expect(
      page.getByRole('button', { name: `Actions for ${SIGNAL_SOURCE_WEIGHTED.slug}` }),
    ).toBeVisible();
  });

  test('a write to the system source is refused by the backend (owner semantics)', async ({
    page,
  }) => {
    await openPage(page);
    const { status, body } = await callBff(page, MANAGE_SOURCE_BFF, {
      source: { slug: SIGNAL_SOURCE_SYSTEM.slug, reliabilityWeight: 0.1 },
      operation: 'update',
      updateMask: 'reliabilityWeight',
    });
    expect(status).not.toBe(200);
    expect(JSON.stringify(body).toLowerCase()).toContain('read-only');
  });
});

test.describe('Own signal sources — edits through the real BFF', () => {
  test('editing a source without a new secret sends a mask that omits credentials_ref', async ({
    page,
  }) => {
    await openPage(page);
    await page.getByRole('button', { name: `Actions for ${SIGNAL_SOURCE_WEIGHTED.slug}` }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await page.getByPlaceholder('Display name').fill('Renamed Source');
    const req = page.waitForRequest((r) => isManage(r.url()) && r.method() === 'POST');
    const res = page.waitForResponse((r) => isManage(r.url()));
    await page.getByRole('button', { name: 'Save' }).click();
    const body = ((await req).postData() ?? '').toLowerCase();
    expect(body).toContain('update');
    expect(body).toContain('displayname');
    expect(body).not.toContain('credentialsref');
    expect((await res).status()).toBe(200);
  });

  test('the inline weight edit persists a masked reliability_weight update', async ({ page }) => {
    await openPage(page);
    const slug = SIGNAL_SOURCE_WEIGHTED.slug;
    const weightCell = page.getByTestId(`weight-${slug}`);
    await expect(weightCell).toHaveText(String(SIGNAL_SOURCE_WEIGHTED.reliabilityWeight));
    await weightCell.click();
    await page.getByLabel(`Weight for ${slug}`).fill('0.8');
    const req = page.waitForRequest((r) => isManage(r.url()) && r.method() === 'POST');
    const res = page.waitForResponse((r) => isManage(r.url()));
    await page.getByRole('button', { name: 'Save' }).click();
    const body = (await req).postData() ?? '';
    expect(body).toContain('updateMask');
    expect(body).toContain('reliabilityWeight');
    expect(body).toContain('0.8');
    const saved = (await (await res).json()) as { source: { reliabilityWeight: number } };
    expect(saved.source.reliabilityWeight).toBe(0.8);
    // The editor closes on success (the read-only cell button returns).
    await expect(page.getByLabel(`Weight for ${slug}`)).toHaveCount(0);
    await expect(page.getByTestId(`weight-${slug}`)).toBeVisible();
  });

  test('a weight outside [0,1] is rejected client-side (no ManageSignalSource call)', async ({
    page,
  }) => {
    await openPage(page);
    const slug = SIGNAL_SOURCE_WEIGHTED.slug;
    await page.getByTestId(`weight-${slug}`).click();
    await page.getByLabel(`Weight for ${slug}`).fill('1.5');
    let sawManage = false;
    page.on('request', (r) => {
      if (isManage(r.url()) && r.method() === 'POST') sawManage = true;
    });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Weight must be a number in [0, 1]')).toBeVisible();
    expect(sawManage).toBe(false);
  });
});

test.describe('Feature 161 — reliability_weight guidance (re-homed by feature 224)', () => {
  test('@feature-161 @AC-4 the create form sets reliability_weight and shows guidance', async ({
    page,
  }) => {
    await openPage(page);
    await page.getByRole('button', { name: 'Register New Source' }).click();
    await expect(page.getByText(/Higher weights rank this source/)).toBeVisible();

    await page.getByPlaceholder('e.g. unusual_whales').fill('insider-buys');
    await page.getByPlaceholder('Display name').fill('Insider Buys');
    await page.getByLabel('Reliability weight').fill('0.6');

    const req = page.waitForRequest((r) => isManage(r.url()) && r.method() === 'POST');
    const res = page.waitForResponse((r) => isManage(r.url()));
    await page.getByRole('button', { name: 'Register', exact: true }).click();
    const body = (await req).postData() ?? '';
    expect(body).toContain('register');
    expect(body).toContain('reliabilityWeight');
    expect(body).toContain('0.6');
    // The register is owned by the caller.
    const created = (await (await res).json()) as {
      source: { userId: string; reliabilityWeight: number };
    };
    expect(created.source.userId).toBe(TEST_USER_ID);
    expect(created.source.reliabilityWeight).toBe(0.6);
  });

  test('@feature-161 @AC-5 the inline weight editor shows guidance text', async ({ page }) => {
    await openPage(page);
    await page.getByTestId(`weight-${SIGNAL_SOURCE_WEIGHTED.slug}`).click();
    await expect(page.getByText(/Higher = this source/)).toBeVisible();
  });
});

test.describe('mcp_client bearer — per-user secret (feature 224)', () => {
  const TOKEN = 'sk-live-abc123';

  test('registering writes the bearer to mcp_credential.<uuid> as a secret, then credentials_ref', async ({
    page,
  }) => {
    await openPage(page);
    await page.getByRole('button', { name: 'Register New Source' }).click();
    await page.getByPlaceholder('e.g. unusual_whales').fill('acme-mcp');
    await page.getByPlaceholder('Display name').fill('Acme MCP');
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'mcp_client' }).click();
    await page.getByLabel('MCP endpoint').fill('https://mcp.acme.example/mcp');
    await page.getByLabel('MCP tool name').fill('get_signals');
    await page.getByLabel('Bearer token').fill(TOKEN);

    const setConfigReq = page.waitForRequest((r) => r.url().endsWith('/SetConfig'));
    const setConfigRes = page.waitForResponse((r) => r.url().endsWith('/SetConfig'));
    const manageReq = page.waitForRequest((r) => isManage(r.url()) && r.method() === 'POST');
    await page.getByRole('button', { name: 'Register', exact: true }).click();

    const sc = (await setConfigReq).postDataJSON() as {
      namespace: string;
      key: string;
      value: { stringVal: string; isSecret: boolean };
    };
    expect(sc.namespace).toBe('ingest');
    expect(sc.key).toMatch(/^mcp_credential\.[0-9a-f-]{36}$/);
    expect(sc.value.isSecret).toBe(true);
    expect(sc.value.stringVal).toBe(TOKEN);
    // What reached the config backend: forced per-user scope + secret + create.
    const scBody = (await (await setConfigRes).json()) as { version: string };
    expect(JSON.parse(scBody.version)).toEqual({
      userId: TEST_USER_ID,
      createKey: true,
      isSecret: true,
    });

    const mg = (await manageReq).postDataJSON() as {
      operation: string;
      credentialsRef: string;
      source: { sourceType: string };
    };
    expect(mg.operation).toBe('register');
    expect(mg.credentialsRef).toBe(`ingest.${sc.key}`);
    expect(mg.source.sourceType).toBe('mcp_client');

    await expect(page.getByLabel('Bearer token')).toHaveCount(0);
    expect(await page.textContent('body')).not.toContain(TOKEN);
  });

  test('the insights BFF forces isSecret, createKey and the session user on SetConfig', async ({
    page,
  }) => {
    await openPage(page);
    const { status, body } = await callBff(page, SET_CONFIG_BFF, {
      namespace: 'ingest',
      key: 'mcp_credential.0b4f7c3e-5d2a-4c1b-9e8f-1a2b3c4d5e6f',
      value: { stringVal: 'sk-plain', isSecret: false },
      createKey: false,
      userId: 'someone-else',
    });
    expect(status).toBe(200);
    expect(JSON.parse(body.version as string)).toEqual({
      userId: TEST_USER_ID,
      createKey: true,
      isSecret: true,
    });
  });

  for (const [why, namespace, key] of [
    ['a non-ingest namespace', 'platform', 'mcp_credential.0b4f7c3e'],
    ['a key outside mcp_credential.', 'ingest', 'poll_interval_seconds'],
  ]) {
    test(`the insights BFF rejects SetConfig for ${why}`, async ({ page }) => {
      await openPage(page);
      const { status, body } = await callBff(page, SET_CONFIG_BFF, {
        namespace,
        key,
        value: { stringVal: 'x' },
      });
      expect(status).not.toBe(200);
      expect(JSON.stringify(body)).toContain('mcp_credential');
    });
  }
});
