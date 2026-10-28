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

**Expected.** Every edge read returns only the caller's own data. The trader BFF refuses foreign stream keys and
owner-scopes empty/unrecognised ones (or the ledger read is owner-scoped); a non-admin `get_config` /
`list_config_keys` carrying another user's `user_id` is bound to the caller (the caller's own `x-user-id` replaces
it), so no other user's data is ever read. Legitimate own-data reads
(copilot thread, own position lineage, own account reconciliation status, own config overlay) keep working.

## Functional Requirements

- **FR-1** — The trader BFF `LedgerService.QueryEvents` forwards a non-empty `stream_key` unfiltered only when it is
  owned by the verified caller: an `account:<id>` the caller owns (all of that stream's rows, including its
  NULL-`user_id` reconciliation rows), or the caller's own `copilot:` thread (any `copilot:` key is rewritten to it).
  A foreign or empty-id `account:<id>` fails with `PERMISSION_DENIED` and returns no events. Every other non-empty
  key falls under FR-2.
- **FR-2** — A trader BFF `QueryEvents` with an empty or unrecognised `stream_key` is owner-scoped to the verified
  caller; it never returns an event belonging to another user, nor a historical row whose `user_id`
  is NULL (`ExportEvents` parity). An empty-`stream_key` query still returns the caller's own events (FR-5).
- **FR-3** — Agent `get_config` called by a non-admin caller with a `user_id` other than the verified caller's is
  bound to the caller: it returns the caller's own per-user overrides and never reads or returns that user's values.
- **FR-4** — Agent `list_config_keys` called by a non-admin caller with a `user_id` other than the verified caller's
  is bound to the caller: it lists the caller's own overridden keys and never reveals which keys that user overrode.
- **FR-5** — Legitimate own-data reads keep working: own copilot thread, own position lineage, own account
  reconciliation status, and own per-user config overlay.
- **FR-6** — A caller with admin access scope may still read another user's per-user overlay through `get_config`
  (FR-3/FR-4 bind non-admin callers only).

## Consumer Surface(s)

- **UI — trader segment (`/trader`)**: BFF `QueryEvents` responses become owner-scoped. `useReconciliationStatus`
  (`account:<id>`) keeps working for owned accounts and gets `PERMISSION_DENIED` for foreign ones (surfaced through the
  hook's existing error state, not as an empty status);
  `usePositionLineage` (no stream key) receives only the caller's events instead of filtering client-side. No visual
  change for a user reading their own data.
- **Agent (MCP tools)**: `get_config` and `list_config_keys` called by a non-admin caller with a foreign `user_id`
  return the caller's own overlay instead of the other user's; own-overlay reads are unchanged.

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

- [x] Proto change: one additive field, `bool owner_only = 7` on `ledger.v1.QueryEventsRequest` (corrected
  2026-10-22 by `/sdd-design`: the ledger owner predicate is opt-in, set by the trader BFF, so internal callers are
  unaffected); C-09 approval gate applies
- [x] No database migrations anticipated — `ledger.events.user_id` already exists (migration 003, nullable; historical
  rows are NULL and cannot be backfilled under the append-only guard)
- [x] No config key changes anticipated

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Open Questions

- [x] Fix site for D-25 (BFF allow-list vs ledger owner predicate on `QueryEvents`). Resolved 2026-10-21: the product
  contract is site-agnostic. FR-1/FR-2 and AC-1/AC-2/AC-7 assert behaviour at the trader BFF surface, so either site
  satisfies them. `/sdd-design` picks the site (C-11) and must keep insights BFF and `ExportEvents` parity.
- [x] Foreign `user_id` in D-31: refuse vs bind to caller. Resolved 2026-10-22 (operator override of the 2026-10-21
  "refuse" resolution): bind to the caller. The caller's own `x-user-id` replaces the foreign `user_id`, the caller's
  own overrides are returned, and no other user's data is ever read (FR-3/FR-4, AC-4/AC-5).
- [x] Admin/internal exemption and NULL-owner rows. Resolved 2026-10-21: admin-scope callers stay exempt from
  FR-3/FR-4 (FR-6, AC-8), matching the existing "non-admin" wording. NULL-`user_id` historical ledger rows are never
  returned by a trader BFF read (FR-2, `ExportEvents` parity, AC-2), since they cannot be attributed to the caller.
- [x] How ownership of an `account:<id>` stream key is determined (FR-1). Resolved 2026-10-22 by `/sdd-design`: a
  per-call trading `ListBrokerAccounts` lookup (user-scoped by trading), no cache; a trading error is passed through
  with its own code and no ledger read is made.

## Out of Scope

- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
- Config `GetSecret` taking `user_id` from the body (debt-radar NC-B, needs confirmation — not yet a finding)
- The `sourceService: 'trading'` vs `'xstockstrat-trading'` mismatch in `usePositionLineage.ts:18` (same class as
  feature `251-fix-getpnl-source-service`; note that fixing it without D-25 would start returning other users'
  fills to the browser)
- Insights BFF `queryEvents` (already forces `portfolio:<own id>`)
