# Product Spec: fix-edge-owner-scope

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-21-edge-owner-scope-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-21

---

## Problem Statement

Source: repo-surveyor debt-radar scan @ 4535695, findings D-25, D-31 (re-verified on main-dev @ a053b0e).

**Observed.**
- **D-25** — `traderBff.ts:118-126` (`services/xstockstrat-ui/src/lib/traderBff.ts`) rewrites only `copilot:` stream
  keys to the caller's thread and forwards every other (or empty) `stream_key` unchanged. Ledger `QueryEvents`
  (`services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:124-162`) has no owner predicate, so any signed-in
  trader can read every user's events. Live callers: `usePositionLineage.ts:16-19` (no stream key, owner filtered
  client-side only) and `useReconciliationStatus.ts:12-13` (`account:<id>`, no ownership check).
- **D-31** — agent `get_config` / `list_config_keys` (`services/xstockstrat-agent/app/tools.py:1592`, `:1620`)
  pass a caller-chosen `user_id` as the request body; config reads (`configServiceImpl.ts:78-79`, `:317-319`,
  `:527-536`) trust it over the verified `x-user-id` the agent propagates. Any MCP user can read another user's
  non-secret per-user overrides and see which keys they overrode.

**Expected.** Every edge read returns only the caller's own data. The trader BFF forwards only owned stream keys
(and refuses empty/unknown ones) or the ledger read is owner-scoped; a non-admin `get_config` / `list_config_keys`
for another user's `user_id` is refused (`PERMISSION_DENIED`) or bound to the caller. Legitimate own-data reads
(copilot thread, own position lineage, own account reconciliation status, own config overlay) keep working.

## Reproduction Steps

1. D-25: as trader user A, call `/trader/api/xstockstrat.ledger.v1.LedgerService/QueryEvents` with
   `{"streamKey": "account:<B's account id>"}` or `{"eventType": "order.filled"}` (no stream key); B's events return.
2. D-31: as non-admin MCP user A, `get_config(namespace="analysis", user_id="<B>")` returns B's overlay values.

## Root Cause Hypothesis

Owner scoping is a per-edge special case (copilot rewrite, insights forced key, `SetConfig` per-user write gate)
rather than a rule at the backend read: ledger `QueryEvents` has no owner concept, and config reads trust the body
`user_id`.

## Affected Services

- xstockstrat-ui (trader BFF; fix site for D-25; position-lineage and reconciliation hooks are consumers)
- xstockstrat-ledger (unscoped `QueryEvents`; fix site only if design scopes the read backend-side, as
  `ExportEvents` already does at `ledgerServiceImpl.ts:279-311`)
- xstockstrat-agent (D-31 tools; fix site if the agent binds `user_id` to the caller)
- xstockstrat-config (body-`user_id` reads; fix site if config binds `user_id` to `x-user-id` unless admin/internal)

## Fix Scope

- [x] No proto changes anticipated — an edge-only fix or a ledger predicate on the inbound `x-user-id` needs none;
  revisit only if design adds an explicit owner field to `QueryEventsRequest`
- [x] No database migrations anticipated — `ledger.events.user_id` already exists (migration 003, nullable; historical
  rows are NULL and cannot be backfilled under the append-only guard)
- [x] No config key changes anticipated

(Update after investigation — remove or replace each item as needed)

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Config `GetSecret` taking `user_id` from the body (debt-radar NC-B, needs confirmation — not yet a finding)
- The `sourceService: 'trading'` vs `'xstockstrat-trading'` mismatch in `usePositionLineage.ts:18` (same class as
  feature `251-fix-getpnl-source-service`; note that fixing it without D-25 would start returning other users'
  fills to the browser)
- Insights BFF `queryEvents` (already forces `portfolio:<own id>`)
