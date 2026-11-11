# Recon: fix-analysis-per-symbol-isolation

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: main-dev@c4fd48b0a ≡ origin/main-dev (no `origin/feature/fix-analysis-per-symbol-isolation` yet). The discovery digests were UNSTAMPED; every `path:line` below was re-grepped at c4fd48b0a.
**Affected services**: xstockstrat-analysis

---

## Objective

Each per-symbol fan-out in xstockstrat-analysis has its only exception handler outside the per-symbol unit, or a handler that catches only `grpc.RpcError`. As a result, one failing symbol takes down the whole batch:
- the user's opportunities compute
- the `EvaluateReadiness` RPC
- the readiness kick batch
- the materializer owner pass
- the 300 s heal

The fix gives each of these sites the feature-245 per-symbol isolation, so a failing symbol degrades only its own row and the healthy siblings are still returned and persisted.

## Codebase Map

- **`xstockstrat-analysis`** (Python 3.13; all paths are under `services/xstockstrat-analysis/`)
  - Handler/servicer: `app/handlers/servicer.py`
  - Shared seam: `compute_readiness_row` at `app/services/readiness.py:38`.
    - The bars fetch is wrapped (`:66-71`, `except Exception` → `bars = []`, `fetch_ok = False` → `bar_epoch = -1`).
    - `evaluator.evaluate_conditions_traced(...)` at `:80` is **unwrapped**, so an `RpcError`, a `FormulaExecutionError` or any other exception escapes to all four callers.
  - **Opportunities compute** (`_compute_opportunities`):
    - `fetch_failed: set[str]` is declared at `servicer.py:5669`. It is a symbol-wide side set.
    - `_row_for` is at `:5743`. The comment at `:5741` reads "No return_exceptions".
    - The traced eval is at `:5815`. The only catch is `except grpc.RpcError` at `:5825`, which does `fetch_failed.add(sym)` / `readiness = _empty_readiness(sym)` at `:5834-5835`.
    - The comment at `:5829` says `FormulaExecutionError` is left to propagate. This is the feature-185 contract, also documented in `services/xstockstrat-analysis/CLAUDE.md` § Decide-surface RPCs: "a `FormulaExecutionError` still propagates".
    - `bars_failed=(sym in fetch_failed or not bars)` is at `:5807`.
    - The feature-215 skip-row guard comment is at `:5877`.
    - The gather, with no `return_exceptions`, is at `:5917`: `rows = [r for r in await asyncio.gather(*[_row_for(c) for c in selected]) if r is not None]`.
  - **`EvaluateReadiness`**:
    - `_readiness_for` at `:4031` is unguarded. The FAST cache-hit check is at `:4033`. The SLOW path calls `compute_readiness_row` at `:4059`.
    - The gather is at `:4103`: `results = await asyncio.gather(*[_readiness_for(s) for s in request.symbols])`.
    - `upsert_many(staged_rows)` at `:4110` runs only after the gather, as best-effort.
    - Degraded results must keep the `(proto, None, computed_at)` triple shape, because `staged_rows` filters on `r[1] is not None`.
  - **Readiness kick**:
    - `_kick_readiness_refresh` is at `:4261`. Its per-symbol loop `for sym in syms:` is at `:4312`, and it calls `compute_readiness_row` at `:4329`.
    - `upsert_many(staged_all)` at `:4354` runs after the loops.
    - The only catch is the outer `except Exception` at `:4356` ("readiness refresh kick failed"). The `finally` at `:4358` discards the `_readiness_kicking` keys.
  - **Opportunity heal**:
    - `_kick_opportunity_retry` is at `:4944` and its outer `except Exception` is at `:4962`.
    - `_retry_unavailable_symbols` is at `:4970`. Its docstring at `:4980` says "A `FormulaExecutionError` propagates".
    - The per-symbol traced eval is at `:5152`. The catch at `:5162-5164` is `grpc.RpcError` only ("transport outage only — FormulaExecutionError propagates").
    - The readiness-cache subset `compute_readiness_row` call is at `:5257`. It is entry × watchlist only, success-only, and wrapped best-effort at `:5313`.
  - **Readiness materializer**:
    - `_materialize_readiness_for_owner` is at `:6086`. Its `staged_rows.append(await compute_readiness_row(...))` is at `:6166-6167`.
    - The per-owner catch is at `:6228-6230` ("readiness materializer failed for owner").
  - Provenance markers: `_PROVENANCE_STRUCTURAL_MARKERS` is at `app/repositories/opportunities.py:28`. It holds `watchlist`, `position`, `denied`, `fundamentals_unavailable` and `formula_unreadable`. `"unavailable"` is not in it; it is floor-exempted separately in the read query, according to the service CLAUDE.md.
  - Last migration: `027_contract_owner_dimension.up.sql` (`services/xstockstrat-analysis/migrations/`). This fix is not expected to need one.
  - Tests: pytest (`uv run pytest`, `tests/conftest.py`, `real_pg` marker). Adjacent suites:
    - `tests/test_readiness.py`
    - `tests/test_readiness_materializer.py`
    - `tests/test_watchlist_readiness.py`
    - `tests/test_readiness_cache.py`
    - `tests/test_opportunity_compute_state.py`
    - `tests/test_opportunity_refresh.py`
    - `tests/test_opportunities_fundamentals_guard.py`
    - `tests/test_readiness_opportunities_source_symbol.py`
    - `tests/test_screener.py`: `test_cancelled_error_in_symbol_eval_propagates`, the precedent for a cancellation test.

