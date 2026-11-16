import { expect, type Locator, type Page } from '@playwright/test';

const MARK = 'data-row-menu-probe';

/**
 * After a row-menu confirmation is resolved nothing may be left blocking the page. The menu is
 * counted with a CSS locator because an open dialog hides it from role queries.
 */
export async function expectRowMenuSettled(page: Page): Promise<void> {
  await expect(page.locator('[role="menu"]')).toHaveCount(0);
  await expect(page.locator('[role="alertdialog"]')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => getComputedStyle(document.body).pointerEvents))
    .not.toBe('none');
  await expect(page.locator('body > [aria-hidden="true"]')).toHaveCount(0);
}

/** Tags the element so a later focus check proves it is the same node, not a remounted one. */
export async function markTrigger(trigger: Locator): Promise<void> {
  await trigger.evaluate((el, attr) => el.setAttribute(attr, '1'), MARK);
}

export async function expectFocusOnMarkedTrigger(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate((attr) => document.activeElement?.hasAttribute(attr) ?? false, MARK))
    .toBe(true);
}
