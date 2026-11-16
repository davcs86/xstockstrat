import type { Page } from '@playwright/test';

// While the drawer is open Radix hides the rest of the page from the accessibility tree.
export const bellOf = (page: Page) =>
  page.getByRole('button', { name: /^Alerts/, includeHidden: true });
export const badgeOf = (page: Page) => bellOf(page).locator('[data-slot="badge"]');
