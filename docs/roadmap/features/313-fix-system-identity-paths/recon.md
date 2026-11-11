# Recon: fix-system-identity-paths

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: origin/main-dev@c4fd48b0a (detached checkout; no `feature/fix-system-identity-paths` branch existed at recon time). The four discovery digests were UNSTAMPED. Every `path:line` below was re-grepped by the orchestrator at this tree.
**Affected services**: xstockstrat-ingest, xstockstrat-analysis, xstockstrat-ledger (ledger is read-only reference; no change expected)

---

## Objective

Two owner-identity gaps sit on paths that have no real inbound caller.

1. **Ingest.** The server-initiated `mcp_client` poll loop writes `ingest.signal.ingested` ledger events with a NULL owner. The cause is that `AppendEventRequest.user_id` is never set and the loop has no propagated `x-user-id`. As a result `ExportEvents`, which is scoped to `user_id = caller`, never returns these events to the source owner.
2. **Analysis.** In the P&L consumer, `_compose` is documented never to raise (FR-6). It does raise `ValueError` for a `system`-owned order event, because the feature-225 `owner_metadata` call sits outside every `try`. The event is then retried and parked as poison instead of degrading to a partial snapshot.

The fix attributes the owner explicitly on the ingest AppendEvent, and makes a `system` owner take the existing empty-owner degrade branch in `_compose`.

## Codebase Map

### `xstockstrat-ingest` (Python)

- **Loop entry point.** `poll_one_source` is at `services/xstockstrat-ingest/app/engine/mcp_client_loop.py:115`.
  - The owner comes from the source row: `owner = src["user_id"]` at `:123`.
  - The per-item call is at `:158-160`: `servicer._ingest_external_signal(_build_external_signal(slug, item), owner=owner)`. It passes no metadata.
  - Per-item isolation is the `try/except` around it at `:157-169`. The all-items-failed raise is at `:173-175`.
- **Shared ingest core.** `async def _ingest_external_signal` is at `services/xstockstrat-ingest/app/handlers/servicer.py:1015`.
  - `propagation_meta = propagation_meta or []` at `:1024`. On the loop path the ledger therefore receives an empty metadata list, not `None`.
- **Bug site.** The ledger emit is at `servicer.py:1174-1182`.
  - `ledger_pb2.AppendEventRequest(event_type="ingest.signal.ingested", source_service=..., stream_key=f"signal:{signal.source}:{signal.symbol}", payload=payload)`, with `metadata=propagation_meta`. No `user_id=` is set.
  - The payload already carries `"user_id": owner` at `:1167`. The ledger owner column does not read the payload.
- **RPC path, which works.** `IngestSignal` is at `servicer.py:981`. It builds `propagation_meta` from invocation metadata filtered to `x-user-id`, `x-access-scope` and `x-trace-id` (`:983-987`), then passes it at `:994-996`.
- **Helpers.**
  - `_propagation_meta(context)` (`servicer.py:362`) is a staticmethod that needs a gRPC context, so the loop cannot use it.
  - The `x-trace-id` mint precedent is the backfill resume at `servicer.py:762`: `meta = (("x-trace-id", str(uuid.uuid4())),)`.
  - `import uuid` is at `servicer.py:11`. Digest 1 said `:415`; the re-grep shows `:11`.
  - `_PROPAGATED_HEADERS` is defined at `services/xstockstrat-ingest/app/admin_audit.py:19`.
- **Other `AppendEventRequest` sites.** The backfill events at `servicer.py:467`, along with the other `metadata=propagation_meta` forwards at `:473,500,565,618,823`, are out of scope.
- **Last migration.** `014_contract_signal_ownership.up.sql` (`services/xstockstrat-ingest/migrations/`). This fix needs none.
- **Config read.** Not involved.

### `xstockstrat-analysis` (Python)

