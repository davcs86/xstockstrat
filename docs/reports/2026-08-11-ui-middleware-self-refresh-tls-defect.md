# UI: Middleware Token-Refresh Self-Call Fails Intermittently with `ERR_SSL_WRONG_VERSION_NUMBER` — 2026-08-11

**Status: fixed in this report's companion PR** (`claude/ui-service-logs-debug-4oygmg`).
GitHub Issues are disabled on this repo, so this report is the audit trail per
`docs/runbooks/bug-triage.md` Track C (SEV-3 — intermittent session-refresh failure with no
trading-path or financial-integrity impact; only the DigitalOcean `xstockstrat-staging` app, which
serves as the dev deployment, is affected).

## Report

`xstockstrat-ui`'s DigitalOcean App Platform RUN logs (`xstockstrat-staging` app, deployment
`13d123c7-91da-4c6d-a848-1279a78457ea`) show recurring bursts of:

```
TypeError: fetch failed
    at cj (.next/server/src/middleware.js:13:60297)
  [cause]: [Error: ...SSL routines:tls_validate_record_header:wrong version number...] {
    library: 'SSL routines',
    reason: 'wrong version number',
    code: 'ERR_SSL_WRONG_VERSION_NUMBER'
  }
 ⨯ Error: Cannot append headers after they are sent to the client
    code: 'ERR_HTTP_HEADERS_SENT'
```

Each burst is a request whose access-token cookie was within `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS`
(60s) of expiry, so `middleware.ts` tries to refresh it before continuing; the refresh call itself
fails with a TLS handshake mismatch, which Next.js then fails to render an error response for
cleanly (`_not-found/page.js` tries to write headers a second time). The overall app health stayed
`HEALTHY` throughout (this doesn't crash the process), but affected users would be bounced through
an unclean error response instead of a normal redirect-to-login when their session happened to be
near-expiry.

## Root cause

`middleware.ts` built the internal refresh request from the inbound request's own URL:

```ts
const refreshUrl = new URL('/api/auth/refresh', req.url);
```

`req.url` in production is the app's public `https://xstockstrat-staging-….ondigitalocean.app`
origin. A container calling back out to its own public domain is, on DigitalOcean App Platform,
intermittently routed over the platform's internal (plain-HTTP) service network rather than back
out through the edge's TLS termination — the `https://` `ClientHello` then lands on a non-TLS
responder, producing exactly `ERR_SSL_WRONG_VERSION_NUMBER`.

Separately, `/api/auth/refresh` was not excluded from the middleware `matcher` (unlike its sibling
`api/auth/login`). Since this route is called only by this same middleware's near-expiry branch and
never by the browser, an un-excluded self-call re-entered the auth gate on the same
still-not-yet-refreshed cookie — which is still inside the refresh threshold — and could trigger a
second self-call. This compounds the failure mode above but is a bug independent of it.

## Fix

- `services/xstockstrat-ui/src/lib/auth.ts`: added `buildInternalRefreshUrl()` — builds
  `http://127.0.0.1:<PORT>/api/auth/refresh` (`PORT` defaults to `3000`, matching the Dockerfile's
  `EXPOSE 3000`) instead of deriving the URL from the inbound request's public origin. The Next.js
  server always listens on plain HTTP on that port in the same container, so this loopback never
  leaves the process and can't hit the platform's TLS-termination ambiguity.
- `services/xstockstrat-ui/src/middleware.ts`: uses `buildInternalRefreshUrl()` for the refresh
  call, and adds `api/auth/refresh` to the matcher's exclusion list alongside `api/auth/login` /
  `api/health`.

## Tests added

- `services/xstockstrat-ui/src/lib/auth.test.ts`: asserts `buildInternalRefreshUrl()` returns a
  plain-`http://127.0.0.1` URL (never derived from a request origin), defaults to port `3000`, and
  honors a `PORT` override. RED-verified against the pre-fix code (the function didn't exist).
- `services/xstockstrat-ui/src/middleware.test.ts`: asserts the exported `config.matcher` excludes
  `api/auth/refresh` (and still excludes its siblings, still matches a protected app route).
  RED-verified against the pre-fix matcher (the exclusion was missing).

## Not in scope

- No change to `ACCESS_TOKEN_REFRESH_THRESHOLD_SECONDS` or the redirect-to-login fallback when a
  refresh genuinely fails (e.g. an actually-expired refresh token) — that behavior is correct and
  unaffected by this fix.
