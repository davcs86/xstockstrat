# Recon: fix-edge-owner-scope

**Created**: 2026-10-22
**From**: product-spec.md (spec-ready, operator override 2026-10-22 applied: D-31 bind-to-caller)
**Affected services**: xstockstrat-ui, xstockstrat-ledger, xstockstrat-agent, xstockstrat-config
**Severity**: SEV-2 (Track C bug, debt-radar D-25, D-31)

---

## Objective

Close two cross-tenant reads. **D-25:** the trader BFF `LedgerService.QueryEvents` forwards foreign or empty
`stream_key`s to a ledger read that has no owner predicate. **D-31:** the agent `get_config` / `list_config_keys`
tools pass a caller-chosen `user_id` that config trusts over the verified `x-user-id`. After the fix, every edge read
returns only the caller's own data. A foreign `account:<id>` returns `PERMISSION_DENIED`. An empty or unrecognised key
is owner-scoped and never returns NULL-`user_id` rows. A non-admin's foreign config `user_id` is bound to the caller
(it is not refused), and admins stay exempt. Own-data reads keep working: copilot thread, lineage, reconciliation, and
the caller's own overlay.

## Codebase Map

- **`xstockstrat-ui`** (Next.js, trader BFF): the D-25 edge
  - Handler: `LedgerService.queryEvents`, `services/xstockstrat-ui/src/lib/traderBff.ts:118-127`. It rewrites only
    keys that start with `COPILOT_STREAM_PREFIX` and passes every other `req.streamKey` through unchanged. This is the
    bug.
  - `appendEvent` forces the key, type and source server-side: `traderBff.ts:130-141`
  - Session and permission helpers, `src/lib/bffShared.ts`:
    - `requireSession`: `:29`
    - `backendHeaders`: `:38`
    - `requireAdminScope`: `:47`
    - `forward`: `:64`
    - `forwardAdmin`: `:80`
  - Copilot helpers: `COPILOT_STREAM_PREFIX = 'copilot:'` at `src/lib/copilot.ts:9`, and `copilotStreamKey(userId)`
    at `:27`
  - `tradingClient` is already imported in `traderBff.ts:9`. `listBrokerAccounts` is a plain `forward` at
    `traderBff.ts:53`. Trading scopes `ListBrokerAccounts` by user (`account_repo.go:84`, per digest, not re-grepped
    here).
  - Insights BFF forces `portfolio:<own id>` at `src/lib/insightsBff.ts:148-157`. It is out of scope and must keep
    working.
  - Consumers:
    - `src/hooks/usePositionLineage.ts:16-20` sends `eventType 'order.filled'` and `sourceService 'trading'` with no
      `streamKey`, then filters client-side at `:22-29`.
    - `src/hooks/useReconciliationStatus.ts:12-15` sends `streamKey: account:${accountId}`.
    - `src/components/copilot/CopilotRail.tsx:55` sends a copilot read.
  - Last migration: n/a. Config-read pattern: n/a (no new key).
- **`xstockstrat-ledger`** (Node): the alternative D-25 fix site
  - `queryEvents`: `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:124`. Its WHERE clause uses only
    stream_key, event_type, source_service, time_range and from_sequence, and the SELECT is at `:162`. It has **no
    owner predicate**.
  - `appendEvent` stamps the owner as request `userId`, else `x-user-id` metadata, else NULL: `ledgerServiceImpl.ts:37-39`
  - `exportEvents` is the parity model, at `:282`.
    - The caller is `call.metadata?.get?.('x-user-id')?.[0] ?? ''` (`:302`), so an empty caller matches nothing and
      NULL rows are excluded (comment at `:301`).
    - Its SQL is `WHERE user_id = $1 AND occurred_at BETWEEN …` (`:311`).
  - Same unscoped class, out of the stated scope: `streamEvents` at `:182` (replay SELECT at `:236`) and `getEvent` at
    `:262`
  - `rowToEvent` maps `userId: row.user_id ?? ''` at `:376`, so events carry their owner to the BFF.
  - Last migration: `003_events_user_id.up.sql` (`services/xstockstrat-ledger/migrations/`). It adds a nullable
    `user_id` and `idx_events_user_sequence`. Historical rows are NULL (the append-only guard blocks UPDATE).