- **Identity helper.** In `services/xstockstrat-analysis/app/identity.py`, `SYSTEM_IDENTITY = "system"` is at `:3`. `owner_metadata` (`:6-10`) raises `ValueError` for an empty or `system` owner (`:8`). It is the sole builder of the owner header (feature 225).
- **Consumer (`services/xstockstrat-analysis/app/engine/pnl_pattern_consumer.py`).**
  - `_POISON` (`:65-73`) includes `ValueError`.
  - `_is_poison` is at `:76`, `_EVENT_MAX_ATTEMPTS = 3` at `:55`, and `_process_with_retry` at `:228`.
  - `_handle_order_event` (`:348`):
    - Owner read: `user_id = payload.get("user_id", "")` at `:350`.
    - `position_id = self._synth_position_id(user_id, ...)` at `:358`.
    - `_compose(symbol, strategy_id, user_id)` at `:362-364`. It runs before the txn.
    - The `order_snapshots` insert is at `:368-386`.
    - The window open is guarded `if event_type in (...) and user_id:` at `:388`. A truthy `system` would open a `pnl_positions` window owned by `system`.
    - The audit event name is chosen by `degraded` at `:407` (`analysis.snapshot.degraded` vs `.captured`).
  - `_compose` (`:532`):
    - **Bug site.** `meta = owner_metadata(owner) if owner else ()` at `:539`, outside any `try`.
    - The `ohlcv_and_closes(symbol, meta)` call is inside a `try` at `:541-545`.
    - **Degrade branch to reuse.** The empty-owner degrade at `:546-548` is `if not owner: log.warning(...); return bar, closes, {}, [], True`.
  - `_handle_close_event` reads `user_id` at `:421`. No `owner_metadata` call appears in that read, so it is not in scope.
- **Other `SYSTEM_IDENTITY` users, which must stay untouched.**
  - `app/handlers/servicer.py:687`: the inbound refusal of `system`.
  - `app/engine/live_loop.py:76`: `_SYSTEM_READ_META`.
  - `app/engine/fundsignal_loop.py:211`.
- **Schema fact (load-bearing for AC-2).** `order_snapshots` is created in `migrations/016_order_snapshots_pnl_patterns.up.sql`. A grep for `degraded` across `services/xstockstrat-analysis/migrations/` returns nothing, so the table has no degraded column. "Degraded" exists only as the ledger event name (`:407`) and the `degraded` field of that event's payload.
- **Last migration.** The highest `*.up.sql` is `027_contract_owner_dimension.up.sql`. Digest 2 flagged that the analysis CLAUDE.md cites higher seed numbers, so this listing is not a next-free claim. This fix needs no migration.

### `xstockstrat-ledger` (Node.js), reference only

- **Owner resolution.** At `services/xstockstrat-ledger/src/grpc/ledgerServiceImpl.ts:76-78` the order is `req.userId`, then `x-user-id` metadata, then `null`.
- **ExportEvents scoping.**
  - Documented at `ledgerServiceImpl.ts:373`.
  - The query is at `:404`: `SELECT * FROM ledger.events WHERE user_id = $1 ...`. NULL-owner rows never match.
- **Proto.** In `packages/proto/ledger/v1/ledger.proto:51`, `string user_id = 9; // owning user; falls back to the x-user-id metadata when empty`. The Event message has `user_id = 11` (`:35`).
- **Existing tests (`services/xstockstrat-ledger/src/__tests__/ledgerServiceImpl.test.ts`).** They already pin all three owner paths:
  - `:675` request field wins.
  - `:691` metadata fallback.
  - `:709` NULL.
- **Migrations.** `000`-`003` (`003_events_user_id`). None needed.

### Test harnesses

- **Ingest `services/xstockstrat-ingest/tests/test_mcp_client_loop.py`.**
  - `_mcp_source(...)` at `:80`.
  - `test_cycle_parses_and_ingests_signal` at `:94`.
  - A spy `async def spy(signal, propagation_meta=None, owner=None)` at `:196`.
  - `test_per_owner_bearers_and_ingest_as_owner` at `:259`.
  - The owner assertion `all(c.kwargs["owner"] == "u-1" for c in calls)` at `:439`.
- **Ingest `services/xstockstrat-ingest/tests/test_signal_ownership.py:138-139`.**
  - Pattern: `svc._ledger.AppendEvent.call_args.args[0].payload["user_id"] == owner`.
  - AC-1 adds `.user_id == owner` on the same request object.
