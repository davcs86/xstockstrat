import { test, expect, type Page } from '@playwright/test';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { addAdminCookie, addAuthCookie } from '../helpers/auth';
import { CONFIG_KEY_STUB_ROWS, listKeysStubBody, setConfigStubBody } from '../fixtures';

/** Feature 219 — description under the key, last-updated cell, and refresh after save. */
const LIST_KEYS = '**/xstockstrat.config.v1.ConfigService/ListKeys';

async function stubListKeys(page: Page, rows: Parameters<typeof listKeysStubBody>[0]) {
  await page.route(LIST_KEYS, (route) =>
    route.fulfill({ contentType: 'application/json', body: listKeysStubBody(rows) }),
  );
}

function updatedSpan(page: Page, key: string) {
  return page.locator('tr', { hasText: key }).locator('td span[title]').last();
}

test.describe('Config-ui namespace editor rows (feature 219)', () => {
  test('AC-4: description renders clamped under the key with a full-text title', async ({
    page,
  }) => {
    const { fmpMetrics } = CONFIG_KEY_STUB_ROWS;
    await stubListKeys(page, [fmpMetrics, CONFIG_KEY_STUB_ROWS.fmpEnabled]);
    await page.setViewportSize({ width: 375, height: 800 });
    await addAuthCookie(page);
    await page.goto('/config-ui/marketdata?env=staging');

    const description = page.locator('tr', { hasText: fmpMetrics.key }).locator('p');
    await expect(description).toHaveText(fmpMetrics.description);
    await expect(description).toHaveAttribute('title', fmpMetrics.description);
    await expect(page.getByRole('columnheader', { name: 'Description' })).toHaveCount(0);
  });

  test('AC-5: an empty description renders no element', async ({ page }) => {
    const { fmpEnabled } = CONFIG_KEY_STUB_ROWS;
    await stubListKeys(page, [fmpEnabled]);
    await addAuthCookie(page);
    await page.goto('/config-ui/marketdata?env=staging');

    const keyCell = page.locator('tr', { hasText: fmpEnabled.key }).getByRole('cell').first();
    await expect(keyCell).toBeVisible();
    await expect(keyCell.locator('p')).toHaveCount(0);
  });

  test('AC-8: the last-updated cell shows a local time with the ISO instant as title', async ({
    page,
  }) => {
    const { tradingState } = CONFIG_KEY_STUB_ROWS;
    await stubListKeys(page, [tradingState, CONFIG_KEY_STUB_ROWS.example]);
    await addAuthCookie(page);
    await page.goto('/config-ui/platform?env=staging');

    const cell = updatedSpan(page, tradingState.key);
    await expect(cell).toHaveAttribute('title', '2026-09-15T08:30:00.000Z');
    await expect(cell).toHaveText(/2026/);
  });

  test('AC-9: a row without updatedAt shows a dash', async ({ page }) => {
    const { example } = CONFIG_KEY_STUB_ROWS;
    await stubListKeys(page, [CONFIG_KEY_STUB_ROWS.tradingState, example]);
    await addAuthCookie(page);
    await page.goto('/config-ui/platform?env=staging');

    await expect(page.locator('tr', { hasText: example.key }).getByRole('cell').nth(2)).toHaveText(
      '—',
    );
  });

  test('AC-12: saving refreshes the value and last-updated time without a reload', async ({
    page,
  }) => {
    const { tradingState } = CONFIG_KEY_STUB_ROWS;
    let saved = false;
    await page.route(LIST_KEYS, (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: listKeysStubBody([
          saved
            ? {
                ...tradingState,
                currentValue: 'halted',
                updatedAt: timestampFromDate(new Date('2026-10-02T09:00:00Z')),
              }
            : { ...tradingState, updatedAt: undefined },
        ]),
      }),
    );
    await page.route('**/xstockstrat.config.v1.ConfigService/SetConfig', (route) => {
      saved = true;
      return route.fulfill({ contentType: 'application/json', body: setConfigStubBody() });
    });
    await addAdminCookie(page);
    await page.goto('/config-ui/platform?env=staging');
    const url = page.url();

    const row = page.locator('tr', { hasText: tradingState.key });
    await row.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await row.locator('input').first().fill('halted');
    await row.getByPlaceholder('Reason for this change').fill('maintenance');
    await row.getByRole('button', { name: 'Save' }).click();

    await expect(row.getByRole('cell', { name: 'halted', exact: true })).toBeVisible();
    await expect(updatedSpan(page, tradingState.key)).toHaveAttribute(
      'title',
      '2026-10-02T09:00:00.000Z',
    );
    await expect(row.getByPlaceholder('Reason for this change')).toHaveCount(0);
    expect(page.url()).toBe(url);
  });

  test('a shared-mock row carries its updatedAt end to end through the real BFF', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui/platform?env=staging');

    await expect(updatedSpan(page, 'platform.log_level')).toHaveAttribute(
      'title',
      '2026-09-01T10:00:00.000Z',
    );
  });

  test('C-16 guard (@AC-6 @feature-161): decay half-life row keeps value, description, bounds', async ({
    page,
  }) => {
    const key = 'analysis.scoring.signal_decay_half_life_hours';
    await addAdminCookie(page);
    await page.goto('/config-ui/analysis?env=staging');

    const row = page.locator('tr', { hasText: key });
    const valueCell = row.getByRole('cell').nth(1);
    await expect(valueCell).not.toHaveText('');
    const shown = (await valueCell.innerText()).trim();
    await expect(row.locator('p[title]')).toHaveAttribute('title', /half-life in hours/);

    await row.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(row.locator('input').first()).toHaveValue(shown);
    await expect(page.getByText('Must be a number in [0, 8760].')).toBeVisible();
  });
});