- **`xstockstrat-agent`** (Python, MCP): the D-31 tools
  - `get_config(namespace, user_id="")`: `services/xstockstrat-agent/app/tools.py:1592`. It has **no `ctx`** and
    passes the body `user_id` straight through at `:1610`. The secret-redaction loop follows it.
  - `list_config_keys(namespace, user_id="")`: `tools.py:1620`, with the same pass-through at `:1636`.
  - `set_config` at `tools.py:1642` is the reference shape for a tool that takes `ctx: Context`.
  - Helpers:
    - `_caller_access_scope(ctx, tool)`: `tools.py:134`
    - `_require_admin`: `:146`. It raises, so it cannot be used for bind-not-refuse.
    - `_caller_user_id`: `:155`. It raises when the claims `user_id` is empty.
    - `CallerPropagationMiddleware`: `:190`. It propagates the `x-user-id` / `x-access-scope` / `x-trace-id` trio.
  - Admin bit: `_ADMIN = 0x04` at `app/scopes.py:35`, and `roles_to_access_scope` at `:39`.
  - Client wrappers:
    - `get_config`: `app/client.py:2034`, echoing `"user_id": user_id` at `:2059`
    - `list_config_keys`: `client.py:2064`, echoing at `:2080`
  - Last migration: n/a.
- **`xstockstrat-config`** (Node): the alternative D-31 fix site, and the read sink
  - `requestUserId(req)`: `services/xstockstrat-config/src/grpc/configServiceImpl.ts:78` (body `userId`, falling back
    to `user_id`)
  - Body-`user_id` reads:
    - `watchConfig`: `:280`, with userId at `:283`
    - `getConfig`: `:315`, reading `:317` and resolving via `resolveOverlayValues` at `:229`, called at `:319`
    - `listKeys`: `:525`, with userId at `:527`
    - `getSecret`: `:335`, with userId at `:343`. Out of scope (NC-B).
  - Header-derived bind pattern: `setConfig` at `:371` compares body `userId` (`:374`) with
    `userIdFrom(call.metadata)` (`:376`).
  - `authz.ts` helpers:
    - `ADMIN_SCOPE`: `:8`
    - `HEADER_USER_ID`: `:11`
    - `hasAdminAccessScope`: `:20`
    - `userIdFrom`: `:27`
    - `ADMIN_SCOPE_ERROR`: `:32`
    - `HEADER_INTERNAL_CALLER`: `:56`
    - `hasInternalCallerAuthority`: `:82`
    - `hasSecretCallerAuthority`: `:149`
  - Invariant: `services/xstockstrat-config/CLAUDE.md:36` (#5). `SetConfig` is scope-gated and reads are not. Reads
    are deliberately open because every service boots through an unauthenticated `WatchConfig`.
  - Last migration: `030_marketdata_edgar_snapshot_keys.up.sql`. None is needed.

## Patterns to REUSE

- Forcing the stream key in the BFF from the verified session: use `traderBff.ts:118-127` (copilot rewrite),
  `traderBff.ts:130-141` (`appendEvent`) and `insightsBff.ts:148-157` (`portfolio:<own id>`).
- An owner filter from inbound `x-user-id`, where an empty caller matches nothing and NULL rows are excluded: use
  `exportEvents` at `ledgerServiceImpl.ts:301-311`. This is the `ExportEvents` parity that FR-2 names.
- Admin gating at the BFF: use `requireAdminScope` at `bffShared.ts:47`. Owned-account lookup: use
  `tradingClient.listBrokerAccounts` (already imported at `traderBff.ts:9` and `:53`).
- Agent bind-to-caller: add `ctx: Context` as `set_config` does (`tools.py:1642`). Use `_caller_access_scope(ctx,
  tool) & 0x04` for the admin exemption (pattern at `tools.py:151`) and `_caller_user_id(ctx, tool)` (`:155`) as the
  replacement `user_id`. Do **not** use `_require_admin`, because it refuses.
- Config-side bind, if chosen: use `userIdFrom(call.metadata)` at `configServiceImpl.ts:376` and `hasAdminAccessScope`
  at `authz.ts:20`. The latter fails closed on an absent or unparseable scope.
- Insight `insights.md:602-604` (formula-management-ui): "Any ownership/identity field accepted from a client request
  body must be overwritten server-side at the BFF layer, never trusted as-typed". This is the D-31 bind rule and the
  D-25 copilot rewrite.
- Insight `insights.md:1491+` (strategy-user-ownership): derive the "which RPCs/paths need the owner check" set
  mechanically, and audit list reads separately. That applies here: `streamEvents` and `getEvent` are the same class.
- Test harnesses:
  - Ledger: `makePool` (`ledgerServiceImpl.test.ts:35`) ignores SQL, so a predicate test must capture
    `_sql` / `_params`. `makeStreamCall(req, userId)` at `:545` supplies `x-user-id`. Mirror `describe('exportEvents')`
    at `:624` beside `describe('queryEvents')` at `:142`.
  - Agent: use `_ctx(TRADER|ADMIN)` from `tests/conftest.py:17`. Its claims are `ADMIN u-1` at `:12` and
    `TRADER u-2` at `:13`. Use `patch.object(client, "get_config", AsyncMock)` with `await_args.kwargs`, following
    `tests/test_config_tools.py:308-328`.
  - UI e2e: `e2e/mock-backend.ts:394` `queryEvents`. It has no owner or foreign-key branch yet. Fixtures live in
    `e2e/fixtures/ledgerEvents.ts` and `copilotThread.ts`, with the catalog in `INVENTORY.md` (C-12).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-11 @FR-10 @feature-021` "The export returns only the authenticated user's own events"
  (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`). This is `ExportEvents` per-user scoping and
  the parity model for FR-2. A `QueryEvents` owner predicate must leave `ExportEvents` behavior unchanged.