- **Analysis `services/xstockstrat-analysis/tests/test_pnl_pattern_consumer.py`.**
  - Fakes: `FakeLedger` (`:158`) and `FakeComposer` (`:192`).
  - `make_consumer(*, composer=None, cfg=None)` at `:214`.
  - `ORDER_PAYLOAD` at `:234` (owner `u-1`).
  - `test_ac6_indicator_timeout_degrades` at `:328`.
  - `_MetaRecordingComposer` at `:443`.
  - `test_compose_threads_order_owner_header` at `:461`.
  - `PARKED = "analysis.pnl.event_parked"` at `:474`.
  - The `sleeps` fixture at `:483`.
- **Analysis `services/xstockstrat-analysis/tests/test_owner_header_guard.py:435`.** `test_ac17_ownerless_order_event_issues_no_owner_scoped_call` is the empty-owner sibling of AC-2.

## Patterns to REUSE

- **Ingest ledger owner.**
  - Set `user_id=owner` explicitly on the `AppendEventRequest` at `servicer.py:1175`. The proto field exists for this purpose (`ledger.proto:51`), and ledger precedence honours it first (`ledgerServiceImpl.ts:77-78`).
  - This also fixes the RPC path harmlessly, because there the owner equals the header value.
  - Do not add a new helper and do not route the owner through `system`.
- **Per-cycle trace id (Open Question 1, if taken in scope).** Mint `("x-trace-id", str(uuid.uuid4()))` with the precedent at `servicer.py:762`, and pass it as `propagation_meta` from `mcp_client_loop.py:158-160`. Do not use `_propagation_meta(context)` (`servicer.py:362`), because it needs a gRPC context.
- **Analysis degrade.** Route a `system` owner into the existing early-return at `pnl_pattern_consumer.py:546-548`, using the same shape as empty-owner. There are two options:
  - Guard the `:539` meta build and the `:546` check with `not owner or owner == SYSTEM_IDENTITY`.
  - Normalise once at the top of `_compose`.

  In both cases `SYSTEM_IDENTITY` is imported from `app/identity.py:3`. `owner_metadata` stays the sole header builder and keeps raising (feature 225, AC-16).
- **AC-2 test.** Model it on `test_compose_threads_order_owner_header` (`tests/test_pnl_pattern_consumer.py:461`), with a `system` variant of `ORDER_PAYLOAD`. Assert the following:
  - The snapshot insert happened.
  - `analysis.snapshot.degraded` is in `FakeLedger.appended`.
  - No `PARKED` (`:474`).
  - No composer indicators/signals call.

  Build the RED against the real `_compose`, not a mocked raise (insights 2026-11-04 fix-analysis-owner-scope: "a mock that cannot raise is not evidence").
