# Implementation Spec: opportunity-composite-score

**Status**: `pending`
**Created**: 2026-09-20
**Feature**: `docs/roadmap/features/199-opportunity-composite-score/feature.md`
**Total Steps**: 11
**Feature Branch**: `feature/opportunity-composite-score`

---

## Execution Summary

Land the wire contract first (proto field `21` + regen), then the storage (migration `024`),
then the analysis compute (config-key reads → pure fusion `_composite_score` → wire into
`_row_for`/heal path → persist on the two write paths + read/project), then the two named
consumer surfaces (agent `list_opportunities` projection, UI `/insights` queue + `/trader` panel),
each with its paired test. The cardinal-guard (fails.md:313 next-occurrence guard) lands as a
proto doc-comment (Step 1) plus a durable `ANALYSIS-10` invariant (Step 7). Ordering is driven by
the descriptor-parity constraint: once Step 2 regenerates stubs, the agent parity test
(`test_opportunity_projection.py`) goes RED until Step 8/9 project the new field — this is the
intended red-before-green gate, not a defect.

**Consumer surfaces (C-14)** — product spec names **UI** (`/insights` + `/trader`) and **Agent**
(`list_opportunities`). Both are covered: agent by Steps 8/9, UI by Steps 10/11. Neither is a new
route, so no `PLATFORM_SUBNAV` registration is needed (both routes already registered — recon.md,
design.md §Consumer surfaces). No surface is deferred.

### Scenario Coverage (C-15)

| Scenario | Covered by step(s) |
|---|---|
| `@AC-1` (persisted alongside axes) | Step 6 (repo persistence round-trip) |
| `@AC-2` (shrinkage blend) | Step 6 |
| `@AC-3` (absent axis → zero weight) | Step 6 |
| `@AC-4` (present-but-contradicted pull-down) | Step 6 |
| `@AC-5` (direction agree > conflict) | Step 6 |
| `@AC-6` (both axes, own weights) | Step 6 |
| `@AC-7` (determinism) | Step 6 |
| `@AC-8` (queue renders 3-decimal + scoreColor, no client re-sort) | Step 11 (Playwright) |
| `@AC-9` (reaches `list_opportunities`) | Step 9 |
| `@AC-10` (never-computed → NULL) | Step 6 (repo NULL read-back) |
| `@AC-11` (data-unavailable → NULL, em-dash) | Step 6 (NULL compute) + Step 11 (em-dash render) |
| `@AC-12` (muted 0/0 → NULL) | Step 6 |

## Step Dependencies

- Step 2 (`proto-gen`) requires Step 1 (`proto`) — stubs regenerate from the edited `.proto`.
- Step 5 (analysis service) requires Step 2 (generated `composite_score` field exists), Step 3
  (column exists to persist into) and Step 4 (config keys documented).
- Step 6 (analysis test) pairs Step 5 (red-before-green).
- Step 8 (agent service) requires Step 2. **After Step 2 and before Step 8**, the existing agent
  parity test `test_opportunity_projection_covers_every_proto_field` is RED (descriptor gained field
  21, projection has not) — this is the intended RED for Step 9; do not "fix" it before Step 8.
- Step 9 (agent test) pairs Step 8.
- Step 10 (UI service) requires Step 2 (typed `compositeScore` on the generated `Opportunity`).
- Step 11 (UI test) pairs Step 10.
- Step 7 (`docs`) is independent; land it in the analysis PR alongside Step 5.
- **Rebase re-derivation (design Open Risk)**: proto field `= 21` and migration `= 024` were
  re-confirmed against the current tree at spec time (proto max `data_unavailable = 20`
  `analysis.proto:592`; migration tip `023_opportunity_compute_state`). Soft same-file overlap with
  features 187 (`opportunities.py` read ORDER BY), 193 (`_compute_opportunities` body), 188
  (`OpportunityRow` markup) — re-confirm both numbers and the cited line anchors after any rebase.
