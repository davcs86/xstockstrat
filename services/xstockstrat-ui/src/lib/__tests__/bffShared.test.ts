/** Feature 280 (AC-37) — createDispatch rejects every non-POST method before handler lookup. */
import { describe, it, expect, vi } from 'vitest';
import type { ConnectRouter } from '@connectrpc/connect';
import { createDispatch } from '@/lib/bffShared';

const SEGMENTS = ['/trader/api', '/insights/api', '/config-ui/api'];
const RPC = '/xstockstrat.test.v1.TestService/Ping';

function setup(prefix: string) {
  const handler = vi.fn(async () => ({
    status: 200,
    header: new Headers(),
    body: undefined,
  }));
  const router = { handlers: [{ requestPath: RPC }].map((h) => Object.assign(handler, h)) };
  return { handler, dispatch: createDispatch(router as unknown as ConnectRouter, prefix) };
}

describe.each(SEGMENTS)('createDispatch(%s) method guard', (prefix) => {
  it.each(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS'])(
    '%s returns 405 with Allow: POST and calls no handler',
    async (method) => {
      const { handler, dispatch } = setup(prefix);
      const res = await dispatch(new Request(`http://localhost${prefix}${RPC}`, { method }));
      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toBe('POST');
      expect(handler).not.toHaveBeenCalled();
    },
  );

  it('405s non-POST even for an unknown path', async () => {
    const { dispatch } = setup(prefix);
    const res = await dispatch(new Request(`http://localhost${prefix}/nope`, { method: 'GET' }));
    expect(res.status).toBe(405);
  });

  it('POST still dispatches to the handler', async () => {
    const { handler, dispatch } = setup(prefix);
    const res = await dispatch(
      new Request(`http://localhost${prefix}${RPC}`, { method: 'POST', body: '{}' }),
    );
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledOnce();
  });
});
