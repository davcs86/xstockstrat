import type { Page } from '@playwright/test';
import { fulfillStream, gate } from './connectStream';

// While the drawer is open Radix hides the rest of the page from the accessibility tree.
export const bellOf = (page: Page) =>
  page.getByRole('button', { name: /^Alerts/, includeHidden: true });
export const badgeOf = (page: Page) => bellOf(page).locator('[data-slot="badge"]');

export type DrawerAlert = { alertId: string; createdAt: string; read?: boolean };

const NOTIFY = '**/xstockstrat.notify.v1.NotifyService/';

/**
 * Stateful notify stubs; `stream: 'gated'` delivers `streamed` once on `release()`, then holds.
 * `holdFirstList` answers the first ListAlerts with the state it had on arrival, after `releaseList()`.
 */
export async function stubNotify(
  page: Page,
  stored: DrawerAlert[],
  stream: 'held' | 'gated',
  options: { holdFirstList?: boolean; failMarkRead?: boolean } = {},
) {
  const firstList = gate();
  const state = {
    stored: [...stored],
    streamed: [] as DrawerAlert[],
    markedIds: [] as string[],
    listCalls: 0,
    streamAttempts: 0,
    release: () => {},
    releaseList: firstList.release,
  };
  const unreadSet = () => {
    const byId = new Map<string, DrawerAlert>();
    for (const a of [...state.stored.filter((s) => !s.read), ...state.streamed]) {
      if (!state.markedIds.includes(a.alertId) && !byId.has(a.alertId)) byId.set(a.alertId, a);
    }
    return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  };
  const everyAlert = () => {
    const byId = new Map<string, DrawerAlert>();
    for (const a of [...state.stored, ...state.streamed]) {
      if (!byId.has(a.alertId)) byId.set(a.alertId, a);
    }
    return [...byId.values()].map((a) => ({
      ...a,
      read: a.read === true || state.markedIds.includes(a.alertId),
    }));
  };

  await page.route(NOTIFY + 'ListAlerts', async (route) => {
    state.listCalls += 1;
    const unread = unreadSet();
    const alerts = route.request().postDataJSON()?.unreadOnly ? unread : everyAlert();
    const body = JSON.stringify({ alerts, unreadCount: unread.length });
    if (options.holdFirstList && state.listCalls === 1) await firstList.wait;
    return route.fulfill({ status: 200, contentType: 'application/json', body });
  });
  await page.route(NOTIFY + 'MarkAlertRead', (route) => {
    if (options.failMarkRead) {
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'internal', message: 'mark failed' }),
      });
    }
    state.markedIds.push(...(route.request().postDataJSON()?.alertIds ?? []));
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.route(NOTIFY + 'GetAlert', (route) => {
    const id = route.request().postDataJSON()?.alertId;
    const found = everyAlert().find((a) => a.alertId === id);
    return found
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(found) })
      : route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ code: 'not_found', message: 'alert not found' }),
        });
  });

  const opened = gate();
  state.release = opened.release;
  const never = new Promise<void>(() => {});
  await page.route(NOTIFY + 'StreamAlerts', async (route) => {
    state.streamAttempts += 1;
    if (stream === 'gated' && state.streamAttempts === 1) {
      await opened.wait;
      await fulfillStream(route, state.streamed);
      return;
    }
    await never;
  });
  return state;
}
