import { test, expect } from '@playwright/test';
import { addAdminCookie } from '../helpers/auth';

const PLATFORM_NAMESPACE_PAGE = '/config-ui/platform?env=staging';

/**
 * Regression coverage for the config-ui "editing configs" bug: Save appeared to silently
 * revert every edit because the Value column (and edit-prefill) read ConfigKeyMeta's
 * `defaultValue` — seed metadata that a write never touches (CONFIG-2) — instead of the
 * row's live `currentValue` (the `value_data` a SetConfig write actually updates). The write
 * itself succeeded; the UI just never displayed it, so a save looked like a no-op.
 *
 * These tests exercise NamespaceEditor's Value column/edit-prefill, the consumer this bug
 * affected. (Signal-source reliability weight is a first-class `SignalSource.reliabilityWeight`
 * field, covered directly by `sources.spec.ts`. The former `analysis.signals.source_weights`
 * config blob was removed entirely by feature 161; config-ui's per-key scalar validation is now
 * exercised via the `analysis.scoring.signal_decay_half_life_hours` FLOAT_SCALAR key.)
 */
test.describe('config-ui — a saved value replaces the displayed value (not the seed default)', () => {
  // Uses platform.trading_state, not platform.log_level — reason-capture.spec.ts and
  // api-smoke.spec.ts also drive platform.log_level (echoing/writing 'debug') against this
  // same mock backend singleton (started once in globalSetup, shared across the fullyParallel
  // run), so asserting an exact "before" value on that key would be racy. trading_state's
  // value is untouched by every other spec (positions-reconciliation.spec.ts stubs the
  // unrelated GetConfig RPC via page.route(), not ListKeys/SetConfig).
  test('editing platform.trading_state shows the new value after Save, not the old one', async ({
    page,
  }) => {
    await addAdminCookie(page);
    await page.goto(PLATFORM_NAMESPACE_PAGE);

    const row = page.locator('tr', { hasText: 'platform.trading_state' });
    await expect(row.getByRole('cell', { name: 'ACTIVE', exact: true })).toBeVisible();

    // Read-only-state Edit is behind a kebab menu (FR-2); Save/Cancel stay inline once editing
    // (not menu-gated — they're the primary action for a field being actively edited).
    await row.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await row.locator('input').first().fill('REDUCE_ONLY');
    // trading_state requires a non-empty reason (NamespaceEditor.handleSave) before Save calls SetConfig.
    await row.getByPlaceholder('Reason for this change').fill('e2e: verify save reflects');

    const respPromise = page.waitForResponse(
      (r) => r.url().includes('/SetConfig') && r.status() === 200,
    );
    await row.getByRole('button', { name: 'Save' }).click();
    await respPromise;

    // The row must exit edit mode and show the SAVED value — this is the assertion that
    // fails against the pre-fix code (it would show 'ACTIVE', the untouched seed default).
    await expect(row.getByRole('button', { name: 'Actions' })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'REDUCE_ONLY', exact: true })).toBeVisible();
    await expect(row.getByRole('cell', { name: 'ACTIVE', exact: true })).toHaveCount(0);

    // Re-editing must prefill from the saved value, not silently fall back to the default.
    await row.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(row.locator('input').first()).toHaveValue('REDUCE_ONLY');
  });

  test('a saved value survives a full page reload (mock backend is the source of truth, not local state)', async ({
    page,
  }) => {
    await addAdminCookie(page);
    await page.goto(PLATFORM_NAMESPACE_PAGE);

    const row = page.locator('tr', { hasText: 'platform.maintenance_mode' });
    await expect(row.getByRole('cell', { name: 'false', exact: true })).toBeVisible();

    await row.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await row.locator('input').first().fill('true');
    const respPromise = page.waitForResponse(
      (r) => r.url().includes('/SetConfig') && r.status() === 200,
    );
    await row.getByRole('button', { name: 'Save' }).click();
    await respPromise;

    await page.reload();
    const reloadedRow = page.locator('tr', { hasText: 'platform.maintenance_mode' });
    await expect(reloadedRow.getByRole('cell', { name: 'true', exact: true })).toBeVisible();
  });
});
