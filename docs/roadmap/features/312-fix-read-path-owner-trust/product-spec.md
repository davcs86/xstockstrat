# Product Spec: fix-read-path-owner-trust

**Type**: bug
**GitHub Issue**: none (Issues disabled) — reports: `docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md`, `docs/reports/2026-10-19-portfolio-default-identity-fallback-defect.md`, `docs/reports/2026-10-19-notify-listalerts-owner-fallback-unscoped-defect.md`
**Severity**: SEV-3
**Created**: 2026-11-10

---

## Problem Statement

### Trading ListOrders/StreamOrderUpdates trust a body user_id filter where empty means all users (SEV-3)

- **Observed**: both RPCs filter on the request-body `user_id` and never consult `x-user-id`; an empty
  `user_id` returns every user's orders. The proto field is undocumented. Today the UI BFF pins it to the
  session and the agent to the caller, so it is not externally exploitable, but any new internal caller (or
  a BFF regression) leaks all users' orders. Contradicts PLAT-11 and PROTO-10.
- **Expected**: non-admin callers are scoped to `x-user-id` server-side (body `user_id` honoured only as an
  admin selector), and the proto documents the field's semantics.
- Report: [`docs/reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md`](../../../reports/2026-10-19-trading-listorders-body-user-id-filter-defect.md)

### Portfolio consumers substitute literal "default" / "alpaca-default" for a missing user or account id (SEV-3)

- **Observed**: `processOrderFill` maps an empty `account_id` to `"alpaca-default"` (dead code — no current
  producer sends it empty); `processPositionSync`, the account-deregister handler and the balance-sync
  consumer map an empty `user_id` to `"default"` (reachable: trading `RegisterBrokerAccount` accepts an
  empty caller when `x-user-id` is missing, so that account's events carry `user_id: ""`). Rows land under a
  phantom owner nobody can read or clean up.
- **Expected**: trading `RegisterBrokerAccount` rejects an empty caller; portfolio rejects and logs events
  without `user_id`/`account_id` (acked and skipped) instead of substituting a placeholder; the dead
  `"alpaca-default"` fallback is deleted.
- Report: [`docs/reports/2026-10-19-portfolio-default-identity-fallback-defect.md`](../../../reports/2026-10-19-portfolio-default-identity-fallback-defect.md)

### ListAlerts trusts the body userId and is unscoped with no identity (SEV-3)

- **Observed**: `ListAlerts` resolves the owner from `x-user-id`, then body `userId`, then `null`; with
  `null` the predicate `$1::text IS NULL OR …` returns every user's targeted alerts, and a body `userId`
  reads another user's alerts. Only direct gRPC (mTLS) callers are exposed; the BFF injects the header.
- **Expected**: require `x-user-id` and reject with INVALID_ARGUMENT or UNAUTHENTICATED when absent, as
  `registerPushSubscription` does (NOTIFY-5); ignore the body `userId`.
- Report: [`docs/reports/2026-10-19-notify-listalerts-owner-fallback-unscoped-defect.md`](../../../reports/2026-10-19-notify-listalerts-owner-fallback-unscoped-defect.md)

## Reproduction Steps

1. Trading: over mTLS as any internal caller, send `ListOrders{}` with a non-admin `x-user-id` → all users' orders.
2. Portfolio: call trading `RegisterBrokerAccount` with no `x-user-id` → account persisted with
   `user_id = ""`; let the sync poller run or call `DeregisterBrokerAccount` with no `x-user-id` → event
   carries `user_id: ""`; portfolio stores or purges rows under `user_id = 'default'`. (Report 2 ran a scratch
   Go test confirming steps 1–2.)
3. Notify: emit alerts targeted to users A and B; call `NotifyService.ListAlerts({})` over mTLS with no
   metadata → alerts for both A and B.

## Root Cause Hypothesis

The read RPCs kept the pre-PLAT-11 body filter when mutation RPCs moved to header identity, leaving the
ownership guard only in callers; a body `userId` fallback kept "for direct gRPC test callers" was never
removed; the portfolio `"default"` fallbacks mask a missing empty-caller guard in `RegisterBrokerAccount`.
Current sites (main-dev @ 0fecb24d):

- `packages/proto/trading/v1/trading.proto` `ListOrdersRequest.user_id = 1` (no comment, not deprecated).
- `services/xstockstrat-trading/internal/service/trading.go:1645-1646` `ListOrders` (passes `req.UserId`);
  `:1726` `StreamOrderUpdates`, `:1730` `if req.UserId != "" && order.UserId != req.UserId`.
- `services/xstockstrat-ui/src/lib/traderBff.ts:35-36` — BFF pins `user_id` to the session.
- `services/xstockstrat-trading/internal/service/trading.go:2595` `RegisterBrokerAccount` (no empty-caller
  check); `:3144` `DeregisterBrokerAccountSvc`; `internal/handler/trading.go:258` `extractUserID` returns "".
- `services/xstockstrat-portfolio/internal/service/portfolio_service.go:435` `acctID = "alpaca-default"`;
  `:1558,1614,1762` `userID = "default"` (deregister, position sync, balance sync).
- `services/xstockstrat-notify/src/grpc/notifyServiceImpl.ts:200` owner fallback chain; `:210,218` the
  `$1::text IS NULL` predicate.

## Affected Services

- xstockstrat-trading (ListOrders / StreamOrderUpdates scoping; RegisterBrokerAccount empty-caller guard)
- xstockstrat-portfolio (placeholder identity fallbacks)
- xstockstrat-notify (ListAlerts owner resolution)
- Consumer surfaces: xstockstrat-ui (trader BFF `listOrders`, alerts) and xstockstrat-agent (orders tools) call the changed RPCs

## Fix Scope

- Proto changes: **yes** — report 1 expects `ListOrdersRequest.user_id` (and the StreamOrderUpdates filter) to document its semantics; a comment at minimum, possibly a deprecation.
- DB migrations: **no** — no schema change named; cleanup of any existing `'default'` / `user_id = ''` rows is an Open Question, not a stated requirement.
- Config key changes: **no** — no report names a key.

## Open Questions

1. Security posture for trading order reads: is body `user_id` kept as an admin-only selector (PROTO-10; how is admin decided — `x-access-scope`?) or dropped entirely, and does an empty value for an admin still mean "all users"?
2. ListAlerts missing-header status: INVALID_ARGUMENT or UNAUTHENTICATED (report 3 allows either); untargeted alerts (`target_user_id IS NULL`) stay visible to every authenticated caller?
3. Existing phantom data: clean up rows already filed under `user_id = 'default'` and broker accounts persisted with `user_id = ''`, or leave them?
4. Rejecting identity-less ledger events in portfolio also drops legacy pre-`user_id` events on replay (the `"default"` comment cites them) — acceptable?
5. Proto: comment only, or deprecate `ListOrdersRequest.user_id` in favour of a separate admin selector (a breaking-change review if renamed)?

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Other RPCs' header propagation (header-propagation pattern) — only the three named read/consume paths.
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
