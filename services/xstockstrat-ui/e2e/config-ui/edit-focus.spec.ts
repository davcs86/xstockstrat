import { test, expect, type Page } from '@playwright/test';
import { addAdminCookie } from '../helpers/auth';
import { CONFIG_KEY_STUB_ROWS, listKeysStubBody } from '../fixtures';

/**
 * Feature 219 — typing into the inline edit form must never remount its inputs. Keystroke-level on
 * purpose: `.fill()` writes in one shot and hides the remount, and `toBeFocused` alone passes
 * vacuously because the value input's autoFocus re-steals focus on every remount.
 */
const ROW = CONFIG_KEY_STUB_ROWS.tradingState;

async function openEdit(page: Page) {
  await page.route('**/xstockstrat.config.v1.ConfigService/ListKeys', (route) =>
    route.fulfill({ contentType: 'application/json', body: listKeysStubBody([ROW]) }),
  );
  await addAdminCookie(page);
  await page.goto('/config-ui/platform?env=staging');
  const row = page.locator('tr', { hasText: ROW.key });
  await row.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  return row;
}

test.describe('Config-ui edit form focus stability (feature 219)', () => {
  test('AC-10: typing a reason keeps focus in the reason input', async ({ page }) => {
    const row = await openEdit(page);
    const valueInput = row.locator('input').first();
    const reasonInput = row.getByPlaceholder('Reason for this change');
    const prefill = await valueInput.inputValue();

    await reasonInput.click();
    await reasonInput.pressSequentially('halting for maintenance');

    await expect(reasonInput).toBeFocused();
    await expect(reasonInput).toHaveValue('halting for maintenance');
    await expect(valueInput).toHaveValue(prefill);
  });

  test('AC-11: typing a value keeps focus and the same input element', async ({ page }) => {
    const row = await openEdit(page);
    const valueInput = row.locator('input').first();
    await valueInput.fill('');
    await valueInput.evaluate((el) => el.setAttribute('data-probe', '1'));
    const probe = page.locator('[data-probe="1"]');

    for (const char of 'halted') {
      await page.keyboard.press(char);
      await expect(probe).toBeFocused();
    }
    await expect(probe).toHaveValue('halted');
  });
});
