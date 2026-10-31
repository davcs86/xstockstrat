import { test, expect, type Locator, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import {
  BROKER_ACCOUNT_ALPACA,
  BROKER_ACCOUNT_IBKR,
  BROKER_ACCOUNT_NEW,
  IBKR_TEST_CREDENTIALS_INPUT,
} from '../fixtures';

/**
 * E2E tests for AccountSelector and AccountManagementPanel.
 *
 * ListBrokerAccounts and RegisterBrokerAccount are intercepted via page.route on
 * the BFF Connect paths (glob: "**TradingService/ListBrokerAccounts", etc.) rather than
 * the non-existent /trader/api/accounts REST route. The Connect JSON response uses
 * camelCase proto field names (id, displayName, brokerType, isPaper, isActive).
 */

test.describe('AccountSelector', () => {
  test('Account Selector is visible in the header', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    await expect(page.getByRole('combobox').first()).toBeVisible({ timeout: 5000 });
  });

  test('Place Order button is disabled when no account is selected', async ({ page }) => {
    await page.route(
      '**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ accounts: [] }),
        });
      },
    );
    await addAuthCookie(page);
    await page.goto('/trader');
    const submitBtn = page.getByRole('button', { name: /buy|sell/i }).last();
    await expect(submitBtn).toBeDisabled({ timeout: 5000 });
  });

  test('Place Order button is enabled when an account is selected', async ({ page }) => {
    await page.route(
      '**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ accounts: [BROKER_ACCOUNT_ALPACA] }),
        });
      },
    );
    await addAuthCookie(page);
    await page.goto('/trader');
    const submitBtn = page.getByRole('button', { name: /buy|sell/i }).last();
    await expect(submitBtn).toBeEnabled({ timeout: 5000 });
  });

  test('Account Management Panel opens via gear icon', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/trader');
    // Gear icon is a link that navigates to the accounts submodule page.
    await page.getByRole('link', { name: /manage accounts/i }).click();
    await expect(page.getByRole('heading', { name: 'Broker Accounts' })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByRole('button', { name: 'Add account' })).toBeVisible();
  });

  test('Add Account modal closes on success', async ({ page }) => {
    await page.route(
      '**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ accounts: [BROKER_ACCOUNT_ALPACA] }),
        });
      },
    );
    await page.route(
      '**/xstockstrat.trading.v1.TradingService/RegisterBrokerAccount',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ account: BROKER_ACCOUNT_NEW }),
        });
      },
    );
    await addAuthCookie(page);
    // Navigate directly to the accounts submodule page. Add now happens in a modal opened from the
    // "Add account" button in the Registered Accounts header.
    await page.goto('/trader/accounts');
    await page.getByRole('button', { name: 'Add account' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByPlaceholder('Display name').fill('Test Account');
    await dialog.getByPlaceholder('API Key').fill('test-key-123');
    await dialog.getByPlaceholder('API Secret').fill('test-secret-456');
    await dialog.getByRole('button', { name: 'Add Account' }).click();
    // The modal closes on successful registration.
    await expect(page.getByRole('alertdialog')).toHaveCount(0, { timeout: 5000 });
  });

  test('Edit keys opens a credential modal; Cancel closes it (feature 121, FR-3)', async ({
    page,
  }) => {
    await page.route(
      '**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ accounts: [BROKER_ACCOUNT_ALPACA] }),
        });
      },
    );
    await addAuthCookie(page);
    await page.goto('/trader/accounts');

    // Edit keys now opens a modal (UI refinement) — no credential form is rendered until it opens.
    const row = page.getByTestId(`account-row-${BROKER_ACCOUNT_ALPACA.id}`);
    const actions = row.getByRole('button', {
      name: `Actions for ${BROKER_ACCOUNT_ALPACA.displayName}`,
    });
    await expect(actions).toBeVisible({ timeout: 5000 });
    await expect(page.getByPlaceholder('API Key')).toHaveCount(0);

    await actions.click();
    await page.getByRole('menuitem', { name: 'Edit keys' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByPlaceholder('API Key')).toBeVisible();

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('Edit Credentials modal closes on successful save (feature 122, FR-3 characterization)', async ({
    page,
  }) => {
    await page.route(
      '**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ accounts: [BROKER_ACCOUNT_ALPACA] }),
        });
      },
    );
    await addAuthCookie(page);
    await page.goto('/trader/accounts');

    const row = page.getByTestId(`account-row-${BROKER_ACCOUNT_ALPACA.id}`);
    await row
      .getByRole('button', { name: `Actions for ${BROKER_ACCOUNT_ALPACA.displayName}` })
      .click();
    await page.getByRole('menuitem', { name: 'Edit keys' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByPlaceholder('API Key').fill('test-key-123');
    await dialog.getByPlaceholder('API Secret').fill('test-secret-456');
    await dialog.getByRole('button', { name: 'Save keys' }).click();

    // EditCredentialsForm's onDone callback closes the modal on success, so the parity assertion
    // is the dialog unmounting — not a cleared-but-mounted field.
    await expect(page.getByRole('alertdialog')).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByPlaceholder('API Key')).toHaveCount(0);
  });

  // Feature 249 (AC-7 UI half): the IBKR form collects all seven OAuth credential values.
  const IBKR_INPUTS: [placeholder: string, field: keyof typeof IBKR_TEST_CREDENTIALS_INPUT][] = [
    ['Consumer Key', 'consumerKey'],
    ['Access Token', 'accessToken'],
    ['Access Token Secret', 'accessTokenSecret'],
    ['IBKR Account ID', 'ibkrAccountId'],
    ['Signature key (PEM)', 'signatureKey'],
    ['Encryption key (PEM)', 'encryptionKey'],
    ['DH prime (PEM)', 'dhPrime'],
  ];
  const IBKR_CREDENTIALS_JSON = {
    consumer_key: IBKR_TEST_CREDENTIALS_INPUT.consumerKey,
    access_token: IBKR_TEST_CREDENTIALS_INPUT.accessToken,
    access_token_secret: IBKR_TEST_CREDENTIALS_INPUT.accessTokenSecret,
    ibkr_account_id: IBKR_TEST_CREDENTIALS_INPUT.ibkrAccountId,
    signature_key: IBKR_TEST_CREDENTIALS_INPUT.signatureKey,
    encryption_key: IBKR_TEST_CREDENTIALS_INPUT.encryptionKey,
    dh_prime: IBKR_TEST_CREDENTIALS_INPUT.dhPrime,
  };

  async function routeAccounts(page: Page, accounts: object[]) {
    await page.route(
      '**/xstockstrat.trading.v1.TradingService/ListBrokerAccounts',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ accounts }),
        });
      },
    );
  }

  /** Captures each intercepted request body of `method` and answers with `response`. */
  async function captureRpc(page: Page, method: string, response: object) {
    const bodies: { credentialsJson?: string }[] = [];
    await page.route(`**/xstockstrat.trading.v1.TradingService/${method}`, async (route) => {
      bodies.push(route.request().postDataJSON() as { credentialsJson?: string });
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
    });
    return bodies;
  }

  async function openIbkrAddForm(page: Page) {
    await routeAccounts(page, [BROKER_ACCOUNT_ALPACA]);
    const bodies = await captureRpc(page, 'RegisterBrokerAccount', { account: BROKER_ACCOUNT_NEW });
    await addAuthCookie(page);
    await page.goto('/trader/accounts');
    await page.getByRole('button', { name: 'Add account' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByPlaceholder('Display name').fill('IBKR Live');
    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: 'IBKR' }).click();
    return { dialog, bodies };
  }

  async function fillIbkrInputs(dialog: Locator, skip?: string) {
    for (const [placeholder, field] of IBKR_INPUTS) {
      if (placeholder !== skip) {
        await dialog
          .getByPlaceholder(placeholder, { exact: true })
          .fill(IBKR_TEST_CREDENTIALS_INPUT[field]);
      }
    }
  }

  test('@AC-7 IBKR register posts all seven credential fields', async ({ page }) => {
    const { dialog, bodies } = await openIbkrAddForm(page);
    await fillIbkrInputs(dialog);
    await dialog.getByRole('button', { name: 'Add Account' }).click();

    await expect(page.getByRole('alertdialog')).toHaveCount(0, { timeout: 5000 });
    expect(bodies).toHaveLength(1);
    // Exact equality pins the 7-key shape and the preserved PEM newlines.
    expect(JSON.parse(bodies[0].credentialsJson ?? '')).toEqual(IBKR_CREDENTIALS_JSON);
  });

  test('@AC-7 IBKR register blocks submit when a key field is empty', async ({ page }) => {
    const { dialog, bodies } = await openIbkrAddForm(page);
    await fillIbkrInputs(dialog, 'Encryption key (PEM)');
    await dialog.getByRole('button', { name: 'Add Account' }).click();

    // Native `required` blocks the submit before react-hook-form runs.
    const encryptionKey = dialog.locator('textarea[placeholder="Encryption key (PEM)"]');
    await expect(encryptionKey).toHaveCount(1);
    await expect(
      dialog.locator('textarea[placeholder="Encryption key (PEM)"]:invalid'),
    ).toHaveCount(1);
    expect(
      await encryptionKey.evaluate((el: HTMLTextAreaElement) => el.validationMessage),
    ).not.toBe('');
    await expect(page.getByRole('alertdialog')).toBeVisible();
    expect(bodies).toHaveLength(0);
  });

  test('IBKR Edit keys never renders stored values', async ({ page }) => {
    await routeAccounts(page, [BROKER_ACCOUNT_IBKR]);
    const bodies = await captureRpc(page, 'UpdateBrokerAccountCredentials', {
      account: BROKER_ACCOUNT_IBKR,
    });
    await addAuthCookie(page);
    await page.goto('/trader/accounts');

    await page
      .getByTestId(`account-row-${BROKER_ACCOUNT_IBKR.id}`)
      .getByRole('button', { name: `Actions for ${BROKER_ACCOUNT_IBKR.displayName}` })
      .click();
    await page.getByRole('menuitem', { name: 'Edit keys' }).click();
    const dialog = page.getByRole('alertdialog');
    for (const [placeholder] of IBKR_INPUTS) {
      await expect(dialog.getByPlaceholder(placeholder, { exact: true })).toHaveValue('');
    }

    await fillIbkrInputs(dialog);
    await dialog.getByRole('button', { name: 'Save keys' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0, { timeout: 5000 });
    expect(bodies).toHaveLength(1);
    expect(Object.keys(JSON.parse(bodies[0].credentialsJson ?? '')).sort()).toEqual(
      Object.keys(IBKR_CREDENTIALS_JSON).sort(),
    );
  });

  test('Add form Offline option renders no credential inputs', async ({ page }) => {
    await routeAccounts(page, [BROKER_ACCOUNT_ALPACA]);
    await addAuthCookie(page);
    await page.goto('/trader/accounts');
    await page.getByRole('button', { name: 'Add account' }).click();
    const dialog = page.getByRole('alertdialog');
    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Offline' }).click();

    await expect(dialog.getByPlaceholder('Display name')).toBeVisible();
    await expect(dialog.locator('input[type="password"], textarea')).toHaveCount(0);
  });
});
