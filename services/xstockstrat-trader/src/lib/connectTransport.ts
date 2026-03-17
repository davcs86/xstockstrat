/**
 * Connect-RPC transport factory for xstockstrat-trader.
 *
 * Server-side route handlers use createNodeHttpTransport (Node.js fetch).
 * Browser components use createConnectTransport (web fetch).
 *
 * All service endpoints now point to HTTP ports (8051, 8052, etc.) instead
 * of gRPC ports (50051, 50052). The HTTP ports serve Connect-RPC which supports
 * both HTTP/1.1 and HTTP/2 with protobuf or JSON encoding.
 */
import { createConnectTransport } from '@connectrpc/connect-web';
import { createNodeHttpTransport } from '@connectrpc/connect-node';

const isServer = typeof window === 'undefined';

/**
 * Returns a Connect transport for the given service HTTP base URL.
 * On the server (Next.js Route Handlers), uses Node.js HTTP.
 * In the browser, uses fetch.
 */
export function createTransport(baseUrl: string) {
  if (isServer) {
    return createNodeHttpTransport({ baseUrl, httpVersion: '2' });
  }
  return createConnectTransport({ baseUrl });
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
