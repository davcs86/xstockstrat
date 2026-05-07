/**
 * Connect-RPC transport factory for xstockstrat-insights.
 *
 * Server-side route handlers use createNodeHttpTransport (Node.js fetch).
 * Browser components use createConnectTransport (web fetch).
 *
 * All service endpoints now point to HTTP ports (8053, 8054, 8056, etc.)
 * instead of gRPC ports. The HTTP ports serve Connect-RPC which supports
 * both HTTP/1.1 and HTTP/2 with protobuf or JSON encoding.
 */
import { createConnectTransport } from '@connectrpc/connect-web';
import { createConnectTransport as createNodeTransport } from '@connectrpc/connect-node';

const isServer = typeof window === 'undefined';

/**
 * Returns a Connect transport for the given service HTTP base URL.
 * On the server (Next.js Route Handlers), uses Node.js HTTP.
 * In the browser, uses fetch.
 */
export function createTransport(baseUrl: string) {
  if (isServer) {
    return createNodeTransport({ baseUrl, httpVersion: '1.1' });
  }
  return createConnectTransport({ baseUrl });
}

// ── Service base URLs ──────────────────────────────────────────────────────
// These point to the Connect-RPC HTTP ports (not the raw gRPC ports).

export const ANALYSIS_BASE_URL =
  process.env.ANALYSIS_HTTP_ENDPOINT ?? 'http://xstockstrat-analysis:8056';

export const INDICATORS_BASE_URL =
  process.env.INDICATORS_HTTP_ENDPOINT ?? 'http://xstockstrat-indicators:8054';

export const MARKETDATA_BASE_URL =
  process.env.MARKETDATA_HTTP_ENDPOINT ?? 'http://xstockstrat-marketdata:8053';

export const NOTIFY_BASE_URL =
  process.env.NOTIFY_HTTP_ENDPOINT ?? 'http://xstockstrat-notify:8059';

export const IDENTITY_BASE_URL =
  process.env.IDENTITY_HTTP_ENDPOINT ?? 'http://xstockstrat-identity:8058';
