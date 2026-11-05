import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_UNARY_TIMEOUT_MS } from '@/lib/deadlines';

type TransportCall = (...args: unknown[]) => Promise<unknown>;

const { fakeTransport, createGrpcTransport } = vi.hoisted(() => {
  const fakeTransport = {
    unary: vi.fn<TransportCall>(async () => ({
      stream: false,
      header: new Headers(),
      trailer: new Headers(),
      message: {},
    })),
    stream: vi.fn<TransportCall>(async () => ({
      stream: true,
      header: new Headers(),
      trailer: new Headers(),
      message: (async function* () {})(),
    })),
  };
  return { fakeTransport, createGrpcTransport: vi.fn(() => fakeTransport) };
});

vi.mock('@connectrpc/connect-node', () => ({ createGrpcTransport }));

let clients: typeof import('@/lib/connectClients');
let transportsBuiltAtImport: number;

beforeAll(async () => {
  process.env.MTLS_CERT = 'test-cert';
  process.env.MTLS_KEY = 'test-key';
  process.env.MTLS_CA_CERT = 'test-ca';
  clients = await import('@/lib/connectClients');
  transportsBuiltAtImport = createGrpcTransport.mock.calls.length;
});

describe('connectClients transport deadlines (feature 271)', () => {
  it('@AC-6 @feature-128: builds no transport at import, only on the first RPC', async () => {
    expect(transportsBuiltAtImport).toBe(0);
    createGrpcTransport.mockClear();
    await clients.identityClient.revokeToken({ token: 't' });
    expect(createGrpcTransport).toHaveBeenCalledTimes(1);
  });

  it('@AC-1: an un-timed unary call gets DEFAULT_UNARY_TIMEOUT_MS', async () => {
    fakeTransport.unary.mockClear();
    await clients.identityClient.revokeToken({ token: 't' });
    expect(fakeTransport.unary).toHaveBeenCalledTimes(1);
    expect(fakeTransport.unary.mock.calls[0][2]).toBe(DEFAULT_UNARY_TIMEOUT_MS);
  });

  it('@AC-6: a per-call timeoutMs overrides the default', async () => {
    fakeTransport.unary.mockClear();
    await clients.configClient.getConfig({ namespace: 'ui' }, { timeoutMs: 2000 });
    expect(fakeTransport.unary.mock.calls[0][2]).toBe(2000);
  });

  it('@AC-5: server streams get no default deadline', async () => {
    fakeTransport.stream.mockClear();
    const alerts: unknown[] = [];
    for await (const alert of clients.notifyClient.streamAlerts({})) alerts.push(alert);
    expect(alerts).toEqual([]);
    expect(fakeTransport.stream).toHaveBeenCalledTimes(1);
    expect(fakeTransport.stream.mock.calls[0][2]).toBeUndefined();
  });
});
