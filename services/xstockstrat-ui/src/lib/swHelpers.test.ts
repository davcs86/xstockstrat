import { describe, it, expect } from 'vitest';
import { parsePushPayload, pickClientUrl } from './swHelpers';

describe('parsePushPayload', () => {
  it('parses a well-formed payload', () => {
    const p = parsePushPayload(
      JSON.stringify({
        title: 'Order filled',
        body: 'AAPL 10 @ 190',
        icon: '/i.png',
        tag: 'trade',
        url: '/trader/positions/AAPL',
      }),
    );
    expect(p.title).toBe('Order filled');
    expect(p.body).toBe('AAPL 10 @ 190');
    expect(p.url).toBe('/trader/positions/AAPL');
    expect(p.tag).toBe('trade');
  });

  it('falls back to a generic notification on null/empty (userVisibleOnly obligation)', () => {
    for (const raw of [null, undefined, '']) {
      const p = parsePushPayload(raw);
      expect(p.title).toBe('xstockstrat');
      expect(p.body).toBe('You have a new alert');
      expect(p.url).toBe('/trader');
    }
  });

  it('falls back on invalid JSON rather than throwing', () => {
    const p = parsePushPayload('{not json');
    expect(p.title).toBe('xstockstrat');
    expect(p.url).toBe('/trader');
  });

  it('fills missing fields from the fallback but keeps provided ones', () => {
    const p = parsePushPayload(JSON.stringify({ title: 'Risk breach' }));
    expect(p.title).toBe('Risk breach');
    expect(p.body).toBe('You have a new alert'); // fallback
    expect(p.icon).toBe('/icon-192.png'); // fallback
  });
});

describe('pickClientUrl', () => {
  it('returns an existing window whose URL contains the target (focus it)', () => {
    const wins = ['https://app.test/insights', 'https://app.test/trader/positions/AAPL'];
    expect(pickClientUrl(wins, '/trader/positions/AAPL')).toBe(
      'https://app.test/trader/positions/AAPL',
    );
  });

  it('returns null when no window matches (open a new one)', () => {
    const wins = ['https://app.test/insights', 'https://app.test/config-ui'];
    expect(pickClientUrl(wins, '/trader/positions/AAPL')).toBeNull();
  });

  it('returns null when there are no open windows', () => {
    expect(pickClientUrl([], '/trader')).toBeNull();
  });
});
