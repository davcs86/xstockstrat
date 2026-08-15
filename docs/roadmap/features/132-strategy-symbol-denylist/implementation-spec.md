# Implementation Spec: strategy-symbol-denylist

**Status**: `pending`
**Created**: 2026-08-14
**Feature**: `docs/roadmap/features/132-strategy-symbol-denylist/feature.md`
**Total Steps**: 17
**Feature Branch**: `feature/strategy-symbol-denylist`

---

## Execution Summary

This feature layers a per-strategy **deny list** on top of feature 131's live-attribution machinery,
owner-scoped by feature 133. It executes/merges **last** in the cohort — build order is
`133 → 134 → 131 → 132` (`docs/roadmap/features/merge-order.md`). The order is: (1) proto adds three
additive fields + codegen; (2) analysis write-path introduces the shared `resolve_universe()` helper,
makes the two new fields maskable, and rejects the allowlist×`signal_eligible` conflict; (3) the live
loop gains entry-only deny, fair-share scheduling, and owner-scoped universe resolution; (4)
`_compute_opportunities` emits muted rows and the read query exempts them from the conviction floor;
(5) the SetStrategyLive precondition and `entry_backfill` migrate off the deleted `strategy_symbols`;
(6) the agent `manage_strategy` tool + `strat-lab` skill expose the fields; (7) the UI wizard, Symbol
page, and Opportunities page reach the consumer surface (C-14). No migration — all three fields ride
existing JSONB columns.

**Consumer surfaces (C-14), both named in the product spec, both covered here:** the `/insights` UI
segment (Steps 13–16: StrategyWizard deny-list editor + `signal_eligible` toggle, Symbol-page
mute-for-strategy control, Opportunities muted-row treatment) and the `xstockstrat-agent`
`manage_strategy` MCP tool (Steps 11–12, with the same-PR `strat-lab` skill update). No surface is
deferred.

> **CRITICAL — dependency-landing precondition (re-spec gate).** Features **131** and **133** are
> `design-approved` but **NOT on `main-dev`** as of spec time. This spec grounds every step in the
> **current trunk** `path:line`, and flags — per step — each anchor that only takes its final shape
> after 131/133 land (`resolve_universe`/`live_by_symbol` in `_compute_opportunities`,
> `StrategyDefinition.user_id`, the rewritten `get_by_owner_and_id`, `_MASKABLE_PATHS` membership).
> Because 132 executes *after* both merge, run a **conditional re-spec pass** (`/sdd-spec
> strategy-symbol-denylist`, evidence-only) immediately before `/sdd-execute` to refresh the shifted
> line numbers against 131's and 133's landed `servicer.py`/`analysis.proto`/`live_loop.py`. This
> mirrors the fails.md lessons for specs written against not-yet-landed dependencies (019, 041) and
> the design's own Open Risk "Field-number re-verification at `/sdd-spec`". The field-number
> assignments below (`denied_symbols=12`, `signal_eligible=14`, `Opportunity.muted=12`) were
> re-verified **free on trunk today** (StrategyDefinition highest = `exit_cooldown_days = 11`;
> Opportunity highest = `provenance = 11`) — 133 claims `13` for `user_id`, 131 adds no `Opportunity`
> field.

## Step Dependencies

- Step 2 (`proto-gen`) requires Step 1 (`proto`): stubs regenerate from the edited `.proto`.
- Steps 3–16 require Step 2: all consume the regenerated `denied_symbols`/`signal_eligible`/`muted`
  fields.
- Step 3 (`resolve_universe` helper) is the seam every later analysis step reads: Steps 5, 7, and 9
  all import/consume `resolve_universe`. Step 3 lands first among analysis steps.
- Step 4 covers Step 3 (test); Step 6 covers Step 5; Step 8 covers Step 7; Step 10 covers Step 9;
  Step 12 covers Step 11. Each `test` step is red-before-green (P-06).
- Step 5 depends on **feature 133** landed: it reads `definition.user_id` and calls owner-scoped
  `ListPositions(user_id=owner)` + synthetic-header `ListWatchlists` (133 design decision 6).
- Step 7 depends on **feature 131** landed: it inserts muted-row logic into 131's restructured
  `_compute_opportunities` candidate/cut block and consumes `resolve_universe(...).union/.denied`
  alongside 131's `live_by_symbol`.
- Step 9 depends on **feature 133** landed: the SetStrategyLive precondition edit targets 133's
  rewritten `get_by_owner_and_id` block.
- Steps 13–15 (UI, Next.js) have no coverage threshold; Step 16 carries their e2e + fixtures.
- Step 17 (`docs`) requires Steps 3–12 (documents the landed analysis + agent behavior).

---

### Step 1 — proto: add `denied_symbols`, `signal_eligible`, and `Opportunity.muted`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness, no breaking change without deprecation, `buf lint`/`buf breaking`; `xstockstrat-analysis` owner — strategy definition/opportunity contract; `xstockstrat-ui` owner — camelCase field surfacing; `xstockstrat-agent` owner — MCP tool field mapping.

**Codebase Evidence**:
- `message StrategyDefinition` at `analysis.proto:249-274`; highest field today is `optional int32 exit_cooldown_days = 11;` (`:273`) → **field 12 free**. `warnings = 10` (`:266`), `cooldown_days = 9` (`:261`).
- `message Opportunity` at `analysis.proto:447-459`; highest field today is `repeated string provenance = 11;` (`:458`) → **field 12 free**.
- `ManageStrategyRequest.update_mask` allowed-paths comment at `analysis.proto:298-299`: "Allowed paths: display_name, components, entry_rule, exit_rule, signal_params, cooldown_days, exit_cooldown_days."
- Confirmed via `grep -n` on `analysis.proto`: no `denied_symbols`/`signal_eligible`/`muted`/`user_id` on `StrategyDefinition` today; feature 133 will add `user_id = 13`.

**TDD**: `N/A (proto)` — verified by `buf` + the codegen freshness check, not a red-green unit test.