- **Line-anchor re-derivation (covers the impl-spec review's anchor-drift warning).** Every
  `path:line` in the step bodies below was verified against the tree at spec time, but a few drift by
  1–3 lines against the live checkout and *will* drift again once 187/193/188 land. All symbol names
  are real and current; the line numbers are navigational hints only. `/sdd-execute`'s mandatory
  per-step codebase-discovery **re-anchors every cited line before writing** — do not treat a 1–3 line
  offset as a defect, and re-grep the symbol (not the number) at execute time.

---

### Step 1 — proto: Add `composite_score` field to `Opportunity` with cardinal-guard comment

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field-number uniqueness per message, additive-only, `buf breaking` passes; `xstockstrat-analysis` (service owner) — `Opportunity` contract

**Codebase Evidence**:
- `Opportunity` message spans `analysis.proto:558-593`; existing fields end at `bool data_unavailable = 20;` (`:592`) → **next free = 21** (confirmed by reading the message, not guessed).
- Optional-double presence convention already used: `optional double signal_confidence = 19;` (`:588`) and the `13-18` live-market block (`:577-582`).
- The `conviction = 3` doc-comment (`:555-557`) is the template for the "NOT a probability" cardinal guard: `conviction is a deterministic ordinal (passing/total leaves + normalized worst-distance-to-threshold), NOT a probability`.

**TDD**: `N/A (proto)`

**Covers**: `—`

**Instructions**:
- Add, immediately after `bool data_unavailable = 20;` (`:592`) and before the closing brace of `Opportunity`:
  ```proto
  // feature 199 — a single shrunk 0–1 ranking ordinal fusing readiness + directional signal
  // (empirical-Bayes over the two axes present at compute; NULL/unset = nothing to fuse). Like
  // conviction=3 it is NOT a probability and NEVER a cardinal sizing/alert/risk input — that is
  // ExternalSignal.conviction (ingest.proto:110). Explicit-presence: unset = not-yet/nothing-to-fuse.
  optional double composite_score = 21;
  ```
- Do not renumber any existing field; do not change any type.

**Verification**:
- `cd packages/proto && buf lint && buf breaking --against ".git#branch=feature/opportunity-composite-score"` — both pass (additive-only).
- `grep -n "composite_score = 21" packages/proto/analysis/v1/analysis.proto` — confirms the field at number 21.

---

### Step 2 — proto-gen: Regenerate stubs and commit `gen/`

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/` — modify (generated Go / Python / TS stubs; never hand-edit)

**Reviewers**: Proto Reviewer — field-number uniqueness per message, additive-only, `buf breaking` passes; `xstockstrat-analysis` (service owner) — `Opportunity` contract _(inherited from Step 1)_

**Codebase Evidence**:
- Root CLAUDE.md § Generating Proto Stubs: run `./scripts/buf-gen.sh`, commit `packages/proto/gen/`.
- Generated stubs are checked in and consumed by analysis (`gen/python`), agent (`gen/analysis/v1/analysis_pb2`), and UI (typed `Opportunity` via `gen/ts`).

**TDD**: `N/A (proto-gen)`

**Covers**: `—`

**Instructions**:
- Run `./scripts/buf-gen.sh` from repo root.
- Stage the full `packages/proto/gen/` diff (Go, Python, TS + compiled `gen/ts/dist/`).
- _(The `**Files**` entry is a directory intentionally: `buf generate` rewrites the whole `gen/` tree across all three languages — there is no single-file target. Correctness is gated by the empty-diff freshness re-run in Verification, not by enumerating individual generated files; never hand-edit any file under `gen/`.)_

**Verification**:
- `./scripts/buf-gen.sh && git status --porcelain packages/proto/gen/` — the only diff is the added `composite_score` accessors; a second `./scripts/buf-gen.sh` leaves `git diff packages/proto/gen/` empty (freshness).

---

### Step 3 — migration: Add nullable `composite_score` column to `analysis.opportunities`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/migrations/024_opportunity_composite_score.up.sql` — create
- `services/xstockstrat-analysis/migrations/024_opportunity_composite_score.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps), up+down pair present, column additivity; `xstockstrat-analysis` (service owner) — schema ownership

**Codebase Evidence**:
- `ls services/xstockstrat-analysis/migrations/` — last file is `023_opportunity_compute_state.{up,down}.sql` → **next-free = 024** (confirmed by listing the dir). NOTE (corrects an earlier imprecise "drift" claim in recon.md:71): the `026`/`027`/`028` migrations named in `services/xstockstrat-analysis/CLAUDE.md` are **config-service** seed migrations (`services/xstockstrat-config/migrations/026_analysis_engine_blend_keys` … `028_analysis_opportunity_keys`, verified present) that seed `analysis.*` **config keys** — a *different* `migrations/` dir from the analysis-service **schema** migrations here. They are NOT analysis-service migrations and NOT drift; `024` is the correct, uncontested next-free schema migration for this table.
- `analysis.opportunities` DDL: `migrations/011_opportunities.up.sql` (`conviction DOUBLE PRECISION NOT NULL DEFAULT 0` :14, `signal_axis DOUBLE PRECISION NOT NULL DEFAULT 0` :16, `PK (user_id, opportunity_key)` :21).
- Column-add + `DROP TABLE`-inverse down pattern: `023_opportunity_compute_state.{up,down}.sql`.

**TDD**: `N/A (migration)`

**Covers**: `—`

**Instructions**:
- `024_opportunity_composite_score.up.sql`:
  ```sql
  -- Migration: 024_opportunity_composite_score.up.sql
  -- Service: xstockstrat-analysis
  -- feature 199 — nullable composite ranking ordinal per opportunity row. NULLABLE with NO DEFAULT:
  -- NULL is the honest "not yet computed / nothing to fuse" state (@AC-10/@AC-11/@AC-12), distinct
  -- from a computed neutral 0.5. Additive to the feature-011 table; conviction/signal_axis untouched.
  ALTER TABLE analysis.opportunities ADD COLUMN IF NOT EXISTS composite_score DOUBLE PRECISION;
  ```
- `024_opportunity_composite_score.down.sql`:
  ```sql
  -- Migration: 024_opportunity_composite_score.down.sql
  ALTER TABLE analysis.opportunities DROP COLUMN IF EXISTS composite_score;
  ```
- Do **not** add `NOT NULL` or a `DEFAULT` — NULL must remain a legitimate persisted value (F-01: never edit an applied migration; this is a new numbered one).

**Verification** (offline, no DB):
- `ls services/xstockstrat-analysis/migrations/024_opportunity_composite_score.up.sql services/xstockstrat-analysis/migrations/024_opportunity_composite_score.down.sql` — both exist with the next-free `024` prefix.
- Read both: the `.up` `ADD COLUMN composite_score` is reversed by the `.down` `DROP COLUMN composite_score`; column is nullable (no `NOT NULL`, no `DEFAULT`).

---

### Step 4 — config: Document the three `analysis.scoring.composite_*` keys and defaults

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify (Config Keys Consumed table)

**Reviewers**: `xstockstrat-analysis` (service owner) — config-key defaults declared in CLAUDE.md; `xstockstrat-config` (service owner) — config key naming (`<service>.<category>.<key>`), env/global-per-user scoping

**Codebase Evidence**:
- Config Keys Consumed table at `services/xstockstrat-analysis/CLAUDE.md:275+`; sibling `analysis.scoring.*` rows at `:288-294` (`sharpe_weight`, `shrinkage_days`, `signal_decay_half_life_hours`).
- Precedent for `get_float_present` (honors a configured `0`): `signal_decay_half_life_hours` row (`:294`).
- Design §"k and weights (config defaults)": **three** keys only (the two dropped `composite_weight_fundamentals`/`composite_weight_technical` from product-spec are cut with the 2-axis FR-5 change), defaults `k = 1.0`, `w_readiness = w_signal = 1.0`.

**TDD**: `N/A (config)`

**Covers**: `—`

**Instructions**:
- Add three rows to the `## Config Keys Consumed` table:
  - `analysis.scoring.composite_shrinkage_k` — float — `1.0` — Empirical-Bayes pseudo-count `k` for the per-opportunity `composite_score` fusion `(Σwᵢ·sᵢ + 0.5·k)/(Σwᵢ + k)` (feature 199). Equals one axis-weight so a single maxed axis lands at 0.750, a corroborated pair at 0.833. Read via `get_float_present` (a configured `0` disables shrinkage honestly; the `get_float` zero-trap would swallow it).
  - `analysis.scoring.composite_weight_readiness` — float — `1.0` — Fusion weight `wᵢ` for the readiness sub-score (identity map of `conviction`). `get_float_present`; a configured `0` disables the readiness axis.
  - `analysis.scoring.composite_weight_signal` — float — `1.0` — Fusion weight `wᵢ` for the directional-signal sub-score. `get_float_present`; a configured `0` disables the signal axis.
- Note in the row text that these are **not** seeded by a config-ui migration (design §Rejected: matches the un-seeded sibling `analysis.scoring.*` keys — code-default-only via `get_float_present`).

**Verification**:
- `grep -n "composite_shrinkage_k\|composite_weight_readiness\|composite_weight_signal" services/xstockstrat-analysis/CLAUDE.md` — all three rows present with defaults `1.0` and `get_float_present`.

---

### Step 5 — service: Compute + persist `composite_score` on the opportunity write + heal paths

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/repositories/opportunities.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Candidate dict init: `_candidate` closure `servicer.py:3966-3980` (`"signal_axis": 0.0`, `"best_direction": ""`, `"_best_sig_conv": -1.0`).
- Per-signal decay + direction fold: `sig_contribs.append((sig, effective_conviction))` `servicer.py:4088`; the `for key in targets: c = candidates[key]: for sig, effective_conviction in sig_contribs:` fold maxes `c["signal_axis"]` (`:4094`) and picks `best_direction` from **raw** `sig.conviction` (`:4095-4097`).
- `_signal_decay(sig, source_weights, now_utc, half_life)` → `(effective_conviction, …)` `servicer.py:4926`; `source_weights.get(sig.source, 1.0)` can exceed 1 under operator override (`:4081`).
- half_life read once per pass: `self._cfg.get_float_present("analysis.scoring.signal_decay_half_life_hours", 24.0)` `servicer.py:3886`.
- `_row_for` closure `servicer.py:4253`; `sym_unavailable = evaluated and sym in fetch_failed` `:4323`; the return dict `:4326-4336` zeroes both axes (`"conviction": 0.0 if sym_unavailable else readiness["conviction"]` :4332, `"signal_axis": 0.0 if sym_unavailable else c["signal_axis"]` :4334); `readiness["total_conditions"]` available (`:4294`).
- Heal path: `_retry_unavailable_symbols` `servicer.py:3671`; re-drains signals and rebuilds `signal_axis` via `_signal_decay` (`:3699-3713`) then calls `replace_symbols`.
- EB shape to reuse-by-shape (NOT extract — ANALYSIS-2 binding path): `_aggregate_cells` `servicer.py:5187-5226` (`overall = (Σwᵢ·sᵢ + 0.5·k)/(Σwᵢ + k)`, `Σw <= 0 → None`).
- Read/project: `read()` SELECT columns `opportunities.py:180-183` (`o.conviction, o.readiness_json, o.signal_axis, …`); INSERT `replace_for_user` `opportunities.py:81-97`; UPDATE `replace_symbols` `opportunities.py:120-145`; proto mapping `_row_to_opportunity` `servicer.py:4996-5049` (optional-field pattern: `signal_confidence = readiness.get(...); if ... is not None: opp.signal_confidence = float(...)` `:5045-5047`).
- `get_float_present` getter `app/config/watcher.py:132`.

**TDD**: `red-green required`

**Covers**: `—` _(behavioral coverage asserted in Step 6)_

**Instructions**:
- **Pure fusion fn** — add a module-level `def _composite_score(scored: list[tuple[float, float]], k: float) -> float | None:` near `_aggregate_cells` (`servicer.py`), inlined (design §"Fusion formula" — do not extract `_aggregate_cells`): `scored` is `[(wᵢ, sᵢ), …]`; `total_w = sum(w for w, _s in scored)`; `if total_w <= 0: return None`; `return (sum(w*s for w,s in scored) + 0.5*k) / (total_w + k)`. Docstring must state: `composite_score` is a ranking ordinal, `Σw <= 0 → None` (never a computed 0.5), and that a **present** sub-score of 0.0 is an active pull-down (weight counted), distinct from an absent axis (weight omitted).
- **Readiness sub-score (identity map)**: `s_readiness = readiness["conviction"]`; **present iff** `readiness["total_conditions"] > 0` (design §Presence predicate — never key on `s_readiness > 0`).
- **Signal sub-score (direction-scoped multiplicative attenuation)**: carry a new `"_composite_sig_contribs": []` on the candidate dict (init in `_candidate` `servicer.py:~3979`), and in the existing fold (`servicer.py:~4092`, alongside the `signal_axis` max) append `c["_composite_sig_contribs"].append((sig.direction, effective_conviction))` — the local `sig_contribs` is not visible in `_row_for`. In `_row_for`, compute against `c["best_direction"]` (raw-conviction anchor, unchanged): `max_agree` = max `effective` among contribs whose `direction == c["best_direction"]`; `max_conflict` = max `effective` among the opposing tradeable direction (`buy`↔`sell`; `hold`/`""` contribute to neither); `s_signal = clamp(max_agree,0,1) * (1 - clamp(max_conflict,0,1))`. **present iff** `c["_composite_sig_contribs"]` is non-empty (equivalently `c["_best_sig_conv"] >= 0.0`) — never `s_signal > 0`.
- **Config reads (once per pass, deterministic)**: alongside the half_life read (`servicer.py:~3886`), read `k = self._cfg.get_float_present("analysis.scoring.composite_shrinkage_k", 1.0)`, `w_readiness = get_float_present("analysis.scoring.composite_weight_readiness", 1.0)`, `w_signal = get_float_present("analysis.scoring.composite_weight_signal", 1.0)`; close over them into `_row_for` the same way `half_life` is closed over. Never hardcode (F-07).
- **Compute site (before axis-zeroing)**: in `_row_for`, compute `composite` **against the real `readiness`/`c` before the `sym_unavailable` axis-zeroing** (`servicer.py:~4326`). Build `scored = []`; if readiness present append `(w_readiness, s_readiness)`; if signal present append `(w_signal, s_signal)`. If `sym_unavailable`, force **both** absent (empty `scored`) so `_composite_score` returns `None` (design §Presence predicate: `sym_unavailable` → `Σw = 0` → NULL, preserving "unavailable ≠ evaluated-low"). Add `"composite_score": _composite_score(scored, k)` to the return dict (`:4326-4336`) — a `float | None`.
- **Persist**: add `composite_score` to `replace_for_user` INSERT column list + VALUES + tuple (`opportunities.py:81-97`) as `r.get("composite_score")` (pass `None` straight through — nullable column), and to the `replace_symbols` UPDATE `SET` + tuple (`opportunities.py:120-145`).
- **Heal parity**: in `_retry_unavailable_symbols` (`servicer.py:3671`), after rebuilding `signal_axis`, recompute the composite through the **same** `_composite_score`, deriving `best_direction` from **raw** conviction to match the main path (design Open Risk: heal must anchor on raw conviction), and include it on the healed row dict passed to `replace_symbols`.
- **Read + project**: add `o.composite_score` to the `read()` SELECT column list (`opportunities.py:180-183`); in `_row_to_opportunity` (`servicer.py:4996`) map it with the optional-presence pattern: `composite = row.get("composite_score"); if composite is not None: opp.composite_score = float(composite)` (never fabricate 0.0 on NULL).

**Verification**:
- Behavioral + coverage in Step 6.
- `grep -n "composite_score" services/xstockstrat-analysis/app/repositories/opportunities.py` — present in INSERT, UPDATE, and SELECT.
- Lint: `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`
- Header propagation: no new outbound gRPC call is added (compute is in-path arithmetic on already-drained signals/config) — nothing to propagate; confirmed no new `stub.`/`grpc` call in the diff.

---

### Step 6 — test: Fusion math, NULL boundary, determinism, presence, direction, heal parity

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_composite_score.py` — create
- `services/xstockstrat-analysis/tests/test_opportunities_repo.py` — modify

**Reviewers**: `xstockstrat-analysis` (service owner) — strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Pure-fn + repo tests live under `tests/`; repo round-trip precedent `tests/test_opportunities_repo.py`; refresh/heal precedent `tests/test_opportunity_refresh.py`, `tests/test_opportunity_compute_state.py`.
- `tests/conftest.py` exists (C-13 canonical Python fixture home already present).
- pytest coverage config: analysis threshold **40%** (spec-template coverage table).

**TDD**: `red-green required` — assert the new behavior; runs RED before Step 5.

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7, AC-10, AC-11, AC-12`

**Instructions**:
- `test_composite_score.py` (pure `_composite_score` + sub-score helpers):
  - `AC-2`: `_composite_score([(1.0, 0.90), (1.0, 0.70)], 1.0) == pytest.approx(0.700, abs=5e-4)`.
  - `AC-3`: absent signal → `_composite_score([(1.0, 0.80)], 1.0) == approx(0.650)` and `> 0.0` (weight omitted, not `s=0`).
  - `AC-4`: present-but-contradicted signal → `_composite_score([(1.0, 0.80), (1.0, 0.0)], 1.0) == approx(0.433)`, and assert it is **strictly less** than the `AC-3` `0.650` (present-contradicted ranks below absent).
  - `AC-5`: signal sub-score attenuation — agree-only `0.70*(1-0.0)=0.70` → composite `(0.80+0.70+0.5)/3 == approx(0.667)`; conflict `0.70*(1-0.50)=0.35` → `(0.80+0.35+0.5)/3 == approx(0.550)`; assert `0.667 > 0.550`.
  - `AC-6`: distinct weights — `_composite_score([(2.0, 0.90), (1.0, 0.70)], 1.0) == approx(0.750)` (proves weight 2.0 is applied; weight 1.0 would yield 0.700).
  - `AC-10`/`AC-12`: `_composite_score([], 1.0) is None` (Σw = 0 → NULL, never 0.5).
  - Presence-predicate + direction unit cases: `hold`/`""` direction contributes to neither agree nor conflict (`max_conflict = 0`); operands clamped when `effective > 1`.
  - Document (comment) the intended **anchor/measure split** (raw `best_direction`, decayed agree/conflict) so a future reviewer does not "fix" it (design Open Risk).
- `test_opportunities_repo.py` (persistence round-trip, against the migrated table):
  - `AC-1`: `replace_for_user` a row with `conviction=0.80, signal_axis=0.60, composite_score=<in [0,1]>`; `read()` back → `composite_score` present in `[0,1]` **and** `conviction == 0.80` and `signal_axis == 0.60` (axes independently queryable, unchanged).
  - `AC-10`: a row persisted with `composite_score=None` reads back NULL (not 0.5, not 0.0).
  - `AC-11`: a `sym_unavailable`/data-unavailable row (both axes zeroed) persists `composite_score=None` — assert NULL on read-back, never a signal-only or `0.167` value.
  - `AC-7` (determinism): compute the composite twice on the refresh path for a fixed input+config → identical value; and assert the value is unchanged whether or not read-time live enrichment (`_enrich_opportunities_live`) ran (composite is a write-time column — executable assertion, not prose).
  - Heal parity: a **mixed-direction** (buy+sell present) symbol healed via `_retry_unavailable_symbols`/`replace_symbols` recomputes+repersists the composite (not stale/NULL), anchoring `best_direction` on raw conviction (design Open Risk).

**Verification**:
- `cd services/xstockstrat-analysis && pytest tests/test_composite_score.py tests/test_opportunities_repo.py tests/test_opportunity_refresh.py -q` — all pass after Step 5, and the AC-marked assertions FAIL when run before Step 5 (red-before-green).
- `cd services/xstockstrat-analysis && pytest --cov=app --cov-fail-under=40` — coverage gate passes.
- Lint: `cd services/xstockstrat-analysis && ruff check . && ruff format --check .`
- Test-data (C-13): new domain literals have a single consumer (these test modules) → inline is compliant; no second copy introduced (`tests/conftest.py` unchanged unless a fixture gains a second consumer).

---

### Step 7 — docs: Add `ANALYSIS-10` cardinal-guard invariant

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/docs/context-constitution.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Existing invariants `ANALYSIS-1 … ANALYSIS-9` in `services/xstockstrat-analysis/docs/context-constitution.md` (table rows `:17-24`); next id = **ANALYSIS-10**.
- ANALYSIS-2 already names the EB formula (`:18`); the new invariant is the *cardinal-vs-ordinal* guard (design §Cardinal guard, part (b)).
- The trap being guarded: `fails.md:313` (conviction ordinal proposed as a confidence input); `ExternalSignal.conviction` is the correct 0–1 confidence producer (`ingest.proto:110`).

**TDD**: `N/A (docs)`

**Covers**: `—`

**Instructions**:
- Add an `ANALYSIS-10` row: `composite_score` (feature 199) is a **shrunk ranking ordinal, NOT a cardinal probability** — never wire it into position sizing, alert cutoffs, or any risk/expected-return input. The confidence-to-size producer is `ExternalSignal.conviction` (`ingest.proto:110`), surfaced as `Opportunity.signal_confidence` (`analysis.proto:588`). Cite the fusion (`_composite_score`, `servicer.py`) and the `fails.md:313` next-occurrence rationale.
- This edits a context-constitution file → the CLAUDE.md teardown audit applies (run `/context-forge:context-constitution refresh` scoped to this file before the PR, or record the manual reconciliation in the PR body).

**Verification**:
- `grep -n "ANALYSIS-10" services/xstockstrat-analysis/docs/context-constitution.md` — the invariant is present and names `ExternalSignal.conviction` as the correct producer.

---

### Step 8 — service: Project `composite_score` in the agent `list_opportunities` response

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/client.py` — modify
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — MCP tool contract stability (`list_opportunities` return shape), `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- `_opportunity_to_dict(o, analysis_pb2)` `services/xstockstrat-agent/app/client.py:747`; base dict `:754-768`; `HasField`-gated optionals `:770-798` (e.g. `if o.HasField("signal_confidence"): d["signal_confidence"] = o.signal_confidence` `:797-798`).
- `list_opportunities` return-shape doc: `docs/runbooks/mcp-tools.md:865-920` (the omit-not-fabricate list, `signal_confidence` at `:882`).

**TDD**: `red-green required`

**Covers**: `—` _(behavioral coverage asserted in Step 9)_

**Instructions**:
- In `_opportunity_to_dict`, add after the `signal_confidence` block (`client.py:~797`): `if o.HasField("composite_score"): d["composite_score"] = o.composite_score` — omit-not-fabricate on unset/NULL (matches the field's explicit-presence contract; never a fabricated 0.0).
- In `docs/runbooks/mcp-tools.md` `list_opportunities` return shape (the omit-not-fabricate bullet list, `:875-887`), add a `composite_score` bullet: the shrunk 0–1 ranking ordinal (feature 199); omitted when the row has nothing to fuse (NULL), never a fabricated `0.0`; a ranking aid, not a cardinal probability.

**Verification**:
- `grep -n "composite_score" services/xstockstrat-agent/app/client.py docs/runbooks/mcp-tools.md` — projected (HasField-gated) and documented.
- Lint: `cd services/xstockstrat-agent && ruff check . && ruff format --check .`
- Header propagation: no new outbound gRPC call (projection of an already-fetched message) — nothing to propagate.

---

### Step 9 — test: Agent descriptor-parity covers `composite_score`

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_opportunity_projection.py` — modify

**Reviewers**: `xstockstrat-agent` (service owner) — MCP tool contract stability, descriptor-parity

**Codebase Evidence**:
- Parity test `test_opportunity_projection_covers_every_proto_field` asserts `set(_opportunity_to_dict(...)) == set(Opportunity.DESCRIPTOR.fields_by_name)` `tests/test_opportunity_projection.py:50-52`.
- `_full_opportunity` builder populates **every** field so the projected key set is the union `tests/test_opportunity_projection.py:18-42` (e.g. `signal_confidence=0.9` `:37`).
- `test_guard_has_teeth` proves dropping a projected field breaks parity `:55-60`.

**TDD**: `red-green required` — after Step 2 (descriptor gained field 21) and before Step 8, this test is already RED; Step 9 adds the builder value that keeps it meaningful and asserts the added key.

**Covers**: `AC-9`

**Instructions**:
- Add `composite_score=0.512` to the `_full_opportunity(analysis_pb2)` proto builder (`:20-32`) so the full-field opportunity carries it (parity's union must include it).
- `AC-9`: add an explicit assertion that `_opportunity_to_dict(_full_opportunity(analysis_pb2), analysis_pb2)["composite_score"] == pytest.approx(0.512)`, and that a NULL/unset-composite opportunity omits the key (build an `Opportunity` without `composite_score` → `"composite_score" not in projected`).
- The existing `test_opportunity_projection_covers_every_proto_field` then passes only once Step 8's projection lands (the built-in RED gate).

**Verification**:
- `cd services/xstockstrat-agent && pytest tests/test_opportunity_projection.py -q` — RED before Step 8 (parity fails: descriptor has `composite_score`, projection does not), GREEN after.
- `cd services/xstockstrat-agent && pytest --cov=app --cov-fail-under=40` — coverage gate passes.
- Lint: `cd services/xstockstrat-agent && ruff check . && ruff format --check .`
- Test-data (C-13): the `_full_opportunity` literal has a single consumer (this test module) → inline is compliant.

---

### Step 10 — service: Render `composite_score` on `/insights` queue + `/trader` panel

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/scoreDisplay.ts` — modify (add 3-decimal formatter)
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify (`OpportunityRow` metric cell + mobile `SignalRow` map)
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify (`OpportunitySection`)
- `services/xstockstrat-ui/e2e/fixtures/opportunities.ts` — modify (add `compositeScore` to fixtures)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (update the Opportunity queue catalog row)

**Reviewers**: `xstockstrat-ui` (service owner) — analytics display accuracy, Connect-RPC call safety, no secret values rendered

**Codebase Evidence**:
- `scoreColor(score)` (thresholds 0.8/0.6 → `text-buy`/`text-paper`/`text-destructive`) `src/lib/scoreDisplay.ts:13-17`; **no 3-decimal formatter exists** (only `formatSymbolYears` `.toFixed(1)` `:24-26`).
- `OpportunityRow` metric grid `src/app/insights/opportunities/page.tsx:483-522` (Conviction cell `:485-494`, Readiness cell w/ `dataUnavailable` em-dash-style unavailable cue `:496-522`).
- Mobile `SignalRow` mapping `src/app/insights/opportunities/page.tsx:170-182` (`conviction`, `readiness`, `dataUnavailable`, `caption`, `chips` …).
- Trader `OpportunitySection` `src/app/trader/positions/[symbol]/page.tsx:934-995` (Conviction `:949`, Edge (BT) `:977-985`).
- The field is generated as `compositeScore?: number` (Connect-JSON camelCase, `optional double`); BFF `listOpportunities` is a raw passthrough `src/lib/insightsBff.ts:54` — field auto-flows after Step 2 regen.
- Fixtures: `OPPORTUNITIES` array `e2e/fixtures/opportunities.ts:54+`; catalog row `e2e/fixtures/INVENTORY.md:28`.

**TDD**: `red-green required` _(paired e2e/vitest in Step 11)_

**Covers**: `—` _(behavioral coverage asserted in Step 11)_

**Instructions**:
- `scoreDisplay.ts`: add `export function formatComposite(score: number): string { return score.toFixed(3); }` (3-decimal, C-18 DRY — reuse `scoreColor` for the color, no new color logic). Use **design-role tokens only** via `scoreColor` (C-17 — no hardcoded hex).
- `OpportunityRow` (`page.tsx:~483`): add a third metric cell "Composite" after Readiness — when `o.compositeScore !== undefined`, render `formatComposite(o.compositeScore)` in a `<span className={scoreColor(o.compositeScore)}>` (mono, tabular-nums, matching the Conviction/Readiness value spans); when `undefined` (NULL), render an em-dash `—` (never `0.000`). Give the value span a `data-testid={\`opp-composite-${o.symbol}\`}`.
- Mobile `SignalRow` map (`page.tsx:~170`): add `compositeScore: o.compositeScore` to the mapped signal object and render it alongside the existing tags without regressing symbol grouping (design EXTEND `@AC-9/@AC-10 @feature-155`).
- Trader `OpportunitySection` (`positions/[symbol]/page.tsx:~949`): add a "Composite" stat next to Conviction — `opportunity.compositeScore !== undefined ? formatComposite(...)` colored via `scoreColor`, else em-dash.
- Do **not** change the queue sort or add any client-side sort by composite (design PRESERVE `@AC-15 @feature-190`; AC-8 "server order is authoritative").
- Fixtures (C-12): add `compositeScore` to a couple of existing `OPPORTUNITIES` rows (e.g. AAPL `0.732`, MSFT `0.512`) and leave one row's `compositeScore` unset + keep the PLTR `dataUnavailable:true` row with **no** `compositeScore` (drives the em-dash assertion). Update the `INVENTORY.md:28` Opportunity-queue row text to note the added `compositeScore` (feature 199) and which rows carry/omit it.

**Verification**:
- Behavioral in Step 11.
- `grep -n "compositeScore\|formatComposite" services/xstockstrat-ui/src/app/insights/opportunities/page.tsx services/xstockstrat-ui/src/app/trader/positions/\[symbol\]/page.tsx services/xstockstrat-ui/src/lib/scoreDisplay.ts` — rendered on all three surfaces.
- Lint: `cd services/xstockstrat-ui && pnpm run lint`

---

### Step 11 — test: vitest formatter + Playwright composite render (queue, trader, em-dash)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/scoreDisplay.test.ts` — modify (vitest unit)
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify (Playwright)
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify (Playwright)

**Reviewers**: `xstockstrat-ui` (service owner) — analytics display accuracy

**Codebase Evidence**:
- vitest unit home for `src/lib/**`: `src/lib/scoreDisplay.test.ts` exists (feature 065 vitest coverage scoped to `src/lib/**`).
- Playwright specs: `e2e/insights/opportunities.spec.ts` (stateful ListOpportunities/SetOpportunityAction mock), `e2e/trader/position-detail.spec.ts` (tabbed opportunity panel).
- Auth helpers: `addAuthCookie`/`addAdminCookie`/`addCookieWithRoles` `e2e/helpers/auth.ts:51-71` (new specs never re-sign JWTs).
- xstockstrat-ui has **no coverage threshold** (spec-template table) — vitest for the pure formatter, Playwright for the render.

**TDD**: `red-green required`

**Covers**: `AC-8, AC-11`

**Instructions**:
- `scoreDisplay.test.ts` (vitest): `expect(formatComposite(0.732)).toBe('0.732')`; `expect(formatComposite(0.5)).toBe('0.500')` (always 3 decimals); a quick `scoreColor` boundary reuse check (0.732 → `text-paper`) so the queue color assertion is grounded.
- `opportunities.spec.ts` (Playwright, `AC-8`): with the `OPPORTUNITIES` fixture (AAPL `compositeScore: 0.732`), `addAuthCookie`, load `/insights/opportunities`, assert `opp-composite-AAPL` shows `0.732` with the `scoreColor` class (`text-paper` at 0.732), assert **no** A–F letter grade text near it, and assert the queue order is unchanged when composite differs from conviction (server order authoritative — no client re-sort).
- `opportunities.spec.ts` (Playwright, `AC-11`): assert the PLTR `dataUnavailable:true` / no-`compositeScore` row renders the composite as an em-dash `—` (never `0.000`), without masking the existing "unavailable" cue.
- `position-detail.spec.ts` (Playwright): assert the trader `OpportunitySection` Composite stat renders the fixture value (and em-dash when unset), reusing the existing opportunity fixtures/auth helpers.
- Test-data (C-12): reuse `OPPORTUNITIES`/`CAPR_*` fixtures from `e2e/fixtures/` and `addAuthCookie` from `e2e/helpers/auth.ts` — no inline domain literals; the `compositeScore` values live in the fixture (Step 10), not the spec.

**Verification**:
- `cd services/xstockstrat-ui && pnpm test -- src/lib/scoreDisplay.test.ts` (vitest) — passes after Step 10, FAILS before (`formatComposite` undefined) — red-before-green.
- `cd services/xstockstrat-ui && pnpm test:e2e -- e2e/insights/opportunities.spec.ts e2e/trader/position-detail.spec.ts` — the composite/em-dash assertions FAIL before Step 10 and pass after.
- Lint: `cd services/xstockstrat-ui && pnpm run lint`
- `grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth" services/xstockstrat-ui/e2e/insights/opportunities.spec.ts services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — confirms fixture + auth-helper imports (no re-declared literals/JWTs).

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
