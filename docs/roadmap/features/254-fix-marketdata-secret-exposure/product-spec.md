# Product Spec: fix-marketdata-secret-exposure

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-marketdata-secret-exposure-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

**Impacted actor:** the platform operator and security owner, whose FMP/Finnhub vendor keys and Alpaca live
trading keys are exposed to anyone who can read gRPC errors, caller logs or OTel, or who holds any platform
mTLS leaf.

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

## Functional Requirements

- **FR-1 (D-39, FMP):** when the FMP HTTP transport fails, the returned error names `fmp` and the request
  `path` (for example `/stable/quote`, the first call `GetFundamentalsMulti` makes), and contains neither the
  API key nor the substring `apikey=`.
- **FR-2 (D-39, Finnhub):** when the Finnhub HTTP transport fails, the returned error names `finnhub` and the
  request `path` (for example `/stock/metric`, the first call `GetFundamentals` makes), and contains neither the
  API key nor the substring `token=`. Finnhub's `GetFundamentalsMulti` skips per-symbol errors
  (`finnhub_client.go:64-69`), so the error surfaces through `GetFundamentals`.
- **FR-3 (D-39, gRPC edge):** the `CodeUnavailable` status message that `marketdata_service.go:1704`/`:1760`
  build from a vendor transport failure contains no vendor key, so callers and OTel never see it. The
  redaction happens at the client (FR-1, FR-2). The service layer keeps its `%w` wrap and needs no change,
  because it only wraps the already-redacted client error.
- **FR-4 (D-40, deny):** config `GetSecret` for any of the four marketdata vendor keys with
  `x-internal-caller: marketdata` returns `PERMISSION_DENIED` and no plaintext when the mTLS peer SAN is not
  `xstockstrat-marketdata` (a different SAN, or no SAN at all).
- **FR-5 (D-40, allow):** the same call from an mTLS peer whose DNS SAN is `xstockstrat-marketdata` still returns
  the plaintext, so marketdata keeps resolving its credentials at boot.

## Consumer Surface(s)

None - internal/platform-only. No UI page, agent tool or public API changes shape. The visible changes are
narrower: the text of the marketdata `CodeUnavailable` status message (FR-3; vendor and path stay, key goes) and
the `GetSecret` authz outcome for non-marketdata peers (FR-4). Neither has a legitimate consumer that depends on
the old behavior.

**Broker scope (C-2):** ALPACA and IBKR order routing is unaffected. Only the marketdata secret-read grant in
config changes; trading's order path, order types and fills are untouched.

**Paper/live (C-3):** the SAN binding (FR-4, FR-5) behaves identically in staging (paper) and production (live).
The grant is not environment-scoped, and both environments mint the marketdata leaf with the same SAN (see Fix
Scope).

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
- [x] Deploy check resolved: every environment's marketdata leaf carries DNS SAN `xstockstrat-marketdata`.
  Local/dev leaves come from `scripts/gen-dev-certs.sh` (`SERVICES` at :28 includes `xstockstrat-marketdata`;
  `subjectAltName = DNS:${svc}` at :50). Dev and prod deploys mint their leaves the same way:
  `.github/workflows/deploy.yml:102` runs `gen-dev-certs.sh` off the per-env CA, and `scripts/mtls-provision.sh`
  only provisions the CA. **Pre-merge gate (execute):** re-confirm those three lines are unchanged before the SAN
  binding merges, because a leaf without the SAN would fail FR-5 at boot.
- [x] Rollback and smoke test: after the dev deploy, confirm marketdata logs a successful vendor-credential
  resolve at boot (no `PERMISSION_DENIED` from `GetSecret`). If it fails, revert the `authz.ts` grant change
  alone. The D-39 client fix is independent and can stay.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- The SetConfig grant's missing `peerSan` (`authz.ts:66-76`). Feature 241 owns it as a named follow-up defect.
- A `GetSecret` audit by caller SAN (debt-radar signal-map cross-reference)
