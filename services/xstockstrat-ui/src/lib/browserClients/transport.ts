// Shared browser (connect-web) transport factory. Every `browserClients/*.ts` client uses this so the
// "Unauthorized -> refresh-first, then redirect to login" guard covers ALL data calls — don't call
// `createConnectTransport` directly. BROWSER-ONLY (references `window` via connect-web + authRedirect);
// never reachable from middleware.ts/auth.ts (Edge bundle).

import { createConnectTransport } from '@connectrpc/connect-web';
import { Code, ConnectError, type Interceptor } from '@connectrpc/connect';
import { handleUnauthorized, redirectToLogin } from '@/lib/authRedirect';

function isUnauthenticated(err: unknown): boolean {
  return err instanceof ConnectError && err.code === Code.Unauthenticated;
}

/**
 * Wrap a server-stream so a mid-stream Unauthenticated triggers refresh-or-redirect instead of being
 * silently swallowed. The stream is NOT replayed on refresh — it recovers on the next reconnect.
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
