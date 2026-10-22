# Product Spec: fix-ui-transport-hardening

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-ui-transport-hardening-defect.md`
**Severity**: SEV-3
**Created**: 2026-10-21

---

## Problem Statement

**Observed.**

- **D-37.** `services/xstockstrat-ui/src/lib/connectClients.ts:53-62` creates the server-side gRPC transport with
  no default timeout; only `insightsBff.ts:58`, `:103`, `:114` and `traderBff.ts:78` pass their own.
  `src/lib/identity.ts:14` (`refreshSession`, called from `src/middleware.ts:40`) has none, so a black-holed
  identity backend stalls middleware for every navigation by a user with an expired access token.
- **D-38.** `src/middleware.ts:22` excludes `api/health|health` only at the root (`/api/health`, `/health`), where
  no route exists. The eight segment health routes (`/trader/health`, `/trader/api/health`, `/insights/health`,
  `/insights/api/health`, `/config-ui/health`, `/config-ui/api/health`, `/accounts/api/health`,
  `/accounts/api/agent-health`) go through auth and redirect unauthenticated probes to `/auth/login`.

**Expected.** Every server-side UI gRPC call has a bounded default deadline (overridable per call), including
`refreshSession`; the eight segment health routes are reachable without a session.

## Reproduction Steps

1. D-37: point `IDENTITY_ENDPOINT` at a listener that never responds; load a protected page with an expired access
   token and a valid refresh cookie — the request hangs.
2. D-38: `curl -sI http://localhost:3000/trader/health` with no cookies → redirect to `/auth/login`.

## Root Cause Hypothesis

D-37: the mTLS transport wrapper never set a default deadline. D-38: health routes moved under segment prefixes
(feature 045) while the matcher kept root-level exclusions.

## Affected Services

- xstockstrat-ui

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated (escalate to quick design if the default deadline is made a `ui.*` config key)

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Agent `client.py` default deadline (debt-radar D-16)