- **AC-1 test.** Extend the `test_signal_ownership.py:138-139` pattern, and/or drive `poll_one_source` via `test_mcp_client_loop.py` and assert `AppendEvent.call_args.args[0].user_id == "u-1"`. The ledger-side half of AC-1 ("ExportEvents as user-a returns it") is already guaranteed by ledger `@AC-11 @feature-021` plus the precedence tests at `ledgerServiceImpl.test.ts:675`. The design must decide whether AC-1's second Then is covered by citation or needs an integration step.
- **Fixtures (C-13).** A `system`-owner order payload has one consumer, so it stays inline. Centralise into `tests/conftest.py` only on a second consumer.

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-17 @FR-1 @feature-225` "An ownerless order event issues no owner-scoped call" (`services/xstockstrat-analysis/acceptance/private-by-default-enforce-contract.feature:42-47`). The empty-owner branch stays exactly as is. **EXTEND**: the `system`-owner case adds a sibling with the same shape.
- **PRESERVE** `@AC-16 @FR-1 @feature-225` "An ungranted system identity is refused by analysis" and `@AC-8 @FR-1 @feature-225` "A headerless owner-scoped call is rejected in analysis" (same file). The inbound fail-closed gate is untouched. `owner_metadata` still raises for `system`, and no `system` header is ever sent from `_compose`.
- **PRESERVE** `@AC-14`/`@AC-15 @FR-7 @feature-225` (same file). `QueryPnLPatterns` is caller-owner-scoped. A `system` order must not open a `pnl_positions` window that could surface in anyone's patterns (see Risks, `:388`).
- **PRESERVE** `@AC-6 @FR-6 @FR-7`, `@AC-7 @FR-7` and `@AC-1 @FR-1 @FR-2` (all `@feature-042`, `services/xstockstrat-analysis/acceptance/order-snapshots-pnl-patterns.feature`). These cover the partial-snapshot and never-block guarantee, the unchanged snapshot event types, and the real-owner path (non-empty indicators and signals). **EXTEND** `@AC-6`: AC-2 adds the `system` case to "degrade, never raise".
- **PRESERVE** `@AC-7 @FR-5 @regression @feature-259` "A ledger event that keeps failing is parked" and `@AC-9 @FR-5 @regression @feature-259` (`services/xstockstrat-analysis/acceptance/fix-python-loop-supervision.feature`). Retry-then-park stays for genuine poison. `ValueError` is **not** removed from `_POISON`. Only the `system`-owner raise stops reaching it.
- **PRESERVE** `@AC-11 @FR-10 @feature-021` and `@AC-8 @FR-7 @feature-021` (`services/xstockstrat-ledger/acceptance/ledger-event-export.feature`). Export is scoped to `user_id = caller` and the row shape is unchanged. AC-1 relies on this with no ledger change.
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-261` and `@AC-8 @FR-1 @regression @feature-261` (`services/xstockstrat-ingest/acceptance/fix-ingest-poller-backfill.feature`). These cover per-item isolation and all-items-failed `last_error` on the mcp_client poll.
- **PRESERVE** `@AC-4 @FR-4 @feature-166` (`services/xstockstrat-ingest/acceptance/mcp-client-signal-source.feature`). This covers poll ingest and per-owner dedup on the second cycle.
- **PRESERVE** `@AC-28`/`@AC-29`/`@AC-53 @FR-9 @feature-294` (`services/xstockstrat-ingest/acceptance/signal-map-instrumentation.feature`). The `ingest.signal.outcome{path=mcp_poll}` metrics stay unchanged, and neither user_id nor a trace id may become a metric label.
- **PRESERVE** `@AC-33 @FR-6 @feature-224` "A user cannot write as the system owner" (`services/xstockstrat-ingest/acceptance/private-by-default-templates.feature:40-41`). The ingest fix attributes a real owner and never routes through `system`.
- **PRESERVE** `docs/sdd/business-rules/platform.feature` `@AC-5 @FR-5 @feature-210` "Header-propagation semantics are unchanged beneath mTLS" (`:243-244`), together with `@AC-6 @FR-3 @FR-1`, `@AC-23 @FR-11`, `@AC-26 @FR-6` and `@AC-36 @FR-4` (all `@feature-224`). `system` stays a SAN-gated reserved identity, and the semantics of the propagated trio are unchanged.
- **No CHANGE** to any existing guarantee. No existing `@AC-*` pins the ledger owner of `ingest.signal.ingested` or mcp_client trace-id minting, so AC-1 and AC-2 are net-new and additive.

## Dependencies

- **Proto/RPC:** none. `AppendEventRequest.user_id = 9` already exists (`packages/proto/ledger/v1/ledger.proto:51`).
- **Migration:** none in any service. Ingest is at `014`, ledger at `003`, analysis at `027` (per glob).
- **Config keys:** none.
- **Inter-service edges:** the existing ingest → ledger (`AppendEvent`) edge only, with no new edge. The analysis consumer → ingest/indicators calls are *removed* for a `system` owner, matching the empty-owner case.
- **New env vars / ports:** none.

## Risks / Not-found

