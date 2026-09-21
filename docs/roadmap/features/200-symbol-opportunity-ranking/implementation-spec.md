# Implementation Spec: symbol-opportunity-ranking

**Status**: `pending`
**Created**: 2026-09-21
**Feature**: `docs/roadmap/features/200-symbol-opportunity-ranking/feature.md`
**Total Steps**: 11
**Feature Branch**: `feature/symbol-opportunity-ranking`

---

## Execution Summary

This feature adds a symbol-level roll-up score (`symbol_score`) computed **entirely inside
`xstockstrat-analysis`'s existing opportunity write/read path** (design.md § Chosen Approach). It
layers on feature-199's landed per-row `composite_score` (proto `= 21`, migration `024`, projected in
`read()`) — no new inter-service edge, no new RPC/bars fetch.

Order: proto surface first (Step 1 additive field + sort enum, Step 2 regen), then the persistence
column (Step 3 migration `025`), then the analysis roll-up + repo + sort + heal + cardinal-guard
invariant (Step 4) with its comprehensive test (Step 5), then the config-key declaration (Step 6). The
two named consumer surfaces (C-14) follow: Agent projection (Step 7) + its parity test (Step 8) +
`mcp-tools.md` parity (Step 9), then the UI `/insights` sort option + symbol-group-header render
(Step 10) + its e2e (Step 11).

**Consumer surfaces (C-14):** product-spec names **UI** (`/insights` queue, existing route — no new
nav entry, so no `PLATFORM_SUBNAV`/C-10(a) step needed) and **Agent** (`list_opportunities`). Both get
their own steps (10/11 for UI, 7/8/9 for Agent). The per-strategy operator override is **deferred to a
named follow-up feature** (`per-strategy-rank-weight-override`, design.md § Deferred) — see Step
Dependencies.

### Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` built from composite scores | Step 5 (analysis unit) |
| `@AC-2` 2 moderate > 1 strong | Step 5 (analysis unit) |
| `@AC-3` diminishing returns / γ-clamp | Step 5 (analysis unit) |
| `@AC-4` higher-weighted strategy outranks | Step 5 (analysis unit) |
| `@AC-5` operator override | **DEFERRED** — `@deferred-followup`, no v1 step (design.md § Deferred; FR-3 grade-weighting stays covered by `@AC-4`) |
| `@AC-6` NULL composite contributes nothing / all-NULL → NULL | Step 5 (analysis unit) |
| `@AC-7` provisional grade → neutral floor weight (> 0) | Step 5 (analysis unit) |
| `@AC-8` queue ranked by symbol_score, server-authoritative | Step 5 (repo sort) + Step 11 (UI e2e) |
| `@AC-9` agent compares by symbol_score | Step 8 (agent projection) |
| `@AC-10` deterministic for fixed inputs | Step 5 (analysis unit — order-insensitive shared fold) |

---

## Step Dependencies

- Step 2 (proto-gen) requires Step 1 (proto) — regen reflects the new field/enum value.
- Step 4 (analysis service) requires Step 2 (generated stubs carry `symbol_score`/sort value) and
  Step 3 (the `symbol_score` column exists for INSERT/UPDATE/SELECT).
- Step 5 (analysis test) covers Step 4 (Constitution **C-08**) — placed immediately after.
- Step 6 (config declaration) pairs with Step 4 (the `get_float_present` reads live in Step 4; Step 6
  is the C-05 CLAUDE.md declaration).
- Step 7 (agent service) requires Step 2 (the generated Python `Opportunity` carries `symbol_score`).
- Step 8 (agent test) covers Step 7.
- Step 10 (UI service) requires Step 2 (the generated TS `OpportunitySort` carries `SYMBOL_SCORE`) and
  the field on the typed client message.
- Step 11 (UI e2e) covers Step 10.
- **Deferred surface:** `@AC-5` per-strategy operator override → follow-up feature
  `per-strategy-rank-weight-override` (design.md § Deferred lists its four grounded must-fixes). Not in
  this feature's scope.
- **Merge-order:** must merge **after** feature 199 (consumes `composite_score`); blocking row in
  `docs/roadmap/features/merge-order.md`. Soft same-file rebase overlap with in-flight 187/193/188 on
  `servicer.py` `_compute_opportunities`, `opportunities.py` ORDER BY, `insights/opportunities/page.tsx`,
  agent `client.py` — re-anchor line numbers at execute time.

