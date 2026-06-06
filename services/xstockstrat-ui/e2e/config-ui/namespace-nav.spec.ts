import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * E2E tests for the namespace list dashboard (app/page.tsx).
 *
 * The homepage is a server component — no API calls to mock here.
 * It renders KNOWN_NAMESPACES as cards with links that preserve env/mode params.
 *
 * Auth cookie is injected directly so the middleware does not redirect to /login.
 */

const KNOWN_NAMESPACES = [
  'platform', 'trading', 'portfolio', 'marketdata', 'indicators',
  'ingest', 'analysis', 'ledger', 'identity', 'notify',
];

test.describe('Namespace dashboard', () => {
  test('renders all 10 namespace cards', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui');

    for (const ns of KNOWN_NAMESPACES) {
      await expect(page.getByText(ns).first()).toBeVisible();
    }
  });

  test('each namespace card links to /<namespace> with env and mode params', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui?env=dev&mode=paper');

    // Click the first namespace card
    await page.getByText('platform').first().click();

    await expect(page).toHaveURL(/\/platform\?env=dev&mode=paper/);
  });

  test('env and mode params are preserved when clicking different namespaces', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui?env=production&mode=live');

    await page.getByText('trading').first().click();

    await expect(page).toHaveURL(/\/trading\?env=production&mode=live/);
  });

  test('"Configuration Namespaces" heading is visible', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui');
    await expect(page.getByText('Configuration Namespaces')).toBeVisible();
  });

  test('namespace cards show "namespace" label text', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui');
    // Each card has a "namespace" label below the namespace name
    const labels = page.getByText('namespace');
    await expect(labels.first()).toBeVisible();
  });
});
