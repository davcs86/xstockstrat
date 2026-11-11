# Product Spec: fix-vendor-key-in-url

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: docs/reports/2026-10-29-marketdata-vendor-key-url-residuals-defect.md
**Severity**: SEV-2
**Created**: 2026-11-10

---

## Problem Statement

### marketdata vendor API keys still ride in the request URL (redirect-parse residual + access logs)

Report: [docs/reports/2026-10-29-marketdata-vendor-key-url-residuals-defect.md](../../../reports/2026-10-29-marketdata-vendor-key-url-residuals-defect.md)
(filed by feature 254 Step 8 as its accepted residuals; 254's transport and build-request sites are fixed).

- **Observed:** (a) a vendor redirect whose `Location` header fails to parse yields `net/http`'s
  `failed to parse Location header %q` error; the client wraps that inner cause, which quotes the vendor-sent
  `Location` — if the vendor echoes the query, the key reaches the error, the gRPC `Unavailable` status and
  logs. (b) Every request URL carries the key, so it lands in vendor access logs and any egress proxy /
  load-balancer log that records full URLs.
- **Expected:** no vendor API key appears in any error text, log line or URL that leaves the process.

## Reproduction Steps

1. (a) Point `fmp.NewClient` at an `httptest` server returning `302` with an unparseable `Location` that
   contains the request's query string; call `GetFundamentalsMulti`. The returned error text contains `apikey=`.
2. (b) Route marketdata vendor traffic through any proxy that logs request URLs; observe `apikey=` / `token=`.

## Root Cause Hypothesis

The key travels in the query string, so every URL-bearing surface (redirect errors, access logs) can carry
it. Report's recommended class fix: send the key in a request header (FMP `apikey`, Finnhub
`X-Finnhub-Token` — vendor support **unverified**); if URL-bearing errors still need handling, consolidate
the `*url.Error` unwrap in one shared `redactURLError` helper used by both clients.

Current sites (spot-checked at 0fecb24d; moved from the report's lines):
- `services/xstockstrat-marketdata/internal/fmp/fmp_client.go:260` — `params.Set("apikey", c.apiKey())`
- `services/xstockstrat-marketdata/internal/finnhub/finnhub_client.go:126` — `params.Set("token", c.apiKey())`

## Affected Services

- xstockstrat-marketdata (`internal/fmp`, `internal/finnhub`)

## Fix Scope

- [x] Proto changes anticipated: **no** — vendor HTTP client internals only.
- [x] Database migrations anticipated: **no** — no schema touched.
- [x] Config key changes anticipated: **no** — same `marketdata.fmp.api_key` / `marketdata.finnhub.api_key` secrets, only their transport changes.

## Open Questions

1. Do FMP and Finnhub actually accept the key as a header (`apikey` / `X-Finnhub-Token`)? The report marks
   this unverified; the fix shape depends on it.
2. If a vendor does not support header auth, is residual (b) (access-log exposure) accepted, and who signs
   off on that security posture?
3. Should the shared `redactURLError` helper be added even after a header move (defence in depth), or only
   if a query-string key remains?

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- The feature-254 transport (`Do`) and `build request` error sites — already fixed.
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
