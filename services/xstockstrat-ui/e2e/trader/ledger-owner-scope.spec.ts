import { test, expect, type Page } from '@playwright/test';
import { addAuthCookie } from '../helpers/auth';
import { BROKER_ACCOUNT_ALPACA, TEST_USER_ID } from '../fixtures';
import {
  OWNER_SCOPE_COPILOT_NOTE_TEXT,
  OWNER_SCOPE_FOREIGN_ACCOUNT_ID,
  OWNER_SCOPE_FOREIGN_COPILOT_NOTE_TEXT,
  OWNER_SCOPE_FOREIGN_USER_ID,
  OWNER_SCOPE_LEGACY_SYMBOL,
  OWNER_SCOPE_OWN_SYMBOL,
} from '../fixtures/ledgerEvents';
import { COPILOT_EVENT_TYPE, copilotStreamKey } from '../../src/lib/copilot';

/**
 * Feature 263 — the trader BFF scopes LedgerService/QueryEvents to the session's owner
 * (AC-1/2/3/7). Browser-level fetch, as in api-smoke.spec.ts, so the real BFF handler runs.
 */

const LEDGER_PATH = '/trader/api/xstockstrat.ledger.v1.LedgerService';

interface RpcResult {
  status: number;
  body: Record<string, unknown>;
}

interface LedgerEventJson {
  eventType?: string;
  streamKey?: string;
  userId?: string;
  payload?: Record<string, unknown>;
}

async function callLedger(page: Page, method: string, body: object): Promise<RpcResult> {
  return page.evaluate(
    async ({ url, payload }) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return { status: res.status, body: (await res.json()) as Record<string, unknown> };
    },
    { url: `${LEDGER_PATH}/${method}`, payload: body },
  );
}

function eventsOf(result: RpcResult): LedgerEventJson[] {
  expect(result.status).toBe(200);
  return (result.body.events ?? []) as LedgerEventJson[];
}

test.describe('Trader BFF — QueryEvents owner scoping (feature 263)', () => {
  test.beforeEach(async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/auth/login');
  });

  test('AC-1: a foreign account: stream is refused with permission_denied', async ({ page }) => {
    const result = await callLedger(page, 'QueryEvents', {
      streamKey: `account:${OWNER_SCOPE_FOREIGN_ACCOUNT_ID}`,
    });
    expect(result.status).not.toBe(200);
    expect(result.body.code).toBe('permission_denied');
  });

  test('AC-2/AC-7: no stream key returns only the caller-owned rows', async ({ page }) => {
    const events = eventsOf(await callLedger(page, 'QueryEvents', { eventType: 'order.filled' }));

    expect(events.some((e) => e.userId === OWNER_SCOPE_FOREIGN_USER_ID)).toBe(false);
    expect(events.some((e) => !e.userId)).toBe(false);
    expect(events.some((e) => e.payload?.symbol === OWNER_SCOPE_LEGACY_SYMBOL)).toBe(false);
    // AC-7: the caller's own lineage row still arrives.
    expect(
      events.some((e) => e.userId === TEST_USER_ID && e.payload?.symbol === OWNER_SCOPE_OWN_SYMBOL),
    ).toBe(true);
  });

  test('AC-3: an owned account: stream still returns its reconciliation event', async ({
    page,
  }) => {
    const events = eventsOf(
      await callLedger(page, 'QueryEvents', { streamKey: `account:${BROKER_ACCOUNT_ALPACA.id}` }),
    );
    expect(events.some((e) => e.eventType?.startsWith('reconciliation.'))).toBe(true);
  });

  test('AC-3: copilot reads resolve to the caller thread only', async ({ page }) => {
    const ownKey = copilotStreamKey(TEST_USER_ID);
    const append = await callLedger(page, 'AppendEvent', {
      payload: { role: 'user', text: OWNER_SCOPE_COPILOT_NOTE_TEXT },
    });
    expect(append.status).toBe(200);

    const events = eventsOf(
      await callLedger(page, 'QueryEvents', {
        streamKey: copilotStreamKey(OWNER_SCOPE_FOREIGN_USER_ID),
        eventType: COPILOT_EVENT_TYPE,
      }),
    );
    const texts = events.map((e) => e.payload?.text);
    expect(events.every((e) => e.streamKey === ownKey)).toBe(true);
    expect(texts.filter((t) => t === OWNER_SCOPE_COPILOT_NOTE_TEXT).length).toBeGreaterThan(0);
    expect(texts).not.toContain(OWNER_SCOPE_FOREIGN_COPILOT_NOTE_TEXT);
  });
});
