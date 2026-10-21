# Product Spec: fix-identity-auth-code-race

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-identity-auth-code-race-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

Source: repo-surveyor debt-radar scan @ 4535695, findings D-23 (auth-code half only) and D-21 (residual), re-verified
on main-dev @ a053b0e. The refresh-rotation half of D-23 is out of scope: fixed by hotfix `5bd271d`.

**Who is affected.** The MCP agent's OAuth client (and any registered OAuth client) redeeming an authorization code
via `ExchangeAuthCode`: anyone who obtains a code in flight can race the legitimate client and receive a second,
independent access + refresh token pair for the authenticating trader. First-party trader/operator login and refresh
in `xstockstrat-ui` are touched only by the D-21 helper consolidation and must keep their current token shape.

**Observed.**
- **D-23** — `ExchangeAuthCode` (`services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:474-518`) reads the
  code with an unlocked SELECT (`:481-488`), checks `consumed_at` in JS (`:491`), then consumes with an
  unconditional `UPDATE … WHERE code = $1` (`:503-506`) and inserts the refresh token separately (`:511`). Concurrent
  exchanges of one code each mint an access JWT and a refresh token.
- **D-21 (residual)** — first-party `authenticateUser` (`:166-185`) and `refreshToken` (`:243-249`) build and sign
  the access JWT inline beside `mintOAuthAccessToken` (`:295-315`), and `authenticateUser` inserts its refresh token
  inline beside `issueRefreshToken` (`:321-334`). The refresh lookup duplication the scan cited was removed by
  `5bd271d` (`rotateRefreshToken`, `:340-370`).

**Expected.** A code is redeemed at most once: a conditional claim (`… AND consumed_at IS NULL AND expires_at >
NOW() RETURNING`), in one transaction with the successor refresh-token INSERT, like `rotateRefreshToken`. Of N
concurrent exchanges, exactly one succeeds; the rest get `UNAUTHENTICATED` (`invalid_grant`). First-party and OAuth
paths share one mint helper and one refresh-issue helper with unchanged claim shapes.

## Functional Requirements

- **FR-1** — `ExchangeAuthCode` consumes the code with a single conditional claim (`UPDATE … WHERE code = $1 AND
  consumed_at IS NULL AND expires_at > NOW() RETURNING …`); the redemption decision is the claim's row count, never
  a prior unlocked SELECT plus a JS `consumed_at` check.
- **FR-2** — The claim and the successor refresh-token INSERT run in one transaction: if the INSERT (or anything
  after the claim) fails, the transaction rolls back and the code's `consumed_at` stays NULL.
- **FR-3** — Of N concurrent `ExchangeAuthCode` calls for one valid code, exactly one returns tokens; the other N-1
  return `UNAUTHENTICATED` with message `invalid_grant`, and exactly one refresh-token row is created.
- **FR-4** — A code already consumed, or expired, returns `UNAUTHENTICATED` `invalid_grant` and creates no token.
- **FR-5** — A request whose `redirect_uri`, `client_id` or PKCE `code_verifier` does not match the stored code fails
  without consuming it (`consumed_at` stays NULL), so a party holding only the code cannot burn it for the
  legitimate client. This preserves today's validate-before-consume order (`:495-502` before `:503`).
- **FR-6** — First-party `authenticateUser`, first-party `refreshToken` and the OAuth exchange/refresh sign access
  JWTs through one shared mint helper; no inline `jwt.sign` remains in `authenticateUser` or `refreshToken`.
- **FR-7** — First-party `authenticateUser` and `ExchangeAuthCode` issue refresh tokens through one shared
  refresh-issue helper (the existing `issueRefreshToken` or its successor); no inline refresh hash + INSERT remains in
  `authenticateUser`.
- **FR-8** — Claim shapes are unchanged: every access token carries `user_id`, `email`, `roles`, `issued_at`,
  `expires_at` with `expires_at - issued_at` equal to `identity.jwt.access_ttl_seconds` (default 900); only OAuth
  tokens carry `aud` (the requested resource); first-party refresh rows keep `client_id` NULL, OAuth rows carry the
  client id.

## Test Harness Expectations

- FR-1..FR-3 (AC-1) are proven only against a real Postgres (the harness the `5bd271d` hotfix used); a mocked-pool
  unit test cannot show the race is closed. The design phase names the harness and confirms the new tests execute
  (identity unit suite early-return, see overlap with 252).
- AC-3 needs fault injection on the refresh-token INSERT; the design phase states the mechanism (e.g. a pool/client
  stub that rejects the INSERT inside the transaction).
- New fixtures follow the C-13 test-data inventory rules.

## Reproduction Steps

1. Real Postgres: register a client, `IssueAuthCode` for `u-1` with a known PKCE verifier.
2. Fire 20 concurrent `ExchangeAuthCode` calls with the same code/verifier/redirect/client.
3. Bug: more than one success and more than one refresh token row for `u-1`/client. Correct: exactly one.

## Root Cause Hypothesis

Read-validate-write with independent autocommit queries; the `5bd271d` hotfix for the identical refresh race was
scoped to refresh only. D-21 is helper extraction never back-applied to first-party login/refresh.

## Affected Services

- xstockstrat-identity

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated (`identity.oauth_auth_codes.consumed_at` already exists, `003_oauth.up.sql`)
- [x] No config key changes anticipated (the hard-coded 60 s auth-code TTL is the separate config-governance audit
  item F-7, `docs/reports/2026-08-07-config-governance-audit.md:123`)

## Consumer Surface(s)

None (internal/platform-only). No RPC, proto field, response shape, UI segment or Agent MCP tool changes. The MCP agent's
OAuth token exchange and `xstockstrat-ui` first-party login/refresh call the same RPCs with the same requests and get
the same token shapes (FR-8). The only behavior change a consumer can see is that a duplicate or concurrent redemption
of one code now fails with `invalid_grant` (the standard OAuth outcome for a reused code), the same error a
sequential reuse already gets today.

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Performance improvements unrelated to the fix
- Refresh-token rotation (fixed by `5bd271d`)
- `RevokeToken` unverified decode (`2026-10-19-identity-revoketoken-unverified-decode-defect`)
- Auth-code TTL as a config key (config-governance audit F-7)
