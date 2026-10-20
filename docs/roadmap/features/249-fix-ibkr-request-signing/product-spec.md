# Product Spec: fix-ibkr-request-signing

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-19-trading-ibkr-oauth-signature-omits-query-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

**Who is blocked.** A trader or operator with a registered IBKR account, paper or live, cannot place, cancel,
replace or track orders on it. Position and balance sync (`GetPositions`/`GetAccount`, `ibkr.go:462`, `:516`) also
fails, and the account never reads `CREDENTIAL_STATUS_OK`.

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

**Confidence.** The query-param omission is confirmed locally. The scratch test's `GetOrder` signature matches the
reference computed with the query omitted, not with it included (context.md:19-24). The LST and `realm`
requirement comes from the ibind reference client and IBKR's docs. No live 401 has been observed, and no IBKR
account is available (context.md § Operator decisions). `/sdd-design` verifies the handshake against IBKR's docs.

**Expected.** IBKR accepts every request the client sends: FR-1..FR-4.

## Functional Requirements

- **FR-1**: Before its first regular request, and whenever it holds no valid LST, the IBKR client obtains a Live
  Session Token through IBKR's OAuth 1.0a handshake. That is an RSA-SHA256-signed LST request carrying a
  Diffie-Hellman challenge, with the LST derived from IBKR's DH response.
- **FR-2**: Every regular request (GET/POST/DELETE) is HMAC-SHA256 signed with the base64-decoded LST, never with
  `"&" + access_token_secret`, and its `Authorization` header carries `realm="limited_poa"`.
- **FR-3**: The signature base string's parameter string includes every query param actually sent, merged and
  sorted with the oauth params. The base string URI excludes the query (RFC 5849 §3.4.1.2, §3.4.1.3).
- **FR-4**: Handshake failures follow TRADING-3. If IBKR rejects the LST request with 401/403, the client returns
  `broker.ErrInvalidCredentials` and the account reads INVALID. Any other failure (5xx, network, timeout) is a
  wrapped transient error, so `credentialStatusFromError` (`trading.go:2951-2960`) records UNKNOWN, never INVALID.

## Reproduction Steps

1. Register an IBKR account with valid OAuth credentials (paper or live).
2. Place an order → `resolveConid` `GET .../secdef/search?symbol=…&types=STK`.
3. Observe a 401 from IBKR: `PlaceOrder` fails with the wrapped `ibkr resolveConid: status 401` error
   (`ibkr.go:177-178`). `CredentialStatus` flips to INVALID only through `ValidateCredentials`, which register,
   update-credentials and the credential-health poller call (`validateAndRecordCredential`, `trading.go:2528`,
   `:2575`, `:2690`).
4. Repeat with the fill poller (`GetOrder`), the reconciliation poller (`ListOrders`) and `ValidateCredentials`.
   `ValidateCredentials` sends no query, so it is expected to fail on the missing LST alone.

Local (no IBKR account): scratch test `zz_sigrepro_test.go` from the report, run in
`services/xstockstrat-trading/internal/broker/` with `GOWORK=off go test ./internal/broker/ -run TestZZ_ -v`.

## Root Cause Hypothesis

`signRequest` implements generic OAuth 1.0a, not IBKR's variant: it takes a URL string (callers pass the pre-query
endpoint) and never merges query params; it keys HMAC with the access-token secret, performs no LST handshake and
omits `realm`. Fixing query params alone does not make IBKR work.

## Affected Services

- xstockstrat-trading (fix site: `internal/broker/ibkr.go`, `ibkrCreds` in `internal/service/trading.go:87-92`)
- xstockstrat-ui (`src/components/trader/accountShared.tsx`) and xstockstrat-agent (`app/tools.py`): expected to
  change, because the LST key material is per-account and the 4-field blob holds none (Fix Scope). `/sdd-design`
  confirms where the material lives.
- The IBKR credential shape is copied in five places; a shape change updates all five: `trading.go:87-92`,
  `packages/proto/trading/v1/trading.proto:269`, `accountShared.tsx:49-55`, `tools.py:2162-2163`,
  `docs/runbooks/mcp-tools.md:1391` (C-10)

## Consumer Surface(s)

