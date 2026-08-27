import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

const AUDIT_PAGE = '/config-ui/audit';

// Inline literal fixture rows — this spec is the first consumer of audit-log domain data (no
// existing fixture module per e2e/fixtures/INVENTORY.md), so per C-12 it stays inline until a
// second consumer appears. Distinct namespace/key/old/new/by/env/reason per row.
const AUDIT_ENTRIES = [
  {
    id: '1',
    namespace: 'platform',
    key: 'trading_state',
    oldValue: 'ACTIVE',
    newValue: 'REDUCE_ONLY',
    changedBy: 'alice@example.com',
    reason: 'Reducing exposure ahead of earnings',
    changedAt: new Date('2026-08-10T12:00:00Z').toISOString(),
    environment: 'staging',
    userId: '',
  },
  {
    id: '2',
    namespace: 'analysis',
    key: 'scoring.signal_decay_half_life_hours',
    oldValue: '24.0',
    newValue: '48.0',
    changedBy: 'bob@example.com',
    reason: 'Slow the signal age-decay',
    changedAt: new Date('2026-08-12T09:30:00Z').toISOString(),
    environment: 'staging',
    userId: 'u-42',
  },
];

test.describe('/config-ui/audit table content and sorting', () => {
  test('renders all 7 headers and every row field (AC-5 field-parity)', async ({ page }) => {
    await addAuthCookie(page);
    await page.route('**/config-ui/api/audit*', (route) =>
      route.fulfill({ json: { entries: AUDIT_ENTRIES } }),
    );
    await page.goto(AUDIT_PAGE);

    for (const header of [
      'When',
      'Namespace / Key',
      'Old Value',
      'New Value',
      'By',
      'Env / Scope',
      'Reason',
    ]) {
      await expect(page.getByRole('columnheader', { name: header })).toBeVisible();
    }

    for (const entry of AUDIT_ENTRIES) {
      const row = page.locator('tr', { hasText: `${entry.namespace}.${entry.key}` });
      await expect(row.getByText(entry.oldValue)).toBeVisible();
      await expect(row.getByText(entry.newValue)).toBeVisible();
      await expect(row.getByText(entry.changedBy)).toBeVisible();
      await expect(row.getByText(entry.environment)).toBeVisible();
      await expect(row.getByText(entry.userId ? `user:${entry.userId}` : 'global')).toBeVisible();
      await expect(row.getByText(entry.reason)).toBeVisible();
    }
  });

  // New sort capability (Step 1/7) — the plain pre-migration Table had no sort affordance, so
  // this has no pre-migration equivalent to satisfy; it is the red-before-green proof that
  // clicking a sortable header actually re-orders the rendered rows.
  test('clicking the "By" header re-orders the rendered rows', async ({ page }) => {
    await addAuthCookie(page);
    await page.route('**/config-ui/api/audit*', (route) =>
      route.fulfill({ json: { entries: AUDIT_ENTRIES } }),
    );
    await page.goto(AUDIT_PAGE);

    const rows = page.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    // Default order matches fixture order (alice, then bob).
    await expect(rows.nth(0)).toContainText('alice@example.com');
    await expect(rows.nth(1)).toContainText('bob@example.com');

    await page.getByRole('columnheader', { name: 'By' }).getByRole('button').click();
    await expect(rows.nth(0)).toContainText('alice@example.com');
    await expect(rows.nth(1)).toContainText('bob@example.com');

    // Second click reverses to descending — bob first.
    await page.getByRole('columnheader', { name: 'By' }).getByRole('button').click();
    await expect(rows.nth(0)).toContainText('bob@example.com');
    await expect(rows.nth(1)).toContainText('alice@example.com');
  });
});