## Patterns to REUSE

- **Per-symbol isolation wrapper**: reuse the feature-245 shape `ScreenerEngine._eval_symbol_isolated` at `app/services/screener.py:234`. It is called at `:117` and catches `except Exception` (not `BaseException`, see the comment at `:237-238`) at `:239`, returning `(row, exc_or_None)`. The insights entry (`docs/roadmap/ledger/insights.md:3909-3912`) names these two gathers as the intended reuse sites. Rule: a per-item failure flag lives on the item's own row, never in a side set keyed by an input that may repeat. This applies directly to `fetch_failed`.
- **Failure tally logging**: the screener tallies per-symbol failures (`screener.py:128-155`): ERROR when all symbols failed, otherwise WARNING naming the symbol and the exception type. Reuse it for the WARN lines at each site.
- **Degraded readiness row**:
  - Opportunities: reuse `_empty_readiness(sym)` (`servicer.py:5835`).
  - `EvaluateReadiness`: reuse the existing empty-proto path (`_readiness_to_proto` / `_symbol_readiness_from_json`, `servicer.py:4040,4079`).
  - Cache sentinel: reuse the existing `bar_epoch = -1` sentinel that `compute_readiness_row` already produces when `fetch_ok=False` (`readiness.py:66-71`). It decorates the row UNKNOWN, with a 300 s cooldown (feature 181 @AC-2), rather than leaving it in perpetual PENDING.
- **Shared seam**: isolating once inside `compute_readiness_row` (`readiness.py:80`) would cover all four callers (`servicer.py:4059`, `:4329`, `:5257`, `:6167`). Decide in design whether to do that or to wrap at each caller. A seam catch must still produce a row that is not cached as a success (see Business Rules).
- **Existing best-effort precedents in the same code**: `readiness.py:68` (bars fetch) and `servicer.py:4099` (`GetDataCoverage`). These show that `except Exception` with a `# noqa: BLE001` comment is the house style; see also `:5082` and `:6191`.
- **Opportunity outage sentinel**: reuse the `"unavailable"` provenance token for a genuine `RpcError` outage. That is existing behaviour; do not change it.
- **Distinct fault marker (if Open Question 2 chooses one)**: follow the `formula_unreadable` precedent from feature 289:
  - add an entry to `_PROVENANCE_STRUCTURAL_MARKERS` (`app/repositories/opportunities.py:28`)
  - add an `OR provenance ? '<token>'` clause to the read-query floor exemption
  - derive the flag at read time