Nothing is deferred. Rows marked "if the shape changes" depend on where `/sdd-design` puts the LST key material
(Fix Scope). The expected home is the encrypted blob, which makes those rows required.

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
  `migrations/002_broker_accounts.up.sql:8`). If the shape changes, they cannot handshake until
  `UpdateBrokerAccountCredentials` supplies the new keys. `/sdd-design` decides what the badge and `manage_account`
  show until then. Such an account must never read OK.
- Unaffected: `BROKER_TYPE_ALPACA` accounts take the `default` branch of `instantiateBrokerLocked`
  (`trading.go:3098-3110`), and `internal/broker/alpaca.go` signing is untouched. `BROKER_TYPE_OFFLINE` accounts never
  get a broker client (`trading.go:256`). Order types, order-status mapping and fill handling (including
  PARTIALLY_FILLED/FILLED) are unchanged. Only request signing and the LST handshake change.

## Fix Scope

- [x] No database migrations: credentials are an encrypted JSON blob (`002_broker_accounts.up.sql:8`).
- [x] New credential key material is required. Per the ibind reference, the LST handshake needs a private RSA
  signature key, a private RSA encryption key (which decrypts the access-token secret) and the DH prime.
  `ibkrCreds` (`trading.go:87-92`) holds none of these. Expected home: the `BROKER_ACCOUNTS_ENCRYPTION_KEY`-encrypted
  blob, confirmed by `/sdd-design`. Needs Security review. If any of it moves to env or config, re-check trading-domain C-1
  and C-05.
- [x] Proto: comment-only update of the IBKR `credentials_json` shape (`packages/proto/trading/v1/trading.proto:269`)
  when the blob shape changes (expected). It is non-breaking because no field number or type changes. The `buf lint` /
  `buf breaking` CI gate still runs (C-09), `./scripts/buf-gen.sh` regenerates `gen/` for `proto-freshness`, and
  one `packages/proto` owner approves.
- [x] Config keys: none named here. Any LST TTL, refresh margin or handshake timeout that design adds is a
  `trading.<category>.<key>` read via `WatchConfig`, not a constant (C-05, F-07).

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass. The primary proof is an `httptest` IBKR fake
plus RFC 5849 / ibind known-answer vectors (no live IBKR account; context.md § Operator decisions). The dev smoke
test confirms that trading starts and that Alpaca and offline accounts are unaffected. An IBKR paper-account smoke
test is secondary and runs only if an account with OAuth key material becomes available.

## Open Questions

Resolved (context.md § Operator decisions, 2026-10-20):
- C-11 scope fork: the LST handshake stays in this bug track; no separate `/sdd-story`.
- Verification: RFC 5849 / ibind reference vectors and an `httptest` server, since no live IBKR account exists.

For `/sdd-design`. Each answer that adds behavior adds an `@AC-*` scenario.
- Key material: where it lives (encrypted blob expected), and what an existing 4-field IBKR account shows until it
  is updated.
- Brokerage session: does `/iserver/*` need `/iserver/auth/ssodh/init` and a `/tickle` keepalive after the LST?
  Neither is in the repo. If yes, it is either in scope or named in Out of Scope with a follow-up feature.
- LST lifecycle: expiry and refresh, caching per account in the broker pool, and concurrent pollers sharing one LST
  without a handshake storm.
- Query-value encoding: RFC 5849 §3.6 encodes a space as `%20`, but `url.QueryEscape` (used at `ibkr.go:604-611`)
  emits `+`. Confirm IBKR's rule against its docs and the ibind reference, then add a vector for symbol `BRK B`.
- Timeout budget: the handshake adds round trips inside `validateAndRecordCredential`'s 5s context
  (`trading.go:2603`) and `IBKRRequestTimeout` (`ibkr.go:46`, 10s). That constant also floors the
  `trading.order_intent.stale_multiplier` staleness formula.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- IBKR Client Portal Gateway support (rejected by feature 001)
- Alpaca signing (`internal/broker/alpaca.go`) and offline accounts
- IBKR's hardcoded `IBKRRequestTimeout` (`ibkr.go:44-46`), a separate defect:
  `docs/reports/2026-10-19-trading-ibkr-timeout-hardcoded-defect.md`
