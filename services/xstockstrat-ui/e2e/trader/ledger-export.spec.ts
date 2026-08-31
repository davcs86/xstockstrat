import { test, expect } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { EXPORT_DISABLED_SENTINEL } from '../fixtures/ledgerEvents';

// Feature 021 — /trader ledger event export (BFF streaming route + Book/Portfolio button).
// Exercises the observable behavior of Steps 11/12 against the mock ledger ExportEvents stream.

const ISO = (d: Date) => d.toISOString();
const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

function exportUrl(params: Record<string, string>): string {
  const qs = new URLSearchParams(params);
  return `/trader/api/ledger/export?${qs.toString()}`;
}

test.describe('ledger event export (feature 021)', () => {
  test('AC-1: NDJSON export is ordered by global sequence', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get(
      exportUrl({ start: ISO(daysAgo(30)), end: ISO(new Date()) }),
    );
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/x-ndjson');
    const rows = (await res.text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(rows.length).toBe(5);
    const seqs = rows.map((r) => r.sequence);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
    // AC-8: each row carries the required fields incl. user_id + payload.
    expect(rows[0]).toMatchObject({
      event_id: 'evt-fill-1',
      event_type: 'fill',
      source_service: 'xstockstrat-trading',
      user_id: 'test-user-001',
    });
    expect(rows[0].payload).toMatchObject({ symbol: 'AAPL' });
  });

  test('AC-2: CSV export has the exact header + one row per event', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get(
      exportUrl({ start: ISO(daysAgo(30)), end: ISO(new Date()), format: 'csv' }),
    );
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');
    const lines = (await res.text()).trim().split('\n');
    expect(lines[0]).toBe(
      'event_id,event_type,occurred_at,source_service,correlation_id,sequence,stream_key,user_id,payload',
    );
    expect(lines.length).toBe(6); // header + 5 rows
  });

  test('AC-3/AC-4: event_type filters the subset; omitting it returns all types', async ({
    page,
  }) => {
    await addAuthCookie(page);
    const filtered = await page.request.get(
      exportUrl({ start: ISO(daysAgo(30)), end: ISO(new Date()), event_type: 'fill,signal' }),
    );
    const filteredRows = (await filtered.text())
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(filteredRows.map((r) => r.event_type).sort()).toEqual(['fill', 'signal']);

    const all = await page.request.get(
      exportUrl({ start: ISO(daysAgo(30)), end: ISO(new Date()) }),
    );
    const allRows = (await all.text()).trim().split('\n');
    expect(allRows.length).toBe(5);
  });

  test('AC-5: an over-wide window is rejected with 400 and the exact message', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get(
      exportUrl({ start: ISO(daysAgo(800)), end: ISO(new Date()) }),
    );
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain('window exceeds ledger.export.max_window_days');
  });

  test('AC-10: a disabled export is rejected with 403', async ({ page }) => {
    await addAuthCookie(page);
    const res = await page.request.get(
      exportUrl({
        start: ISO(daysAgo(30)),
        end: ISO(new Date()),
        event_type: EXPORT_DISABLED_SENTINEL,
      }),
    );
    expect(res.status()).toBe(403);
  });

  test('AC-6: an unauthenticated request never streams events', async ({ page }) => {
    // No auth cookie → the middleware auth gate redirects to /auth/login; the export never runs.
    const res = await page.request.get(
      exportUrl({ start: ISO(daysAgo(30)), end: ISO(new Date()) }),
      { maxRedirects: 0 },
    );
    expect([401, 307]).toContain(res.status());
    if (res.status() === 307) {
      expect(res.headers()['location']).toContain('/auth/login');
    }
    expect(res.headers()['content-type'] ?? '').not.toContain('application/x-ndjson');
  });

  test('AC-9: the Book/Portfolio button downloads the last 90 days, all types', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/trader/portfolio');

    const requestPromise = page.waitForRequest((r) =>
      r.url().includes('/trader/api/ledger/export'),
    );
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export events' }).click();

    const request = await requestPromise;
    const url = new URL(request.url());
    expect(url.searchParams.get('event_type')).toBeNull(); // all types (AC-9)
    const start = new Date(url.searchParams.get('start')!);
    const end = new Date(url.searchParams.get('end')!);
    const days = (end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);

    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('ledger-events.ndjson');
  });
});
