# xstockstrat-analysis — Constitution Findings

Defects and drift surfaced by `/context-constitution` on 2026-07-24; refreshed 2026-09-02 (branch
`claude/loaded-plugins-list-d120nl` @ `82a0549`); re-verified 2026-10-14 (branch `ccr-fe84109f-0lwin8` @ `09ec8d9`); refreshed 2026-10-19 (branch `ccr-c386317f-6vt6t6` @ `a914f69` — `_is_admin` row resolved; added the `max_concurrent_bars_fetches` enrichment doc-lie and the unreferenced boot-recompute task; line hints re-stamped). For triage/fixing, not
governance. The config zero-trap was resolved by feature 244 (root CF-N10); the internal
admin-scope-injection security question is recorded at the root (it is cross-cutting).

## Documentation that lies (docs claim behavior the code lacks)

| What the docs say | What the code does | Evidence | Suggested action |
|---|---|---|---|
| The service `CLAUDE.md` "P&L pattern consumer" section describes the seal writing "the enriched payload's `realized_pnl`" and lists only the migration-016 tables | It omits the `fees_total` column (migration `021`), the **net-of-fees** contract (ANALYSIS-9), and the new **`GetAttribution`** RPC (absent from both the RPC narrative and any ledger-event/RPC table) — an agent trusting CLAUDE.md would not know net≠gross exists | `services/xstockstrat-analysis/CLAUDE.md` P&L section vs `app/handlers/servicer.py#GetAttribution` (~L4300), `migrations/021_pnl_positions_fees_total.up.sql` | Add `GetAttribution` + the `fees_total`/net contract (ANALYSIS-9) to CLAUDE.md |
| `CLAUDE.md` config row for `analysis.opportunity.max_concurrent_bars_fetches` and the `_enrich_opportunities_live` docstring say `_bars_fetch_sem` bounds live enrichment (found 2026-10-19) | Enrichment does one `BatchGetLatestPrice` under `asyncio.wait_for` with no semaphore; `_bars_fetch_sem` guards only the `EvaluateReadiness` slow path | `services/xstockstrat-analysis/CLAUDE.md` (config table, `analysis.opportunity.max_concurrent_bars_fetches`) vs `app/handlers/servicer.py#_enrich_opportunities_live` (docstring ~L4688; `BatchGetLatestPrice` ~L4736), `#EvaluateReadiness` (~L3927-3942) | Drop the enrichment clause from both (constitution ANALYSIS-8 already narrowed) |

## Latent bugs (looks broken, not merely non-obvious)

