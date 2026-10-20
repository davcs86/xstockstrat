# Product Spec: fix-ibkr-request-signing

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-19-trading-ibkr-oauth-signature-omits-query-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

**Observed.** `resolveConid`, `GetOrder` and `ListOrders` set `httpReq.URL.RawQuery` and then sign the bare
endpoint (`services/xstockstrat-trading/internal/broker/ibkr.go:167-168`, `:388-389`, `:427-428`).
`signRequest` (`ibkr.go:580`) builds the base string from the `oauth_*` params only, so sent query params are
never signed. Beyond that, every request (GET/POST/DELETE) is HMAC-SHA256 keyed by `"&" + accessTokenSecret`;
there is no Live Session Token (LST) handshake and no `realm` in the header (grep of `services/xstockstrat-trading`
for `live_session`, `realm`, `limited_poa`, `diffie`: no matches). Paper and live both use
`https://api.ibkr.com/v1/api` (`ibkr.go:51`; `trading.go:3009-3015` never sets `BaseURL`). Every IBKR call is
expected to 401, which TRADING-3 maps to `broker.ErrInvalidCredentials`, marking the account INVALID.

**Expected.**
- The client obtains an LST via IBKR's OAuth 1.0a handshake (RSA-SHA256 + Diffie-Hellman).
- Each regular request is HMAC-SHA256 signed with the base64-decoded LST, and the header carries
  `realm="limited_poa"`.
- The signature base string includes every query param actually sent, sorted and encoded with the oauth params;
  the base URI excludes the query (RFC 5849 §3.4.1.3).

## Reproduction Steps

1. Register an IBKR account with valid OAuth credentials (paper or live).
2. Place an order → `resolveConid` `GET .../secdef/search?symbol=…&types=STK`.
3. Observe 401 from IBKR, or the account's `CredentialStatus` flipping to INVALID.
4. Repeat with the fill poller (`GetOrder`), the reconciliation poller (`ListOrders`) and `ValidateCredentials`
   (no query; fails on the missing LST alone).

Local (no IBKR account): scratch test `zz_sigrepro_test.go` from the report, run in
`services/xstockstrat-trading/internal/broker/` with `GOWORK=off go test ./internal/broker/ -run TestZZ_ -v`.

## Root Cause Hypothesis

`signRequest` implements generic OAuth 1.0a, not IBKR's variant: it takes a URL string (callers pass the pre-query
endpoint) and never merges query params; it keys HMAC with the access-token secret, performs no LST handshake and
omits `realm`. Fixing query params alone does not make IBKR work.

## Affected Services

- xstockstrat-trading (fix site: `internal/broker/ibkr.go`, `ibkrCreds` in `internal/service/trading.go:87`)
- Possibly xstockstrat-ui (`src/components/trader/accountShared.tsx`) and xstockstrat-agent (`app/tools.py`) if the
  IBKR credential blob gains LST key material (signature/encryption RSA keys, DH prime) — design decision

## Fix Scope

- [ ] Proto change possible: comment-only update of the IBKR `credentials_json` shape (`packages/proto/trading/v1/trading.proto:267`) if new key fields are added; no field-number change anticipated
- [x] No database migrations anticipated (credentials are an encrypted JSON blob)
- [ ] Credential shape change possible: new encrypted IBKR credential fields for the LST handshake (Security review)

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- IBKR Client Portal Gateway support (rejected by feature 001)
