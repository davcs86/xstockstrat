import { createConnectTransport as createWebTransport } from '@connectrpc/connect-web';
import { createConnectTransport as createNodeTransport } from '@connectrpc/connect-node';

const isServer = typeof window === 'undefined';

export function createTransport(baseUrl: string) {
  if (isServer) {
    return createNodeTransport({ baseUrl, httpVersion: '1.1' });
  }
  return createWebTransport({ baseUrl });
}

// ── Service base URLs ──────────────────────────────────────────────────────
// These point to the Connect-RPC HTTP ports (not the raw gRPC ports).
// In docker-compose, services communicate over the internal network using
// container names. The HTTP ports are used here; gRPC ports remain for
// internal service-to-service calls.

export const TRADING_BASE_URL =
  process.env.TRADING_HTTP_ENDPOINT ?? 'http://xstockstrat-trading:8051';

export const PORTFOLIO_BASE_URL =
  process.env.PORTFOLIO_HTTP_ENDPOINT ?? 'http://xstockstrat-portfolio:8052';

export const NOTIFY_BASE_URL =
  process.env.NOTIFY_HTTP_ENDPOINT ?? 'http://xstockstrat-notify:8059';

export const IDENTITY_BASE_URL =
  process.env.IDENTITY_HTTP_ENDPOINT ?? 'http://xstockstrat-identity:8058';
