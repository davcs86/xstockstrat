import { test, expect, type Locator, type Page } from '@playwright/test';
import { addAuthCookie, BASE_URL } from '../helpers/auth';
import {
  FUNDAMENTALS_LYFT,
  LYFT_SOURCE_LABEL_OPPORTUNITIES,
  POSITION_LYFT_WIDE,
} from '../fixtures';

/**
 * Symbol-page stat tiles at a 384px phone width (feature 339, @AC-1/@AC-8): every long value stays
 * inside its own `StatTile`. Each test stubs its BFF read with page.route(); fixtures from
 * e2e/fixtures/ (C-12). Assertions are independent of how the value is formatted.
 */
test.use({ viewport: { width: 384, height: 844 } });

// Under `pnpm dev` the symbol page's Research section can take over the 10 s local test timeout;
// 30 s matches CI. --no-deps skips the warmup project, so the one visited route is warmed here.
test.describe.configure({ timeout: 30_000 });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await browser.newPage();
  await addAuthCookie(page);
  await page.goto(`${BASE_URL}/trader/positions/LYFT`, { timeout: 170_000 });
  await page.close();
});

const GET_FUNDAMENTALS = '**/xstockstrat.marketdata.v1.MarketDataService/GetFundamentals';
const GET_POSITION = '**/xstockstrat.portfolio.v1.PortfolioService/GetPosition';
const LIST_OPPORTUNITIES = '**/xstockstrat.analysis.v1.AnalysisService/ListOpportunities';

async function routeJson(page: Page, path: string, body: unknown) {
  await page.route(path, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

type Box = { x: number; y: number; width: number; height: number };

function intersects(a: Box, b: Box) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** A StatTile is the label's parent; its value is the tile's tabular-nums mono child. */
function tileByLabel(scope: Locator, label: string) {
  return scope.getByText(label, { exact: true }).locator('xpath=..');
}

function tileValue(tile: Locator) {
  return tile.locator(':scope > .font-mono.tabular-nums');
}

async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox();
  expect(b, 'element has a layout box').not.toBeNull();
  return b as Box;
}

async function expectTileFits(scope: Locator, label: string) {
  const tile = tileByLabel(scope, label);
  const value = tileValue(tile);
  await expect(value).toBeVisible();

  const { scrollWidth, clientWidth } = await value.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth, `${label} value overflows its box`).toBeLessThanOrEqual(clientWidth);

  const tileBox = await box(tile);
  const valueBox = await box(value);
  expect(valueBox.x).toBeGreaterThanOrEqual(tileBox.x);
  expect(valueBox.y).toBeGreaterThanOrEqual(tileBox.y);
  expect(valueBox.x + valueBox.width).toBeLessThanOrEqual(tileBox.x + tileBox.width);
  expect(valueBox.y + valueBox.height).toBeLessThanOrEqual(tileBox.y + tileBox.height);

  const tiles = tile.locator('xpath=../div');
  const count = await tiles.count();
  let others = 0;
  for (let i = 0; i < count; i++) {
    const other = tiles.nth(i);
    if (await other.evaluate((el, t) => el === t, await tile.elementHandle())) continue;
    others++;
    const otherValue = await box(tileValue(other));
    expect(intersects(valueBox, otherValue), `${label} value overlaps a neighbour`).toBe(false);
  }
  expect(others, 'tile has neighbours in its grid').toBeGreaterThan(0);
}

function fundamentalsCard(page: Page) {
  return page.locator('[data-slot="card"]', {
    has: page.getByText('Fundamentals', { exact: true }),
  });
}

for (const [marketCap, compact] of [
  [FUNDAMENTALS_LYFT.marketCap, '$6.73B'],
  [3.45e12, '$3.45T'],
] as const) {
  test(`@AC-1 a market cap of ${marketCap} fits its Fundamentals tile at 384px`, async ({
    page,
  }) => {
    await routeJson(page, GET_FUNDAMENTALS, { fundamentals: { ...FUNDAMENTALS_LYFT, marketCap } });
    await addAuthCookie(page);
    await page.goto('/trader/positions/LYFT');

    const card = fundamentalsCard(page);
    await expect(card.getByText('Market cap', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(card.getByText('Valuation', { exact: true })).toBeVisible();
    await expect(card.getByText('Quality & risk', { exact: true })).toBeVisible();
    await expect(tileValue(tileByLabel(card, 'Market cap'))).toHaveText(compact);
    await expect(tileValue(tileByLabel(card, 'P/E'))).toHaveText('41.20');
    await expect(card.getByText('as of 2026-11-13 · fmp', { exact: true })).toBeVisible();
    await expectTileFits(card, 'Market cap');

    const labels = card.locator('.font-mono.uppercase');
    const n = await labels.count();
    expect(n).toBe(8);
    for (let i = 0; i < n; i++) {
      const tile = labels.nth(i).locator('xpath=..');
      const labelBox = await box(labels.nth(i));
      const valueBox = await box(tileValue(tile));
      expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(valueBox.y);
    }
  });
}

test('@AC-8 a wide cost basis fits its position tile at 384px', async ({ page }) => {
  await routeJson(page, GET_POSITION, POSITION_LYFT_WIDE);
  await addAuthCookie(page);
  await page.goto('/trader/positions/LYFT');

  // The Position panel joins the Trade tabs only once GetPosition answers, after the first tab is
  // already active, so it is selected explicitly.
  const trade = page.locator('#trade');
  await trade.getByRole('radio', { name: 'Position' }).click({ timeout: 15000 });
  await expect(trade.getByText('Cost basis', { exact: true })).toBeVisible();
  await expectTileFits(trade, 'Cost basis');
});

test('@AC-2 a strategy-less opportunity chip is labelled by its source, never the ticker', async ({
  page,
}) => {
  await routeJson(page, LIST_OPPORTUNITIES, { opportunities: LYFT_SOURCE_LABEL_OPPORTUNITIES });
  await addAuthCookie(page);
  await page.goto('/trader/positions/LYFT');

  const chips = page.getByRole('radiogroup', { name: 'Opportunities' });
  await expect(chips.getByRole('radio', { name: 'dip_buyer_vol_stop', exact: true })).toBeVisible({
    timeout: 15000,
  });
  await expect(chips.getByRole('radio', { name: 'Fundamentals', exact: true })).toBeVisible();
  await expect(chips.getByRole('radio', { name: 'LYFT' })).toHaveCount(0);
});