---

### Step 1 — proto: add `symbol_score` field + `OPPORTUNITY_SORT_SYMBOL_SCORE` enum value

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness + `buf breaking` passes against dev trunk;
xstockstrat-analysis owner — strategy scoring determinism; xstockstrat-ui owner — analytics display
accuracy; xstockstrat-agent owner — MCP tool contract stability

**Codebase Evidence**:
- `OpportunitySort` enum confirmed at `analysis.proto:546-550`: `OPPORTUNITY_SORT_UNSPECIFIED = 0;`
  `OPPORTUNITY_SORT_CONVICTION = 1;` `OPPORTUNITY_SORT_EXPIRY = 2;` — max value 2, so `= 3` is free.
- `Opportunity` message confirmed at `analysis.proto:563`; last landed field is feature-199's
  `optional double composite_score = 21;` at `analysis.proto:602` (with its cardinal-guard
  doc-comment at `:599-602`). Next-free field number is **22**.
- Cardinal-guard doc-comment precedent to mirror: `analysis.proto:599-602` ("NOT a probability and
  NEVER a cardinal sizing/alert/risk input").

**TDD**: `N/A (proto)`

**Covers**: —

**Instructions**:
1. In the `OpportunitySort` enum (`analysis.proto:546`), add after `OPPORTUNITY_SORT_EXPIRY = 2;`:
   `OPPORTUNITY_SORT_SYMBOL_SCORE = 3;  // symbol roll-up ordering (MAX(symbol_score) OVER PARTITION BY symbol) — feature 200`
2. In the `Opportunity` message, after `optional double composite_score = 21;` (`:602`), add
   `optional double symbol_score = 22;` with a doc-comment mirroring `ANALYSIS-12` and the
   `composite_score` guard, stating it is a **bounded (`< 2·max_composite`, i.e. `< 2.0`, for γ<1)
   ordinal RANKING scalar on a non-`[0,1]` scale; NOT a probability / expected-return / sizing / alert
   input**; explicit-presence: unset = no score-eligible opportunity for the symbol (design.md
   § Cardinal guard).
3. Keep the change additive only — do not renumber or retype any existing field (C-09).

**Verification**:
```
cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/symbol-opportunity-ranking"
```
Both pass (additive field + additive enum value are non-breaking).

---

### Step 2 — proto-gen: regenerate stubs

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/**` — modify (generated)
- `packages/proto/gen/python/**` — modify (generated)
- `packages/proto/gen/ts/**` — modify (generated, incl. compiled `gen/ts/dist/`)

**Reviewers**: Proto Reviewer — field number uniqueness + `buf breaking` passes against dev trunk;
xstockstrat-analysis owner — strategy scoring determinism; xstockstrat-ui owner — analytics display
accuracy; xstockstrat-agent owner — MCP tool contract stability _(inherited from Step 1)_

**Codebase Evidence**:
- Regen script confirmed: root `CLAUDE.md` § Generating Proto Stubs → `./scripts/buf-gen.sh`
  (generates TS/Python/Go + compiles the TS package); CI `proto-freshness` enforces an empty
  `git diff packages/proto/gen/` afterward.

**TDD**: `N/A (proto-gen)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from repo root.
2. Commit the generated stub changes together with the Step 1 `.proto` change (proto source + stubs
   in one PR, per `docs/runbooks/proto-versioning.md`).

**Verification**:
```
./scripts/buf-gen.sh && git diff --exit-code packages/proto/gen/
```
Empty diff after regen (the generated tree already reflects the new field/enum value).

---

### Step 3 — migration: add nullable `symbol_score` column to `analysis.opportunities`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/025_opportunity_symbol_score.up.sql` — create
- `services/xstockstrat-analysis/migrations/025_opportunity_symbol_score.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps), up+down pair present, index correctness;
xstockstrat-analysis owner — schema ownership

**Codebase Evidence**:
- Last migration confirmed via `ls services/xstockstrat-analysis/migrations/`: `024_opportunity_composite_score.up.sql`
  / `.down.sql` — so the next-free NNN is **`025`** (C-07).
- Feature-199 precedent to mirror: `024_opportunity_composite_score.{up,down}.sql` added its nullable
  `DOUBLE PRECISION composite_score` column the same way.

**TDD**: `N/A (migration)`

**Covers**: —

**Instructions**:
1. `025_opportunity_symbol_score.up.sql`:
   `ALTER TABLE analysis.opportunities ADD COLUMN symbol_score DOUBLE PRECISION;`
   (nullable, no default — NULL = no score-eligible opportunity for the symbol; symbol-uniform value,
   design.md § Persist + sort). No index — the sort computes `MAX(...) OVER (PARTITION BY o.symbol)`
   over the already-user-scoped read (no per-column index needed; mirror `024` which added none).
2. `025_opportunity_symbol_score.down.sql`:
   `ALTER TABLE analysis.opportunities DROP COLUMN symbol_score;`
3. Never edit an applied migration (F-01) — this is a new numbered pair.

**Verification** (offline, no DB):
```
ls services/xstockstrat-analysis/migrations/025_opportunity_symbol_score.up.sql \
   services/xstockstrat-analysis/migrations/025_opportunity_symbol_score.down.sql
```
Then read both: confirm the `ADD COLUMN` in `.up` has the inverse `DROP COLUMN` in `.down`. (The real
apply/rollback runs in CI/deploy against the managed DB — never spin up a database here.)

---

### Step 4 — service: analysis symbol_score roll-up (compute + persist + sort + heal + guard)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/repositories/opportunities.py` — modify
- `services/xstockstrat-analysis/docs/context-constitution.md` — modify (add `ANALYSIS-12`)

**Reviewers**: xstockstrat-analysis owner — strategy scoring determinism, no look-ahead bias,
backtest/roll-up reproducibility

**Codebase Evidence**:
- `_compute_opportunities` confirmed at `servicer.py:3989`; the composite fusion config reads are read
  once per pass at `servicer.py:4016-4022` (`composite_k`/`composite_w_readiness`/`composite_w_signal`
  via `get_float_present`) — the anchor for the two new `analysis.scoring.*` reads.
- `owned_ids` sources confirmed: `_drain_watchlist_bindings(propagation_meta)` (`servicer.py:4007`)
  → `watchlist_by_symbol` (`:4028-4030`); `list_live_enabled(user_id)` (`:4053`, owner-scoped per the
  `:4037` comment) → `live_by_symbol` (`:4081`); the fundamentals-blend force-run fires only when the
  user owns a live blend (`blend_active = … any(r["strategy_id"] == blend_id for r in live_rows)`,
  `:4060`). design.md Open Risk RESOLVED (round-6 grep): `owned_ids = watchlist ∪ live_rows` is a
  complete cover — no fourth attribution path, no `list(user_id)` fallback.
- Per-row assembly: `_row_for(c)` returns the row dict incl. `"composite_score": composite`
  (`servicer.py:4512`); `rows = [r for r in await asyncio.gather(...) if r is not None]` at
  `servicer.py:4515`; `valid_until` stamped `:4522-4526`; `return rows` at `:4527` — the wiring point
  for the group-fold + per-row stamp.
- Reusable fusion helpers (module-level, layer the new pure helpers beside them):
  `_composite_signal_subscore` at `servicer.py:5216`, `_composite_score` at `servicer.py:5236`
  (`Σw≤0 → None`).
- Grade cache: `self._strategies` at `servicer.py:417`; hydrated `self._strategies[r["strategy_id"]] =
  _row_to_score(r)` at `servicer.py:2319`; `_row_to_score` at `servicer.py:5665` carries
  `overall_score`, `provisional` (and `rating`) — the **continuous** `overall_score ∈ [0,1]` +
  `provisional`, NOT the A–F letter (design.md). A strategy with no cached score maps to floor.
- `_row_to_opportunity` explicit-presence mapping confirmed at `servicer.py:5301-5305`
  (`composite_score = row.get("composite_score"); if … is not None: opp.composite_score = float(...)`).
- Repo write/read paths in `opportunities.py`: `_SORT_ORDER_BY` dict at `:33` (keys 0/1/2, each
  `… OVER (PARTITION BY o.symbol) … , o.opportunity_key ASC`); `replace_for_user` INSERT column list
  `… composite_score)` at `:84`, values `r.get("composite_score")` at `:101`; `replace_symbols` UPDATE
  `composite_score = $9` at `:132`, value at `:147`; `read()` SELECT `o.computed_at, o.composite_score`
  at `:187`, `order_by = _SORT_ORDER_BY.get(sort, _SORT_ORDER_BY[0])` at `:182`.
- Heal path: `_retry_unavailable_symbols(self, user_id, symbols: set, propagation_meta)` at
  `servicer.py:3744`; builds `heal_rows` then `await self._opportunities_repo.replace_symbols(user_id,
  heal_rows)` at `servicer.py:3982`; the read-time single-symbol composite recompute helper
  `_composite_for(sym, readiness)` is at `servicer.py:3797` (shows the heal path recomputes composite
  through the SAME fusion).
- `ANALYSIS-11` (feature-199 composite guard) confirmed at
  `services/xstockstrat-analysis/docs/context-constitution.md:27` — `ANALYSIS-12` is the next-free
  companion id.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. **Two new module-level pure helpers in `servicer.py`, beside `_composite_score`/`_composite_signal_subscore`**
   (design.md § Chosen Approach / Fold):
   - `_strategy_weight(overall_score, provisional, floor)` → returns `floor` when `overall_score is
     None` OR `provisional` is truthy; else `floor + (1 - floor) * clamp01(overall_score)`. **No
     override term** (v1 grade-only). Clamp `overall_score` to `[0,1]`.
   - `_symbol_score(terms, gamma)` → `None` when `terms` is empty; else
     `sum(gamma**i * t for i, t in enumerate(sorted(terms, reverse=True)))`. Sorting DESC internally
     makes the fold **order-insensitive** (determinism; `@AC-10`, and heal/compute byte-parity).
2. **One shared fold builder** `_symbol_score_for_group(rows, grade_lookup, cfg_gamma, cfg_floor)`
   that both compute and heal call (parity by construction, design.md § Single shared fold path):
   `terms = [r["composite_score"] * _strategy_weight(*grade_lookup(r["strategy_id"]), cfg_floor)
   for r in group_rows if r["composite_score"] is not None]`, then `return _symbol_score(terms,
   cfg_gamma)`. `grade_lookup(strategy_id)` returns `(overall_score, provisional)` from
   `self._strategies` **only when `strategy_id` is in the owner's id set**, else `(None, False)` →
   floor (IDOR guard, `fails.md:1153/1532`).
3. **Compute wiring** in `_compute_opportunities`: alongside the composite reads at
   `servicer.py:4016-4022`, read `gamma = self._cfg.get_float_present("analysis.scoring.symbol_score_decay", 0.5)`
   **clamped to `[0, 0.99]`** (design.md round-6: a γ≥1 degenerates the fold and inverts `@AC-3`) and
   `floor = self._cfg.get_float_present("analysis.scoring.strategy_weight_floor", 0.5)`. Derive
   `owned_ids = set(watchlist_by_symbol values) ∪ {r["strategy_id"] for r in live_rows}` from rows
   already drained this pass (no extra query, F-06). After the `rows` list is built (`servicer.py:4515`)
   and before `return rows` (`:4527`), group `rows` by `symbol`, call `_symbol_score_for_group` once
   per group, and stamp the single scalar (or `None`) onto **every** row in that group (symbol-uniform,
   incl. NULL-composite / muted / data-unavailable rows) as `r["symbol_score"]`.
4. **Repo persistence** in `opportunities.py`: add `symbol_score` to the `replace_for_user` INSERT
   column list (`:84`) + values (`:101`, `r.get("symbol_score")`); add `symbol_score = $N` to the
   `replace_symbols` UPDATE (`:132`) + value (`:147`); add `o.symbol_score` to the `read()` SELECT
   (`:187`). Add sort branch `_SORT_ORDER_BY[3] = "MAX(o.symbol_score) OVER (PARTITION BY o.symbol) DESC
   NULLS LAST, o.symbol ASC, o.opportunity_key ASC"` (keeps grouping/contiguity `@AC-8/9`, stable
   paging `@AC-13`). **Default stays `_SORT_ORDER_BY[0]`** — no `@AC-10 @feature-190` change.
5. **New repo methods** in `opportunities.py` for the heal path (design.md § Heal): a disposition-free
   `symbol_composite_terms(user_id, symbol)` read (all rows for the symbol, no `opportunity_actions`
   join, no `valid_until` filter — returns `strategy_id` + `composite_score` per row) and a
   `stamp_symbol_score(user_id, symbol, score)` symbol-wide UPDATE that sets `symbol_score` on **every**
   row of that symbol (NOT `replace_symbols`).
6. **Heal wiring** in `_retry_unavailable_symbols`: after `replace_symbols(...)` at `servicer.py:3982`,
   for each `sym` in `symbols`, read `symbol_composite_terms(user_id, sym)`, fold via the SAME
   `_symbol_score_for_group` (grade from `self._strategies` ∩ owner ids), and `stamp_symbol_score(user_id,
   sym, score)`.
7. **Proto mapping** in `_row_to_opportunity` (`servicer.py:5301-5305`): after the composite_score
   mapping add the explicit-presence map for `symbol_score`
   (`sym_sc = row.get("symbol_score"); if sym_sc is not None: opp.symbol_score = float(sym_sc)`).
8. **`ANALYSIS-12` invariant** in `services/xstockstrat-analysis/docs/context-constitution.md` (after
   `ANALYSIS-11`): declare `Opportunity.symbol_score` a **bounded (`< 2·max_composite`, `< 2.0` for
   γ<1) ordinal RANKING scalar on a non-`[0,1]` scale — NEVER a cardinal sizing/alert/risk input**;
   cite `fails.md:313/:418` and the shared fold helper (discharges the ordinal-as-cardinal trap).
9. No new outbound gRPC call is added (reuses drained rows + in-memory grade cache) → header
   propagation (C-03) unaffected; no new DB pool (F-06).

**Verification** (lint + coverage live in the paired Step 5): the behavioral proof is Step 5's RED→GREEN.

---

### Step 5 — test: analysis roll-up unit + repo sort + heal-parity + compute wiring

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_symbol_score.py` — create (pure-helper + fold unit tests)
- `services/xstockstrat-analysis/tests/test_opportunities_repo.py` — modify (sort branch 3 + read/persist)
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (compute stamp + heal parity)

**Reviewers**: xstockstrat-analysis owner — strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `test_composite_score.py` is the sibling home for the new `test_symbol_score.py` pure-fold unit
  tests (confirmed present in `tests/`); `test_opportunities_repo.py` already exercises composite
  read/persist and the sort branches; `test_analysis_servicer.py` already covers `_compute_opportunities`
  + `_retry_unavailable_symbols`.
- C-13 (Python fixtures): the canonical home is `tests/conftest.py`; `grep` shows no shared
  strategy-score fixture there today — small `StrategyScore`/row literals with a single consumer stay
  inline (record that verdict); a second consumer of any domain literal moves it to `conftest.py` in
  this step.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-6, AC-7, AC-8, AC-10`

**Instructions** (assert the mandated orderings at the **default** γ=0.5, floor=0.5 — design.md
worked numbers):
1. `_symbol_score` / `_strategy_weight` / `_symbol_score_for_group` unit tests:
   - **`@AC-1`**: symbol_score is a function of the group's `composite_score`s (0.70, 0.60), and
     changing a composite changes the result.
   - **`@AC-2`**: AAPL 2×0.80 (equal weight) → 1.20 ranks strictly above MSFT 1×1.00 → 1.00 (flips the
     legacy MAX ordering).
   - **`@AC-3`**: AAPL 2×0.80 → 1.20 ranks strictly above PENNY 6×0.30 → ≈0.591 (geometric saturation);
     add a γ-clamp assertion — a configured γ≥1 read-clamps to 0.99 so PENNY never overtakes AAPL.
   - **`@AC-4`**: grade-A (`overall≥0.8`) weight strictly exceeds grade-C (`overall∈[0.5,0.65)`) weight
     → AAPL (grade-A + grade-C at 0.70 each) ranks strictly above MSFT (two grade-C at 0.70).
   - **`@AC-6`**: a NULL-composite term is omitted (not coerced to 0) — AAPL {0.75, NULL} equals AAPL
     {0.75}; a group of all-NULL composites → `symbol_score is None`.
   - **`@AC-7`**: a provisional/absent grade → floor weight (0.5, strictly > 0), still contributes.
   - **`@AC-10`**: the fold is order-insensitive — same terms in any input order yield the identical
     score (internal DESC sort).
2. `test_opportunities_repo.py` (**`@AC-8`**): `read(sort=OPPORTUNITY_SORT_SYMBOL_SCORE)` orders symbol
   groups by `MAX(symbol_score) OVER (PARTITION BY o.symbol) DESC NULLS LAST`, keeps rows contiguous by
   symbol with `o.opportunity_key ASC` tiebreak; a NULL-symbol_score symbol sinks last; assert
   `replace_for_user`/`replace_symbols` round-trip `symbol_score` and `read()` projects it.
3. `test_analysis_servicer.py`: (a) a compute pass stamps the symbol-uniform `symbol_score` on every
   row of a group (incl. muted/data-unavailable); (b) **heal-parity** — after
   `_retry_unavailable_symbols`, every row of the healed symbol (incl. dismissed) carries the identical
   `symbol_score` AND it equals a full compute pass over the same inputs (design.md § Heal).
4. Author every assertion to fail against the pre-Step-4 tree (P-06 red-before-green).

**Verification**:
```
cd services/xstockstrat-analysis && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40
```
Confirm the new tests pass and total coverage ≥ 40%.

---

### Step 6 — config: declare the two `analysis.scoring.*` keys in the service CLAUDE.md

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify (config-key table)

**Reviewers**: xstockstrat-analysis owner — config key usage; xstockstrat-config owner — config key
naming (`<service>.<category>.<key>`), WatchConfig stream stability

**Codebase Evidence**:
- Sibling `analysis.scoring.composite_*` keys are declared in the analysis config-key table with the
  "Read via `get_float_present` … Code-default only (not config-ui-seeded)" note (confirmed
  `services/xstockstrat-analysis/CLAUDE.md:296-298`) — the exact precedent to mirror (C-05, F-07). No
  config-service seed migration is created (code-default only, design.md § Constitution `F-07`).

**TDD**: `N/A (config)`

**Covers**: —

**Instructions**:
1. Add two rows to the analysis config-key table (beside the `composite_*` keys, `CLAUDE.md:296-298`):
   - `analysis.scoring.symbol_score_decay` | float | `0.5` | Geometric rank-decay γ for the feature-200
     symbol_score fold `Σ γ^i·(composite×strategy_weight)`; **read-clamped to `[0, 0.99]`** in
     `_compute_opportunities` (γ≥1 would invert the `@AC-3` saturation ordering). Read via
     `get_float_present` (a configured `0` legitimately collapses the fold to the top term). Code-default
     only (not config-ui-seeded).
   - `analysis.scoring.strategy_weight_floor` | float | `0.5` | Affine grade-weight floor for
     `strategy_weight = floor + (1−floor)·overall_score`; also the neutral weight for a
     provisional/absent/unattributed grade (never 0, so an unproven strategy's opportunity still
     contributes — FR-4/`@AC-7`). Read via `get_float_present`. Code-default only.
2. Per the CLAUDE.md teardown rule, this edits a context file — run
   `/context-forge:context-constitution refresh` scoped to the analysis CLAUDE.md before the PR (or
   record the manual reconciliation if the plugin is unavailable).

**Verification**:
```
grep -n "analysis.scoring.symbol_score_decay\|analysis.scoring.strategy_weight_floor" services/xstockstrat-analysis/CLAUDE.md
```
Both rows present with defaults `0.5`/`0.5` and the `get_float_present` / code-default note.

---

### Step 7 — service: agent `list_opportunities` projects `symbol_score`

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape)
and `mcp-tools.md` parity; omit-not-fabricate projection contract

**Codebase Evidence**:
- `_opportunity_to_dict` confirmed at `client.py:751`; feature-199's `composite_score` projection is
  the exact omit-on-unset precedent: `if o.HasField("composite_score"): d["composite_score"] =
  o.composite_score` (`client.py:803-806`).
- `list_opportunities` does not set `sort` today (recon `client.py:802-833`) — no sort change needed;
  AC-9 is satisfied by projecting the field so the agent can compare symbols.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
1. In `_opportunity_to_dict` (`client.py:751`), after the `composite_score` block (`:803-806`), add the
   same omit-on-unset projection: `if o.HasField("symbol_score"): d["symbol_score"] = o.symbol_score`
   (raw float, omit when unset — `@AC-15 @feature-095` omit-not-fabricate).
2. No new outbound gRPC call added (reuses the existing `ListOpportunities` client path) — header
   propagation unaffected.

**Verification**: lint + the parity assertion live in the paired Step 8.

---

### Step 8 — test: agent descriptor-parity + symbol_score projection

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_opportunity_projection.py` — modify

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability, descriptor-parity guard

**Codebase Evidence**:
- Descriptor-parity test confirmed: `test_opportunity_projection.py:50-51` asserts
  `set(_opportunity_to_dict(...)) == set(Opportunity.DESCRIPTOR.fields_by_name)`; `_full_opportunity`
  sets every field incl. `composite_score=0.512` (`:39`), and `test_composite_score_projected_with_value_and_omitted_when_unset`
  (`:64`) is the value/omit precedent.
- C-13: the `_full_opportunity` builder is the single in-test fixture — extend it, no new home needed.

**TDD**: `red-green required`

**Covers**: `AC-9`

**Instructions**:
1. Add `symbol_score=…` to `_full_opportunity` so the descriptor-parity assertion at `:51` covers the
   new field (this is the EXTEND `@AC-10 @feature-185` descriptor-parity guard — the test fails until
   Step 7 projects it).
2. Add a `symbol_score` value-and-omit test mirroring `test_composite_score_projected_with_value_and_omitted_when_unset`
   (`:64`): projected when `HasField` is set (**`@AC-9`** — AAPL 0.62 > MSFT 0.48 comparability),
   omitted when unset.
3. Author both to fail against the pre-Step-7 tree (P-06).

**Verification**:
```
cd services/xstockstrat-agent && ruff check . && ruff format --check . && pytest --cov=app --cov-fail-under=40
```
New assertions pass and total coverage ≥ 40%. _(xstockstrat-agent **is** in the `python-test`
matrix with a 40% CI coverage gate — `.github/workflows/ci.yml:346-348,372-375`,
`docs/patterns/ci-overview.md:16` — so the whole-suite `--cov-fail-under=40` run reproduces the
real gate; the targeted `test_opportunity_projection.py` file is where the new assertions live.)_

---

### Step 9 — docs: `mcp-tools.md` `list_opportunities` symbol_score parity

**Status**: `pending`
**Service**: `docs/runbooks/`
**Files**:
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `list_opportunities` section confirmed at `mcp-tools.md:858`; the `composite_score` field entry
  ("shrunk 0–1 ranking ordinal") is at `mcp-tools.md:885` — the sibling entry to mirror. The
  descriptor-parity + `mcp-tools.md` same-PR rule is `fails.md:1151` / `@AC-10 @feature-185`.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. In the `list_opportunities` return-field list, add a `symbol_score` entry beside `composite_score`
   (`:885`): the **bounded (`< 2.0`) symbol-level ranking ordinal** rolling up the symbol's
   opportunities; omitted when the symbol has no score-eligible opportunity; NOT a cardinal
   sizing/alert input. Same PR as Step 7 (agent contract parity).

**Verification**:
```
grep -n "symbol_score" docs/runbooks/mcp-tools.md
```
Entry present in the `list_opportunities` section.

---

### Step 10 — service: UI `/insights` symbol_score sort option + group-header render

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify
- `services/xstockstrat-ui/e2e/fixtures/opportunities.ts` — modify (add `symbolScore` to fixtures)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (catalog note)

**Reviewers**: xstockstrat-ui owner — analytics display accuracy, Connect-RPC call safety, no client
re-sort (server order authoritative)

**Codebase Evidence**:
- `SortKey` union `'conviction' | 'expiry'` at `page.tsx:52`; sort `Select` at `page.tsx:260-268`
  (Conviction / Soonest expiry only); UI→enum map `sortEnum = sortKey === 'expiry' ?
  OpportunitySort.EXPIRY : OpportunitySort.CONVICTION` at `page.tsx:100-101`. `useOpportunities` threads
  `sort` server-side (`useOpportunities.ts:27,36`); `insightsBff` forwards it transparently.
- Typed-client data shape: `page.tsx:192` maps `compositeScore: o.compositeScore` — the pattern for a
  new `symbolScore: o.symbolScore` if the mobile section needs it.
- `SymbolGroupCard` at `page.tsx:382`; its header row (`page.tsx:409-421`) renders the symbol link +
  signal count — the insertion point for the symbol_score value; it receives `opps: Opportunity[]`, and
  symbol_score is symbol-uniform, so read `opps[0]?.symbolScore`.
- Number formatter: `formatComposite(score) => score.toFixed(3)` at `scoreDisplay.ts:32-33` (a plain
  3-decimal format with **no** color) — reuse it for the number (C-18 DRY). **Do NOT wrap in
  `scoreColor`** — design.md § Consumer surfaces: symbol_score is a bounded `[0,<2)` ordinal on a
  non-`[0,1]` scale, so `scoreColor`'s `[0,1]` thresholds do not apply (the recon `scoreColor`
  suggestion is a rejected bug).
- Existing `OPPORTUNITIES` fixture (`e2e/fixtures/opportunities.ts`) already carries feature-199
  `compositeScore` on AAPL/MSFT (INVENTORY.md:28) — extend those rows with `symbolScore` (C-12).

**TDD**: `red-green required` (paired Step 11 e2e is the RED→GREEN proof)

**Covers**: —

**Instructions**:
1. Extend `SortKey` (`page.tsx:52`) to `'conviction' | 'expiry' | 'symbolScore'`; add a third
   `SelectItem value="symbolScore"` ("Sort · Symbol score") to the sort `Select` (`page.tsx:260-268`);
   extend the `sortEnum` map (`:100-101`) so `sortKey === 'symbolScore'` →
   `OpportunitySort.SYMBOL_SCORE`. Sorting stays **server-side** (`useOpportunities` forwards `sort`);
   the client does not re-sort groups (`@AC-15 @feature-190`).
2. In `SymbolGroupCard`'s header (`page.tsx:409-421`), when the active sort is symbol_score render the
   symbol's `symbol_score` as a plain 3-decimal number via `formatComposite(opps[0].symbolScore)`
   (em-dash when unset), NOT `scoreColor`. Pass the current sort into `SymbolGroupCard` (a
   `showSymbolScore` boolean prop is the minimal wiring) so the value renders **only under the
   symbol_score sort** (design.md). Give the value a `data-testid` (e.g. `symbol-score-${symbol}`) and
   ensure the header keeps a unique accessible name (C-17).
3. Add `symbolScore` to the AAPL/MSFT rows in the `OPPORTUNITIES` fixture (`e2e/fixtures/opportunities.ts`)
   with values that make AAPL rank above MSFT (e.g. AAPL 1.20, MSFT 1.00 — matching the design worked
   numbers); leave a NULL/absent case (e.g. a symbol with no `symbolScore`) for the em-dash + NULLS-LAST
   path. Add an `INVENTORY.md` note (feature 200) to the Opportunity queue row.

**Verification**: lint + e2e in the paired Step 11.

---

### Step 11 — test: UI e2e symbol_score sort + header render

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify

**Reviewers**: xstockstrat-ui owner — analytics display accuracy, server-order authoritative

**Codebase Evidence**:
- `opportunities.spec.ts` is the existing `/insights` queue e2e (INVENTORY.md:28 lists it as the
  consumer of `OPPORTUNITIES` + the stateful `ListOpportunities` mock); the `listOpportunities` handler
  in `e2e/mock-backend.ts` returns the fixture rows and honors request `sort`.
- C-12: the spec imports fixtures from `e2e/fixtures` and auth from `e2e/helpers/auth.ts` — reuse, no
  inline domain literals.

**TDD**: `red-green required`

**Covers**: `AC-8`

**Instructions**:
1. Add a spec: selecting "Sort · Symbol score" refetches server-side (no client transform,
   `@AC-14 @feature-190`) and the `SymbolGroupCard` groups render in **descending server-returned**
   `symbol_score` order — AAPL above MSFT (**`@AC-8`**); assert the client does not reorder locally
   (server order authoritative).
2. Assert the group header shows the plain 3-decimal `symbol_score` (via the `data-testid` from Step
   10) only under the symbol_score sort, and an em-dash for the NULL-symbol_score symbol.
3. Author to fail against the pre-Step-10 tree (P-06 — the sort option and header value do not exist
   yet).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint && pnpm test:e2e -- opportunities
```
The new symbol_score sort + header assertions pass. _(xstockstrat-ui has no CI coverage threshold —
Playwright e2e is the gate.)_

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
