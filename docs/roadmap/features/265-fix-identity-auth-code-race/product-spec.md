# Product Spec: fix-identity-auth-code-race

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-identity-auth-code-race-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

Source: repo-surveyor debt-radar scan @ 4535695, findings D-23 (auth-code half only) and D-21 (residual), re-verified
on main-dev @ a053b0e. The refresh-rotation half of D-23 is out of scope: fixed by hotfix `5bd271d`.

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

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Refresh-token rotation (fixed by `5bd271d`)
- `RevokeToken` unverified decode (`2026-10-19-identity-revoketoken-unverified-decode-defect`)
- Auth-code TTL as a config key (config-governance audit F-7)
