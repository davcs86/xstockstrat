// Shared browser (connect-web) transport factory (feature 153).
//
// Every `browserClients/*.ts` client is built on this factory so the "Unauthorized -> refresh-first,
// then redirect to login" behavior is applied uniformly to ALL segment data calls — no client is
// left unguarded. Do not call `createConnectTransport` directly in a client module; use this instead.
//
// BROWSER-ONLY (imports connect-web + `authRedirect`, which reference `window`). Never reachable from
// `middleware.ts`/`auth.ts` (the Edge bundle).

import { createConnectTransport } from '@connectrpc/connect-web';
import { Code, ConnectError, type Interceptor } from '@connectrpc/connect';
import { handleUnauthorized, redirectToLogin } from '@/lib/authRedirect';

function isUnauthenticated(err: unknown): boolean {
  return err instanceof ConnectError && err.code === Code.Unauthenticated;
}

/**
 * Wrap a server-stream's message iterable so a mid-stream Unauthenticated (e.g. the session expiring
 * while the trader alert / order-update stream is open) triggers refresh-or-redirect instead of the
 * consumer silently swallowing the error. The stream is not replayed on refresh success — it recovers
 * on the next reconnect/navigation (documented open risk).
 */
async function* guardStream<O>(stream: AsyncIterable<O>): AsyncIterable<O> {
  try {
    for await (const message of stream) {
      yield message;
    }
  } catch (err) {
    if (isUnauthenticated(err)) {
      await handleUnauthorized();
    }
    throw err;
  }
}

const unauthenticatedRedirectInterceptor: Interceptor = (next) => async (req) => {
  try {
    const res = await next(req);
    if (res.stream) {
      return { ...res, message: guardStream(res.message) };
    }
    return res;
  } catch (err) {
    if (!isUnauthenticated(err)) throw err;
    const refreshed = await handleUnauthorized();
    // Unary calls retry once with the refreshed session; on a second Unauthenticated, redirect.
    if (refreshed && !req.stream) {
      try {
        return await next(req);
      } catch (retryErr) {
        if (isUnauthenticated(retryErr)) redirectToLogin();
        throw retryErr;
      }
    }
    // Stream open failed, or refresh failed (handleUnauthorized already redirected on failure).
    throw err;
  }
};

/** Build a connect-web transport for the given segment baseUrl, carrying the 401 redirect guard. */
export function makeBrowserTransport(baseUrl: string) {
  return createConnectTransport({ baseUrl, interceptors: [unauthenticatedRedirectInterceptor] });
}
