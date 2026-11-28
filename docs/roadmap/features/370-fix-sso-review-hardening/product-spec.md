# Product Spec: fix-sso-review-hardening

**Type**: bug
**GitHub Issue**: none — `docs/reports/2026-11-28-sso-review-hardening-nits-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-28

---

## Problem Statement

An independent security review of feature 345 (Authelia SSO, PR #1637 → `6739f030`) found five
defense-in-depth gaps, rated "nit, not exploitable today". The owner asked for all five to be fixed
(2026-11-28). Item numbers follow the review.

- **4.** `xstockstrat-ui` middleware copies every inbound header (`Object.fromEntries(req.headers)`)
  into the forwarded request, so a client-sent `x-user-id` / `x-access-scope` reaches the UI's own
  handlers. Expected: both are removed on every middleware path; `x-trace-id` is still set.
- **5.** Identity `IssueSessionForUser` and `ResolveExternalIdentity` do not read `auth.mode`.
  Expected: both refuse in `local` with FAILED_PRECONDITION (code 9), the shape `LinkExternalIdentity`
  uses.
- **6.** The link transaction seals `user_id`, not the session. Expected: it seals SHA-256 of the
  session's refresh token (identity's `token_hash`); confirm compares it in constant time against the
  live `refresh_token`, in addition to the `user_id` and password checks.
- **7.** A callback failure after the txn is opened leaves the `sso_txn_*` cookie; `sso_link` has
  `Path=/`. Expected: every such failure clears the txn cookie; `sso_link` is scoped to
  `/accounts/api/sso` (its only readers: `GET /accounts/api/sso`, `POST /accounts/api/sso/confirm`).
- **8.** Agent JWKS `_ingest` accepts a key with `use: "enc"`. Expected: a key whose `use` is present
  and not `"sig"` is skipped with a logged reason.

## Reproduction Steps

See the defect report § Reproduction.

## Root Cause Hypothesis

Defense-in-depth checks omitted from the 345 implementation; each is a local fix.

## Affected Services

xstockstrat-ui, xstockstrat-identity, xstockstrat-agent

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated (item 6 reads the TTL from the access token's own
      `expires_at − issued_at`, not from `identity/jwt.access_ttl_seconds`)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Paths the middleware matcher excludes (`api/auth/login`, `api/auth/refresh`, `api/oauth`,
  `.well-known`, static assets): middleware does not run there; no handler there reads the headers
