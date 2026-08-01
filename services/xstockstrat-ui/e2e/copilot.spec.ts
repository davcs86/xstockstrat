import { test, expect } from '@playwright/test';
import { addAuthCookie } from './helpers/auth';
import { COPILOT_NOTE_TEXT } from './fixtures';

/**
 * Copilot shallow-beta rail (feature 083, Step 27 / FR-4, FR-19). The rail is global (mounted in
 * PlatformHeader), default OFF, toggled from the top bar. It shows two client-side templated
 * reads (queue summary + concentration flag — no LLM), replays an append-only note thread from
 * the ledger, and carries the beta/read-only footer. There is NO edit/delete/clear affordance
 * (append-only precondition, F-06 / insights.md 2026-07-31).
 */
test.describe('Copilot rail', () => {
  test.beforeEach(async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
  });

  test('is off by default and toggles from the top bar', async ({ page }) => {
    await expect(page.getByTestId('copilot-toggle')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('copilot-rail')).toBeHidden();

    await page.getByTestId('copilot-toggle').click();
    await expect(page.getByTestId('copilot-rail')).toBeVisible();

    // Toggle closes it again.
    await page.getByTestId('copilot-toggle').click();
    await expect(page.getByTestId('copilot-rail')).toBeHidden();
  });

  test('shows the queue read, concentration flag and read-only beta footer', async ({ page }) => {
    await page.getByTestId('copilot-toggle').click();
    const rail = page.getByTestId('copilot-rail');
    await expect(rail).toBeVisible();

    await expect(page.getByTestId('copilot-queue-summary')).not.toHaveText('Reading the queue…', {
      timeout: 10000,
    });
    await expect(page.getByTestId('copilot-concentration')).toBeVisible();
    // Beta footer states the read-only guarantee.
    await expect(page.getByTestId('copilot-footer')).toContainText('read-only unless you confirm');
    // Append-only: no edit / delete / clear controls in the rail.
    await expect(rail.getByRole('button', { name: /edit|delete|clear/i })).toHaveCount(0);
  });

  test('persists a note to the append-only thread and replays it', async ({ page }) => {
    await page.getByTestId('copilot-toggle').click();
    await expect(page.getByTestId('copilot-rail')).toBeVisible();

    await page.getByLabel('Copilot note').fill(COPILOT_NOTE_TEXT);
    await page.getByRole('button', { name: 'Save note' }).click();

    // The note appears in the replayed thread (round-trips through the ledger mock).
    await expect(
      page.getByTestId('copilot-message').filter({ hasText: COPILOT_NOTE_TEXT }),
    ).toBeVisible({ timeout: 10000 });
    // Input clears after a successful append.
    await expect(page.getByLabel('Copilot note')).toHaveValue('');
  });
});
