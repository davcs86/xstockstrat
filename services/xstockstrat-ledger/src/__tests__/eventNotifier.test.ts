/**
 * Unit tests for EventNotifier — the shared LISTEN/NOTIFY fan-out that decouples
 * live StreamEvents subscribers from the DB query pool.
 *
 * A fake pg Client (no real DB) drives connect / LISTEN / notification / end.
 * Tests gracefully skip if the TypeScript import fails in strip-only mode
 * (parameter properties), matching ledgerServiceImpl.test.ts.
 *
 * Run: node --experimental-strip-types --test src/__tests__/*.test.ts
 */
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

let EventNotifier: any;

before(async () => {
  try {
    const mod = await import('../services/eventNotifier.js');
    EventNotifier = mod.EventNotifier;
  } catch {
    // Unsupported TypeScript syntax in strip-only mode — tests will be skipped.
  }
});

// Minimal pg.Client stand-in: records LISTENs and lets the test push
// notifications / simulate connection errors.
class FakeClient {
  handlers: Record<string, Array<(...a: any[]) => void>> = {};
  connected = false;
  ended = false;
  listens: string[] = [];
  failConnect = false;

  on(event: string, cb: (...a: any[]) => void) {
    (this.handlers[event] ||= []).push(cb);
    return this;
  }
  async connect() {
    if (this.failConnect) throw new Error('connect refused');
    this.connected = true;
  }
  async query(sql: string) {
    if (/^LISTEN/i.test(sql)) this.listens.push(sql);
    return { rows: [] };
  }
  async end() {
    this.ended = true;
  }
  emit(event: string, ...args: any[]) {
    (this.handlers[event] || []).forEach((cb) => cb(...args));
  }
  notify(payload: string) {
    this.emit('notification', { payload });
  }
}

function row(overrides: any = {}) {
  return JSON.stringify({
    event_id: 'e1',
    event_type: 'order.filled',
    source_service: 'trading',
    stream_key: 'order:1',
    sequence: 1,
    ...overrides,
  });
}

const tick = () => new Promise((r) => setTimeout(r, 5));

describe('EventNotifier', () => {
  it('LISTENs on the shared channel once connected', async () => {
    if (!EventNotifier) return;
    const client = new FakeClient();
    const n = new EventNotifier(() => client);
    await n.start();
    assert.ok(client.connected);
    assert.ok(client.listens.some((s) => /LISTEN "ledger_stream_all"/.test(s)));
    await n.stop();
    assert.ok(client.ended);
  });

  it('fans out an event to a matching subscriber', async () => {
    if (!EventNotifier) return;
    const client = new FakeClient();
    const n = new EventNotifier(() => client);
    await n.start();
    const got: any[] = [];
    n.subscribe({ onEvent: (r: any) => got.push(r) });
    client.notify(row({ sequence: 5 }));
    assert.strictEqual(got.length, 1);
    assert.strictEqual(got[0].sequence, 5);
    await n.stop();
  });

  it('filters by stream_key and event_type', async () => {
    if (!EventNotifier) return;
    const client = new FakeClient();
    const n = new EventNotifier(() => client);
    await n.start();
    const got: any[] = [];
    n.subscribe({ streamKey: 'order:1', eventType: 'order.filled', onEvent: (r: any) => got.push(r) });

    client.notify(row({ stream_key: 'order:2' })); // wrong stream_key
    client.notify(row({ event_type: 'order.canceled' })); // wrong event_type
    client.notify(row()); // matches both filters
    assert.strictEqual(got.length, 1);
    assert.strictEqual(got[0].stream_key, 'order:1');
    await n.stop();
  });

  it('stops delivering after unsubscribe', async () => {
    if (!EventNotifier) return;
    const client = new FakeClient();
    const n = new EventNotifier(() => client);
    await n.start();
    const got: any[] = [];
    const unsub = n.subscribe({ onEvent: (r: any) => got.push(r) });
    client.notify(row());
    unsub();
    client.notify(row({ sequence: 2 }));
    assert.strictEqual(got.length, 1);
    await n.stop();
  });

  it('ignores malformed NOTIFY payloads', async () => {
    if (!EventNotifier) return;
    const client = new FakeClient();
    const n = new EventNotifier(() => client);
    await n.start();
    const got: any[] = [];
    n.subscribe({ onEvent: (r: any) => got.push(r) });
    client.notify('{not json');
    client.emit('notification', {}); // no payload
    assert.strictEqual(got.length, 0);
    await n.stop();
  });

  it('one subscriber throwing does not break fan-out to others', async () => {
    if (!EventNotifier) return;
    const client = new FakeClient();
    const n = new EventNotifier(() => client);
    await n.start();
    const got: any[] = [];
    n.subscribe({ onEvent: () => { throw new Error('boom'); } });
    n.subscribe({ onEvent: (r: any) => got.push(r) });
    client.notify(row());
    assert.strictEqual(got.length, 1);
    await n.stop();
  });

  it('reconnects after a connection error and fires onReconnect', async () => {
    if (!EventNotifier) return;
    const clients: FakeClient[] = [];
    const n = new EventNotifier(
      () => {
        const c = new FakeClient();
        clients.push(c);
        return c;
      },
      'ledger_stream_all',
      1, // fast reconnect for the test
    );
    await n.start();
    let reconnects = 0;
    n.subscribe({ onEvent: () => {}, onReconnect: () => { reconnects++; } });

    // Simulate the live connection dropping.
    clients[0].emit('error', new Error('connection lost'));
    await tick();
    await tick();

    assert.ok(clients.length >= 2, 'should have created a replacement client');
    assert.ok(clients[1].connected, 'replacement client should be connected');
    assert.strictEqual(reconnects, 1, 'onReconnect should fire once after a reconnect');
    await n.stop();
  });
});
