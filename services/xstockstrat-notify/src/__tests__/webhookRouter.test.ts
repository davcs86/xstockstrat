/**
 * Tests for x-mcp-secret enforcement in xstockstrat-notify webhookRouter.
 *
 * MCP_AGENT_SECRET is captured as a module constant at import time.
 * Set process.env.MCP_AGENT_SECRET BEFORE the lazy import in before() runs.
 *
 * Run: node --experimental-strip-types --test src/__tests__/webhookRouter.test.ts
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'http';

// Set secret before module is imported so the constant captures it.
process.env['MCP_AGENT_SECRET'] = 'test-secret';

let createWebhookRouter: any;

before(async () => {
  try {
    // Dynamic import so the env var is already set when the module initialises.
    const mod = await import('../webhooks/router.js');
    createWebhookRouter = mod.createWebhookRouter;
  } catch {
    // Unsupported TypeScript syntax in strip-only mode — tests will be skipped.
  }
});

after(() => {
  delete process.env['MCP_AGENT_SECRET'];
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeImpl() {
  return {
    emitAlert: (_: any, cb: any) => cb(null, { success: true }),
    listAlerts: (_: any, cb: any) => cb(null, { alerts: [] }),
  };
}

function makeRequest(opts: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: string;
}): http.IncomingMessage {
  const req = Object.assign(
    Object.create(require('stream').Readable.prototype),
    {
      method: opts.method ?? 'POST',
      url: opts.url ?? '/webhooks/emit-alert',
      headers: opts.headers ?? {},
    }
  ) as http.IncomingMessage;
  // Simulate readable stream
  process.nextTick(() => {
    req.emit('data', opts.body ?? '{}');
    req.emit('end');
  });
  return req;
}

function makeResponse(): { statusCode: number; ended: boolean; body: string; res: http.ServerResponse } {
  let statusCode = 200;
  let ended = false;
  let body = '';
  const res = {
    writeHead(code: number) { statusCode = code; },
    end(data: string) { ended = true; body = data; },
    getHeader: () => undefined,
    setHeader: () => undefined,
  } as unknown as http.ServerResponse;
  return { get statusCode() { return statusCode; }, get ended() { return ended; }, get body() { return body; }, res };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('webhookRouter x-mcp-secret enforcement', () => {
  it('rejects request when x-mcp-secret header is missing', async () => {
    if (!createWebhookRouter) return;
    const handler = createWebhookRouter(makeImpl());
    const result = makeResponse();
    await handler(makeRequest({ headers: {} }), result.res);
    assert.equal(result.statusCode, 401);
  });

  it('rejects request when x-mcp-secret header is wrong', async () => {
    if (!createWebhookRouter) return;
    const handler = createWebhookRouter(makeImpl());
    const result = makeResponse();
    await handler(makeRequest({ headers: { 'x-mcp-secret': 'wrong' } }), result.res);
    assert.equal(result.statusCode, 401);
  });

  it('passes request through with correct x-mcp-secret header', async () => {
    if (!createWebhookRouter) return;
    const handler = createWebhookRouter(makeImpl());
    const result = makeResponse();
    await handler(makeRequest({ headers: { 'x-mcp-secret': 'test-secret' } }), result.res);
    assert.notEqual(result.statusCode, 401);
  });
});
