import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';

/**
 * Book → Exposure risk reframe (feature 083, Step 25). The positions table gains
 * Factor / Stop-distance / Flag columns backed by the additive Position risk fields
 * (factor, stopPrice, stopDistancePct, flag → POSITION_RISK_FLAG). Data comes from the
 * shared mock backend (e2e/mock-backend.ts) — the AAPL row carries factor 'Tech',
 * stopDistancePct 0.062, and flag 3 (STOP_NEAR); MSFT carries none and renders the
 * unclassified / em-dash fallbacks. The account context auto-selects the first active
 * broker account so ListPositions is issued without any manual selection.
 */
test.describe('Positions — Exposure risk', () => {
  test('renders Factor, Stop-distance and risk Flag columns', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader/positions');

    const aapl = page.getByRole('row', { name: /AAPL/ });
    await expect(aapl).toBeVisible({ timeout: 10000 });
    // Additive risk fields on the AAPL row.
    await expect(aapl).toContainText('Tech'); // factor
    await expect(aapl).toContainText('6.20%'); // stop distance (0.062)
    await expect(aapl.getByText('Stop near')).toBeVisible(); // flag → POSITION_RISK_FLAG STOP_NEAR

    // MSFT has no risk metadata → unclassified factor, em-dash stop/flag fallbacks.
    const msft = page.getByRole('row', { name: /MSFT/ });
    await expect(msft).toContainText('Unclassified');
  });
});
