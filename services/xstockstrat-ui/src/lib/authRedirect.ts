// Shared client-side "Unauthorized -> refresh-first, then redirect to login" core (feature 153).
//
// BROWSER-ONLY. Never import this from `middleware.ts` or `auth.ts` — those are bundled for the Edge
// runtime, and this module references `window`/`fetch` and (transitively, via transport.ts) the
// connect-web client. Consumers: `browserClients/transport.ts` (connect-web unary + streaming) and
// the `/accounts` REST fetch call sites (via `apiFetch`).
//
// Behavior on any 401 / gRPC Unauthenticated from a data call: attempt a single token refresh
// (`POST /api/auth/refresh`, cookie-only). If it succeeds the caller retries once (a still-valid
// session recovers silently — access tokens expire every ~15 min but the refresh token lives days).
// If it fails, redirect the browser to the unified login page, preserving the current location.

/** The unified login page path (domain root, outside every segment basePath). */
const LOGIN_PATH = '/auth/login';

/**
 * True when a login redirect is appropriate for the given pathname. Suppressed on the login page
 * itself so an Unauthorized observed there cannot cause a redirect loop (AC-7).
 */
export function shouldRedirectToLogin(pathname: string): boolean {
  return pathname !== LOGIN_PATH;
}

/**
 * Build the login redirect URL, preserving the current location so the user returns after signing in.
 * Matches the shape `middleware.ts` produces for server-side navigation redirects.
 */
export function buildLoginRedirect(pathname: string, search: string): string {
  return `${LOGIN_PATH}?redirect=${encodeURIComponent(pathname + search)}`;
}

// Single in-flight refresh: a page firing many data calls at once will observe many 401s together;
// they must share ONE refresh POST rather than each issuing their own (and rotating each other's
// refresh token out from under them).
let refreshInFlight: Promise<boolean> | null = null;

/** Attempt a token refresh. Deduplicated: concurrent callers await the same POST. */
export function attemptRefresh(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = fetch('/api/auth/refresh', { method: 'POST' })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

/** Navigate the browser to the login page, unless already there (loop guard) or running on the server. */
export function redirectToLogin(): void {
  if (typeof window === 'undefined') return;
  const { pathname, search } = window.location;
  if (!shouldRedirectToLogin(pathname)) return;
  window.location.assign(buildLoginRedirect(pathname, search));
}

/**
 * Shared decision for a just-observed Unauthorized: refresh-first, then redirect on failure.
 * Returns true if the session was refreshed (caller should retry the original call once), false if a
 * redirect was triggered instead (caller should stop).
 */
export async function handleUnauthorized(): Promise<boolean> {
  const refreshed = await attemptRefresh();
  if (!refreshed) redirectToLogin();
  return refreshed;
}

/**
 * `fetch` wrapper for browser REST data calls (the `/accounts` segment, which does not use the
 * connect-web browser clients). On a 401 it runs the refresh-first-then-redirect flow and retries
 * once on refresh success. Same-origin credentialed by default (cookies are same-origin).
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;
  const refreshed = await handleUnauthorized();
  if (!refreshed) return res;
  return fetch(input, init);
}
