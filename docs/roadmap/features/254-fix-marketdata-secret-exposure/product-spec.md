# Product Spec: fix-marketdata-secret-exposure

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-marketdata-secret-exposure-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

**D-39 — vendor key in transport errors.** **Observed:** `fmp_client.go:243` and `finnhub_client.go:118` wrap the
`http.Client.Do` error with `%w`. That error is a `*url.Error` whose message contains the full URL, including
`apikey=` (FMP, set at `fmp_client.go:222`) or `token=` (Finnhub, set at `finnhub_client.go:110`).
`marketdata_service.go:1704`/`:1760` wrap it again into `CodeUnavailable`, so the plaintext key reaches gRPC
status messages, caller logs and OTel. **Expected:** the error keeps vendor and `path` and drops the URL. The
same rule already applies on the non-2xx branch (`fmp_client.go:254`, `finnhub_client.go:126`).

**D-40 — header-only marketdata GetSecret grant.** **Observed:** `authz.ts:115-119` grants the four marketdata
vendor keys to `callerID: 'marketdata'` with no `peerSan`. The interface doc (`authz.ts:110`) says the header
alone is spoofable. Any peer with a platform mTLS leaf can decrypt the Alpaca live keys and both vendor keys.
**Expected:** the grant is bound to the marketdata leaf's SAN, `peerSan: 'xstockstrat-marketdata'`, like
the ingest grant (`authz.ts:124`). A mismatched or absent SAN gets `PERMISSION_DENIED`.

## Reproduction Steps

1. D-39: point the FMP or Finnhub client at `http://127.0.0.1:1` with key `k-secret`, call any fetch, and read
   the returned error. It contains `apikey=k-secret` / `token=k-secret`.
2. D-40: call config `getSecret` for `marketdata/alpaca.api_key` with `x-internal-caller: marketdata` from a peer
   whose SAN is `xstockstrat-ingest`. It returns the plaintext. See `perUserSecrets.test.ts:236`, which asserts
   "no SAN required".

## Root Cause Hypothesis

- D-39: the `%w` wrap on the transport path keeps the `*url.Error`. Redaction was applied only to the status branch.
- D-40: feature 224 SAN-bound only the new ingest grant and left marketdata's unchanged on purpose
  (`224-private-by-default-templates/implementation-spec.md:1615`). Nothing has closed the gap since.

## Affected Services

- xstockstrat-marketdata (D-39 fix site: `internal/fmp/fmp_client.go`, `internal/finnhub/finnhub_client.go`)
- xstockstrat-config (D-40 fix site: `src/grpc/authz.ts`, and flip `src/__tests__/perUserSecrets.test.ts:236`)

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated (D-40 changes an in-code allow-list, not a config key)
- [ ] Deploy check: confirm the dev and prod marketdata leaves carry SAN `xstockstrat-marketdata` (`scripts/gen-dev-certs.sh:50`, `scripts/mtls-provision.sh`) before the SAN binding ships. Otherwise marketdata fails to resolve its credentials at boot.

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- The SetConfig grant's missing `peerSan` (`authz.ts:66-76`). Feature 241 owns it as a named follow-up defect.
- A `GetSecret` audit by caller SAN (debt-radar signal-map cross-reference)