**Instructions**:
1. In `StrategyDefinition` (after `exit_cooldown_days = 11`, `:273`) add, with a doc comment:
   `repeated string denied_symbols = 12;` — normalized-uppercase symbols this strategy must never
   evaluate **for entry** (entry-only deny; a held position keeps exit tracing). Note in the comment
   that field 13 is reserved for feature 133's `user_id`.
2. In the same message add `bool signal_eligible = 14;` (default false) — gates whether the
   platform-wide active-signal term joins this strategy's universe; a strategy that sets both a
   non-empty `signal_params.symbols` allowlist and `signal_eligible=true` is rejected `INVALID_ARGUMENT`
   at write time (enforced in Step 3). Plain `bool` (no `optional`) is intentional — absent ≡ false ≡
   explicit-false resolve identically (design decision 4; avoids the fails.md-067 enum→TS break).
3. In `Opportunity` (after `provenance = 11`, `:458`) add `bool muted = 12;` — the pair is on its
   strategy's deny list; surfaced as an explicit skipped/muted row, never `conviction=0` (fails.md 023).
4. Extend the `ManageStrategyRequest.update_mask` allowed-paths comment (`:298-299`) to list
   `denied_symbols` and `signal_eligible` as maskable paths.

**Verification**:
```
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/strategy-symbol-denylist"
```
Both pass (additive fields → no breaking change). Confirm the three new field numbers do not collide:
`grep -n "= 12;\|= 13;\|= 14;" packages/proto/analysis/v1/analysis.proto` within each message block.

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/**` — modify (generated; do not hand-edit)
- `packages/proto/gen/ts/dist/**` — modify (compiled TS)

**Reviewers**: inherited from Step 1 (Proto Reviewer + analysis/ui/agent owners).

**Codebase Evidence**:
- Generation entrypoint `./scripts/buf-gen.sh` (root `CLAUDE.md` § Generating Proto Stubs — "generates TypeScript, Python, and Go stubs and compiles the TS package").
- Generated stubs are checked in under `packages/proto/gen/{go,python,ts}` (root `CLAUDE.md` § Key File Paths).

**TDD**: `N/A (proto-gen)`.

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root.
2. Stage the regenerated Python (`gen/python/`), TS (`gen/ts/` + compiled `gen/ts/dist/`), and Go
   (`gen/go/`) stubs. Do not hand-edit any generated file.

**Verification**:
```
./scripts/buf-gen.sh && git status --porcelain packages/proto/gen | head
```
The only diff under `packages/proto/gen/` is the three added fields' accessors (`deniedSymbols`,
`signalEligible`, `muted` in TS; `denied_symbols`, `signal_eligible`, `muted` in Python/Go). A second
run leaves an empty `git diff packages/proto/gen/` (freshness — the CI `proto-freshness` gate).

---

### Step 3 — service: shared `resolve_universe()` helper, maskable paths, allowlist×signal_eligible reject

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias; live-loop evaluation-universe correctness.

**Codebase Evidence**:
- `strategy_symbols(definition)` today at `live_loop.py:37-47` (allowlist from `signal_params.symbols`;
  empty-list short-circuit at `:44-45`). Callers on trunk: `live_loop.py:210` (`_symbols_for` →
  `_run_cycle`), `entry_backfill.py:83` (import `:18`), `servicer.py:1838` (SetStrategyLive
  precondition; local import `:1824`).
- `_normalize_symbol(symbol)` at `servicer.py:2542` (imported cross-module by `live_loop.py:29`'s
  existing `from app.handlers.servicer import _row_to_strategy_definition` seam).
- `_MASKABLE_PATHS` frozenset at `servicer.py:2873-2883` (today: display_name, components, entry_rule,
  exit_rule, signal_params, cooldown_days, exit_cooldown_days).
- `_validate_definition(...)` invoked on the **merged** definition at `servicer.py:1705`
  (`_validate_definition(to_write, formula_outputs)`) and via `_validate_definition_proto` at `:268-280`.
- `_row_to_strategy_definition` at `servicer.py:2990` — design decision 13: `denied_symbols`/
  `signal_eligible` need **no** mapper line (they ride `definition_json` via `ParseDict`; the
  fails.md-048 lockstep applies only to column-backed fields like 133's `user_id`).

**TDD**: `red-green required`.

**Instructions**:
1. In `live_loop.py`, replace `strategy_symbols(definition)` (`:37-47`) with a pure module-level
   `resolve_universe(definition, watchlist, held, signals)` returning a
   `NamedTuple(universe, deny_entry, union, denied)` (design decision 2):
   - `denied = {_normalize_symbol(s) for s in definition.denied_symbols}` (import `_normalize_symbol`
     from `servicer.py` via the existing `live_loop.py:29` seam).
   - `union = norm(allowlist) if signal_params.symbols else (watchlist ∪ held ∪ (signals iff
     definition.signal_eligible))` — the pre-deny coverage set. **AC-5**: a non-empty
     `signal_params.symbols` is treated *as* the universe (explicit override), applied verbatim, still
     minus `denied`.
   - `universe = (union − denied) ∪ (held ∩ denied)` — entry universe with held-denied retained for exit.
   - `deny_entry = held ∩ denied` — held-denied members whose entry edge is suppressed, exit stays live.
   Keep `signal_params.symbols` extraction identical to the current `strategy_symbols` body
   (`json_format.MessageToDict(definition.signal_params)` guarded by `HasField("signal_params")`).
2. Add `denied_symbols` and `signal_eligible` to `_MASKABLE_PATHS` (`servicer.py:2873-2883`), mirroring
   the `cooldown_days`/`exit_cooldown_days` precedent (FR-2; ledger insight 2026-07-26 / 070).
3. In `_validate_definition` (the merged-definition validator reached at `servicer.py:1705` — verify it
   runs on the merged `to_write`, so a two-step masked update cannot bypass it), reject with
   `INVALID_ARGUMENT` when the merged definition has **both** a non-empty `signal_params.symbols`
   allowlist **and** `signal_eligible=true` (design decision 4). Do **not** add a `_row_to_strategy_definition`
   line for the two new fields (decision 13 — JSONB-ridden).

**Verification**: covered by Step 4 (unit tests + lint). Behavioral spot-check:
`grep -n "def resolve_universe\|denied_symbols\|signal_eligible" services/xstockstrat-analysis/app/engine/live_loop.py services/xstockstrat-analysis/app/handlers/servicer.py`.

---

### Step 4 — test: `resolve_universe` branches, maskability round-trip, allowlist×signal_eligible reject

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify
- `services/xstockstrat-analysis/tests/conftest.py` — modify (only if a new shared `StrategyDefinition`
  fixture gains a second consumer; otherwise inline per C-13)

**Reviewers**: `xstockstrat-analysis` owner — determinism, universe correctness.

**Codebase Evidence**:
- Masked-update test home `TestPartialStrategyUpdate` at `test_analysis_servicer.py:2656` (masked-clear
  `:2691`, full-replace `:2745`, erasure-guard `:2765-2817`; `_update_req` helper `:2649`).
- Cooldown mask register-reject precedent `TestBacktestCooldown` `:2444`; exit-cooldown negative-reject
  `:2584`.
- Fixture home `tests/conftest.py` (C-13 Python canonical home).

**TDD**: `red-green required` — assertions target Step 3's new behavior, so they **fail** on the
pre-Step-3 tree.

**Instructions**:
1. `resolve_universe` 4-branch unit test (design decision 2): (a) allowlist present → universe =
   allowlist − denied; (b) no allowlist, `signal_eligible=false` → universe = watchlist ∪ held − denied
   (signals excluded); (c) no allowlist, `signal_eligible=true` → watchlist ∪ held ∪ signals − denied;
   (d) held ∩ denied → `deny_entry` non-empty, held-denied symbol retained in `universe` for exit.
2. Maskability round-trip: extend `TestPartialStrategyUpdate` to mask-update `denied_symbols` and
   `signal_eligible` independently (plain set, masked-clear back to empty/false), asserting other
   definition fields are preserved.
3. Reject test: a `ManageStrategy` update whose merged definition has a non-empty `signal_params.symbols`
   **and** `signal_eligible=true` raises `INVALID_ARGUMENT` (mirror `TestBacktestCooldown`'s
   register-reject shape). Include the two-step-masked-update path (set allowlist in call 1, flip flag in
   call 2) to prove the merged-definition validator catches it.
4. `StrategyDefinition` round-trip test (plain + masked + masked-clear) proving `denied_symbols`/
   `signal_eligible` persist through `definition_json` with no `_row_to_strategy_definition` change
   (decision 13). State whether any domain literal gains a **second** consumer; if so move it to
   `conftest.py` (C-13), else keep inline and say so.

**Verification**:
```
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
Coverage ≥ 40%; the four assertions above fail on the pre-Step-3 tree (red) and pass after (green).

---

### Step 5 — service: entry-only deny + fair-share scheduler + owner-scoped universe in the live loop

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/engine/live_loop.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — live-loop evaluation-universe correctness, no look-ahead bias, per-cycle fairness.

**Codebase Evidence**:
- `_apply_transition(...)` at `live_loop.py:50-75`; entry branch `:67-70`, exit branch `:71-74` (reads
  only `in_position`/`entry_time`/`last_exit_at`/`decision.exit`). `_replay_state` fold at `:100-112`
  (calls `_apply_transition` at `:103`). `_eval_pair`'s live `_apply_transition` at `:273-281`;
  unresolved-entry-time skip at `:295-308`.
- `_run_cycle` at `live_loop.py:185-206`: `max_pairs = self._cfg.get_int("analysis.engine.max_strategies_per_cycle", default=50)` (`:186`); unordered `SELECT * FROM analysis.strategies WHERE live_enabled = TRUE AND active = TRUE` (`:188-190`); truncate-at-cap early return (`:195-196`). `_symbols_for` at `:208-210` (calls `strategy_symbols`).
- `_lock` cycle-skip at `live_loop.py:176-178` (an overrunning cycle is skipped, not stacked).
- Owner-scoping precedent to reuse: feature 133's `ListPositions(user_id=owner)` + synthetic outbound
  `x-user-id` metadata on `ListWatchlists` (133 design decision 6; `fundsignal_loop.py:338-346`).
  `PORTFOLIO_ENDPOINT` stub already wired (analysis `CLAUDE.md` § Dependencies).
- **131/133 dependency**: `_symbols_for`/`_run_cycle` read `definition.user_id` (133 field 13) and the
  131 `LIVE_ENABLED_PREDICATE_SQL` constant — re-verify their landed names/lines at execute time.

**TDD**: `red-green required`.

**Instructions**:
1. **Entry-only deny (decision 3).** Add `deny_entry: bool = False` to `_apply_transition` (`:50-58`);
   when `True`, short-circuit **only** the entry branch (`:67-70` → return no-transition) and leave the
   exit branch (`:71-74`) byte-for-byte untouched. `_eval_pair`'s live call (`:273`) passes the per-pair
   `deny_entry`; `_replay_state`'s historical fold (`:103`) passes nothing (default `False`) so a
   held-denied symbol reconstructs a truthful `entry_time` on restart and its exit still fires.
2. **Owner-scoped universe (decisions 5,6).** In `_run_cycle`, read `owner = definition.user_id` (133
   field 13) per row; fetch owner-scoped sets **memoized per owner within the cycle**:
   `ListPositions(user_id=owner)` + synthetic-`x-user-id` `ListWatchlists` (reuse `fundsignal_loop.py:338-346`);
   fetch platform-wide `QuerySignals` **once per cycle**, joined per-strategy only when `signal_eligible`.
   Resolve each strategy's universe via `resolve_universe(...)` (Step 3). Replace `_symbols_for`'s
   `strategy_symbols` call accordingly.
3. **Fair-share scheduler (decision 5).** Replace the truncate-at-cap `_run_cycle` body: select live rows
   `ORDER BY created_at, strategy_id`; flatten to
   `pairs = [(created_at, strategy_id, symbol) for row in rows for symbol in sorted(universe(row))]`,
   `pairs.sort()`; `n = min(max_pairs, len(pairs))`; **if `len(pairs)==0`/`n==0` return early without
   touching the cursor**; evaluate the `n` indices `(start + i) % len(pairs)` where
   `start = bisect_right(pairs, self._cursor_key)` (in-memory tuple `_cursor_key`, `None` initially),
   resetting `start=0` on wrap; advance `self._cursor_key` to the last-processed tuple **only when `n>0`**.
   Budget stays `analysis.engine.max_strategies_per_cycle` (no new config key — F-07 honored).
4. **Observability.** When `len(pairs) > max_pairs`, emit one bounded `log.warning` (once per
   `eval_interval_seconds`) + an OTel truncation counter.

**Codebase Evidence — header propagation (C-03)**: the new `ListPositions`/`ListWatchlists` outbound
calls must carry `x-user-id`/`x-access-scope`/`x-trace-id`. Reuse the Python per-method `metadata`
synthetic-header mechanism already used by `fundsignal_loop.py:338-346` (133 decision 6); the live loop
synthesizes `x-user-id = owner` per strategy owner.

**Verification**: covered by Step 6.

---

### Step 6 — test: entry-only deny, fair-share rotation, owner-scoped universe

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_live_loop.py` — modify
- `services/xstockstrat-analysis/tests/conftest.py` — modify (only on a second fixture consumer, C-13)

**Reviewers**: `xstockstrat-analysis` owner — live-loop fairness + parity.

**Codebase Evidence**:
- Existing live-loop test home `tests/test_live_loop.py` (`TestLiveEvaluationLoopExitCooldown` — the
  three required exit-cooldown guards named at `live_loop.py:290-294`:
  `test_exit_suppressed_when_entry_time_unresolved`, `test_exit_fires_once_entry_time_resolves`,
  `test_unresolved_entry_time_does_not_suppress_reentry_gate`).
- `_replay_state`/`_apply_transition` parity contract at `live_loop.py:59-75`.

**TDD**: `red-green required`.

**Instructions**:
1. **Entry-only deny**: a held-denied `(strategy, symbol)` — assert its **entry** is suppressed
   (`deny_entry=True` short-circuits `:67-70`) while its **exit** still fires (exit branch untouched);
   and that `_replay_state` (default `deny_entry=False`) reconstructs a truthful `entry_time` so the
   live exit is not tripped by the unresolved-entry-time skip (`:295-308`).
2. **Fair-share rotation**: with `len(pairs) > max_pairs`, assert every pair is reached within
   `⌈len(pairs)/max_pairs⌉` cycles across universe churn (rebuild the pair list between cycles) and a
   simulated restart (`_cursor_key` reset to `None` → resumes at the oldest). Assert the zero-guard
   (`len(pairs)==0` leaves `_cursor_key` untouched) and that the truncation `log.warning`/counter fire
   only when `len(pairs) > max_pairs`.
3. **Owner-scoping**: two owners' strategies in one cycle → `ListPositions`/`ListWatchlists` fetched
   **once per owner** (memoized), `QuerySignals` once per cycle; a `signal_eligible=false` strategy's
   universe excludes the platform-wide signal symbols; the outbound `x-user-id` metadata equals the
   strategy owner (C-03).

**Verification**:
```
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
Coverage ≥ 40%; assertions fail on the pre-Step-5 tree, pass after.

---

### Step 7 — service: muted rows in `_compute_opportunities` + read-query conviction-floor exemption

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/repositories/opportunities.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — opportunity queue correctness, ordinal/cardinal discipline (fails.md 023).

**Codebase Evidence**:
- `_compute_opportunities` at `servicer.py:2083`; `_candidate()` template `:2113-2127` (fields
  `is_watchlist`/`is_held`/`provenance`/`signal_axis`); `_add_provenance` `:2131-2133`; held loop
  `:2144-2150`; signals-merge `:2154-2168`; `max_universe` cut `:2170-2177`
  (`curated`/`speculative`/`budget`/`selected`); `_resolve_action_tag(...) is None → continue`
  `:2214-2216`.
- `_row_to_opportunity` at `servicer.py:2590-2608` (OR-F descriptor-parity contract point;
  `provenance` read at `:2596`, `Opportunity(...)` build `:2597-2607`).
- `_primary_source` at `servicer.py:2580-2587` (skips `"watchlist"`/`"position"` structural markers).
- `_normalize_symbol` `:2542`; `_opportunity_key` `:2548-2552`.
- `OpportunitiesRepository` read query with the conviction floor — confirm the `o.conviction >= $2`
  predicate in `services/xstockstrat-analysis/app/repositories/opportunities.py` (design cites
  `opportunities.py:105`; `provenance` JSONB round-trips at `:57,69,98`).
- **131 dependency**: this block is restructured by 131 to fold in `live_by_symbol` (`servicer.py:2144-2168`
  region). Insert the muted-row logic **into 131's landed shape**; re-verify line anchors at execute time.

**TDD**: `red-green required`.

**Instructions** (design decision 7 — dedicated `bool muted`, persisted via provenance, exactly one row per pair):
1. Add `"muted": False` to the `_candidate()` dict (`:2117-2127`), sibling to `is_watchlist`/`is_held`.
2. **Held+denied = ONE row**: in the held loop after `c["is_held"]=True` (`:2149`), if `(sym,strat) ∈
   denied`, set `c["muted"]=True` and `_add_provenance(c,"denied")` — flag the existing exit-traced held
   row; **no second row**.
3. **Standalone muted emission** (after 131's signals-merge, before the `max_universe` cut): for each
   `(sym,strat) ∈ denied` with `sym ∈ union` and `sym ∉ held_norm`, `_candidate(sym,strat)` (idempotent),
   `c["muted"]=True`, `_add_provenance(c,"denied")`. The `sym ∉ held_norm` guard mirrors 131's
   `− held_norm` domain restriction. Source `union`/`denied` from `resolve_universe(...)` (Step 3).
4. Set `c["muted"] = ("denied" in c["provenance"])` right after the denylist step so the in-memory flag
   and the read-side derivation share one source.
5. **Three-bucket cut** (replace `:2173-2177`) with `_sel(c) = is_watchlist or is_held or
   c.get("is_live",False)` (131's `is_live`): `curated=[_sel]`, `muted_only=[muted and not _sel]`,
   `speculative=[not(_sel or muted)]`, `budget=max(0, max_universe − len(curated) − len(muted_only))`,
   `selected = curated + muted_only + speculative[:budget]`. A watchlist-denied `(X,A)` lands in
   `curated` only (single `opportunity_key`, no PK collision at `replace_for_user`).
6. **Trace-skip for muted non-held rows** (row-assembly loop, `:2188-2216`): `c["muted"] and not
   c["is_held"]` skips bars-fetch/trace and emits a `0/0` placeholder — and must **not** be dropped by
   the `action is None` guard (`:2215-2216`). `muted` is the classifier, **never** `conviction=0`
   (fails.md 023).
7. `_row_to_opportunity`: derive `opp.muted = ("denied" in provenance)` (`:2597-2607`); persistence
   carrier is the existing `provenance` JSONB (no migration — `analysis.opportunities` has no `muted`
   column). Add `"denied"` to `_primary_source`'s structural-marker skip tuple (`:2585`) so it never
   leaks into `Opportunity.source`.
8. **Read-query exemption (decision 8)**: change the `OpportunitiesRepository` conviction floor to
   `WHERE conviction >= $2 OR provenance ? 'denied'` (`opportunities.py:105`) so a `min_conviction>0`
   read still returns muted (conviction-0) rows.

**Verification**: covered by Step 8.

---

### Step 8 — test: muted-row emission, mapper parity, read-filter exemption

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — queue correctness, ordinal/cardinal discipline.

**Codebase Evidence**:
- `TestOpportunityRowParity` (proto↔mapper descriptor parity) at `test_analysis_servicer.py:3996-4024`
  — fails until `_row_to_opportunity` carries `muted` (design cites `:4016-4019`).
- `TestListOpportunitiesMaterialized` at `test_analysis_servicer.py:3683` (in-memory
  `OpportunitiesRepository` feeding the real `_compute_opportunities`, `:3517`).

**TDD**: `red-green required`.

**Instructions**:
1. **Held+denied = one row**: a held-denied `(sym,strat)` produces exactly one row with `muted=True`,
   its exit/REDUCE trace preserved (not a second standalone row).
2. **Standalone muted**: a watchlist-denied `(sym,strat)` with `sym ∈ union`, `sym ∉ held` produces one
   `muted=True` `0/0` placeholder row (not dropped by the `action is None` guard, not `conviction=0`
   mis-classified).
3. **Three-bucket cut**: with a `max_universe` smaller than curated+muted, assert muted rows survive
   the cut (only speculative tail is dropped) and no `opportunity_key` PK collision occurs.
4. **Mapper parity**: extend `TestOpportunityRowParity` so `Opportunity.muted` is in `_MAPPED` and the
   mapper sets it from `("denied" in provenance)`; assert `_primary_source` never returns `"denied"`.
5. **Read-filter exemption**: a `ListOpportunities` read with `min_conviction>0` still returns a muted
   (conviction-0) row (the `provenance ? 'denied'` OR-branch).

**Verification**:
```
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
Coverage ≥ 40%; assertions red before Step 7, green after.

---

### Step 9 — service: remove SetStrategyLive empty-symbol precondition + migrate `entry_backfill` to the resolved union

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/engine/entry_backfill.py` — modify
- `services/xstockstrat-analysis/app/main.py` — modify

**Reviewers**: `xstockstrat-analysis` owner — live-toggle precondition correctness, boot-time backfill robustness.

**Codebase Evidence**:
- SetStrategyLive precondition at `servicer.py:1803-1843`: local import `:1824`
  (`from app.engine.live_loop import strategy_symbols`); empty-symbol reject
  `if not strategy_symbols(_row_to_strategy_definition(existing)):` at `:1838`. **133 dependency**: 133
  rewrites this into a `get_by_owner_and_id` block — the edit targets 133's rewritten body; re-verify
  the anchor at execute time.
- `entry_backfill.run_once(live_loop, db_pool, trading_stub, cfg_watcher)` at `entry_backfill.py:47-86`;
  `strategy_symbols` import `:18`, use `:83`; the "ListOrders is the only RPC / never portfolio"
  docstring `:5-9`; per-pair `_last_entry_at.get(key) is not None` skip `:63-64`.
- `main.py` wires the entry_backfill call and stubs — capture the **portfolio channel object** (not the
  stub) for `channel_ready()` (design cites `main.py:67` capture, `:132` pass).

**TDD**: `red-green required`.

**Instructions**:
1. **Precondition removal (decision 10)**: delete **only** the `if not strategy_symbols(...)` empty-symbol
   branch (`servicer.py:1838-1843`) inside 133's rewritten `get_by_owner_and_id` block, leaving the
   existence and active guards intact. Under the deny model, empty deny + empty allowlist now fires the
   whole union (AC-1), so the feature-089 precondition would wrongly block a now-valid config. Remove the
   now-unused local `strategy_symbols` import at `:1824` if no other use remains in the method.
2. **entry_backfill union sourcing (decision 9)**: replace `strategy_symbols(definition)` (`:83`) with
   `resolve_universe(...).union` (**not** `.universe` — a held-denied position still needs its
   `_last_entry_at` anchor; deny is entry-only and never applied on this replay/hydration path). Keep the
   existing per-pair `_last_entry_at.get(key) is not None` skip (`:63-64`).
3. **Portfolio-readiness gate (decision 9)**: because the union now comes from portfolio (Position carries
   no `strategy_id`), add a per-allowlist-free-pair readiness gate:
   `await asyncio.wait_for(portfolio_channel.channel_ready(), timeout)` + a bounded `RpcError`-retry
   around the owner-fetch, with `TimeoutError` caught so allowlist-bearing (portfolio-free, 116-equivalent)
   pairs still proceed. Capture the portfolio **channel object** at `main.py:67` and pass it at `:132`.
4. **Docstring + import (P-03)**: amend the "ListOrders is the only RPC / never portfolio" docstring
   (`entry_backfill.py:5-9`) and update the import (`:18`) in the same PR — the module now reads portfolio.

**Verification**: covered by Step 10.

> **Open risk carried from design (accepted):** the one-shot backfill has no retry pass after the bounded
> readiness gate; a prolonged cold-boot portfolio outage still misses allowlist-free held pairs — bounded,
> self-healing next boot, logged once per key (`live_loop.py:301`), no worse than shipped 116. Record in
> the Step 10 test as an explicitly-accepted residual, not a bug.

---

### Step 10 — test: precondition removal, union-sourced backfill, readiness gate

**Status**: `done`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify
- `services/xstockstrat-analysis/tests/test_entry_backfill.py` — modify (or the existing entry_backfill
  test home; confirm at execute time)

**Reviewers**: `xstockstrat-analysis` owner — live-toggle + backfill correctness.

**Codebase Evidence**:
- SetStrategyLive tests live in `test_analysis_servicer.py` alongside `TestPartialStrategyUpdate`
  (`:2656`); the feature-089 empty-symbol reject is the behavior being inverted.
- entry_backfill has an existing test module (feature 116) — confirm exact filename at execute time
  (`grep -rn "run_once\|entry_backfill" services/xstockstrat-analysis/tests`).

**TDD**: `red-green required`.

**Instructions**:
1. **Precondition inversion**: `SetStrategyLive` on a strategy with empty `denied_symbols` and empty
   `signal_params.symbols` now **succeeds** (AC-1) — previously rejected by feature 089. Existence/active
   guards still reject a missing/inactive strategy.
2. **Union sourcing**: `entry_backfill.run_once` seeds `_last_entry_at` from `resolve_universe(...).union`
   (held-denied symbols **included** — assert a held-denied pair still gets its entry anchor), and the
   `_last_entry_at.get(key) is not None` skip still narrows to feature-116's set.
3. **Readiness gate**: a cold-boot portfolio outage (mock `channel_ready()` raising `TimeoutError`) does
   **not** wedge allowlist-bearing pairs (they proceed portfolio-free); a bounded `RpcError` retry is
   attempted for allowlist-free pairs. Add the accepted-residual assertion: a prolonged outage leaves
   allowlist-free held pairs un-anchored, logged once per key (documented as accepted, not a failure).

**Verification**:
```
cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
Coverage ≥ 40%; assertions red before Step 9, green after.

---

### Step 11 — service: agent `manage_strategy` exposes `denied_symbols` + `signal_eligible`; update `strat-lab` skill

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; strat-lab skill same-PR rule.

**Codebase Evidence**:
- `manage_strategy` tool at `tools.py:488-500`; `supplied` field-map dict `:572-583` (currently
  `cooldown_days`/`exit_cooldown_days` at `:578-579`); mask derivation `mask = [name for name, value in
  supplied.items() if value is not None]` `:581`; definition assembly `:583`; `update_mask` finalize
  `:592-601`; delegates to client `:610`; returns camelCase `MessageToDict` (`:563-565`).
- Client `manage_strategy` at `client.py:396-401`; `pb_def = analysis_pb2.StrategyDefinition(...)`
  construction `:425-438` (`cooldown_days`/`exit_cooldown_days` at `:436-437`); read-back
  `get_strategy` `:458-480` / `list_strategy_definitions` `:483-494` via
  `MessageToDict(..., preserving_proto_field_name=True)` (AC-4 round-trip is automatic).
- strat-lab mutation-guard / merge-fields section at `plugins/strat-lab/skills/backtest/SKILL.md:44-57`
  (documents `cooldown_days`/`exit_cooldown_days` partial-merge semantics); root same-PR rule
  (`CLAUDE.md` § Key File Paths — a `manage_strategy` change must update the skill in the **same** PR).

**TDD**: `red-green required`.

**Instructions**:
1. In `tools.py` `manage_strategy`, add `denied_symbols: list[str] | None = None` and
   `signal_eligible: bool | None = None` params; add both to the `supplied` dict (`:572-583`) so they
   join the `is not None` mask derivation (`:581`); document them in the tool docstring alongside
   `cooldown_days`. `denied_symbols` is a normalized-uppercase list; `signal_eligible` gates the
   platform-wide signal term (default false; conflicts with a non-empty `signal_params.symbols` allowlist
   → backend `INVALID_ARGUMENT`).
2. In `client.py`, wire `denied_symbols=definition.get("denied_symbols", [])` and
   `signal_eligible=definition.get("signal_eligible")` into the `StrategyDefinition(...)` construction
   (`:425-438`). Read-back (AC-4) is automatic via `MessageToDict(preserving_proto_field_name=True)`.
3. Update `plugins/strat-lab/skills/backtest/SKILL.md:44-57` in the **same PR**: document deny-list
   semantics (entry-only deny; held positions keep exit tracing) and `signal_eligible` alongside the
   existing `cooldown_days`/`exit_cooldown_days` merge-fields text, and note the allowlist×`signal_eligible`
   `INVALID_ARGUMENT` rejection.

**Verification**: covered by Step 12.

---

### Step 12 — test: agent field-map forwarding + read-back round-trip

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_tools.py` — modify
- `services/xstockstrat-agent/tests/test_client.py` — modify

**Reviewers**: `xstockstrat-agent` owner — MCP tool contract stability.

**Codebase Evidence**:
- `test_forwards_cooldown_days` / `test_forwards_exit_cooldown_days` at `test_tools.py:779-802,805-829`;
  partial-merge mask test `:1218-1241` — the exact template to mirror for `denied_symbols`/
  `signal_eligible`.
- `test_client.py:109-159` (presence round-trip), `:80-107` (admin-scope); shared fixtures
  `tests/conftest.py` (`ADMIN`, `_ctx`, `credentialed_source`).
- Coverage note: `xstockstrat-agent` is **not** in the CI coverage-threshold matrix
  (`reference/spec-template.md` table; fails.md 047 — agent absent from the CI matrix). No `--cov-fail-under`
  gate applies; run the suites + ruff.

**TDD**: `red-green required`.

**Instructions**:
1. Mirror `test_forwards_cooldown_days` for `denied_symbols` and `signal_eligible`: a `manage_strategy`
   update passing each field puts it in `supplied`, in the derived `update_mask`, and in the outbound
   `StrategyDefinition`.
2. Round-trip (AC-4): a `get_strategy`/`list_strategies` read reflects a set `denied_symbols`/
   `signal_eligible` (snake_case via `preserving_proto_field_name=True`).
3. Assert an update omitting the two fields leaves them out of the mask (partial-merge preserved).

**Verification**:
```
cd services/xstockstrat-agent && pytest tests/test_tools.py tests/test_client.py && ruff check . && ruff format --check .
```
Assertions red before Step 11, green after. (No CI coverage threshold for the agent — the suites +
ruff are the gate.)

---

### Step 13 — service: StrategyWizard deny-list chips editor + `signal_eligible` toggle + masked write plumbing

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/insights/StrategyWizard.tsx` — modify
- `services/xstockstrat-ui/src/hooks/useStrategyDefinitions.ts` — modify
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify (only if the masked path needs a BFF change;
  confirm at execute time — `manageStrategy` at `insightsBff.ts:42-54` already forwards the request)

**Reviewers**: `xstockstrat-ui` owner — Trading/analytics UI correctness, Connect-RPC call safety.

**Codebase Evidence**:
- `StrategyWizard({ mode, initial, onSubmitDone })` at `StrategyWizard.tsx:108`; `cooldownDaysRaw`/
  `exitCooldownDaysRaw` state `:121-126`; `components` array editor precedent (add/remove) — design cites
  `:353-374`; presence-honest submit `handleSubmit` `:172-197` (`components` at `:178`, presence-honest
  omit at `:186`). Array editor pattern = `ComponentEditor.tsx`.
- `useManageStrategy()` at `useStrategyDefinitions.ts:34-43` — sends `{operation, definition}` via
  `analysisClient.manageStrategy` at `:43`; **no `update_mask` set anywhere today** (wizard always
  full-replace).
- `manageStrategy` BFF at `insightsBff.ts:42-54` (admin-gated `requireAdminScope` at `:51`).
- Typed client `analysisClient` (Connect-JSON camelCase): `denied_symbols` → `deniedSymbols`,
  `signal_eligible` → `signalEligible` after Step 2 codegen.

**TDD**: `N/A (frontend — no red-green unit gate; e2e-covered in Step 16)`.

**Instructions**:
1. Add a `deniedSymbols` string-chips editor to `StrategyWizard.tsx` mirroring the `components` add/remove
   editor (`:353-374`), normalizing entries to uppercase; thread it into the presence-honest submit
   (`:172-197`).
2. Add a `signal_eligible` boolean toggle to the wizard, submitted as `signalEligible`.
3. Extend `useManageStrategy` (`useStrategyDefinitions.ts:34-43`) with an optional `updateMask?: string[]`
   param passed through to `analysisClient.manageStrategy` — the wizard's full edit keeps `updateMask`
   undefined (full-replace, unchanged); the Symbol-page control (Step 14) uses it for a masked write.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
```
Lint clean; the deny-list chips + toggle render and submit (behavioral proof in Step 16 e2e).

---

### Step 14 — service: Symbol detail page "mute this symbol for a strategy" control (masked write)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/market/[symbol]/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — Connect-RPC call safety, masked-write correctness.

**Codebase Evidence**:
- `market/[symbol]/page.tsx` is a client component; reads `?strategy=` param (`threadedStrategy`) at
  `:44`; derives a single `strategyId` at `:97-102`; `useStrategyAnalytics(strategyId)` `:103-109`. It
  loads **no** strategy list and calls **no** strategy-write BFF today (recon Risk — real new plumbing).
- Masked-write mechanism = `useManageStrategy(..., updateMask)` from Step 13; `listStrategyDefinitions`
  BFF at `insightsBff.ts:56-58` (owner-scoped post-133) provides the strategy picker + each strategy's
  current `deniedSymbols`.

**TDD**: `N/A (frontend — e2e-covered in Step 16)`.

**Instructions**:
1. Add a "mute this symbol for a chosen strategy" control: load `listStrategyDefinitions` for a strategy
   picker (showing each strategy's current `deniedSymbols`), append the current symbol (uppercase) to the
   chosen strategy's `deniedSymbols`, and send a **masked** `manageStrategy` update
   (`updateMask=["denied_symbols"]`) — the first UI exercise of the mask path.
2. Reflect the muted state after write (invalidate the strategy-definitions query, already wired in
   `useManageStrategy`).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
```
Lint clean; behavioral proof in Step 16.

---

### Step 15 — service: Opportunities page muted-row treatment

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify
- `services/xstockstrat-ui/src/components/mobile/SectionRenderer.tsx` — modify (mobile muted branch)

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy, no silent row loss.

**Codebase Evidence**:
- Opportunities page at `opportunities/page.tsx`; `OpportunityCard` component (recon `:311-385`);
  attributed-vs-`0/0` ternary (recon `:333-341`); `strategyId` mono tag when present (recon `:354-356`);
  the min-conviction filter at `:104-106` (`o.conviction >= minConviction`); sort keys
  `'conviction' | 'expiry'` at `:31`. Mobile branch via `SectionRenderer` (`:25` import).
- Typed `Opportunity.muted` (camelCase `muted`) available after Step 2 codegen.

**TDD**: `N/A (frontend — e2e-covered in Step 16)`.

**Instructions**:
1. Branch `OpportunityCard` (and its mobile `SectionRenderer` counterpart) on `o.muted`: distinct
   muted styling, **suppress** the Snooze/Dismiss/Review action buttons, and add a link back to the
   deny-list editor (Step 13/14 surface — e.g. the strategy edit page or Symbol-page control).
2. **Exempt muted rows from the min-conviction filter** (`:104-106`) and the conviction sort — a muted
   non-held row has conviction 0 and must not vanish (mirrors the Step 8 backend read-filter exemption;
   FR-5's "must not silently disappear").

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
```
Lint clean; behavioral proof in Step 16.

---

### Step 16 — test: e2e specs + fixtures for the three UI surfaces (C-12)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/opportunities.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/strategies.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify
- `services/xstockstrat-ui/e2e/insights/strategy-authoring.spec.ts` — modify
- `services/xstockstrat-ui/e2e/insights/signal-detail.spec.ts` — modify (the `market/[symbol]` tests)

**Reviewers**: `xstockstrat-ui` owner — analytics display accuracy, mock-backend fidelity.

**Codebase Evidence**:
- Fixtures: `e2e/fixtures/opportunities.ts:10-64` (`OPPORTUNITIES`, incl. `strategyId:''`/`0/0` rows
  `:38-63`); `e2e/fixtures/strategies.ts:52-67`; catalog `e2e/fixtures/INVENTORY.md:17,21`.
- Mock backend `e2e/mock-backend.ts`: `listOpportunities` filter (recon `:547-550`), `manageStrategy`
  echo (recon `:773-782`), `getStrategy` per-id overrides (recon `:783-813` — attach a `deniedSymbols`
  override here), `listStrategyDefinitions` (recon `:757-762`).
- Specs: `opportunities.spec.ts:53,70`; `strategy-authoring.spec.ts:100-105,299-325`;
  `signal-detail.spec.ts` (market/[symbol]).
- C-12: import mocked domain data from `e2e/fixtures/` (never inline literals); a new domain shape gets a
  fixture module + `INVENTORY.md` row in the same step; scenario one-offs (`{...FIXTURE, override}`) stay
  inline.

**TDD**: `red-green required` — the muted-row + deny-list assertions fail against the pre-Step-13/15 UI.

**Instructions**:
1. Extend the `opportunities.ts` fixture with a `muted:true` row (both a held-denied REDUCE variant and a
   standalone `0/0` muted variant) and add an `INVENTORY.md` row. Extend `strategies.ts` with a
   `deniedSymbols`/`signalEligible`-bearing definition.
2. `mock-backend.ts`: make `listOpportunities` return the muted rows regardless of min-conviction; make
   `getStrategy`/`listStrategyDefinitions` return `deniedSymbols`; make `manageStrategy` echo a masked
   `denied_symbols` update (distinguishable fields so the assertion has teeth — insights.md 2026-07-27).
3. `opportunities.spec.ts`: a muted row renders with muted styling, has no Snooze/Dismiss/Review actions,
   links back to the deny-list editor, and survives a `min_conviction>0` filter.
4. `strategy-authoring.spec.ts`: the wizard deny-list chips editor + `signal_eligible` toggle add/remove
   and submit; a full edit stays full-replace.
5. `signal-detail.spec.ts`: the Symbol-page mute control picks a strategy, appends the symbol, and sends a
   masked `denied_symbols` update.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e -- opportunities strategy-authoring signal-detail
```
Fixture imports confirmed: `grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" e2e/insights/opportunities.spec.ts e2e/insights/strategy-authoring.spec.ts e2e/insights/signal-detail.spec.ts e2e/mock-backend.ts`. `INVENTORY.md` updated for the added fixture. Specs fail against the pre-implementation UI, pass after. (Next.js has no coverage threshold — e2e is the gate.)

---

### Step 17 — docs: update analysis service CLAUDE.md + mcp-tools reference

**Status**: `pending`
**Service**: `docs` / `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `docs/runbooks/mcp-tools.md` — modify (only if `manage_strategy`'s parameter table is documented there;
  confirm at execute time)

**Reviewers**: none (`docs` category).

**Codebase Evidence**:
- Analysis `CLAUDE.md` § Decide-surface RPCs documents `ListOpportunities`'s Universe and the
  `max_universe` cut — the muted-row + deny-list universe change belongs here. The live-loop symbols
  docstring at `live_loop.py:12-14` ("`StrategyDefinition` has no dedicated symbols field... reads
  `signal_params.symbols`") is now stale and updated in Step 5's file.
- `docs/runbooks/mcp-tools.md` is the agent MCP reference (root `CLAUDE.md` § Context Guide → mcp-tools);
  the `manage_strategy` parameter surface changed in Step 11.
- FR-6 doc work (amend 131's `design.md`, update `merge-order.md`) was **already done during
  `/sdd-design`** (feature.md Status History 2026-08-14: "Amended 131's design.md (FR-6) +
  merge-order.md") — do **not** re-do it here.

**TDD**: `N/A (docs)`.

**Instructions**:
1. Update analysis `CLAUDE.md` § Decide-surface RPCs: the live-loop universe is now
   `union(watchlist ∪ held ∪ (signals iff signal_eligible)) − denied` (allowlist-as-override for
   allowlist-bearing strategies), fair-share scheduled; muted `(symbol, strategy)` pairs surface as
   explicit rows via the `provenance`-carried `Opportunity.muted` flag. Note the three new proto fields
   ride JSONB (no migration). Note `signal_eligible` default false and the allowlist conflict rejection.
2. If `docs/runbooks/mcp-tools.md` documents `manage_strategy`'s parameters, add `denied_symbols` and
   `signal_eligible`.
3. Run `/context-scrubber scan` scoped to the touched CLAUDE.md/docs before pushing (root `CLAUDE.md`
   Teardown rule); fix grounded findings. If the context-forge plugin is unavailable, say so in the PR
   body.

**Verification**:
```
grep -n "denied_symbols\|signal_eligible\|muted\|resolve_universe" services/xstockstrat-analysis/CLAUDE.md
```
The deny-list/muted-row/universe change is documented; no stale "reads `signal_params.symbols`" claim
remains as the sole universe description.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
