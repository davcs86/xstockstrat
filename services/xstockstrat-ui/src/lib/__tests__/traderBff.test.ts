/**
 * Feature 263 (fix-edge-owner-scope) — trader BFF `queryEvents` owner scoping, driven through the
 * real `dispatchConnect` so the browser's request body is decoded exactly as in production.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectError, Code } from '@connectrpc/connect';

vi.mock('@/lib/auth', () => ({
  verifyAccessToken: vi.fn(async () => ({
    user_id: 'u-a',
    roles: ['trader'],
    exp: Math.floor(Date.now() / 1000) + 3600,
  })),
  rolesToAccessScope: vi.fn(() => 7),
  generateTraceId: vi.fn(() => 'trace-test'),
  hasAdminScope: vi.fn(() => false),
}));

const listBrokerAccounts = vi.fn();
const queryEvents = vi.fn();

vi.mock('@/lib/connectClients', () => ({
  tradingClient: { listBrokerAccounts: (...a: unknown[]) => listBrokerAccounts(...a) },
  ledgerClient: { queryEvents: (...a: unknown[]) => queryEvents(...a) },
  portfolioClient: {},
  marketDataClient: {},
  notifyClient: {},
  analysisClient: {},
  configClient: {},
}));

import { dispatchConnect } from '@/lib/traderBff';
import { copilotStreamKey } from '@/lib/copilot';
import { HEADER_USER_ID, HEADER_TRACE_ID } from '@/lib/headers';

type CallOpts = { headers: Headers };

function query(body: Record<string, unknown>): Promise<Response> {
  return dispatchConnect(
    new Request('http://localhost/trader/api/xstockstrat.ledger.v1.LedgerService/QueryEvents', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: 'access_token=t' },
      body: JSON.stringify(body),
    }),
  );
}

async function errorCode(res: Response): Promise<string | undefined> {
  return ((await res.json()) as { code?: string }).code;
}

function ledgerReq(): Record<string, unknown> {
  expect(queryEvents).toHaveBeenCalledOnce();
  return queryEvents.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  listBrokerAccounts.mockReset().mockResolvedValue({ accounts: [{ id: 'acct-a' }] });
  queryEvents.mockReset().mockResolvedValue({ events: [] });
});

describe('trader BFF queryEvents — owner scoping (feature 263)', () => {
  it('AC-1: a foreign account: key is PERMISSION_DENIED with no ledger call', async () => {
    const res = await query({ streamKey: 'account:acct-b' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await errorCode(res)).toBe('permission_denied');
    expect(listBrokerAccounts).toHaveBeenCalledOnce();
    expect(queryEvents).not.toHaveBeenCalled();
  });

  it('AC-1: an empty account id is PERMISSION_DENIED with no trading or ledger call', async () => {
    const res = await query({ streamKey: 'account:' });
    expect(await errorCode(res)).toBe('permission_denied');
    expect(listBrokerAccounts).not.toHaveBeenCalled();
    expect(queryEvents).not.toHaveBeenCalled();
  });

  it('a trading error passes through with its own code and no ledger call', async () => {
    listBrokerAccounts.mockReset().mockRejectedValue(new ConnectError('x', Code.Unavailable));
    const res = await query({ streamKey: 'account:acct-a' });
    expect(await errorCode(res)).toBe('unavailable');
    expect(queryEvents).not.toHaveBeenCalled();
  });

  it('AC-3: an owned account: key forwards unchanged and unfiltered', async () => {
    const res = await query({ streamKey: 'account:acct-a' });
    expect(res.status).toBe(200);
    const req = ledgerReq();
    expect(req.streamKey).toBe('account:acct-a');
    expect(req.ownerOnly).toBe(false);
  });

  it("AC-3: a copilot: key is rewritten to the caller's own thread", async () => {
    await query({ streamKey: 'copilot:anything' });
    const req = ledgerReq();
    expect(req.streamKey).toBe(copilotStreamKey('u-a'));
    expect(req.ownerOnly).toBe(false);
  });

  it('AC-2/AC-7: no stream key is owner-scoped', async () => {
    await query({ eventType: 'order.filled' });
    expect(ledgerReq().ownerOnly).toBe(true);
  });

  it('AC-2: any other stream key is owner-scoped', async () => {
    await query({ streamKey: 'portfolio:u-b' });
    const req = ledgerReq();
    expect(req.streamKey).toBe('portfolio:u-b');
    expect(req.ownerOnly).toBe(true);
  });

  it('the browser cannot turn ownerOnly off', async () => {
    await query({ eventType: 'order.filled', ownerOnly: false });
    expect(ledgerReq().ownerOnly).toBe(true);
  });

  it('C-03: trading and ledger calls share one set of propagated headers', async () => {
    await query({ streamKey: 'account:acct-a' });
    const tradingHeaders = (listBrokerAccounts.mock.calls[0][1] as CallOpts).headers;
    const ledgerHeaders = (queryEvents.mock.calls[0][1] as CallOpts).headers;
    for (const h of [tradingHeaders, ledgerHeaders]) {
      expect(h.get(HEADER_USER_ID)).toBe('u-a');
      expect(h.get(HEADER_TRACE_ID)).toBe('trace-test');
    }
  });
});
