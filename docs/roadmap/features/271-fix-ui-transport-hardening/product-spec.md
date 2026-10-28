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

## Functional Requirements

- **FR-1.** Every server-side unary gRPC call made through the UI transport (`src/lib/connectClients.ts`) is bounded
  by a default deadline when the caller passes no `timeoutMs`; a per-call `timeoutMs` still overrides it. This
  includes `refreshSession` (`src/lib/identity.ts`), so an unresponsive identity backend ends in the middleware's
  existing refresh-failed branch (redirect to `/auth/login` with session cookies cleared) instead of a hang.
  Long-lived server streams (`notifyClient.streamAlerts`, proxied by `traderBff.ts` and consumed by
  `AlertStream.tsx`) are not cut off by this default.
- **FR-2.** The eight segment health routes (`/trader/health`, `/trader/api/health`, `/insights/health`,
  `/insights/api/health`, `/config-ui/health`, `/config-ui/api/health`, `/accounts/api/health`,
  `/accounts/api/agent-health`) reach their route handlers without a session (no redirect to `/auth/login`).
- **FR-3.** Every other route under those segments stays gated by auth. The health exclusion matches the exact
  health paths only, not any path that merely starts with or contains `health`.

## Consumer Surface(s)

- **Probes and uptime checks** (DO App Platform health checks, external uptime monitors): the eight segment health
  routes return their handler response instead of a redirect (FR-2).
- **Signed-in users of every segment** (`/trader`, `/insights`, `/config-ui`, `/accounts`): a user with an expired
  access token gets redirected to `/auth/login` within the default deadline when identity is unreachable, instead
  of a hung navigation (FR-1). No visible change when identity is healthy.

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

## Open Questions

1. **Default deadline value.** Proposed: 10s (the transport default; per-call `timeoutMs` overrides keep their
   current values). To confirm in `/sdd-design`; AC-1/AC-2 assert against whatever value is chosen.
2. **Constant vs `ui.*` config key.** Proposed: a code constant (no config change). If it becomes a key it must
   follow C-05 naming (`ui.<category>.<key>`), the Fix Scope config box flips, and the feature escalates to quick
   design with config-team approval. Note that the `ui` namespace is currently read only via a one-shot `GetConfig`
   in `insightsBff.ts`, so a live-updating key would need new wiring.
3. **Streaming calls.** FR-1 exempts long-lived server streams from the default. Design must pick how (unary-only
   default, or an explicit per-stream opt-out) and keep `streamAlerts` open past the default deadline (AC-5).

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Agent `client.py` default deadline (debt-radar D-16)
