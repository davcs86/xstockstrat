import { test, expect, type Page } from '@playwright/test';
import { addAdminCookie, addAuthCookie, BASE_URL } from '../helpers/auth';

/**
 * E2E for the config-ui "Run fundamentals scan" admin card (feature 156, AC-9).
 *
 * BFF path (config-ui AnalysisService, single method, admin-gated via forwardAdmin):
 *   POST /config-ui/api/xstockstrat.analysis.v1.AnalysisService/RunFundamentalsScan
 *
 * The config-ui BFF's analysisClient dials ANALYSIS_ENDPOINT (=9092 in e2e), so the mock handler
 * lives in the insights-port AnalysisService block of mock-backend.ts.
 */

const RUN_SCAN_BFF = '/config-ui/api/xstockstrat.analysis.v1.AnalysisService/RunFundamentalsScan';
const PAGE = `${BASE_URL}/config-ui/fundamentals-scan`;

async function postBff(page: Page, url: string): Promise<{ status: number }> {
  return page.evaluate(
    async ({ url }) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ force: false, dryRun: false, symbols: [] }),
      });
      return { status: res.status };
    },
    { url },
  );
}

test.describe('config-ui fundamentals scan', () => {
  test('nav: the Fundamentals Scan sub-nav item is reachable', async ({ page }) => {
    await addAdminCookie(page);
    await page.goto(`${BASE_URL}/config-ui`);
    const link = page.getByRole('link', { name: 'Fundamentals Scan' });
    await expect(link).toHaveAttribute('href', '/config-ui/fundamentals-scan');
    await link.click();
    await expect(page).toHaveURL(PAGE);
  });

  test('admin: running a scan renders the summary', async ({ page }) => {
    await addAdminCookie(page);
    await page.goto(PAGE);
    await page.getByTestId('run-scan-button').click();
    const summary = page.getByTestId('scan-summary');
    await expect(summary).toBeVisible();
    await expect(summary).toContainText('completed');
    await expect(summary).toContainText('Symbols processed: 3');
  });

  test('admin-gate: a non-admin session is rejected at the BFF route', async ({ page }) => {
    // A non-admin session reaches the BFF but forwardAdmin → requireAdminScope throws
    // PermissionDenied; Connect maps it to a non-2xx HTTP status.
    await addAuthCookie(page);
    await page.goto(PAGE);
    const { status } = await postBff(page, RUN_SCAN_BFF);
    expect(status).not.toBe(200);
  });

  test('admin-gate: an admin session is accepted at the BFF route', async ({ page }) => {
    await addAdminCookie(page);
    await page.goto(PAGE);
    const { status } = await postBff(page, RUN_SCAN_BFF);
    expect(status).toBe(200);
  });
});