- **PRESERVE** `@AC-8 @FR-7 @feature-021` "Each exported row carries the required fields"
  (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`). It covers the exported row keys, including
  `stream_key` and `user_id`. Do not alter the shared event mapping.
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @feature-021`, `@AC-2 @FR-2 @feature-021` and `@AC-7 @FR-6 @feature-021`
  (`docs/sdd/business-rules/platform.feature`). They cover export streaming, ordering and format, which a
  `QueryEvents` change does not affect.
- **PRESERVE** `@AC-6 @FR-5 @feature-021` "An unauthenticated request is rejected"
  (`services/xstockstrat-ui/acceptance/ledger-event-export.feature`). This is the adjacent BFF auth edge.
- **PRESERVE** `@AC-11 @FR-9 @feature-147` "A per-user config value overrides the global value"
  (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`). `GetConfig` with `x-user-id` resolves
  the user's own override (200), and other users get the global value (50). FR-5 and AC-6 depend on this own-overlay
  behavior.
- **PRESERVE** `@AC-13 @FR-9 @feature-147` "A per-user override reaches a WatchConfig subscriber through the overlay"
  (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`). The `WatchConfig` body-`user_id`
  overlay must not regress if config narrows how far it trusts the body `user_id`.
- **PRESERVE** `@AC-14 @FR-2 @FR-9 @feature-147` "A secret stays redacted even inside a per-user WatchConfig overlay"
  and `@AC-3 @FR-2 @feature-147` "GetConfig and ListKeys redact secrets at the edge"
  (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`). Caller-bound reads must still redact
  secrets.
- **PRESERVE** `@AC-4 @FR-3 @feature-147` and `@AC-5 @FR-3 @feature-147`
  (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`). They cover the `GetSecret` allow-list
  and exact-scope resolution. Out of scope, but a shared body-`user_id` change must not break them.
- **PRESERVE** `@AC-6 @FR-4 @feature-219` "ListKeys returns the per-user row's updated_at in user scope"
  (`services/xstockstrat-config/acceptance/config-ui-usability.feature`). A `user_id` that matches the caller must
  keep returning the per-user scope (FR-4).
- **PRESERVE** `@AC-13 @FR-4 @feature-219` "ListKeys returns the global row's updated_at in global scope" and
  `@AC-7 @FR-4 @feature-219` "Secret rows still expose no value but do carry updated_at"
  (`services/xstockstrat-config/acceptance/config-ui-usability.feature`). The empty-`user_id` global scope and the
  redacted-secret `updated_at` stay unchanged.
- **PRESERVE** `@AC-8`/`@AC-9`/`@AC-12 @feature-219` (`services/xstockstrat-ui/acceptance/config-ui-usability.feature`).
  Config-ui `ListKeys` rendering and save-refresh must keep working. The operator view reads `ListKeys` with a
  scope and a `user_id`.
- **PRESERVE** `@AC-8 @FR-5 @feature-161` "the dead source-weights key is gone after the removal migration" and
  `@AC-7 @FR-5 @feature-161` (`services/xstockstrat-config/acceptance/surface-signal-weight-decay-config.feature`). An
  operator's `list_config_keys` / `get_config` for `analysis` keeps working.
- **PRESERVE** `@AC-35 @FR-14 @feature-224 @feature-225` "Two users with the same mcp_client slug use their own
  credentials" (`docs/sdd/business-rules/platform.feature`). `GetConfig`, `ListKeys` and `WatchConfig` never return a
  per-user secret in plaintext. Ingest's `GetSecret` with the owner's `user_id` must keep working.
- **PRESERVE** `@AC-5 @FR-5 @feature-210` "Header-propagation semantics are unchanged beneath mTLS"
  (`docs/sdd/business-rules/platform.feature`). `x-user-id` propagation is the trust anchor for this fix.
- **PRESERVE** `@AC-7 @FR-7 @FR-9 @FR-10 @feature-183` and `@AC-9 @FR-9 @feature-183`
  (`services/xstockstrat-agent/acceptance/mcp-user-profile-roles.feature`). The admin profile tools resolve their
  target from the request `user_id`. They are distinct from `get_config`, so do not apply the caller-binding to them.
- **CHANGE (ambiguous, defaulted to PRESERVE)** `@AC-9 @FR-5 @regression @feature-196` "request-only dead fields stay
  server-ignored" (`docs/sdd/business-rules/platform.feature`). For config, `user_id` is a live scope selector, not a
  dead field, so the D-31 bind runs in the same direction as this rule. Design must confirm that no response field
  or scope behavior changes beyond the caller-binding. If it does, user sign-off must be recorded in `context.md`.
- **EXTEND (net-new)**: no existing acceptance suite for `xstockstrat-ui` covers the trader BFF `queryEvents`, the
  copilot rewrite, `usePositionLineage` or `useReconciliationStatus`. AC-1/2/3/7 here are the first guarantees for
  them. No suite pins the insights BFF forced `portfolio:<own id>` key either, and it must not regress.
- No existing `@AC-*` pins an admin reading another user's overlay through `get_config`. FR-6/AC-8 is net-new.

## Dependencies

- **Proto/RPC**: none anticipated. `QueryEventsRequest` (`packages/proto/ledger/v1/ledger.proto:60`) uses
  `stream_key = 1` … `from_sequence = 6` (`:61`, `:66`). Field 7 would be next only if design adds an explicit owner
  field, which the spec does not anticipate.
- **Migration**: none. If one were ever needed, the next numbers would be ledger `004` and config `031`.
- **Config keys**: none.
- **Inter-service edges**:
  - Existing: `xstockstrat-ui` → `xstockstrat-ledger` `QueryEvents` (gRPC); `xstockstrat-agent` →
    `xstockstrat-config` `GetConfig` / `ListKeys` (gRPC)
  - Possibly new, if FR-1 ownership is resolved at the BFF: `xstockstrat-ui` → `xstockstrat-trading`
    `ListBrokerAccounts`, called inside `queryEvents`
  - The `x-trace-id` trio must be forwarded on every request-derived call (C-03, operator standing decision
    2026-10-21, no waiver).
    - UI: `backendHeaders(claims, ctx)`.
    - Agent: `CallerPropagationMiddleware` (`tools.py:190`).
- **New env vars / ports**: none.

## Risks / Not-found

- **A blanket ledger predicate breaks internal callers.** These Go callers issue `QueryEvents` without an explicit
  user scope:
  - `services/xstockstrat-portfolio/internal/service/portfolio_service.go:534` (`EventType: "order.filled"`)
  - `portfolio_service.go:751` and `:796`
  - `services/xstockstrat-trading/internal/service/trading.go:2222`

  *Not verified:* whether these callers forward an inbound `x-user-id`, and whether their event set is per-user or
  system-wide. Analysis, ingest, indicators and the agent have **no** `QueryEvents` call. That was re-grepped and
  corrects digest 1's "analysis reads it". A ledger-side predicate must therefore be gated: opt-in, admin or
  internal-caller bypass, or "scope only when `x-user-id` is present". The design must settle the gate.
- **Ownership of `account:<id>` (FR-1, open C-11 question).** The options are:
  - a per-call trading `ListBrokerAccounts` lookup (latency, plus failure-mode coupling to trading)
  - a cached owned-account set (staleness)
  - the ledger `user_id` predicate

  *Not verified:* whether events on `account:` streams are stamped with `user_id`. If reconciliation or order-intent
  writers append without `x-user-id`, those rows are NULL. A `user_id` predicate would then silently empty
  `useReconciliationStatus` for the legitimate owner, which breaks AC-3 and FR-5. The design must check the writers of
  `reconciliation.*` / `order_intent.*`.
- **Empty `stream_key` (FR-2) cannot be owner-scoped by the BFF alone without a cost.** Post-filtering response events
  by `e.userId === claims.user_id` (possible, since `rowToEvent` emits `userId` at `:376`) breaks pagination:
  it returns short or empty pages and an opaque `next_page_token`. A ledger predicate avoids that. This is the
  strongest argument for at least a gated ledger-side owner filter.
- **Lineage literal trap.** `usePositionLineage.ts:18` sends `sourceService: 'trading'`, which trading does not write
  (per triage). Lineage therefore likely returns nothing today, which masks AC-7 in live testing. Fixing that literal
  is out of scope (same class as `251-fix-getpnl-source-service`), and it must not ship before D-25.
- **Agent rework cost.** Adding `ctx: Context` breaks the existing ctx-less calls at
  `tests/test_config_tools.py:78`, `:320` and `:328`. These need `_ctx(...)`. `TestSdkWiring` and
  `test_config_tools_expose_no_environment_parameter` must keep `ctx` out of the tool schema.
- **Agent fork (C-11):** does an empty `user_id` from a non-admin still mean "global values", or the caller's own
  overlay? The spec binds only a *foreign* id, and AC-6 passes the caller's own id. Keeping empty as global follows the
  rule of preserving as much as possible (and `@AC-13 @feature-219`).
- **Config-side bind constraint.** `WatchConfig`, `GetConfig` and `ListKeys` are deliberately open
  (`services/xstockstrat-config/CLAUDE.md:36`, #5). Backend services call them with a body `user_id` and no
  `x-user-id`. A config-side bind must apply only when a verified `x-user-id` is present and the scope is non-admin,
  and it must exempt the boot/internal path. Binding in the agent touches only the D-31 surface and avoids this. The
  BFF `getConfig` forwards (`traderBff.ts` ConfigService block, `insightsBff.ts`) would stay unbound in that case.
  That is outside D-31, but design should state it.
- **Doc drift to fix in the same PR (C-10, `fails.md:307-309`):**
  - `services/xstockstrat-agent/CLAUDE.md:74`: the `get_config` row says "scoped by an optional per-user `user_id`".
    The `list_config_keys` row and the `:30` propagation paragraph say similar.
  - The tool docstrings at `tools.py:1595-1596` and `:1623-1624`.
  - `docs/runbooks/mcp-tools.md` (not opened; unverified).
  - The ledger `CLAUDE.md` stream-key section, if `QueryEvents` semantics change.
  - The `strat-lab` plugin does not cover the config tools, so no update is needed there.
- **Merge overlap** (context.md 2026-10-22):
  - `241-fix-config-audit-author-spoof` (agent `tools.py`, config `setConfig`)
  - `247-fix-agent-getconfig-deadline` (collides if `client.get_config` changes; binding inside the tool avoids it)
  - `248-fix-ledger-trimmed-notify-payload` (same ledger file, non-overlapping)
  - `242-fix-push-untargeted-broadcast` (`traderBff.ts`, `authz.ts`)
  - `257-fix-ledger-query-pagination` (same `queryEvents` body, high conflict risk if the ledger predicate is chosen)
  - `270-fix-ui-trader-feedback`
  - `273-fix-agent-client-deadlines`

  257, 270 and 273 are not present on this branch's `docs/roadmap/features/`. Their state comes from context.md only.
- **Applicable `fails.md` trap:** `fails.md:1129-1145` (strategy-user-ownership). Closure claims such as "already
  handles it" or "no other consumer" were disproved round after round, and a second `traderBff.ts` call site was
  missed. Re-grep every "no other caller" claim in the same round, especially the internal `QueryEvents` callers
  above.
- **Not found:**
  - any existing ownership check for `account:<id>` keys
  - a `traderBff` / `bffShared` unit test
  - dedicated tests for agent `get_config` / `list_config_keys` with a foreign `user_id` or admin vs non-admin binding
  - a config test covering a foreign-`user_id` read
- **Also unverified:**
  - `account_repo.go:84` and `trading.go:282` (trading `ListBrokerAccounts`), cited from a digest
  - `services/xstockstrat-ledger/docs/context-constitution.md` and the config per-module constitution, not opened

## Recommended Scope

Advisory input to the grilling and to `/sdd-spec`, not binding. It aims for "preserve as much as you can while having
low rework".

1. **D-31, agent tool bind** (`tools.py:1592`, `:1620`). Add `ctx: Context`. A non-admin gets a non-empty `user_id`
   other than their own replaced by `_caller_user_id`. Admins pass through. An empty `user_id` stays global (pending
   the C-11 fork). Leave `client.py` untouched to avoid 247 and 273. Fix the ctx-less tests and add AC-4/5/6/8 tests.
   Same PR: reword the agent `CLAUDE.md` rows, the propagation paragraph and the docstrings.
2. **D-31, config-side defence-in-depth (optional, design decides).** Bind `GetConfig` / `ListKeys` only when a
   verified `x-user-id` is present and is non-admin. Leave `WatchConfig` and `GetSecret` untouched to preserve
   `@AC-13 @feature-147`, invariant #5 and NC-B. Weigh this against YAGNI (C-18).
3. **D-25, fix locus decision.** Option A: a gated ledger owner predicate on `QueryEvents`, `ExportEvents`-style,
   applied only for a trader-edge caller via a gate to be designed, with the BFF forwarding the session's
   `x-user-id`. Option B: a BFF-only fix with an owned-account check through `ListBrokerAccounts` plus response
   post-filtering, which costs pagination. A hybrid is also possible: the BFF does the allow-list and the
   foreign-`account:` refusal (FR-1), and the ledger owner filter handles empty or unrecognised keys (FR-2).
4. **D-25, consumers and tests.**
   - Add owner and foreign-key branches to `e2e/mock-backend.ts:394`, using fixtures (C-12).
   - Add ledger unit tests that capture the SQL and params, mirroring `exportEvents`.
   - Check that `useReconciliationStatus` surfaces `PERMISSION_DENIED` through its error state.
   - Check that the insights BFF and `ExportEvents` are unchanged.
5. **Docs and teardown.** Update the ledger `CLAUDE.md` `QueryEvents` semantics if they changed, verify
   `docs/runbooks/mcp-tools.md`, and run the context-constitution refresh.