## Existing Business Rules (preserve / extend)

- **CHANGE** `@AC-10 @FR-5 @characterization @feature-289` "A formula execution timeout still fails the opportunities recompute" (`services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature`). This scenario pins that a success=false "Formula execution timed out" result aborts the recompute and keeps the stored rows. Spec @AC-1 would degrade that candidate instead. This requires user sign-off recorded in `context.md`; a silent change is a C-16 regression. The alternative is a timeout carve-out, in which case spec @AC-1/@AC-2 must be reworded.
- **CHANGE** `@AC-13 @FR-5 @characterization @feature-289` "A formula execution timeout still aborts EvaluateReadiness" (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`). This scenario pins an RPC failure plus an ERROR log "Unexpected [FormulaExecutionError]". Spec @AC-2 would instead return OK with an empty unavailable `SymbolReadiness`. This requires user sign-off recorded in `context.md`.
- **PRESERVE** `@AC-4 @FR-4 @characterization @feature-289` "A genuine indicators outage still yields a data-unavailable row" (`.../opportunity-compute-robustness.feature`). An `UNAVAILABLE` still gives `data_unavailable true` with no unreadable marker.
- **PRESERVE** `@AC-1 @FR-1 @feature-185` "A data-unavailable symbol is marked unavailable, not evaluated-0/0" (`.../opportunity-compute-robustness.feature`).
- **PRESERVE** `@AC-2 @FR-1 @feature-185` "An evaluated-but-not-passing symbol is NOT marked unavailable" (`.../opportunity-compute-robustness.feature`). A fault marker must never appear on a healthy row.
- **PRESERVE** `@AC-5 @FR-1 @feature-185` "The sentinel survives the materialization round-trip" (`.../opportunity-compute-robustness.feature`). Any new fault marker must persist as a provenance token.
- **PRESERVE** `@AC-7 @FR-4 @feature-185` "A persistently-failing cold compute renders a terminal error, not an infinite spinner" (`.../opportunity-compute-robustness.feature`). `compute_failed` must remain for compute-wide failures.
- **PRESERVE** `@AC-8 @FR-5 @feature-185` "A data-unavailable row self-heals via a surgical read-time recompute" (`.../opportunity-compute-robustness.feature`). The heal path must be isolated per symbol and keep the `computed_at` re-stamp.
- **PRESERVE** `@AC-9 @FR-5 @feature-185` "A recovered watchlist-entry symbol also refreshes the readiness cache" (`.../opportunity-compute-robustness.feature`). The cache write is success-only, so a degraded pair is never cached as a success.
- **PRESERVE** `@AC-4 @FR-3 @feature-185` "A background recompute does not starve an interactive read" (`.../opportunity-compute-robustness.feature`). The interactive and background work keep separate semaphores (`_bars_fetch_sem` vs `_readiness_materializer_bars_sem`).
- **PRESERVE** `@AC-1 @FR-1 @FR-2 @regression @feature-289` "An unreadable component formula is flagged on the opportunity row, not reported as a data outage" (`.../opportunity-compute-robustness.feature`). A distinct fault marker must not collide with `formula_unreadable`.
- **PRESERVE** `@AC-15 @FR-1 @FR-6 @regression @feature-289` "A NOT_FOUND refusal of a referenced formula also yields the marker" (`.../opportunity-compute-robustness.feature`).
- **PRESERVE** `@AC-16 @FR-6 @characterization @feature-289` "An unreferenced refused component is skipped as before" (`.../opportunity-compute-robustness.feature`).
- **PRESERVE** `@AC-9 @FR-3 @regression @feature-289` "The 300-second heal does not re-stamp an unreadable row as unavailable or retry it endlessly" (`.../opportunity-compute-robustness.feature`). This is the heal path this feature modifies.
- **PRESERVE** `@AC-21 @FR-1 @FR-2 @regression @feature-289` "The marker round-trips storage and a sibling's outage does not flip the row" (`.../opportunity-compute-robustness.feature`). This constrains any `fetch_failed` race fix: a marker row is never flipped by completion order.
- **PRESERVE** `@AC-24 @FR-1 @FR-7 @regression @feature-289` "With the fundamentals gate on, the opportunity compute and the heal yield the marker, not data-unavailable", and `@AC-25 @FR-4 @FR-7 @characterization @feature-289` "With the fundamentals gate on, a GetFormula outage is still data-unavailable" (`.../opportunity-compute-robustness.feature`).
- **PRESERVE** `@AC-18 @FR-2 @FR-6 @regression @feature-289` "A held row keeps its signal action; an exit rule that references the refused formula never fabricates a REDUCE" (`.../opportunity-compute-robustness.feature`).
- **PRESERVE** `@AC-26 @FR-3 @characterization @feature-289` "Once the formula becomes readable the next recompute evaluates the row normally" (`.../opportunity-compute-robustness.feature`). A fault marker must clear on the next recompute.
- **PRESERVE / EXTEND** `@AC-2 @FR-3 @regression @feature-289` "EvaluateReadiness degrades per symbol instead of aborting" (`services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature`). The refusal path stays 0/0 with the marker. Spec @AC-2 extends per-symbol degradation to arbitrary exceptions.
- **PRESERVE / EXTEND** `@AC-3 @FR-3 @regression @feature-289` "The cache-only watchlist readiness read serves a resolved unreadable entry" (`.../readiness-caching-poll-discipline.feature`). A refusal must not discard the batch and must not log a "readiness refresh kick failed" warning. Spec @AC-3 extends the same guarantee to an indicators outage.
- **PRESERVE / EXTEND** `@AC-8 @FR-3 @regression @feature-289` "The readiness materializer persists the unreadable verdict and continues (defense in depth)" (`.../readiness-caching-poll-discipline.feature`). Spec @AC-3 extends "the pass continues" to outages.
- **PRESERVE** `@AC-19 @FR-1 @FR-3 @regression @feature-289` "The daily refresh and the readiness materializer (owner-only metadata) persist the marker" (`.../readiness-caching-poll-discipline.feature`).
- **PRESERVE** `@AC-20 @FR-3 @regression @feature-289` "A repeated EvaluateReadiness within the stale window still carries the marker" (`.../readiness-caching-poll-discipline.feature`). A degraded symbol must not be cached as a fresh success.
- **PRESERVE** `@AC-2 @feature-181` "A data-unavailable readiness row is decorated UNKNOWN, not perpetual PENDING" (`.../readiness-caching-poll-discipline.feature`). This is the target semantics for a degraded pair: `bar_epoch -1` with a 300 s cooldown.
- **PRESERVE** `@AC-3 @feature-181 @feature-180` "A bar-busted watchlist-readiness row is decorated PENDING, never a stale RESOLVED" (`.../readiness-caching-poll-discipline.feature`).
- **PRESERVE** `@AC-1 @FR-1 @FR-5 @feature-177` "A repeat readiness call within the freshness window skips the fan-out", and `@AC-2 @FR-1 @FR-5 @feature-177` "A new bar busts the readiness cache" (`.../readiness-caching-poll-discipline.feature`). Healthy siblings are still cached.
- **PRESERVE** `@AC-5 @FR-5 @feature-180` "An uncovered pair still computes on demand (never a blank overlay)" (`services/xstockstrat-analysis/acceptance/watchlist-readiness-precompute.feature`).
- **PRESERVE** `@AC-2 @FR-2 @feature-180` "The materialized universe is derived from actual watchlist bindings, owner-scoped" (`.../watchlist-readiness-precompute.feature`).
- **PRESERVE** `@AC-6 @FR-6 @feature-180` "A watchlist binding to a non-live strategy is not materialized" (`.../watchlist-readiness-precompute.feature`). The materializer neither raises nor halts the cycle.
- **PRESERVE** `@AC-1 @FR-1 @feature-176` "Opportunity compute fans out concurrently but yields the identical set" (`services/xstockstrat-analysis/acceptance/analysis-concurrency-offload.feature`). Membership and rank order stay the same, and the concurrency bound still applies.
- **PRESERVE** `@AC-2 @FR-2 @feature-176` "EvaluateReadiness parallelizes per-symbol work under the shared bound" (`.../analysis-concurrency-offload.feature`).
- **PRESERVE** `@AC-6 @FR-6 @feature-176` "Parallelized fan-out preserves per-user owner scoping" (`.../analysis-concurrency-offload.feature`).
- **PRESERVE** `@AC-1 @FR-1 @regression @feature-245` "One symbol's non-RPC failure degrades only that symbol's row" (`services/xstockstrat-analysis/acceptance/fix-screener-symbol-isolation.feature`). This is the precedent shape.
- **PRESERVE** `@AC-2 @FR-2 @regression @feature-245` "The scan deadline still cancels the whole scan", and `@AC-3 @FR-3 @regression @feature-245` "An unknown fundamental metric is still rejected for the whole request" (`.../fix-screener-symbol-isolation.feature`). Isolation must not swallow `CancelledError`, deadlines or request-level errors.
- **PRESERVE** `@AC-3 @FR-3 @regression @feature-262` "One owner whose drains fail does not stop the backfill for other owners", and `@AC-8 @FR-3 @regression @feature-262` "A non-ValueError drain failure for one owner does not stop the backfill for other owners" (`.../fix-analysis-owner-scope.feature`). These are the per-owner isolation precedent.
- **PRESERVE** `@AC-1 @regression @feature-227` "A stalled price enrichment returns the stored rows unenriched within the deadline", and `@AC-4 @regression @feature-227` "An exhausted analysis DB pool fails the read fast" (`.../fix-opportunities-read-hangs.feature`). This feature does not alter the read path.
- **EXTEND** (no existing `@AC`):
  - Spec @AC-1 and @AC-2 add per-symbol isolation of arbitrary exceptions and of a `FormulaExecutionError` from a formula bug, alongside the feature-289 refusal-marker rules.
  - Spec @AC-3 adds outage isolation to the kick, the materializer and the heal, alongside the existing refusal isolation.
- `docs/sdd/business-rules/platform.feature` has no cross-service guarantee on this subject.

## Dependencies

- Proto/RPC: none if Open Question 2 reuses `"unavailable"`. A distinct formula-fault marker needs only a provenance token plus a read-side flag to stay internal. Exposing it to clients would need a new `Opportunity` proto field, so the design must decide that explicitly.
- Migration: none expected. The next free analysis number would be `028`. A new marker is a JSONB provenance token plus a read-query clause, not a schema change.
- Config keys: none. The existing `analysis.opportunity.max_concurrent_candidates` already bounds the `_row_for` fan-out.
- Inter-service edges: none new. The existing analysis → indicators `ExecuteFormula` and analysis → marketdata bars edges are unchanged.
- New env vars / ports: none.

## Risks / Not-found

- **Contract reversal (Open Question 1, C-16).** The feature-185 "`FormulaExecutionError` propagates" contract is pinned in three places:
  - code comments at `servicer.py:5829`, `:4980` and `:5164`
  - `services/xstockstrat-analysis/CLAUDE.md`
  - two feature-289 characterization scenarios (`@AC-10` and `@AC-13` above)

  Isolating `Exception` per symbol is a CHANGE that needs operator sign-off in `context.md`. No operator decision is recorded yet. The timeout case may need its own carve-out, because a timeout can be load-driven rather than a deterministic formula bug.
- **Marker choice (Open Question 2).** Reusing `"unavailable"` puts a deterministic formula bug into the 300 s heal selector, which is keyed on `"unavailable"` (feature 185 @AC-8, feature 289 @AC-9). The heal would then re-evaluate it every 300 s indefinitely. A distinct marker must:
  - be structural
  - be exempt from the conviction floor
  - clear on recompute (feature 289 @AC-26)
  - not be flipped by a sibling's `fetch_failed` (feature 289 @AC-21)
- **`fetch_failed` race (Open Question 3).** The symbol-wide side set (`servicer.py:5669,5807,5834`) is exactly what the insights rule at `insights.md:3909-3912` warns against. Fixing the race means moving the flag onto the row. Splitting it out leaves the race and should be filed as a follow-up (C-14).
- **Lost alert signal.** Ledger trap `fails.md:3229-3232` (feature 245) applies: turning a hard failure into a degraded success removes the failure signal (`EvaluateReadiness` UNKNOWN, `compute_failed`, the kick/materializer WARN). The design must name the alert or series that caught it before and read the rule (`packages/otel/alerts/alert-rules.yaml`). It must not claim that a log line covers it.
- **Cancellation passthrough.** A catch-all around concurrent work needs its own engine-level `CancelledError` test, credited only after a mutation run (`insights.md:3914-3917`). The outer-deadline test does not catch an `except BaseException` mutation.
- **Readiness cache poisoning.** A degraded pair may be cached only as the `bar_epoch = -1` sentinel (UNKNOWN, 300 s cooldown), or not at all. It must never be cached as RESOLVED or fresh (feature 177 @AC-1, feature 289 @AC-20, feature 185 @AC-9).
- **Peer overlap.** The `services/xstockstrat-analysis/` servicer is shared with in-flight peers 309, 313, 323, 327 and 329 (from sdd-review). Line anchors will drift; expect rebase conflicts in `servicer.py`.
- **Not found / not read**:
  - No existing test pins the `FormulaExecutionError`-propagates contract or any compute/readiness isolation. A grep of `test_opportunity_compute_state.py` for `isolat|raises|FormulaExecutionError` returned nothing. The other test files were not grepped.
  - The `_materialize_readiness_for_owner` body (`:6086-6230`) and the `_retry_unavailable_symbols` body (`:4970-5313`) were only partly read: the call sites and catch lines were confirmed.
  - The source defect reports were not reopened in recon.

## Recommended Scope

Advisory; these are input to the grilling and to `/sdd-spec`.

1. **Decide the contract first.** Settle Open Questions 1, 2 and 3 with operator sign-off for the two CHANGE scenarios, or narrow the scope with a timeout carve-out. Record the decision in `context.md`.
2. **Readiness seam isolation.** Isolate the per-symbol evaluation either in `compute_readiness_row` (`readiness.py:80`) or at each caller, producing a non-cacheable or `bar_epoch -1` row. This covers `EvaluateReadiness` (`:4103`), the kick (`:4312`), the materializer (`:6167`) and the heal cache subset (`:5257`). Healthy siblings are still upserted.
3. **Opportunities compute isolation.** Wrap `_row_for` (`:5743`) and the gather (`:5917`) using the `_eval_symbol_isolated` shape, giving the degraded row with the chosen marker. If Open Question 3 is in scope, move `fetch_failed` onto the row.
4. **Heal isolation.** Make the per-symbol evaluation in `_retry_unavailable_symbols` (`:5152-5164`) isolate beyond `RpcError`, without re-stamping marker rows or retrying a deterministic fault indefinitely.
5. **Tests.** Write a RED regression per spec scenario. Add engine-level `CancelledError` passthrough tests with a mutation run. Update the feature-289 `@AC-10`/`@AC-13` characterization tests and suites if the CHANGE is signed off, and update the service CLAUDE.md "`FormulaExecutionError` still propagates" sentence in the same PR.