| Issue | Impact | Evidence |
|---|---|---|
| ~~**`ConfigWatcher` carries indicators identity**~~ **RESOLVED (feature 174)**: module docstring is now "Config watcher for xstockstrat-**analysis**" and `client_id=f"analysis-{id(self)}"`, built in `_build_watch_request()` | analysis now registers with the config service under its own "analysis-…" client id | `app/config/watcher.py:2` (docstring), `#_build_watch_request` (~L58; `client_id` ~L61) |
| ~~**`ScreenerEngine.screen()` has no per-symbol error isolation**~~ **RESOLVED (feature 245)**: `screen()` now gathers `_eval_symbol_isolated`, which wraps `_eval_symbol` in `except Exception` (not `BaseException`, so the scan-deadline `CancelledError` still propagates) and returns an `eval_failed` seed row; `_build_result` fails it closed as a degraded row (`status OK`, `passed=false`, `score_unavailable=true`, empty raws), sorted after feature-144 rows, with one summary WARN (ERROR when every symbol failed) and a `screener.degraded_count` span attribute per scan | One bad symbol degrades only its own row; the rest of the scan is scored and returned OK | `app/services/screener.py#screen` (~L92; gather ~L115), `#_eval_symbol_isolated` (~L239), `#_build_result` (fail-closed branch ~L485) |
| ~~**Dead `sandbox_*` helpers** (2026-10-14)~~ **RESOLVED (feature 244)**: deleted with their tests; `app/config/watcher.py` defined `sandbox_timeout_ms` / `sandbox_memory_bytes` / `sandbox_allowed_imports` reading `indicators.sandbox.*` keys — copied from the indicators watcher; analysis consumes only the `analysis` namespace | resolved | n/a (helpers removed) |
| **Possible `ValueError` escape from `PnLPatternConsumer._compose`** (unverified, 2026-10-14): `owner_metadata(owner)` is called outside any `try`; if a ledger order event ever carried `user_id == "system"` the `ValueError` would escape a function documented as "never raising out of here (FR-6)" | Breaks the partial-snapshot guarantee | `app/engine/pnl_pattern_consumer.py#_compose` (~L360; `owner_metadata(owner)` ~L367) |
| **Boot recompute task is unreferenced** (found 2026-10-19, low): `asyncio.get_event_loop().create_task(_boot_recompute())` keeps no reference, so the task can be garbage-collected mid-run (same shape as the other loops' `create_task` calls) | ✗ **REFUTED (2026-10-20, high)**: a Python 3.13 repro collects only a task parked on an otherwise-unreferenced future; every analysis loop (and `_boot_recompute`) awaits an `asyncio.sleep` timer, a grpc.aio call or an asyncpg waiter, all anchored to the event loop. Hygiene only — becomes live if a loop ever awaits a locally-created Event/Queue/Future | `app/main.py#_boot_recompute` (~L136; `create_task` ~L143) |

## Open questions (unresolved *why* — needs a maintainer)

- ⚠ **security** — The fundamentals background loop injects `x-access-scope=4` (admin bit) into its own outbound metadata; the admin check is `int(x-access-scope) & 0x04`. Is a background loop self-granting the admin bit the intended trust model? (Cross-cutting with the MCP agent's hardcoded `x-access-scope=7`; tracked in the root findings log.) `app/engine/fundsignal_loop.py:447-448` (`meta.append(("x-access-scope","4"))`, since deleted), admin check `servicer.py:425-437` (`_is_admin`, now `#_has_admin_scope` ~L628) — status: ✓ **RESOLVED** (feature 224): the injection is deleted; the producer now calls ingest/indicators as the reserved `system` identity under the mTLS-SAN-bound `x-internal-caller: analysis-fundsignal` grant (`fundsignal_loop.py` `sys_meta`, no `x-access-scope` in the file)
- Is `LIVE_ENABLED_PREDICATE_SQL` meant to be the single source for the live gate? `entry_backfill.py` re-types the SQL literal instead of importing it, while `live_loop.py` and `strategies.py` import it — deliberate (import cycle through `servicer.py`) or an oversight? — status: **open**
- Can a ledger `order.*` event carry `user_id == "system"` (for example an automated order)? See the `_compose` latent bug above — status: **open**
- `resolve_trading_mode` / `TRADING_MODE` are still sent as the `WatchConfig` subscription scope even though feature 147 removed the axis (`app/config/watcher.py`) — part of the repo-wide disagreement in the root findings log — status: **open**
- **Gross vs. net P&L basis split across the two `realized_pnl` consumers** (2026-09-02): `QueryPnLPatterns` buckets on GROSS `pnl_pattern_samples.realized_pnl` (`app/engine/pnl_pattern_consumer.py#_build_samples` ~L309; sample rows ~L330,351) while `GetAttribution` uses NET (`servicer.py#win = net > 0.0` ~L4337-4338). Likely intentional (feature 042 vs 029, different subsystems) but nowhere stated — an agent unifying "P&L" reporting would assume one basis. Is pattern-sample P&L deliberately gross while attribution is net? — status: **open**
- ⚠ **security (forward-pointer, feature 133)** — Strategy ownership (feature 133) resolves the owner from the inbound `x-user-id` header, which raised the question of a *synthetic* outbound `x-user-id` = a stored strategy owner on the live loop's owner-scoped `ListWatchlists`/`ListPositions` calls — a second un-JWT-verified origination point for that header (the admin-bit self-injection above, extended to *identity* impersonation). **Feature 133 does NOT introduce that call site**: it is identity-only (live-loop *state* is owner-keyed, but the owner-scoped firing **universe** union — the piece that needs the synthetic header — is deferred to feature 132's `resolve_universe`, see 133 `implementation-spec.md` D-1). So the impersonation finding **belongs to feature 132**, not this one; recorded here only so a future reader knows why 133's `x-user-id` propagation did not add a new synthetic-header vector. — status: **deferred to feature 132**

> Note: the "all-None custom formula on staging" bug (PR #769/#773) is **resolved** by feature 067 —
> `evaluator.py#_decode_formula_output` (~L127) now uses `MessageToDict` (recursive `ListValue` decode; import ~L24). Not an open defect.

## Resolved

| What the docs said | Resolution | Evidence |
|---|---|---|
| `CLAUDE.md` / constitution Pointers cite `_is_admin` and header-filter sites `:520,556,1932,2429` | **Resolved 2026-10-19** — `rg _is_admin CLAUDE.md` = 0; the constitution Pointers row cites `_has_admin_scope` and the re-stamped filter sites | `app/handlers/servicer.py#_has_admin_scope` (~L628), `#_PROPAGATED_HEADERS` (~L350) |


## Filed as defect reports (2026-10-19)

The open rows above were re-verified against `1302e6d` and recorded as `docs/reports/` defects
(status sidecar `open`) for `/sdd-triage --from-report`. A row stays here until its report is resolved.

| Report | Title |
|---|---|
| [`2026-10-19-analysis-claude-md-drift-defect`](../../../docs/reports/2026-10-19-analysis-claude-md-drift-defect.md) | Analysis CLAUDE.md omits the attribution net contract and misstates _bars_fetch_sem scope |
| [`2026-10-19-analysis-fingerprint-ignores-formula-version-defect`](../../../docs/reports/2026-10-19-analysis-fingerprint-ignores-formula-version-defect.md) | Evidence fingerprint ignores referenced formula content |
| [`2026-10-19-analysis-fundsignal-neutral-score-fabricated-defect`](../../../docs/reports/2026-10-19-analysis-fundsignal-neutral-score-fabricated-defect.md) | Fundamentals producer emits fabricated 0.5 scores for symbols with no data |
| [`2026-10-19-analysis-live-gate-sql-duplicated-defect`](../../../docs/reports/2026-10-19-analysis-live-gate-sql-duplicated-defect.md) | Entry-backfill re-types the live-enabled gate SQL instead of importing it |
| [`2026-10-19-analysis-pnl-compose-system-owner-raises-defect`](../../../docs/reports/2026-10-19-analysis-pnl-compose-system-owner-raises-defect.md) | P&L snapshot compose can raise ValueError for a system-owned order event |
| [`2026-10-19-analysis-screener-no-per-symbol-isolation-defect`](../../../docs/reports/2026-10-19-analysis-screener-no-per-symbol-isolation-defect.md) | ScreenSymbols fails entirely when one symbol raises a non-RpcError |
| [`2026-10-19-orphaned-code-defect`](../../../docs/reports/2026-10-19-orphaned-code-defect.md) | Orphaned modules, scripts and dependencies across services |

---
_Surfaced by [context-forge](https://github.com/davcs86/agent-plugins). Defects to action, not rules. Re-run `/context-constitution` to refresh._