- **AC-2 Then over-claims persisted state.** This repeats the trap in fails.md 2026-11-04 private-by-default-enforce-contract. AC-2 says the `order_snapshots` row is "marked degraded". `order_snapshots` has no degraded column: a grep for `degraded` in `services/xstockstrat-analysis/migrations/` returns nothing. "Degraded" exists only as the `analysis.snapshot.degraded` ledger event (`pnl_pattern_consumer.py:407`). The design must reword the Then to "an order_snapshots row is written with empty indicators and signals, and an `analysis.snapshot.degraded` event is emitted" before spec. `@AC-*` IDs are append-only, but the wording may be corrected (C-15), and the correction must be recorded in context.md.
- **`system` opens a `pnl_positions` window.** `:388` gates on truthy `user_id`, so a `system` order would write a `system`-owned window and `position_id` (`:358`). AC-2 requires only the snapshot. The design must decide whether to also skip the window for `system`. Skipping keeps `@AC-14`/`@AC-15` trivially safe; not skipping creates `system`-owned P&L rows. This is not addressed by the product spec.
- **`ohlcv_and_closes` with empty meta.** For `system`, the bars call at `:542` would run with `()` meta, the same as empty-owner today. This is acceptable if it mirrors the empty-owner case. The design should confirm that marketdata accepts a headerless bars read from analysis. That holds for the empty-owner path today, but recon did not verify it for marketdata's gate.
- **Read the real try extents.** fails.md 2026-11-04 private-by-default-enforce-contract (assumption): "open each call site and read the actual try/except extent". Here `:539` is confirmed outside every `try`. The fix must not move `owner_metadata` into a broader `try` that swallows real failures.
- **Never-raises RED must use the real raiser** (insights 2026-11-04 fix-analysis-owner-scope). Drive the real `_compose` and `owner_metadata`, and confirm the RED message `owner-scoped call needs a real owner, got 'system'` before the fix.
- **Positive-poison allow-list** (fails.md 2026-10-22 fix-python-loop-supervision). Do not alter `_POISON` to "fix" AC-2.
- **Open Question 1 (trace id).** No trace-id minting exists in the regions of `mcp_client_loop.py` that were read (`:115-175`). It is not confirmed absent elsewhere in the file. Status: in-scope decision for design.
- **Open Question 2 (existing NULL-owner rows).** These cannot be attributed. `ledger.events` is append-only via `deny_mutation` triggers (ledger CLAUDE.md Critical Invariant #1; `services/xstockstrat-ledger/migrations/003_events_user_id.up.sql` header: backfill "impossible by construction"). Recommendation: leave them, and record the decision in context.md.
- **Open Question 3 (trading `system` guard).** A grep for a `"system"` literal / `SystemIdentity` in `services/xstockstrat-trading/internal/service/trading.go` found none, so there is no explicit guard. Trading is not an affected service. Adding a guard would expand scope and require trading acceptance-suite recon.
- **Spy signature coupling.** The `test_mcp_client_loop.py:196` spy mirrors `_ingest_external_signal(signal, propagation_meta=None, owner=None)`. If the loop starts passing metadata, the spy must still forward it.
- **Overlap** (from sdd-review). The ingest mcp_client area is shared with 328, and analysis with 308/309/327. Check `pnl_pattern_consumer.py` / `mcp_client_loop.py` edits against those branches before spec.
- **Consumer surface (C-14).** The owner-visible consequence is that a user's `ExportEvents` now returns mcp_client signal events. Review warned that the spec has no Consumer Surface statement. The design should name the agent/UI export surface or mark this platform-internal with a reason.
- **Not found.** There is no existing test that feeds `user_id: "system"` to `PnLPatternConsumer`. There is no existing ingest test asserting `AppendEventRequest.user_id` or the loop's AppendEvent metadata.

## Recommended Scope

Advisory, not binding.

1. **ingest (service).** `servicer.py:1175`: set `user_id=owner` on the `ingest.signal.ingested` `AppendEventRequest`. Optionally (OQ-1), the loop mints a per-cycle `x-trace-id` and passes it as `propagation_meta` at `mcp_client_loop.py:158-160`.
2. **ingest (test), AC-1.** Assert the request `user_id == owner` on both the loop path (`test_mcp_client_loop.py`) and the RPC path (`test_signal_ownership.py:138-139`), and the trace id in `call_args.kwargs["metadata"]` if OQ-1 is in scope. Cover AC-1's ExportEvents Then by citing ledger `@AC-11 @feature-021` and `ledgerServiceImpl.test.ts:675`, unless the design requires an integration step.
3. **analysis (service).** `_compose` (`pnl_pattern_consumer.py:539,546`): treat `owner == SYSTEM_IDENTITY` like an empty owner, giving no `owner_metadata` call, empty indicators and signals, and `degraded=True`. Decide on the `:388` window guard for `system`.
4. **analysis (test), AC-2.** A `system`-owner `order.filled` through `process_event` gives a snapshot insert, `analysis.snapshot.degraded`, no `PARKED`, and no indicators/signals composer calls. RED is taken against the real `_compose`. First reword the AC-2 Then so it drops "marked degraded" as row state.
5. **No ledger, proto, migration or config steps.** Record the OQ-2 decision (leave NULL rows) and the OQ-3 decision (no trading guard; out of scope) in context.md.
