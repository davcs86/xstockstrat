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
`https://api.ibkr.com/v1/api` (`ibkr.go:51`; `instantiateBrokerLocked`, `trading.go:3084-3097`, never sets
`BaseURL`). Every IBKR call is expected to 401. `ValidateCredentials` maps 401/403 to `broker.ErrInvalidCredentials`
(`ibkr.go:571-572`, TRADING-3), so the credential-health poller marks the account INVALID; `resolveConid`,
`GetOrder` and `ListOrders` return wrapped `status 401` errors (`ibkr.go:177-178`, `:398-399`, `:437-438`).

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

- xstockstrat-trading (fix site: `internal/broker/ibkr.go`, `ibkrCreds` in `internal/service/trading.go:87-92`)
- Possibly xstockstrat-ui (`src/components/trader/accountShared.tsx`) and xstockstrat-agent (`app/tools.py`) if the
  IBKR credential blob gains LST key material (signature/encryption RSA keys, DH prime) — design decision
- The IBKR credential shape is copied in five places; a shape change updates all five: `trading.go:87-92`,
  `packages/proto/trading/v1/trading.proto:269`, `accountShared.tsx:49-55`, `tools.py:2162-2163`,
  `docs/runbooks/mcp-tools.md:1391` (C-10)

## Consumer Surface(s)

Nothing is deferred. Rows marked "if the shape changes" depend on the credential-shape decision at `/sdd-design`
(Open Questions); with no shape change they need no code change.

- `/trader` Accounts module, credential badge (`src/components/trader/CredentialStatusBadge.tsx`, rendered at
  `accountShared.tsx:315` and `AccountSelector.tsx:59`): no code change. An IBKR account with valid credentials
  reads `CREDENTIAL_STATUS_OK` (`trading.proto:211`) instead of INVALID.
- `/trader` IBKR register / update-credentials form (`accountShared.tsx`: `buildCredentialsJson` `:46-57`,
  `credentialSchema` `:61-91`, IBKR inputs in `CredentialFields` `:110-140`). If the shape changes, the form gains
  the new key-material inputs with required-field validation and still never renders stored values back.
- `/trader` order ticket and order views on an IBKR account (`PlaceOrder`/`CancelOrder`/`ReplaceOrder`, fill and
  reconciliation status): no UI change. Calls stop failing with 401.
- Agent MCP `manage_account` `register` / `update_credentials` (`tools.py:2140`, IBKR shape `:2162-2163`) and
  `docs/runbooks/mcp-tools.md:1391`. If the shape changes, the docstring and runbook IBKR shape are updated in the
  same PR. Tool name, parameters and return shape stay unchanged, and credentials are never echoed.
- Agent MCP `list_accounts`: no contract change. IBKR `credential_status` reads OK for valid credentials. The agent
  has no broker order tools (`manage_offline_account` records offline-only orders, `client.py:2215`).
- Existing IBKR accounts holding the 4-field blob (`trading.broker_accounts.credentials_enc`,
  `migrations/002_broker_accounts.up.sql:8`). If the shape changes, `/sdd-design` decides what the badge and
  `manage_account` show until the account is updated via `UpdateBrokerAccountCredentials`. Such an account must
  never read OK.
- Unaffected: `BROKER_TYPE_ALPACA` and `BROKER_TYPE_OFFLINE` accounts, which take separate branches of
  `instantiateBrokerLocked` (`trading.go:3084-3110`). Order-type handling and fill lifecycle are also unchanged.

## Fix Scope

- [ ] Proto change possible: comment-only update of the IBKR `credentials_json` shape (`packages/proto/trading/v1/trading.proto:269`) if new key fields are added. This is non-breaking: no field number or type changes, and `buf breaking` is unaffected. It needs approval from a single `packages/proto` owner.
- [x] No database migrations anticipated (credentials are an encrypted JSON blob)
- [ ] Credential shape change possible: new encrypted IBKR credential fields for the LST handshake (Security review)

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Open Questions

- Scope fork (C-11, context.md:27-33): does the LST handshake stay in this bug track, or split into a
  `/sdd-story`? The Expected bullets and `@AC-2`/`@AC-3` assume it stays. Operator decision at `/sdd-design`.
- Verification path (trading C-3): no IBKR paper account with OAuth key material is confirmed on dev. Decide at
  `/sdd-design` whether a known-answer vector from the ibind reference client stands in for the dev smoke test.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- IBKR Client Portal Gateway support (rejected by feature 001)
