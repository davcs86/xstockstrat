# Implementation Spec: fix-analysis-admin-formula-refusal

**Status**: `pending`
**Created**: 2026-11-05
**Feature**: `docs/roadmap/features/289-fix-analysis-admin-formula-refusal/feature.md`
**Total Steps**: 14 (Step 8 is delivered as sub-steps 8a + 8b; numbering unchanged)
**Feature Branch**: `feature/fix-analysis-admin-formula-refusal`
**Tree**: `ccr-e5badadb-vrersi@a75d1916 ≡ origin/main-dev +32 unpushed (documented deviation: HEAD not on main-dev; feature branch not on origin; 289 artifacts exist only on this branch; user-accepted 2026-11-05)` (`git rev-list --left-right --count HEAD...origin/main-dev` → `32 0`: 32 ahead, 0 behind; the ahead commits are docs-only SDD artifacts)

---

## Execution Summary

The fix makes an indicators refusal of a formula the caller cannot read (`NOT_FOUND` or `PERMISSION_DENIED` on `ExecuteFormula`) a first-class "formula not readable" state on every analysis surface that traces readiness, via a private per-call sink in the traced evaluator (`design.md` § Chosen Approach). Build order follows `design.md`: proto (Steps 1-2, the generated stubs and the two descriptor-parity carries land together so the existing parity guards never go red on a step PR) → analysis read side (3-4) → evaluator sink (5-6) → servicer producer wiring incl. the global `_formula_fundamentals` classification (7, 8a/8b) → agent (9-10) → UI (11-12) → docs (13) → the deferred C-16 durable-suite promotion (14, integration PR only).

**Consumer surfaces (C-14).** The product spec names two surfaces and each has its own step: **UI** = Step 11 (service) + Step 12 (tests/fixtures/Playwright), touching `services/xstockstrat-ui/` (`/insights/opportunities`, mobile sections, `/insights/watchlists` readiness panel, `/trader/positions/[symbol]` "Why this fired" panel and header); **Agent** = Step 9 (service) + Step 10 (tests), touching `services/xstockstrat-agent/` (`list_opportunities`; the agent has no readiness tool). No new page/route, so the C-10(a) `PLATFORM_SUBNAV` registration does not apply.

**Test pairing (C-08, P-06).** Every non-frontend `service` step (3, 5, 7, 9) is followed immediately by its `test` step (4, 6, 8a+8b, 10), authored to fail first on the pre-implementation tree. The UI service step (11) is paired with Step 12 the same way. Step 2 is a `proto-gen` step that also carries the two one-line descriptor-parity edits: the existing guards `TestOpportunityRowParity` (analysis) and `test_opportunity_projection_covers_every_proto_field` (agent) go red on regen and green on the carry, which is its red-before-green proof.

**Scenario Coverage (C-15)** — `@AC-14` is retired (superseded by `@AC-15`, never reused) and is not covered:

| Scenario | Covering step(s) |
|---|---|
| @AC-1 | 6 (evaluator unit: referenced PERMISSION_DENIED → 0/0 + marker), 8a (`_compute_opportunities` end to end, `s-2` unaffected, no "indicator RPC failed" log) |
| @AC-2 | 6 (`compute_readiness_row` → 0/0, `bar_epoch >= 0`), 8a (`EvaluateReadiness` SLOW returns OK, no `AioRpcError`) |
| @AC-3 | 4 (RESOLVED funnel from a seeded cache row), 8a (kick + `GetWatchlistReadiness`: `MYSZ` and `AAPL` both RESOLVED, no "readiness refresh kick failed") |
| @AC-4 | 8a (UNAVAILABLE → `data_unavailable`, no marker) |
| @AC-5 | 6 (`raise_unreadable` checked first, with and without a sink), 8a (backtest FORMULA_ERROR unchanged) |
| @AC-6 | 10 |
| @AC-7 | 12 (Playwright, four surfaces) |
| @AC-8 | 8a (materializer persists the verdict and continues) |
| @AC-9 | 8a (heal) |
| @AC-10 | 6 (evaluator: mixed unreadable + timeout raises), 8a (recompute fails, rows retained) |
| @AC-11 | 8a (live loop: PERMISSION_DENIED pair isolated, no sink; new test asserts the `live_loop: … — continuing` warning) |
| @AC-12 | 8a (heal on recovery) |
| @AC-13 | 6 (evaluator), 8a (`EvaluateReadiness` aborts on the timeout) |
| @AC-15 | 6 (evaluator: NOT_FOUND → marker, one log line), 8a (`_compute_opportunities`) |
| @AC-16 | 6, 8a (unreferenced refused component skipped, no marker, one log line) |
| @AC-17 | 4 (floor survival, not a source, not in `available_sources`), 8a (non-held rank/action) |
| @AC-18 | 8a (held rows, both Examples rows) |
| @AC-19 | 8a (daily refresh + materializer with owner-only metadata) |
| @AC-20 | 4 (FAST funnel), 8a (second call served without calling indicators) |
| @AC-21 | 4 (storage round-trip), 8a (sibling `fetch_failed` bleed, one log line) |
| @AC-22 | 8b (backtest, gate ON, both start branches) |
| @AC-23 | 8b (`ScoreStrategy`, gate ON; outage still aborts) |
| @AC-24 | 8b (opportunities + heal, gate ON) |
| @AC-25 | 8b (gate ON, `GetFormula` UNAVAILABLE stays data-unavailable) |
| @AC-26 | 8a (next recompute evaluates normally) |
| @AC-27 | 12 (Playwright, held REDUCE + cue) |

**Anchor re-verification (F-04).** Every `path:line` below was re-grepped in this tree (`a75d1916`). `design.md`/`recon.md` anchors for `evaluator.py`, `servicer.py` (opportunities, heal, `_formula_fundamentals`, `_declared_formula_warmup`, `recompute_unscored_pairs`, read-back), `opportunities.py`, the agent and the UI all still resolve. Corrections only: `test_fundamentals_pit_pager.py` — the servicer sibling is `:295-302` and the evaluator sibling `:304-311` (both use UNAVAILABLE today; the NOT_FOUND parameters are added in Step 8b); `test_grade_fundamentals_exclusion.py` — the boot-pass test is `:387-396` with the `GetFormula` count assertion at `:396` (`:395` is the `GetHistoricalFundamentals` count; design cited `:389-396`); `WatchlistReadiness.tsx` — the `readinessState` switches are at `:52` (`barVariant`) and `:74` (`stateLabel`), the rollup at `:235`, the cue at `:296` (design cited `:59,81`); the agent projection function starts at `client.py:817` (docstring) and the tool docstring field list at `tools.py:1692-1704`.

**Operator action — pre-rollout blast-radius measurement (read-only, before the dev rollout; goes in the PR body, `design.md` § Pre-rollout).** Unifying `NOT_FOUND` turns today's quiet partial rows into marked rows for every owner of a deleted / legacy-author / hidden formula. Run on a connection that reaches both schemas (verify reachability on the DO cluster first — **unverified**), then run `uv run python -m app.maintenance.legacy_authors --users users.json --out plan.json` in report mode (`services/xstockstrat-indicators/CLAUDE.md:221-225`, `docs/runbooks/legacy-formula-authors.md`):

```sql
SELECT s.user_id, s.strategy_id, c->>'formula_id' AS formula_id, f.author
FROM analysis.strategies s
CROSS JOIN LATERAL jsonb_array_elements(s.definition_json::jsonb->'components') c
LEFT JOIN indicators.formulas f ON f.formula_id::text = c->>'formula_id'
WHERE coalesce(c->>'formula_id','') <> ''
  AND (f.formula_id IS NULL OR f.pending_intent_id IS NOT NULL
       OR (f.author <> s.user_id AND f.author <> 'system'));
```

No `deleted_at` filter: soft-deleted formulas still execute. The Loki log line carries no user id and is deduped per evaluator, so it cannot give a per-user count.

**Follow-up defect (not re-created here):** genuine-outage batch loss in the kick / materializer / heal and the symbol-wide `fetch_failed` bleed are filed as `docs/reports/2026-11-05-analysis-readiness-batch-loss-on-indicator-outage-defect.md` (status sidecar `open`); Out of Scope for this feature.

## Step Dependencies

- Step 2 requires Step 1: regen needs the `.proto` change; Step 2 also carries the `_row_to_opportunity` line and the agent whitelist line so the existing descriptor-parity guards stay green (Build order 1).
- Step 3 requires Step 2 (new proto fields). Step 4 [test] covers Step 3 [service]. Step 5 [service] is independent of Steps 3-4 at build time (pure evaluator change) and is ordered after them to keep each PR small. Step 6 [test] covers Step 5 [service]. Step 7 [service] requires Steps 3 and 5 (it consumes the evaluator marker and writes the provenance token the read side reads). Steps 8a and 8b [test] together cover Step 7 [service]: 8a covers the row / heal / readiness wiring (Step 7 Instructions 1-2), 8b covers the gate-ON fundamentals classification and per-owner cache (Instructions 3-6). 8b requires 8a only for authoring convenience (`test_unreadable_formula.py` helpers); both must be green before Step 7 merges.
- Step 9 [service] requires Step 2 (generated `Opportunity.formula_unreadable`); Step 10 [test] covers Step 9 [service].
- Step 11 [service] requires Step 2 (regenerated TS stubs `formulaUnreadable` on `Opportunity` and `SymbolReadiness`). Step 12 [test] covers Step 11 [service]. UI steps are independent of Steps 3-8 at build time (the Playwright mock backend serves the marker) but are only user-visible once Step 7 ships.
- Step 13 [docs] requires Steps 7, 9 and 11 (documents the shipped behaviour). **Same-PR rule (root `CLAUDE.md` Context Guide, last row; `docs/patterns/strat-lab-plugin.md:13-14`):** Step 13's strat-lab edits must ship in the same PR as Step 7's gate-ON backtest behaviour change. With per-step PRs into `feature/fix-analysis-admin-formula-refusal`, that means the integration PR to `main-dev` — **do not merge Step 7 (or 8b) to `main-dev` without Step 13**.
- Step 14 [docs] is **deferred to the `/sdd-execute` integration PR** (C-16: promotion of scenarios into the durable per-service suites on launch/integration; `/promote` is the backstop). It does not gate the per-step PRs.
- **Merge coordination with feature 294 (`signal-map-instrumentation`, `implementation-ready`) — rebase-only.** 294's Step 13 edits `services/xstockstrat-analysis/app/services/evaluator.py` in exactly one hunk (the `fundamentals formula=` `log.info` → `log.debug` at `evaluator.py:613-614`, inside `_fundamentals_formula_series`) and `servicer.py` only in the tick/`_kick_*` regions and the `PIT fundamentals loaded` log near `servicer.py:1894-1896` (`294/implementation-spec.md:559-575,585-590`). It does **not** edit `_execute_formula`, so per `design.md` Open Risks no `merge-order.md` row is added. Our hunks in the same function are at `evaluator.py:552` (signature) and `:590-599` (the `_execute_formula` call); the nearest 294 hunk is ≥ 14 lines away, so the overlap is textual at most. Whichever lands second rebases and re-greps every anchor in this spec before editing (294 and 291 also shift `servicer.py` lines).
- Feature 293 (`fix-analysis-live-loop-budget-seed`) edits analysis `live_loop.py` / `tests/test_live_loop.py` / `CLAUDE.md` config-key rows only (`293/implementation-spec.md:53,92,288`); no overlap with this spec except `services/xstockstrat-analysis/CLAUDE.md` (Step 13 edits different sections) — rebase only.
- Feature 275 / 215 / 224 / 225 behaviours are PRESERVE guards (`design.md` § Business Rules Touched); Steps 8a/8b re-assert them.

---

### Step 1 — proto: add `formula_unreadable` to `Opportunity` and `SymbolReadiness`

**Status**: `pending`
**Service**: `packages/proto`
**Files**:
- `packages/proto/analysis/v1/analysis.proto` — modify

**Reviewers**: Proto Reviewer — field number uniqueness per message, no breaking changes, `buf lint` + `buf breaking` against the dev trunk, BSR publication readiness; xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias; xstockstrat-ui owner — Connect-RPC call safety, analytics display accuracy; xstockstrat-agent owner — MCP tool contract stability and `mcp-tools.md` parity

**Codebase Evidence**:
- Confirmed via: `grep -n "fundamentals_gap = 24\|fundamentals_unavailable = 23\|data_unavailable = 20" packages/proto/analysis/v1/analysis.proto` → `:653`, `:651`, `:637`. `message Opportunity` spans `:603-654`; the highest field is `fundamentals_gap = 24`, so **25** is the next free number.
- Confirmed via: `grep -n "^message SymbolReadiness" ...` → `:673`; fields 1-5 (`conditions = 5` at `:678`), so **6** is the next free number. `SymbolReadiness` is shared by `EvaluateReadinessResponse.readiness = 1` and `WatchlistReadinessRow.readiness = 4` (`:737-761`).
- Confirmed via: `grep -n reserved packages/proto/analysis/v1/analysis.proto` → only a comment hit at `:200`; **no `reserved` statement** exists, so additive is safe.
- Existing pattern: `bool data_unavailable = 20;` (`:637`) with a `// feature 185 — …derived at read from the "unavailable" provenance marker (no column)` comment; `bool fundamentals_unavailable = 23;` (`:651`).
- `packages/proto/buf.yaml` exists; CI runs `buf lint packages/proto/` and `buf breaking` (`.github/workflows/ci.yml:165-185`).

**TDD**: N/A (`proto` category — non-code-bearing; `buf breaking` is the verification).

**Covers**: —

**Instructions**:
1. In `message Opportunity`, after `FundamentalsGap fundamentals_gap = 24;` (`:653`), add `bool formula_unreadable = 25;` with a ≤ 3-line comment: feature 289 — a component formula the traced rule references was refused by indicators (NOT_FOUND / PERMISSION_DENIED); derived at read from the `"formula_unreadable"` provenance marker (no column); mutually exclusive with `data_unavailable` / `fundamentals_unavailable`.
2. In `message SymbolReadiness`, after `repeated ConditionEval conditions = 5;` (`:678`), add `bool formula_unreadable = 6;` with a ≤ 2-line comment: rides `readiness_json["formula_unreadable"]` (no column); a RESOLVED 0-of-0 result with a real `bar_epoch >= 0`, never the `-1` UNKNOWN sentinel.
3. A bool, not an enum (C-04 targets closed value sets carried as strings; the sibling markers `muted = 12`, `data_unavailable = 20`, `fundamentals_unavailable = 23` are bools — trade-off recorded in `design.md`). Do not add a `reserved` statement and do not renumber anything.
4. Proto approval gate (C-09, `docs/runbooks/approval-flow.md`): additive field → Proto Reviewer + service owners; no breaking change.

**Verification**:
```bash
cd /home/user/xstockstrat && buf lint packages/proto/ && (cd packages/proto && buf breaking . --against "../../.git#branch=origin/main-dev,subdir=packages/proto")
```
(The `../../.git#branch=origin/<base>,subdir=packages/proto` form is the CI form, `.github/workflows/ci.yml:168-185` (`origin/${{ github.base_ref }}`; a per-step PR into the feature branch compares against `origin/feature/fix-analysis-admin-formula-refusal` once that ref exists on origin); run from `packages/proto` so the module root matches. Never compare against the branch being edited — that is vacuous. Expect: no output / exit 0.)

---

### Step 2 — proto-gen: regenerate stubs and carry the two descriptor-parity guards

**Status**: `pending`
**Service**: `packages/proto` (generated), `xstockstrat-analysis` and `xstockstrat-agent` (one-line carries)
**Files**:
- `packages/proto/gen/go/analysis/v1/analysis.pb.go` — modify (generated)
- `packages/proto/gen/python/analysis/v1/analysis_pb2.py` — modify (generated)
- `packages/proto/gen/ts/analysis/v1/analysis_pb.ts` — modify (generated; `ts/dist/analysis/v1/analysis_pb.{js,d.ts}` is rebuilt by the script — stage whatever `git status --porcelain packages/proto/gen` shows)
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (`_row_to_opportunity`, one keyword)
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (`TestOpportunityRowParity._MAPPED`)
- `services/xstockstrat-agent/app/client.py` — modify (`_opportunity_to_dict`, one key)
- `services/xstockstrat-agent/tests/test_opportunity_projection.py` — modify (`_full_opportunity`)

**Reviewers**: (inherited from Step 1) Proto Reviewer — field number uniqueness, `buf lint`/`buf breaking`; xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias; xstockstrat-ui owner — Connect-RPC call safety; xstockstrat-agent owner — MCP tool contract stability and `mcp-tools.md` parity

**Codebase Evidence**:
- Generated stubs are checked in: `git ls-files packages/proto/gen | grep analysis/v1` → `go/analysis/v1/analysis.pb.go`, `python/analysis/v1/analysis_pb2.py`, `ts/analysis/v1/analysis_pb.ts` (+ `ts/dist/…`). Never Read/Grep these; read the `.proto`.
- Confirmed via: `grep -n "def _row_to_opportunity" services/xstockstrat-analysis/app/handlers/servicer.py` → `:6803`; its docstring says "a newly-added proto field fails the parity test until it is carried here"; `data_unavailable=("unavailable" in provenance)` and `fundamentals_unavailable=("fundamentals_unavailable" in provenance)` at `:6826-6827` (`fundamentals_gap=` follows).
- Confirmed via: `grep -n "class TestOpportunityRowParity" services/xstockstrat-analysis/tests/test_analysis_servicer.py` → `:6379`; `_MAPPED` set `:6385-6411` ends with `"fundamentals_unavailable", "fundamentals_gap"`; `test_mapper_covers_every_proto_field` asserts `_MAPPED | _INTENTIONALLY_UNSET == set(Opportunity.DESCRIPTOR.fields_by_name)` (`:6418-6420`).
- Confirmed via: `grep -n "def _opportunity_to_dict" services/xstockstrat-agent/app/client.py` → `:817`; `"data_unavailable": o.data_unavailable` `:838`, `"fundamentals_unavailable"` `:840`, `"fundamentals_gap"` `:841`.
- Confirmed via: `tests/test_opportunity_projection.py` `_full_opportunity` builds the full message (`fundamentals_unavailable=True`, `fundamentals_gap=…ETF`) and `test_opportunity_projection_covers_every_proto_field` asserts `emitted == set(Opportunity.DESCRIPTOR.fields_by_name)`.

**TDD**: `N/A (generated stubs)` for the regen; the carries are proven red-then-green by the two existing parity guards: after regen and before the carries `TestOpportunityRowParity::test_mapper_covers_every_proto_field` and the agent `test_opportunity_projection_covers_every_proto_field` FAIL (new field unmapped); after the carries they pass.

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root (Docker-based; if Docker or GitHub-releases egress is unavailable use `docs/runbooks/codegen-toolchain-host-setup.md`). Stage only what it rewrites under `packages/proto/gen/`.
2. Run the two guards first to capture the RED run (analysis: `uv run pytest tests/test_analysis_servicer.py::TestOpportunityRowParity -q`; agent: `uv run pytest tests/test_opportunity_projection.py -q`).
3. Analysis: in `_row_to_opportunity` add `formula_unreadable=("formula_unreadable" in provenance),` next to `fundamentals_unavailable` (`:6827`), with a ≤ 1-line comment (derived from the provenance marker, no column). In `TestOpportunityRowParity._MAPPED` add `"formula_unreadable",  # feature 289 — derived from the "formula_unreadable" provenance marker at read`.
4. Agent: in `_opportunity_to_dict` add `"formula_unreadable": o.formula_unreadable,` after `"fundamentals_gap"` (`:841`). In `_full_opportunity` add `formula_unreadable=True,  # feature 289`. (Step 9 owns the tool docstring and runbook; this step only keeps the guards green.)
5. Do not touch `SymbolReadiness` mappers here — `_readiness_to_proto` is Step 3.

**Verification**:
```bash
cd /home/user/xstockstrat && ./scripts/buf-gen.sh && git status --porcelain packages/proto/gen
cd /home/user/xstockstrat/services/xstockstrat-analysis && uv run pytest tests/test_analysis_servicer.py::TestOpportunityRowParity -q && ruff check . && ruff format --check .
cd /home/user/xstockstrat/services/xstockstrat-agent && uv run pytest tests/test_opportunity_projection.py -q && ruff check . && ruff format --check .
```
Also confirm the `proto-freshness` gate: a second `./scripts/buf-gen.sh` produces an empty `git diff packages/proto/gen/`.

---

### Step 3 — service: analysis read side (SymbolReadiness funnel, floor clause, structural marker)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify (`_readiness_to_proto`)
- `services/xstockstrat-analysis/app/repositories/opportunities.py` — modify (`_PROVENANCE_STRUCTURAL_MARKERS`, floor clause)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `grep -n "def _readiness_to_proto\|def _symbol_readiness_from_json" servicer.py` → `:6471`, `:6492`. `_readiness_to_proto(trace)` maps only symbol/conviction/passing/total/conditions (`:6471-6489`); `_symbol_readiness_from_json` routes through it (`:6492-6498`, "so a FAST-served row is byte-identical to a freshly computed one") — **one funnel** for `EvaluateReadiness` SLOW (`:4048`), FAST (`:4009`) and `GetWatchlistReadiness` RESOLVED (`_symbol_readiness_from_json` calls at `:4009` FAST and `:4201` RESOLVED; helper at `:6492`).
- Confirmed via: `grep -n "_PROVENANCE_STRUCTURAL_MARKERS" app/repositories/opportunities.py` → `:27`: `["watchlist", "position", "denied", "fundamentals_unavailable"]`, bound as `$6::text[]` in the `LATERAL` source derivation (`:238-241`) and iterated by `servicer._primary_source` (`:6713-6721`) — a token missing from the list would surface as `Opportunity.source` and a source chip.
- Confirmed via: floor clause `opportunities.py:256-257`: `AND (o.conviction >= $2 OR o.provenance ? 'denied' OR o.provenance ? 'unavailable' OR o.provenance ? 'fundamentals_unavailable')` with the "exempt at every layer" comment block `:246-255` (fails.md vanish trap).
- Existing pattern: `fundamentals_unavailable` marker (feature 215) added to all three places; test pins `tests/test_opportunities_repo.py:549-558`.

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. `_readiness_to_proto`: add `formula_unreadable=bool(trace.get("formula_unreadable", False)),` to the `SymbolReadiness(...)` constructor (`:6473-6489`). `_symbol_readiness_from_json` needs no change (funnel).
2. `opportunities.py`: append `"formula_unreadable"` to `_PROVENANCE_STRUCTURAL_MARKERS` (`:27`) and extend the comment at `:22-26` by ≤ 1 line (feature 289: the marker is never a source/facet). Add `OR o.provenance ? 'formula_unreadable'` to the floor clause (`:256-257`) and one comment line "feature 289: likewise the formula-unreadable row".
3. Do not change `_SORT_ORDER_BY`, the count query, or `replace_symbols` (the heal's action-binding semantics are used unchanged in Step 7).

**Verification**: run Step 4's test command (this step's behaviour is verified there), plus lint:
```bash
cd /home/user/xstockstrat/services/xstockstrat-analysis && ruff check . && ruff format --check .
```

---

### Step 4 — test: analysis read side (seeded-row, floor, structural marker, funnel)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_opportunities_repo.py` — modify (floor + structural-marker tests + @AC-21 `_row_to_opportunity` round-trip)
- `services/xstockstrat-analysis/tests/test_watchlist_readiness.py` — modify (RESOLVED funnel via `GetWatchlistReadiness`)
- `services/xstockstrat-analysis/tests/test_unreadable_formula.py` — modify (FAST `EvaluateReadiness` funnel case; this file already imports `make_servicer`, `_materialized_svc`, `_row`, `_definition`, `ctx_with` and `_BOB`)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `tests/test_opportunities_repo.py:549-558` — `test_read_floor_exempts_fundamentals_unavailable` (`assert "o.provenance ? 'fundamentals_unavailable'" in sql`) and `test_fundamentals_unavailable_is_a_structural_marker` (`assert … in _PROVENANCE_STRUCTURAL_MARKERS`; `_primary_source([...,"uw"]) == "uw"`) — the exact templates.
- Confirmed via: `tests/test_analysis_servicer.py:4359` `class TestEvaluateReadiness` (helper `_svc(bars_by_symbol)` with `_readiness_cache_repo` available at `:4651` `_FakeReadinessCache`); `tests/test_watchlist_readiness.py:87-161` drive `GetWatchlistReadiness` with `svc._kick_readiness_refresh = MagicMock()` and seeded cache rows; `tests/test_readiness_cache.py` holds the `is_readiness_row_fresh` fixtures.
- Confirmed via: `tests/test_opportunities_repo.py:15` already imports `_row_to_opportunity`; `:592` `test_row_to_opportunity_skip_row_round_trip` is the round-trip template (the @AC-21 round-trip lands there, not in `test_analysis_servicer.py`). `TestEvaluateReadiness._svc` (`:4360`) uses `_strategy_row_single_gt()` with no formula component, sets `svc._indicators = MagicMock()` with only `ComputeIndicator` awaitable, and `_FakeReadinessCache.read_many` (`:4658`) always returns `{}`; a custom-formula strategy makes `EvaluateReadiness` call `_formula_fundamentals` (`servicer.py:3973`) → `await self._indicators.GetFormula(...)`, which is `await MagicMock()` → `TypeError`. The FAST case therefore builds its own custom-formula row, cache stub and `GetFormula` stub, and lives in `tests/test_unreadable_formula.py` (importing `_row`/`_definition` from there into `test_analysis_servicer.py` would be circular — `test_unreadable_formula.py:20-28` imports from `test_analysis_servicer`; copying them would duplicate fixtures, C-13) (Instruction 2(b)).
- C-13 verdict: all new literals (a seeded `readiness_json` with `"formula_unreadable": True`, a `provenance` list) have **one consumer per file**; they stay inline in each file. No new fixture home is created.

**TDD**: red-green required — author these tests first; against the pre-Step-3 tree they FAIL for the right reason: `_readiness_to_proto` drops the key (`formula_unreadable` is False on a seeded `True` row), the floor SQL lacks the clause, and `"formula_unreadable"` is absent from `_PROVENANCE_STRUCTURAL_MARKERS` (`_primary_source(["formula_unreadable"])` returns `"formula_unreadable"`). Qualification: the @AC-21 round-trip test's `formula_unreadable True` / `data_unavailable False` assertions are already green after Step 2 (the `_row_to_opportunity` carry); only its `source == ""` assertion is red before Step 3's structural-marker edit.

**Covers**: `AC-3, AC-17, AC-20, AC-21` (read-side halves; the compute-side halves are in Step 8a)

**Instructions**:
1. `test_opportunities_repo.py`: add `test_read_floor_exempts_formula_unreadable` (`"o.provenance ? 'formula_unreadable'" in sql`, @AC-17 floor survival with `min_conviction=0.9`) and `test_formula_unreadable_is_a_structural_marker` (`"formula_unreadable" in _PROVENANCE_STRUCTURAL_MARKERS`; `_primary_source(["formula_unreadable","uw"]) == "uw"`; `["watchlist","formula_unreadable"]` → `""`, so no source, no facet / `available_sources` chip — @AC-17); and `test_row_to_opportunity_formula_unreadable_round_trip` beside `test_row_to_opportunity_skip_row_round_trip` (`:592`), same row shape with `provenance ["watchlist","formula_unreadable"]`: `opp.formula_unreadable is True`, `opp.data_unavailable is False`, `opp.fundamentals_unavailable is False`, `opp.source == ""` (@AC-21 round-trip).
2. `test_unreadable_formula.py` (not `test_analysis_servicer.py`): (a) the @AC-21 round-trip is NOT added here: put it in `test_opportunities_repo.py` beside `test_row_to_opportunity_skip_row_round_trip` (`:592`, which already imports `_row_to_opportunity`) — see Instruction 1; (b) a FAST `EvaluateReadiness` case (import `_empty_readiness` from `app.services.evaluator` and `_definition_fingerprint` from `app.handlers.servicer` (`:7209`); neither is imported in this file today). `TestEvaluateReadiness._svc` uses `_strategy_row_single_gt()` (no formula component) and `_FakeReadinessCache.read_many` (`:4658`) always returns `{}`, so a "`ExecuteFormula` never awaited" assertion would be vacuous with them. Instead build the service with `make_servicer()` and a **custom-formula** strategy (`_row(_definition())`, owner `bob`, `svc._strategies_repo = MagicMock(get_by_owner_and_id=AsyncMock(return_value=row_of_strategy))` (`make_servicer()` leaves `_strategies_repo = None` (`servicer.py:547`), so assigning an attribute on it raises `AttributeError`; `_write_svc` assigns a fresh mock first, `test_unreadable_formula.py:~191-197`), `ctx_with(_BOB)`), set `svc._marketdata = MagicMock()` (the `GetDataCoverage` probe is best-effort, `servicer.py:4055-4070`), `svc._indicators = MagicMock()` with `svc._indicators.GetFormula = AsyncMock(return_value=SimpleNamespace(fundamental_inputs=[]))` (the custom-formula component makes `EvaluateReadiness` call `_formula_fundamentals` at `servicer.py:3973`; a bare `MagicMock` attribute would raise `TypeError` on `await`) and `svc._indicators.ComputeIndicator` as in `TestEvaluateReadiness._svc` (`AsyncMock(side_effect=lambda req, **_kw: _sma_resp(req))`), `svc._indicators.ExecuteFormula = AsyncMock()` and `svc._readiness_cache_repo = MagicMock(read_many=AsyncMock(return_value={"MYSZ": row}))`, where `row` carries `readiness_json = {**_empty_readiness("MYSZ"), "formula_unreadable": True}`, `def_fingerprint == _definition_fingerprint(row_of_strategy["definition_json"])`, a future `valid_until`, `bar_epoch >= 0` and a `computed_at` (see the freshness predicate `is_readiness_row_fresh`, `app/services/readiness.py:16-28`, and the FAST branch `servicer.py:~3999-4010`) → `EvaluateReadiness` FAST returns `formula_unreadable True`, `total_conditions 0`, and `ExecuteFormula.assert_not_awaited()` (@AC-20 second-call half).
3. `test_watchlist_readiness.py`: seeded cache row with `bar_epoch >= 0` and the marker → the `MYSZ` row is `READINESS_STATE_RESOLVED` with `readiness.formula_unreadable True`, not UNKNOWN/PENDING; a sibling `AAPL` row also RESOLVED (@AC-3 read-side half).
4. Reuse `tests/conftest.py` helpers (`ctx_with`, `aio_rpc_error`, `RecordingStub`) rather than redefining them.

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-analysis && uv run pytest tests/test_opportunities_repo.py tests/test_unreadable_formula.py tests/test_watchlist_readiness.py -q && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
Confirm no second inline copy of the seeded-marker row: `grep -rn "formula_unreadable" tests/ | grep -c "readiness_json"` is one declaration per file.

---

### Step 5 — service: evaluator private sink and `UNREADABLE_FORMULA_CODES`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `grep -n "def _execute_formula" evaluator.py` → `:256`. Today: `try: return await self._indicators.ExecuteFormula(request, metadata=self._meta)`; `except grpc.aio.AioRpcError as e:` — if `self._raise_unreadable and e.code() in (NOT_FOUND, PERMISSION_DENIED)` raise `FormulaExecutionError(comp.formula_id, "not readable by owner", e.code().name) from e` (`:262-269`, "Never e.details()"); `if e.code() != NOT_FOUND: raise` (`:270-271`); NOT_FOUND → add to `self.unreadable_formulas` and `log.warning("formula %s not readable by owner", …)` once, `return None` (`:272-275`). `unreadable_formulas: set[str]` initialised at `:244`; nothing outside the evaluator reads it.
- Call sites: `_compute_component` `:491` → `self._execute_formula(comp, …)` at `:518`, `if resp is None: return {"value": [None] * n}` `:526-527`; `_fundamentals_formula_series` `:552` → `:590`, `if resp is None: return {"value": [None] * n}` `:598-599`.
- `_assemble_component_series` `:686-695` (signature ends `formula_fundamentals_data: list | None = None,`); calls `_fundamentals_formula_series(...)` at `:739`, `_compute_component(comp, closes)` at `:745` and the benchmark `_compute_component(comp, bench_closes)` at `:752`. `_assemble_sector_resolved` (`:472`, used only by `evaluate_with_series` `:354`) and `servicer.py:4541-4567` (`GetIndicatorSeries`) call these without a sink — must stay byte-identical.
- `evaluate_conditions_traced` `:383-470`: no-bars early return `:413-416`; `_validate_definition(definition)` `:417`; serial loop `:425-441` and concurrent `_assemble` `:445-459` (`asyncio.gather` without `return_exceptions`); `parsed_rule = json.loads(rule_src) if rule_src else None` `:466`.
- `referenced_refs(rule)` `:958-964` (collapses dotted `<ref>.<series>` to the base); `_empty_readiness(symbol)` `:1134-1142`; `_validate_definition` rejects a term whose base is not a component `ref_name` (`:890-895`), so the bare `t in U` arm of the design is dead — use `referenced_refs` only.

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. Add a module constant `UNREADABLE_FORMULA_CODES = (grpc.StatusCode.NOT_FOUND, grpc.StatusCode.PERMISSION_DENIED)` near `FormulaExecutionError` (`:102`), with a ≤ 2-line comment ("a refusal of a formula the caller cannot read; imported by the servicer's fundamentals classification"). Replace the inline tuple at `:262-265` with it. The servicer already imports from this module (`servicer.py:66-76`), so no cycle.
2. `_execute_formula(self, comp, request, unreadable_sink=None)`: keep the `raise_unreadable` branch first and byte-identical. Then `if unreadable_sink is not None and e.code() in UNREADABLE_FORMULA_CODES:` → `unreadable_sink.add(comp.ref_name)` **outside** the `unreadable_formulas` dedupe; the dedupe block (`if comp.formula_id not in self.unreadable_formulas: add; log.warning("formula %s not readable by owner", comp.formula_id)`) runs once; `return None`. The existing `!= NOT_FOUND` re-raise and NOT_FOUND skip arms (`:270-275`) stay as they are for the no-sink call (`GetIndicatorSeries`, `evaluate`, live loop).
3. Thread `unreadable_sink=None` (keyword-only, after the existing positional-with-default params, e.g. `…, formula_fundamentals_data=None, *, unreadable_sink=None`) through `_assemble_component_series` (`:686`), `_compute_component` (`:491`; pass to `_execute_formula` at `:518`) and `_fundamentals_formula_series` (`:552`; pass at `:590`). In `_assemble_component_series` forward it at all three sites: `:739`, `:745` and the benchmark `:752`. No constructor flag, no `for_owner` change, no `ValueError` guard (user decision).
4. `evaluate_conditions_traced`: after the no-bars return and `_validate_definition` create a local `unreadable: set[str] = set()` (per call — never instance state; one evaluator is shared across concurrently gathered candidates, `servicer.py:5572-5574`, `:5863`) and pass `unreadable_sink=unreadable` at **both** the serial (`:429`) and concurrent (`:447`) `_assemble_component_series` calls. After `parsed_rule` (`:466`): `if unreadable and referenced_refs(parsed_rule) & unreadable: return {**_empty_readiness(symbol), "formula_unreadable": True}`. Referenced-only: an unreferenced refused component stays skipped with one log line and no marker. The no-bars return stays first (data-unavailable outranks unreadable). A real `FormulaExecutionError` / `RpcError` from any component still propagates (concurrent `gather` propagates the first error; `async with self._component_sem` releases the permit).
5. Do not change `compute_readiness_row`'s signature (feature-215 parity — no `failures` argument); the marker flows through the returned trace.

**Verification**: Step 6's command plus lint:
```bash
cd /home/user/xstockstrat/services/xstockstrat-analysis && ruff check . && ruff format --check .
```
**Step 5/6 boundary:** once `evaluate_conditions_traced` returns the 0/0 marker trace, the existing `tests/test_unreadable_formula.py:293-307` (`test_list_opportunities_unreadable_formula_is_not_unavailable`, pins `(passing, total) == (1, 2)`) goes red before Step 7 (`_compute_opportunities` stores the marker trace as `readiness_json`, so the row is `(0, 0)`). Step 6 Instruction 8 carries its interim re-pin; Step 5 and Step 6 must be green together (author Step 6, including that re-pin, first, per the red-before-green pairing).

---

### Step 6 — test: evaluator sink and `compute_readiness_row`

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_unreadable_formula.py` — modify (new evaluator section and `_traced_evaluator`/`_definition_two_formulas` helpers beside `_evaluator`/`_execute`; interim re-pin of `:293-307`)
- `services/xstockstrat-analysis/tests/test_readiness.py` — modify (`compute_readiness_row` cases next to `test_compute_readiness_row_exception_stamps_minus_one_sentinel`)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `tests/test_unreadable_formula.py:135-190` — `_ADMIN_REFUSAL`, `_evaluator(error, *, raise_unreadable)`, `_execute(ev)`, `test_backtest_permission_denied_maps_to_formula_error_with_code`, `test_live_path_permission_denied_still_reraises`, `test_live_path_not_found_still_skips`, `test_backtest_unavailable_still_reraises`; `_definition(z_ref="z")` `:40-70` builds `sma` + `z` (formula `f-zscore`) with a two-leaf AND entry rule — `_definition(z_ref="sma")` makes `z` **unreferenced**; `_FIRING_BARS` is imported from `tests/test_analysis_servicer.py`; `aio_rpc_error` / `ctx_with` / `RecordingStub` from `tests/conftest.py:132-149`.
- Confirmed via: `tests/test_readiness.py:86-113` — `_fake_evaluator`, `_compute(fetch_bars, *, benchmark_epoch)`, the `-1` sentinel test; `tests/test_evaluator_traced.py:296-323` — serial vs concurrent (`component_sem`) fixtures `_counting_stub`, `_period_keyed_stub`.
- C-13 verdict: the refusal-error builder `_not_found()` (`test_unreadable_formula.py:36`) and `_ADMIN_REFUSAL` already live in this file with one consumer file; the new tests reuse them (no second inline copy).
- Existing pin that this step must re-pin: `tests/test_unreadable_formula.py:293-307` `test_list_opportunities_unreadable_formula_is_not_unavailable` asserts `(passing, total) == (1, 2)` for a NOT_FOUND-refused formula. Once Step 5 lands, `evaluate_conditions_traced` returns the 0/0 marker trace and `_compute_opportunities` (`servicer.py:5770-5861`) stores it as the row's `readiness_json` with no sibling `fetch_failed`, so the row is `(0, 0)` with `data_unavailable False` even before Step 7 writes the provenance token (`formula_unreadable` stays False on the proto until then). Instruction 8 re-pins it.
- Existing helpers the new evaluator tests must extend: `_evaluator(error, *, raise_unreadable)` (`:138-141`) builds `MagicMock()` with only `ExecuteFormula` awaitable, but `_definition()` carries an `sma` BUILTIN component, so `evaluate_conditions_traced` also awaits `ComputeIndicator`; `_sma_resp(req)` (`:82`) is the response builder (`SimpleNamespace(result=[…])` over `req.values`), already wired as `AsyncMock(side_effect=lambda req, **_kw: _sma_resp(req))` at `:265` and as `"ComputeIndicator": _sma_resp` in the `RecordingStub` at `:94`. `_definition()` has a single formula component `z`.

**TDD**: red-green required — RED on today's tree for the right reason. The public-API tests (`evaluate_conditions_traced`, `compute_readiness_row`) never pass the new kwarg, so there is no `TypeError` there: `PERMISSION_DENIED` fails because the `AioRpcError` is re-raised (the evaluator re-raises any non-NOT_FOUND refusal today), and `NOT_FOUND` fails on the missing `formula_unreadable` key (the component is skipped with no marker). Only the direct `_execute_formula(..., unreadable_sink=set())` tests (Instruction 5) fail with `TypeError` on the unknown keyword.

**Covers**: `AC-1, AC-2, AC-5, AC-10, AC-13, AC-15, AC-16`

**Instructions**: (each in serial mode `component_sem=None` and concurrent mode `component_sem=asyncio.Semaphore(2)`)
0. **Helpers first** (`test_unreadable_formula.py`): the existing `_evaluator()` is not usable for traced evaluation (see Codebase Evidence). Add a traced helper `_traced_evaluator(execute_side_effect, *, component_sem)` that builds `indicators = MagicMock()` with `ComputeIndicator = AsyncMock(side_effect=lambda req, **_kw: _sma_resp(req))` and `ExecuteFormula = AsyncMock(side_effect=execute_side_effect)`, and returns `StrategyEvaluator(indicators, (("x-user-id", "bob"),), component_sem=component_sem)`. For Instruction 3 add `_definition_two_formulas()` with `z` (`f-zscore`) and `z2` (`f-timeout`) components, both referenced by the entry rule (the `ExecuteFormula` side effect dispatches on `req.formula_id`: `f-zscore` raises the refusal, `f-timeout` returns the timeout `SimpleNamespace`). In Instruction 7 give the `RecordingStub` `"ComputeIndicator": _sma_resp`.
1. `evaluate_conditions_traced` with `ExecuteFormula` → `PERMISSION_DENIED` ("admins cannot execute another user's formula") on a **referenced** formula returns `{symbol, conviction 0.0, passing 0, total 0, conditions [], formula_unreadable True}` (@AC-1); same with `NOT_FOUND` plus **exactly one** `caplog` record `"formula f-zscore not readable by owner"` (@AC-15).
2. `_definition(z_ref="sma")` (unreferenced refused component): evaluated normally, no `formula_unreadable` key, one log line (@AC-16).
3. Mixed (uses `_definition_two_formulas()`): one component refused + another responds `success=false` error `"Formula execution timed out after 5000ms"` → `FormulaExecutionError` propagates (@AC-10/@AC-13 evaluator half; build the response via `SimpleNamespace(success=False, error=…)`).
4. Benchmark `source_symbol` component whose formula is refused (benchmark bars supplied) → marker (covers the `:752` call site).
5. Direct `_execute_formula` tests (`evaluate_conditions_traced` always creates a sink, so the no-sink and sink-present contracts are asserted on `_execute_formula` itself). First extend the existing `_execute(ev)` helper (`tests/test_unreadable_formula.py:144-145`, which builds `SimpleNamespace(formula_id="f-zscore")` with no `ref_name`) to build `SimpleNamespace(formula_id="f-zscore", ref_name="z")` and to take an optional `sink` argument forwarded as `unreadable_sink=sink`; without `ref_name` the Step 5 `unreadable_sink.add(comp.ref_name)` would raise `AttributeError`. Then assert on `_execute_formula(..., unreadable_sink=set())`: `PERMISSION_DENIED` and `NOT_FOUND` both return `None` and the sink holds `{"z"}`; with `raise_unreadable=True` and a sink present `FormulaExecutionError` is still raised first and the sink stays empty (@AC-5); with no sink the existing `test_live_path_*` tests are unchanged and stay green.
6. Two candidates sharing a refused formula on one shared evaluator, awaited concurrently via `asyncio.gather`: **both** results marked, **one** log record (sink outside the log-dedupe; supports @AC-21).
7. `test_readiness.py`: `compute_readiness_row` with a refusing evaluator returns `readiness_json["formula_unreadable"] is True`, `passing/total 0`, and `bar_epoch >= 0` (never `-1`) (@AC-2); the bars-fetch-failure case still stamps `-1`. Do **not** reuse `_fake_evaluator` (`SimpleNamespace(evaluate_conditions_traced=AsyncMock(return_value={}))`) or the current `_compute` (no evaluator parameter, `definition={}`): the assertion would be tautological. Build a real `StrategyEvaluator` over a stub whose `ExecuteFormula` raises `aio_rpc_error(grpc.StatusCode.PERMISSION_DENIED, ...)`, a one-formula-component definition (e.g. `_definition()` from `tests/test_unreadable_formula.py` or an equivalent minimal one whose entry rule references the formula component; the stub also needs `"ComputeIndicator": _sma_resp`, as `_definition()` has an `sma` BUILTIN component), and a `fetch_bars` returning non-empty bar objects exposing `.close` and `.time.seconds` (empty bars would hit the no-bars early return before the sink matters). Extend `_compute` with `evaluator=` and `definition=` keyword parameters (defaults keep the existing `-1`-sentinel callers unchanged).
8. **Interim re-pin of `test_unreadable_formula.py:293-307`** (`test_list_opportunities_unreadable_formula_is_not_unavailable`): change `(opp.passing_conditions, opp.total_conditions) == (1, 2)` to `(0, 0)` and keep `opp.data_unavailable is False`. Step 8a Instruction 1 later extends it with `formula_unreadable True` once Step 7 writes the provenance token.

**Verification** (whole-file runs include the re-pinned `:293-307` test):
```bash
cd /home/user/xstockstrat/services/xstockstrat-analysis && uv run pytest tests/test_unreadable_formula.py tests/test_readiness.py tests/test_evaluator_traced.py -q && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```

---

### Step 7 — service: servicer producer wiring (rows, heal, fundamentals classification, per-owner cache)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/app/handlers/servicer.py` — modify
- `services/xstockstrat-analysis/app/services/evaluator.py` — modify (constraint comment at `:675` only)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- `_row_for` in `_compute_opportunities`: `grep -n "async def _row_for" servicer.py` → `:5699`; local flags `readiness/exit_fires/fund_skip/fund_unknown` `:5703-5706`; trace call `:5770-5779`; `except grpc.RpcError` `:5780-5790` (`fetch_failed.add(sym)` `:5789`); `else:` branch (held exit-rule check `exit_fires` `:5792-5794`); `action = _resolve_action_tag(c, exit_fires)` `:5803`, sell-with-no-position drop `:5804-5810`, `if fund_skip:` `:5811-5813`; `sym_unavailable` `:5827-5829`; `zeroed` `:5832`; composite `:5839-5848` (readiness term skipped when `total_conditions == 0`, `:5841`); return dict `:5850-5861` (`"conviction": 0.0 if zeroed else …`, `"signal_axis": 0.0 if zeroed else c["signal_axis"]`). `_add_provenance(c, origin)` is defined at `:5416`. `c["is_held"]` is the held discriminator; `_resolve_action_tag` `:6688-6710` (held + exit fires → REDUCE; signal direction × held via `_action_for`; watchlist/held fallback ADD (held) / ENTER).
- Heal: `_retry_unavailable_symbols` `:4934`; selector `"unavailable" in (r.get("provenance") or [])` `:4948-4952`; per-row loop `:5035`; `rule = "exit" if "position" in provenance else "entry"` `:5040`; trace call `:5119-5128`; `except grpc.RpcError` `:5129-5134` (catches PERMISSION_DENIED as an outage today); `else: still_unavailable = False` `:5135-5140`; healed row `:5163-5177` (no `action` key → `replace_symbols` keeps stored action via `COALESCE($11::int, action)`, `opportunities.py:144,165`); `_axis_for` `:4981`, `_composite_for` `:4987-5007`; skip-row precedent `"action": int(analysis_pb2.OPPORTUNITY_ACTION_TAG_UNSPECIFIED)` `:5100`; watchlist-entry readiness restage `:5181-5224` with success-only gate `staged.get("bar_epoch", -1) >= 0` `:5223`; fresh `valid_until` filled post-loop `:5226-5236`. Heal task failure catch `:4927-4928` ("opportunity surgical retry failed").
- Fundamentals classification: `_formula_fundamentals` `:1901-1934`, `except grpc.RpcError:` `:1926-1929` writes `failures[("formula", fid)] = Availability.UNKNOWN`; docstring `:1904-1909` ("An unreachable ``GetFormula`` caches ``[]``…"); `_declared_formula_warmup` `:2512-2547`, `except grpc.RpcError:` `:2543-2546`; `_prefetch_formula_warmups` `:2549-2596` (feeds the explicit-start backtest branch; `_formula_fundamentals` feeds the no-start branch `:984`); `_rpc_code` `:6617-6618` (`e.code() if isinstance(e, grpc.RpcError) and hasattr(e, "code") else None`). The live twin `evaluator.declared_formula_fundamentals` `:652-684` (`except grpc.RpcError:` `:675-681`) is **unchanged**.
- Per-owner cache: `recompute_unscored_pairs` `:3064-3089` — `fund_cache: dict = {}` `:3074`, **`formula_cache: dict = {}` `:3075`**, `failures: dict = {}` `:3076`, one shared set passed per `(user_id, strategy_id)` pair at `:3079-3086`; each pair's `GetFormula` runs under its own `owner_metadata` (`_recompute_headline` default `meta=owner_metadata(user_id)`, `:2891`).
- Import: `servicer.py:66-76` imports from `app.services.evaluator` (add `UNREADABLE_FORMULA_CODES` there).
- Callers of `_formula_fundamentals`: `:787` (write-time validation), `:984` (backtest, no explicit start), `:2790` (grade-exclusion), `:3973` (EvaluateReadiness), `:4277` (kick), `:4509` (GetIndicatorSeries), `:5067` (heal), `:5734` (opportunities), `:6061` (materializer).

**TDD**: red-green required (tests: Steps 8a for Instructions 1-2, 8b for Instructions 3-6)

**Covers**: —

**Instructions**:
1. `_row_for` (precedence `fund_skip` > `unreadable` > sibling-`fetch_failed` `unavailable`; an `unavailable` from `fund_unknown` cannot coexist with `unreadable` because the evaluator is not called when `fund_skip or fund_unknown`, `servicer.py:~5768`):
   - Add `unreadable = False` beside `fund_unknown = False` (`:5706`). In the `else:` branch after the trace (`:5791`) set `unreadable = bool(readiness.get("formula_unreadable"))`.
   - After the sell-with-no-position drop (`:5804-5810`) and beside `:5811-5813`: `if unreadable: _add_provenance(c, "formula_unreadable")`; for a **non-held** row also `action = analysis_pb2.OPPORTUNITY_ACTION_TAG_UNSPECIFIED`. A **held** row keeps `_resolve_action_tag`'s result (REDUCE on a sell signal / existing monitored-holding fallback ADD; a firing exit cannot occur on a 0/0 trace).
   - `sym_unavailable` (`:5827-5829`) gains `and not unreadable` so a sibling candidate's symbol-wide `fetch_failed` cannot flip the row (@AC-21). `zeroed = sym_unavailable or fund_skip or (unreadable and not c["is_held"])`: non-held → conviction and signal axis 0.0, composite NULL (the `if not zeroed` guard at `:5840` already NULLs it); held → `readiness["conviction"]` is 0.0 (0/0), `signal_axis` kept, composite from the signal alone (`:5841` skips the readiness term when `total_conditions == 0`; `:5843-5847` adds the signal term).
2. Heal arm (`_retry_unavailable_symbols`): the refusal no longer reaches the `except grpc.RpcError` at `:5129` (the evaluator swallows it into the marker). In the `else:` branch (`:5135`) read `unreadable = bool(readiness.get("formula_unreadable"))` (initialise `unreadable = False` beside `still_unavailable = True`, `:5041`). In the healed-row construction (`:5163-5177`): when `unreadable`, `provenance = [p for p in provenance if p not in ("unavailable", "formula_unreadable")] + ["formula_unreadable"]`, `readiness_json = readiness` (the 0/0 marker), conviction 0.0, `_healed True` (fresh `valid_until` is filled post-loop `:5233-5236`). **Held** (`"position" in provenance`, i.e. `rule == "exit"`): **omit** the `action` key (the stored action is kept via `COALESCE`), `signal_axis = _axis_for(sym)`, `composite_score = _composite_for(sym, readiness)` (signal-only). **Non-held**: `"action": int(analysis_pb2.OPPORTUNITY_ACTION_TAG_UNSPECIFIED)` bound (overwrites, as the skip row does at `:5100`), `signal_axis 0.0`, `composite_score None`. The watchlist-entry restage (`:5181-5224`) needs no change: `compute_readiness_row` now returns the marker with `bar_epoch >= 0`, which passes the success-only gate at `:5223`. The selector stays keyed on `"unavailable"` so a healed unreadable row is never re-selected.
3. `_formula_fundamentals` (global, user-confirmed C-16 CHANGE of FR-5 with the gate ON): `except grpc.RpcError as e: metrics = []; if failures is not None and _rpc_code(e) not in UNREADABLE_FORMULA_CODES: failures[("formula", fid)] = Availability.UNKNOWN`; `metrics = []` either way (so `cache[fid] = []`). An `RpcError` without `.code()` stays UNKNOWN. Rewrite the docstring sentence at `:1907-1909` (≤ 2 lines): a refusal (NOT_FOUND/PERMISSION_DENIED) is "not a fundamentals formula" and records no failure; an outage records UNKNOWN.
4. `_declared_formula_warmup` in lock-step: `except grpc.RpcError as e: cache[formula_id] = 0; if fund_map is not None and failures is not None and _rpc_code(e) not in UNREADABLE_FORMULA_CODES: failures[...] = Availability.UNKNOWN`, so the explicit-start and no-start backtest branches cannot split.
5. Leave `evaluator.declared_formula_fundamentals` (`evaluator.py:652-684`) behaviour unchanged (FR-5/`@AC-11`; live deny-entry ignores UNKNOWN) but add a ≤ 2-line constraint comment at `evaluator.py:675` ("do not merge with servicer._formula_fundamentals: a refusal must still record UNKNOWN here — live behaviour pinned by test") so a later DRY merge cannot silently change live behaviour.
6. `recompute_unscored_pairs`: replace the shared `formula_cache: dict = {}` (`:3075`) with `formula_caches: dict[str, dict] = {}` and pass `formula_cache=formula_caches.setdefault(user_id, {})` at `:3083` (one `GetFormula` result cache per owner; the PIT `fund_cache` stays shared — user-independent). `failures` stays shared and records only real outages (a refusal no longer writes it). Do **not** "never cache refusals" (rejected alternative).
7. Add `UNREADABLE_FORMULA_CODES` to the evaluator import block (`:66-76`). No new outbound gRPC call is added (header propagation unchanged — all calls reuse the existing `propagation_meta` / `owner_metadata`).

**Verification**: Step 8a's and Step 8b's commands plus lint:
```bash
cd /home/user/xstockstrat/services/xstockstrat-analysis && ruff check . && ruff format --check . && grep -n "UNREADABLE_FORMULA_CODES" app/handlers/servicer.py app/services/evaluator.py
```
(Header propagation: no new outbound gRPC call is added, so no propagation grep is required.)

---

### Step 8a — test: servicer paths (opportunities, readiness, heal, materializer, scheduled passes)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_unreadable_formula.py` — modify (rewrite `:293-307`; parameterize `_definition`/`_row`; new servicer cases; new live-loop warning test; `EvaluateReadiness` SLOW/FAST/timeout cases and the heal cases (calling `_retry_unavailable_symbols` directly; import `_unavailable_served_row` and `_FakeReadinessCache` from `tests.test_analysis_servicer`); the `_kick_readiness_refresh` + `GetWatchlistReadiness` end-to-end case (@AC-3); the materializer (@AC-8, @AC-19) and daily-refresh (@AC-19) cases). Import-only sources (these files are **not modified** by this step): `_materializer_svc`, `_upserted_rows`, `_due_schedule` from `tests.test_readiness_materializer`; `_mock_pool` from `tests.test_opportunity_refresh`; `_cache_svc` from `tests.test_readiness_cache`. `test_watchlist_readiness.py` is modified only by Step 4
- `services/xstockstrat-analysis/tests/test_analysis_servicer.py` — modify (Instruction 0 only: `_FakeOppRepo.read` / `available_sources` marker exemption)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `tests/test_unreadable_formula.py:293-307` `test_list_opportunities_unreadable_formula_is_not_unavailable` — uses `_materialized_svc(watchlists=[_wl(bindings=[("AAPL","s-1")])], strategies={"s-1": _row(definition)}, bars={"AAPL": _FIRING_BARS})`, `svc._indicators.ExecuteFormula = AsyncMock(side_effect=_not_found())`, `GetFormula` likewise, `by_symbol, _ = await _list_opps(svc)`; asserts `opp.data_unavailable is False` and `(opp.passing_conditions, opp.total_conditions) == (1, 2)` (pins the **old** skip behaviour — rewritten as the test-level face of the AC-14 retirement: now `(0, 0)`, `formula_unreadable True`, `data_unavailable False`).
- Fixtures in that file are hardcoded and single-consumer (`grep -rn test_unreadable_formula tests/` → only itself): `_definition(z_ref="z")` (`:40-70`) hardcodes `strategy_id="s-1"`, formula `f-zscore`; `_row(definition=None)` (`:73-83`) hardcodes `strategy_id "s-1"`, owner `bob`; `_WARNING = "formula f-zscore not readable by owner"` (`:27`). The Gherkin names (`f-9`, `MYSZ`, `s-2`, `s-3`, an "admin") are **narrative, not literals**: tests keep `f-zscore`, `bob` and assert on `_WARNING`; the symbol is free (`_wl(bindings=[("MYSZ","s-1")])`).
- Helpers confirmed: `tests/test_analysis_servicer.py:4774` `_materialized_svc(signals, held, watchlists, strategies, bars, source_weights, live_strategies)`, `:4884` `_list_opps` (drains the cold-read recompute kick); `:5806` `TestOpportunitySurgicalRecovery` (calls `_retry_unavailable_symbols` directly; `_unavailable_served_row` `:4665` and `_FakeReadinessCache` `:4651` are module-level and importable; `_META` is a per-class attribute, so the new heal cases declare their own `_META`); `:7908` `TestUnguardedReadinessParity_feature215` (re-run only, see Verification); `tests/test_readiness_materializer.py:48` `_materializer_svc`, `:93` `_upserted_rows`, `:27` `_due_schedule`; `tests/test_opportunity_refresh.py:18` `_mock_pool` (the daily-refresh tick itself is the servicer method `svc._opportunity_refresh_tick(schedule)`, called at `:42`/`:61`/`:82` with a `DurableSchedule(_mock_pool(), …)`); `tests/test_readiness_cache.py:27` `_cache_svc(bars_by_symbol, strategy_row=None)`; `tests/test_opportunities_fundamentals_guard.py:374` `test_ac13_heal_rewrites_to_skip_row_without_readiness_staging` / `:393` `test_heal_of_technical_row_carries_no_action_key` are the heal-row templates.
- Live-loop pins: `tests/test_unreadable_formula.py:89` `test_ac5_live_loop_skips_unreadable_component_as_owner` is a **NOT_FOUND skip** (not a PERMISSION_DENIED isolation) and `:172` `test_live_path_permission_denied_still_reraises` is evaluator-level; neither asserts the `live_loop: (…) error: … — continuing` warning (`app/engine/live_loop.py:~479`, `log.warning("live_loop: (%s,%s) error: %s — continuing", …)`).
- Fake-repo gap (Step 7 cannot fix a fake): `_FakeOppRepo.read` (`tests/test_analysis_servicer.py:4520`, floor at `~:4544-4550`) exempts only `denied`/`unavailable` from the conviction floor, and `_FakeOppRepo.available_sources` (`~:4586`) skips only `watchlist`/`position`/`denied` origins, so Instruction 1's `min_conviction=0.9` and `"formula_unreadable" not in available_sources` assertions would fail for the wrong reason without the fake extension in Instruction 0. The real-SQL floor / source behaviour stays covered by Step 4's `test_opportunities_repo.py` tests.
- Placement (circular-import constraint, extended to the materializer / daily-refresh / kick cases): `test_readiness_materializer.py:23-24` `_live_row` wraps `_simple_strategy_row()`, `test_watchlist_readiness.py:24` uses `_simple_strategy_row()` and `test_opportunity_refresh.py` has no strategy fixture, so none can hold a custom-formula case; importing `_row`/`_definition` into `test_readiness_materializer.py` is circular (`test_unreadable_formula.py:29` imports `tests.test_owner_header_guard`, whose `:31` imports `_due_schedule`, `_live_row`, `_materializer_svc` from `tests.test_readiness_materializer`). Those cases therefore also live in `test_unreadable_formula.py`, importing the helpers above; this is cycle-free because neither `test_readiness_materializer.py`, `test_opportunity_refresh.py` nor `test_readiness_cache.py` imports `test_unreadable_formula.py` (`grep -rn test_unreadable_formula tests/` → only itself).
- Placement (circular-import constraint): the `EvaluateReadiness` SLOW/FAST/timeout cases and the heal cases need the custom-formula `_row`, `_definition`, `_not_found`, `_sma_resp` that live in `test_unreadable_formula.py`; importing them into `test_analysis_servicer.py` is circular (`test_unreadable_formula.py:20-28` imports from it) and copying them breaks C-13 (Step 4 resolved the FAST case the same way). So those cases live in `test_unreadable_formula.py` and import `_unavailable_served_row` / `_FakeReadinessCache` from `tests.test_analysis_servicer`; `test_analysis_servicer.py` only gets the Instruction 0 fake extension.
- `_FakeOppRepo.replace_symbols` (`tests/test_analysis_servicer.py:4591-4611`) never stores `action`, so Instruction 5's `action` assertions cannot be read from stored rows; they read the rows handed to `replace_symbols` through a spy (precedent `_spy_heal`, `tests/test_opportunities_fundamentals_guard.py:366-370`).
- C-13 verdict: servicer-level seeds reuse the existing `tests/test_analysis_servicer.py` helpers (already a second-consumer home imported by `test_unreadable_formula.py`); the per-test `GetFormula` error stubs are inline one-offs; the `_definition`/`_row` parameterization stays in this single-consumer file.

**TDD**: red-green required — RED on today's tree for the right reason: today a refused formula yields `(1, 2)` / `data_unavailable True` / an aborting `EvaluateReadiness` / a heal that re-stamps `unavailable`. Characterization cases (AC-4, AC-5, AC-10, AC-11, AC-12, AC-13) are green on arrival and are regression guards, not red-first. The red cases are AC-1/2/3/8/9/15-21 and AC-26 (it first asserts the marked state before the marker clears, so it is red today; AC-16's unreferenced-component `s-2` assertions are green but sit in the same test as the red `s-1` marker assertions).

**Covers**: `AC-1, AC-2, AC-3, AC-4, AC-5, AC-8, AC-9, AC-10, AC-11, AC-12, AC-13, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-26`

**Instructions**:
0. **Fixtures first.** (i) `tests/test_analysis_servicer.py`: extend `_FakeOppRepo`: in `read` add `and "formula_unreadable" not in _prov` to the floor condition (match the real variable names at `~:4544-4550`); in `available_sources` add `"formula_unreadable"` to the skipped-origin tuple. Existing tests are unaffected. (ii) `test_unreadable_formula.py`: add `import logging` (Instruction 2's live-loop test uses `caplog.at_level(logging.WARNING, …)`; the file has no `logging` import or `caplog` use today), `timedelta` to the `datetime` import (heal rows are aged > 300 s), and `_unavailable_served_row` / `_FakeReadinessCache` to the existing `from tests.test_analysis_servicer import (…)` block (Instruction 3's `EvaluateReadiness` and Instruction 5's heal cases live in this file); parameterize `_definition(z_ref="z", formula_id="f-zscore", strategy_id="s-1")` (component `z`'s `formula_id`, `strategy_id` and `display_name`) and have `_row(definition=None)` take `strategy_id`/`display_name` from the definition (default behaviour unchanged for every existing caller). Build the `s-2`/`s-3` rows as `_materialized_svc(strategies={"s-1": _row(_definition()), "s-2": _row(_definition(z_ref="sma", strategy_id="s-2")), "s-3": _row(_definition(strategy_id="s-3"))}, …)` with matching `_wl(bindings=[(SYM, "s-1"), (SYM, "s-2"), (SYM, "s-3")])` bindings; assertions on the log use `_WARNING`, never an `f-9` literal.
1. **Opportunities** (`test_unreadable_formula.py`, @AC-1/15/16/17/18/21/26): rewrite `:293-307` (the Step 6 interim `(0, 0)` assertion becomes the full rewrite: `formula_unreadable True`, `data_unavailable False`, `(0, 0)`); add PERMISSION_DENIED and NOT_FOUND cases: `s-1` row has `formula_unreadable True`, `data_unavailable False`, present at `min_conviction=0.9`, `source != "formula_unreadable"`, `"formula_unreadable" not in available_sources`, no `"indicator RPC failed for <SYM>"` record, exactly one `_WARNING` record; `s-2` (unreferenced refused component, `z_ref="sma"`) evaluated normally with no marker. Non-held: action UNSPECIFIED, conviction 0, `signal_axis 0`, composite unset. Held (`held=[…]` in `_materialized_svc`, exit rule referencing the formula) Examples: sell signal → REDUCE, axis > 0, composite set; no signal → ADD, axis 0, composite unset; conviction 0 and 0/0 in both. Sibling `s-3` sharing the formula + a sibling `UNAVAILABLE` for another component on the same symbol → `s-1` and `s-3` stay marked regardless of completion order, one log line. After the formula becomes readable, the next recompute clears the marker (@AC-26).
2. **Outage / timeout characterization**: `UNAVAILABLE` → `data_unavailable True`, no marker (@AC-4); `success=false` "Formula execution timed out after 5000ms" → recompute fails with warning `"opportunity recompute failed"` and stored rows retained (@AC-10); `EvaluateReadiness` on the timeout raises `FormulaExecutionError` and is not converted to 0/0 (@AC-13); `RunBacktest` PERMISSION_DENIED stays FORMULA_ERROR "not readable by owner" (@AC-5; already pinned by `test_backtest_permission_denied_maps_to_formula_error_with_code` — re-assert, do not duplicate). **Live loop (@AC-11) — add a NEW test** (none exists): build `indicators = RecordingStub({"ExecuteFormula": aio_rpc_error(grpc.StatusCode.PERMISSION_DENIED, _ADMIN_REFUSAL), "GetFormula": _not_found(), "ComputeIndicator": _sma_resp})`, `loop = _live_loop(_ingest(), indicators, [_row()])` (`_live_loop`/`_ingest` from `tests/test_owner_header_guard`), run `await loop._run_cycle()` under `caplog.at_level(logging.WARNING, logger="app.engine.live_loop")`; assert the cycle completes without raising and, after filtering `caplog.records` on `r.name == "app.engine.live_loop"` (and `r.levelno == logging.WARNING`), exactly one record remains, whose message matches `live_loop: \(s-1,\w+\) error: .* — continuing`, and that no formula-unreadable sink/marker is involved (the live path is unchanged). Keep `:89`/`:172` as they are.
3. **Readiness paths** (@AC-2/3/20; all in `test_unreadable_formula.py`, which owns the custom-formula `_row`/`_definition`/`_not_found`/`_sma_resp`; the `EvaluateReadiness` timeout case of Instruction 2 lives there too): the SLOW/FAST servicer setups reuse Step 4 Instruction 2(b)'s, including `svc._strategies_repo = MagicMock(get_by_owner_and_id=AsyncMock(return_value=row_of_strategy))` (never assign onto the `None` that `make_servicer()` leaves at `servicer.py:547`). `EvaluateReadiness` SLOW → OK, 0/0, marker, no `AioRpcError`; second call within `stale_after_seconds` → FAST, marker, `ExecuteFormula` not re-awaited (use the custom-formula strategy row and a seeded fresh cache row from Step 4 Instruction 2(b), or a stateful cache stub that records the first call's upsert; the SLOW case needs the same `svc._indicators.GetFormula = AsyncMock(return_value=SimpleNamespace(fundamental_inputs=[]))` and an awaitable `ComputeIndicator` stub, since a bare `MagicMock` `GetFormula` raises `TypeError` on `await` at `servicer.py:3973`; when the refusal is the thing under test, `GetFormula` instead raises `_not_found()` as in the opportunities cases); `_kick_readiness_refresh` + `GetWatchlistReadiness` end to end (@AC-3) is **also in `test_unreadable_formula.py`** (not `test_watchlist_readiness.py`, whose `_wl_svc` builds only `_simple_strategy_row()` services): build the service with `_cache_svc(bars_by_symbol, strategy_row=_row(_definition()))` imported from `tests.test_readiness_cache` (its signature is `_cache_svc(bars_by_symbol, strategy_row=None)`; it wires `_strategies_repo.get_by_owner_and_id`, marketdata, a `ComputeIndicator` stub and an `AsyncMock` `_readiness_cache_repo`), then set `svc._indicators.GetFormula = AsyncMock(side_effect=_not_found())` and `ExecuteFormula` to the refusal → the symbol RESOLVED 0/0 marker and `AAPL` RESOLVED, no `"readiness refresh kick failed"` warning (`caplog`); `TestUnguardedReadinessParity_feature215` stays green (no `failures` argument added).
4. **Scheduled passes** (@AC-8, @AC-19; **all in `test_unreadable_formula.py`**, importing `_materializer_svc`, `_upserted_rows`, `_due_schedule` from `tests.test_readiness_materializer` and `_mock_pool` from `tests.test_opportunity_refresh`; `test_readiness_materializer.py` must NOT import from `test_unreadable_formula.py` — that would close the cycle through `test_owner_header_guard`). The live row is built inline as `{**_row(_definition()), "user_id": "bob", "strategy_id": "s-1"}` (not via `_live_row`, which wraps `_simple_strategy_row()`); after `_materializer_svc(...)` returns, set `svc._indicators.GetFormula` / `ExecuteFormula` to the refusal stubs. The daily-refresh case drives `svc._opportunity_refresh_tick(DurableSchedule(_mock_pool(), "opportunity", "wallclock", anchor_hour=lambda: 0))` as `test_opportunity_refresh.py:31-48` does. Materializer (`_materializer_svc`) with `owner_metadata` and a stub that answers NOT_FOUND when no admin bit is in metadata, and also with PERMISSION_DENIED: persisted verdict for the symbol/`s-1` is 0/0 + marker + `bar_epoch >= 0`, served fresh (not `-1`), the pass continues and writes `AAPL`; daily refresh tick (`_opportunity_refresh_tick`) yields the marked row.
5. **Heal** (@AC-9, @AC-12; in `test_unreadable_formula.py`, `TestOpportunitySurgicalRecovery` style, calling `svc._retry_unavailable_symbols` directly): data-unavailable row > 300 s, watchlist entry, `ExecuteFormula` now PERMISSION_DENIED → row carries the marker, no `"unavailable"` token, provenance and `readiness_json` agree in both the replace row and the staged readiness-cache row, held rows omit `action`, non-held rows bind `action 0`; a second `_retry_unavailable_symbols`/selector pass does not select it; recovery case (indicators healthy) restores an evaluated row (existing behaviour). Assert the `action` key (omitted for held, `0` for non-held) by spying `svc._opportunities_repo.replace_symbols = AsyncMock(side_effect=real)` and reading `spy.await_args.args[1]`, as `_spy_heal` does (`tests/test_opportunities_fundamentals_guard.py:366-370`; it also sets `svc._readiness_cache_repo = _FakeReadinessCache()`, which the staged-row assertion reads via `.upserted`). The fake `replace_symbols` does not store `action`. Declare the 2-line spy inline rather than importing across test files (C-13).
6. Header propagation: no new outbound call — assert (existing parity tests) that metadata is unchanged.

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-analysis && uv run pytest tests/test_unreadable_formula.py tests/test_readiness_materializer.py tests/test_opportunity_refresh.py tests/test_watchlist_readiness.py tests/test_analysis_servicer.py -q && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```
`tests/test_readiness_materializer.py`, `tests/test_opportunity_refresh.py` and `tests/test_watchlist_readiness.py` are listed as a harmless regression re-run of the import-source modules (this step does not modify them). `tests/test_analysis_servicer.py` is in the command for the Instruction 0 fake extension and the `TestUnguardedReadinessParity_feature215` re-run (no new cases are added there).
Confirm C-13: `grep -rn "def _not_found\|def _rpc_error" tests/` — no new duplicate declaration beyond the existing per-file one-consumer helpers.

---

### Step 8b — test: servicer paths (gate-ON fundamentals classification, per-owner formula cache)

**Status**: `pending`
**Service**: `xstockstrat-analysis`
**Files**:
- `services/xstockstrat-analysis/tests/test_backtest_fundamentals_guard.py` — modify (@AC-22)
- `services/xstockstrat-analysis/tests/test_grade_fundamentals_exclusion.py` — modify (@AC-23; `:387-396` per-owner cache; u1/u2 poisoning test)
- `services/xstockstrat-analysis/tests/test_opportunities_fundamentals_guard.py` — modify (@AC-24, @AC-25)
- `services/xstockstrat-analysis/tests/test_fundamentals_pit_pager.py` — modify (NOT_FOUND parity at `:295-311`)

**Reviewers**: xstockstrat-analysis owner — backtest reproducibility, strategy scoring determinism, no look-ahead bias

**Codebase Evidence**:
- Confirmed via: `tests/test_backtest_fundamentals_guard.py:127` `_svc(gate=…)`, `:167` `_req`, `:66` `_blend`, `:235` gate-on outage pattern `_RERUN`, `:292`/`:312` formula-map outage with gate on/off; `tests/test_fundamentals_pit_pager.py:162` `_gated_servicer`, `:82` `_formula_definition`, `:295-311` sibling tests (servicer `:295-302`, evaluator `:304-311`; both use UNAVAILABLE today); `tests/test_grade_fundamentals_exclusion.py:87` `_blend_svc(cells)`, `:55` `_cell`, `:98` `_CountingSem`, `:387-396` boot-pass test (`GetFormula` count assertion `:396`; `:395` is the `GetHistoricalFundamentals` count); `tests/test_opportunities_fundamentals_guard.py:215-409` skip-row / heal cases (`:374`, `:393`).
- Today with the gate ON a refused `GetFormula` records `failures[("formula", fid)] = UNKNOWN` (`servicer.py:1926-1929`), which short-circuits to UNKNOWN before `ExecuteFormula` — hence RED here.
- C-13 verdict: gate-ON fixtures reuse each file's existing one-consumer helpers; the per-test `GetFormula` error stubs are inline one-offs.

**TDD**: red-green required — RED on today's tree for the right reason: with the gate ON the refusal short-circuits to UNKNOWN (backtest "fundamentals fetch failed — rerun", ScoreStrategy abort, `unavailable` opportunity) before `ExecuteFormula` is reached. Characterization case AC-25 (`GetFormula` UNAVAILABLE stays data-unavailable) is green on arrival and is a regression guard, not red-first. The red cases are AC-22/23/24.

**Covers**: `AC-22, AC-23, AC-24, AC-25`

**Instructions**:
1. **Fundamentals gate ON** (@AC-22/23/24/25): `RunBacktest` with `analysis.backtest.fundamentals.enabled` true and `GetFormula`+`ExecuteFormula` NOT_FOUND, with and without an explicit start → `NO_TRADE_REASON_FORMULA_ERROR`, warning `"backtest symbol AAPL not evaluated: NOT_FOUND"`, no `"rerun"` warning, status INSUFFICIENT_DATA (the explicit-start branch exercises `_prefetch_formula_warmups` → `_declared_formula_warmup`); `ScoreStrategy` succeeds with trailer `x-score-excluded-symbols` `"[]"`, while `GetFormula` UNAVAILABLE still aborts UNAVAILABLE "fundamentals availability unknown — grade unchanged"; opportunities compute and heal with the gate ON yield the marker and are not re-selected (`test_opportunities_fundamentals_guard.py`); `GetFormula` UNAVAILABLE with the gate ON stays `data_unavailable` with its action kept. `test_fundamentals_pit_pager.py`: add NOT_FOUND parameters — servicer sibling asserts `fmap == {}` and `failures == {}`; evaluator sibling (`declared_formula_fundamentals`) asserts `failures == {("formula","divf"): UNKNOWN}` (pins the live twin as unchanged). Gate OFF: unchanged outcomes (existing `:267`, `:312` tests).
2. **Per-owner formula cache**: update `test_boot_pass_shares_cache_and_takes_background_sem` (the `GetFormula` count assertion at `:396`) to expect one `GetFormula` per distinct owner (2); add a test: u1's `GetFormula` refused, u2's readable fundamentals formula → u2 still excludes the ETF 0-trade cell (SCHD) regardless of pair order.
3. No new outbound call is added by Step 7's classification change — the existing metadata assertions in these files stay unchanged.

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-analysis && uv run pytest tests/test_backtest_fundamentals_guard.py tests/test_grade_fundamentals_exclusion.py tests/test_opportunities_fundamentals_guard.py tests/test_fundamentals_pit_pager.py -q && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```

---

### Step 9 — service: agent `list_opportunities` consumer surface (C-14)

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify (tool docstring)
- `docs/runbooks/mcp-tools.md` — modify (`list_opportunities` section)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity; tool-count statements kept in sync across all six inventory surfaces; no secret values in tool output

**Codebase Evidence**:
- Confirmed via: `grep -n "async def list_opportunities" services/xstockstrat-agent/app/tools.py` → `:1679`; docstring field list `:1692-1704` includes `data_unavailable (true = a terminal data-unavailable row, distinct from an evaluated 0/N), fundamentals_unavailable (…), fundamentals_gap (…)`.
- Confirmed via: `client.py:817-879` `_opportunity_to_dict` is an explicit whitelist; Step 2 added `"formula_unreadable": o.formula_unreadable` after `"fundamentals_gap"` (`:841`); `tools.py` docstring `min_conviction` line (`:1687`) says muted rows are exempt (already incomplete — fix only the field list this feature touches).
- Confirmed via: `docs/runbooks/mcp-tools.md:1054-1090` — the `list_opportunities` section; return paragraph `:1068-1073`, feature-215 bullets `:1075-1082`.
- Confirmed via: `services/xstockstrat-agent/CLAUDE.md:70` tool-table row `list_opportunities | List the caller's ranked Decide-queue opportunities…` (no sentinel wording; **no tool is added or removed, so the tool-count statements need no change**).
- No readiness tool exists in the agent (`grep -n "EvaluateReadiness" services/xstockstrat-agent/app/` → none; per `recon.md`).
- `plugins/strat-lab/skills/backtest/SKILL.md` has no `list_opportunities` dependency (grep → none), so the strat-lab rule is handled in Step 13 only for the backtest-behaviour change.

**TDD**: red-green required — the red run is Step 10 Instruction 3 (docstring mentions `formula_unreadable`), written and run **before** this step's `tools.py` edit; the projection key itself was already carried by Step 2.

**Covers**: —

**Instructions**:
1. `tools.py:1692-1704`: add to the field list `formula_unreadable (true = the row's strategy references a formula this account cannot read — missing, private to another user, or its author record needs repair; a NON-ACTIONABLE row for a non-held symbol: action UNSPECIFIED, conviction 0, no composite_score; a held row keeps its action; never also data_unavailable)`. Keep the docstring within the existing style (no secret values; omit-not-fabricate unchanged). The projection key itself was added in Step 2.
2. `docs/runbooks/mcp-tools.md`: in the `list_opportunities` section add a feature-289 bullet group after the feature-215 bullets (`:1075-1082`): the `formula_unreadable` semantics above, exempt from the `min_conviction` floor, never an `Opportunity.source` / `available_sources` facet, mutually exclusive with `data_unavailable` and `fundamentals_unavailable`.
3. `services/xstockstrat-agent/CLAUDE.md:70` (the tool-table row) has no sentinel wording and no tool is added or removed, so no edit is made there (`grep -n "data_unavailable" services/xstockstrat-agent/CLAUDE.md` → none confirms it; if a hit appears, extend it and add the file to this step's Files).

**Verification**: Step 10's command plus lint:
```bash
cd /home/user/xstockstrat/services/xstockstrat-agent && ruff check . && ruff format --check .
```

---

### Step 10 — test: agent projection

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_opportunity_projection.py` — modify
- `services/xstockstrat-agent/tests/test_client.py` — modify (`list_opportunities` mapping, near `:1352-1385`)
- `services/xstockstrat-agent/tests/test_tools.py` — modify (list_opportunities docstring mentions formula_unreadable)

**Reviewers**: xstockstrat-agent owner — MCP tool contract stability (name, parameters, return shape) and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- Confirmed via: `tests/test_tools.py:1103-1111` `test_docs_surfaces_state_rule_string_or_object` — the docstring-assertion pattern Instruction 3 follows (`server._tool_manager.get_tool(name).description`, whitespace-normalized); `tests/test_list_correlation_parity.py:122` pins a different `list_opportunities` docstring concern (join keys) and is not modified.
- Confirmed via: `tests/test_opportunity_projection.py:50-54` `test_opportunity_projection_covers_every_proto_field`, `:57-64` `test_guard_has_teeth`, `:94-109` existing value tests; `tests/test_client.py:1352-1385` `list_opportunities` mapping tests.
- Confirmed via: `tests/test_tools.py` holds tool-surface/docstring assertions (file listed in `ls tests/`).
- C-13 verdict: `_full_opportunity` already lives once in `test_opportunity_projection.py`; the `test_client.py` case builds its own minimal message (single consumer, inline).

**TDD**: Instructions 1-2 are **regression guards, green on arrival** — Step 2 already carried `"formula_unreadable"` through `_opportunity_to_dict`, so the projection and `list_opportunities` mapping assertions pass the moment they are written (AC-6 projection coverage is therefore guard-covered, not red-first). Only Instruction 3 (the `list_opportunities` docstring mentions `formula_unreadable`) is red-then-green, and only if it is authored **before** Step 9's docstring edit: Step 9 is numbered before Step 10, so `/sdd-execute` must write and run Instruction 3's assertion first (RED: docstring lacks the field), then apply Step 9's `tools.py` edit (GREEN). If Step 9 has already landed, Instruction 3 is a guard like the others and no red run is claimed.

**Covers**: `AC-6`

**Instructions**:
1. `test_opportunity_projection.py`: add `test_formula_unreadable_projected_true_and_false` — `_opportunity_to_dict` of an `Opportunity(formula_unreadable=True)` yields `d["formula_unreadable"] is True`, a default message yields `False`, and `data_unavailable`/`fundamentals_unavailable` are independent (@AC-6).
2. `test_client.py`: extend the `list_opportunities` mapping case so a returned page with the marked `MYSZ`/`s-1` row surfaces `formula_unreadable True` in `["opportunities"][0]` (@AC-6).
3. Add a tools-level assertion (`tests/test_tools.py`, following its existing docstring/inventory checks) that the `list_opportunities` docstring mentions `formula_unreadable`.
4. Keep `_full_opportunity` as the single fixture (extended in Step 2).

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-agent && uv run pytest tests/test_opportunity_projection.py tests/test_client.py tests/test_tools.py -q && uv run pytest --cov=app --cov-fail-under=40 && ruff check . && ruff format --check .
```

---

### Step 11 — service: UI consumer surface (C-14, C-17)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/readinessRollup.ts` — modify
- `services/xstockstrat-ui/src/lib/readinessCue.ts` — modify
- `services/xstockstrat-ui/src/lib/readinessRollup.test.ts` — modify (mechanical, keeps `tsc` and the existing assertions green at this step's boundary: `formulaUnreadable: false` on the 5 `readinessState` calls (`:6-9`, `:13`) AND on every `rollupReadiness` row literal (`:27-30`, `:40`); the `toEqual` at `:35` gains `unreadable: 0`; the sum invariants at `:50`, `:57` gain `+ c.unreadable`)
- `services/xstockstrat-ui/src/lib/opportunityShared.test.ts` — modify (mechanical: add `'unreadable'` to the `states` list at `:9`)
- `services/xstockstrat-ui/src/app/insights/opportunities/page.tsx` — modify
- `services/xstockstrat-ui/src/components/mobile/sections.ts` — modify
- `services/xstockstrat-ui/src/components/mobile/SectionRenderer.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/WatchlistReadiness.tsx` — modify
- `services/xstockstrat-ui/src/components/insights/SignalReadiness.tsx` — modify
- `services/xstockstrat-ui/src/app/trader/positions/[symbol]/page.tsx` — modify

**Reviewers**: xstockstrat-ui owner — trading UI correctness, analytics display accuracy, Connect-RPC call safety, no secret values rendered in UI, no direct DB access

**Codebase Evidence**:
- Confirmed via: `src/lib/readinessRollup.ts` — `export type ReadinessState = 'firing' | 'watching' | 'quiet' | 'nodata'` (`:13`); `readinessState(r)` (`:20-28`, `totalConditions === 0` → `'nodata'`); `ReadinessCounts` + `rollupReadiness(readiness, requestedSymbols)` (`:30-62`; sum invariant documented at `:36-39`). `src/lib/readinessCue.ts:15-20` `READINESS_CUE: Record<ReadinessState, EnumRender>` (imports `Lightning, Eye, Moon, Question, Stack` from `@phosphor-icons/react`, `:7`); `SemanticRole = 'buy'|'sell'|'paper'|'secondary'|'info'` (`src/lib/opportunityShared.tsx:19`) — no warning role.
- Call sites to update (`tsc` flags each once `formulaUnreadable` is required): `src/app/insights/opportunities/page.tsx:60` (`readinessVariant(passing: number, total: number)` takes bare numbers and calls `readinessState({ passingConditions, totalConditions })` at `:61`; its one call site is `:559`, `readinessVariant(o.passingConditions, o.totalConditions)`), `src/components/mobile/SectionRenderer.tsx:158`, `src/components/insights/SignalReadiness.tsx:108`, `src/components/insights/WatchlistReadiness.tsx:52` (`barVariant`), `:74` (`stateLabel`), `:235` (`rollupReadiness`), `:296` (`cueState`), plus `readinessRollup.test.ts`: the 5 `readinessState` calls (`:6-9`, `:13`) and the `rollupReadiness` row literals (`:27-30` via the shared `readiness` array, `:40`) — `tsconfig` includes `**/*.ts`, so a required `formulaUnreadable` on the rollup row type breaks `tsc` on every un-updated literal; adding `unreadable` to `ReadinessCounts` also breaks the `toEqual({ ready: 1, watching: 1, quiet: 1, nodata: 1 })` at `:35` and the sum invariants at `:50`, `:57` no longer cover all buckets (they must add `c.unreadable`).
- `opportunities/page.tsx`: mobile mapping `signals: g.opps.map((o) => ({ … dataUnavailable: o.dataUnavailable (:196), fundamentalsUnavailable (:197), … }))` starts `:191` (the **single** `SignalItem` construction site: `grep -rn "SignalItem"` → only `sections.ts:13` and the renderer); row header badge priority `:502-513` (fundUnavailable → muted → action); "Readiness" cell chain `:541-570` (`o.dataUnavailable` → `role="status"` span testid `opportunity-unavailable-${o.symbol}` `:545-552`, `fundUnavailable` `—` `:553-554`, `hasReadiness` Progress `:555-568`); act buttons suppressed for `fundUnavailable` at `:632`.
- `sections.ts:13-35` `SignalItem` (optional flags `dataUnavailable?`, `fundamentalsUnavailable?`); `SectionRenderer.tsx:150-165` `SignalRow` (`rs = readinessState(...)`), `:170-176` badge chain, `:235-246` `s.dataUnavailable` cue testid `opportunity-unavailable-mobile-${s.symbol}`.
- `SignalReadiness.tsx`: `isHeld = pairRow?.provenance.includes('position')` `:47`; `pairRow?.fundamentalsUnavailable && <CardNotice>` `:73-79` (testid `readiness-fundamentals-unavailable`); branch chain `:80-92` (`!readiness || readiness.conditions.length === 0` at `:92`); `readiness = data?.readiness?.[0]` (the `EvaluateReadiness` result). Detail header: `trader/positions/[symbol]/page.tsx:1008-1016` badge chain (`opportunity.fundamentalsUnavailable ? EnumBadge testId="detail-fundamentals-unavailable" : EnumBadge OPPORTUNITY_ACTION[…]`).
- `WatchlistReadiness.tsx:296-318` verdict cell: `READINESS_CUE[cueState]` with `testId={`readiness-cue-${cueState}`}`; UNKNOWN branch `readiness-unknown-${binding.symbol}` `:320-328`.
- BFF `src/lib/insightsBff.ts:63,68,71` is a plain `forward(...)` — the new camelCase field flows untouched (`recon.md`; no change).
- `CardNotice` (`src/components/shared/CardNotice.tsx:3-23`, variants `muted|error`), `EnumBadge`/`EnumRender`, `QueryStateMessages` are the C-17 primitives.
- **Not verified in this tree:** `LockSimple` in the installed `@phosphor-icons/react` (`^2.1.7` in `package.json`; `node_modules` not installed here, and `grep -rn LockSimple src` → none). Step action: `grep -n "LockSimple" node_modules/@phosphor-icons/react/dist/index.d.ts` after `pnpm install`; fall back to `Lock` if absent.

**TDD**: red-green required (paired with Step 12, which is authored first).

**Covers**: —

**Instructions**:
1. `readinessRollup.ts`: `ReadinessState` gains `'unreadable'`; `readinessState(r)` takes a **required** `formulaUnreadable: boolean` field and returns `'unreadable'` **before** the `totalConditions === 0` check (so a 0/0 marked row is never `nodata`); `ReadinessCounts` gains `unreadable`, and `rollupReadiness`'s row param type gains `formulaUnreadable: boolean` (a requested symbol with no row stays `nodata`); the sum invariant `ready + watching + quiet + nodata + unreadable === requestedSymbols.length` holds (update the doc comment). Making it required lets `tsc` flag every literal call; fix each (generated proto objects already carry `formulaUnreadable` after Step 2). In `readinessRollup.test.ts` (mechanical edits only; new unreadable cases belong to Step 12): add `formulaUnreadable: false` to the 5 `readinessState` calls (`:6-9`, `:13`) and to every `rollupReadiness` row literal (`:27-30`, `:40`); change `:35` to `toEqual({ ready: 1, watching: 1, quiet: 1, nodata: 1, unreadable: 0 })`; add `+ c.unreadable` to the sum invariants at `:50` and `:57`.
2. `readinessCue.ts`: `unreadable: { label: 'formula not readable', role: 'secondary', icon: LockSimple }` (fallback `Lock`; icon + text keeps it distinct from "quiet"/"no data", `@AC-4 @feature-155`). `readinessVariant`'s signature gains `formulaUnreadable: boolean` (`readinessVariant(passing, total, formulaUnreadable)`, forwarded into its `readinessState` call at `:61`) and its sole call site `:559` passes `o.formulaUnreadable`. `barVariant` / `stateLabel` / `readinessVariant` have declared return types, so the new case is a type error until handled: `barVariant`/`readinessVariant` → `'muted'`, `stateLabel` → `'formula not readable'`.
3. `opportunities/page.tsx`: derive `held = o.provenance.includes('position')` exactly as `SignalReadiness.tsx:47` does. Header badge priority: fundUnavailable → (`o.formulaUnreadable && !held`: `EnumBadge` of `READINESS_CUE.unreadable`) → muted → action; for a **held** unreadable row show the action badge **plus** the cue. Readiness cell: add a branch directly after the `o.dataUnavailable` branch (`:541-552`; the two markers are mutually exclusive, so order is immaterial): `o.formulaUnreadable ? <span role="status" data-testid={`opportunity-formula-unreadable-${o.symbol}`} aria-label={`Formula not readable for ${o.symbol}`}>` with the cue icon + text "formula not readable" (accessible name includes the symbol; C-17 unique name). Hide act buttons for a non-held unreadable row like `fundUnavailable` (`:632`). Mobile mapping: add `formulaUnreadable: o.formulaUnreadable` beside `dataUnavailable` (`:196`).
4. `sections.ts`: `SignalItem` gets a **required** `formulaUnreadable: boolean` (deliberate divergence from the optional sibling flags, so `tsc` catches the single construction site). `SectionRenderer.tsx`: pass `formulaUnreadable` into `readinessState` (`:158`); render `data-testid={`opportunity-formula-unreadable-mobile-${s.symbol}`}` cue in the readiness slot (`:235`) before the `hasReadiness` meter; the action badge chain (`:170`) is unchanged so a held row keeps its badge.
5. `WatchlistReadiness.tsx`: RESOLVED 0/0 + marker → `readinessState(r)` is `'unreadable'` → `READINESS_CUE.unreadable` with label "formula not readable" (testid `readiness-cue-unreadable`, via the existing `readiness-cue-${cueState}` pattern `:315`), and the `unreadable` count fragment in the rollup summary (`rollupReadiness` result). `blockingCondition` is `—` for 0 conditions already.
6. `SignalReadiness.tsx`: add a branch **before** `!readiness || readiness.conditions.length === 0` (`:92`): `readiness?.formulaUnreadable` → `<div data-testid="readiness-formula-unreadable"><CardNotice>` with the copy below `</CardNotice></div>`. Key it off the **`EvaluateReadiness` result**, not `pairRow`. Signal-detail header (`trader/positions/[symbol]/page.tsx:1008`): non-held unreadable → `EnumBadge render={READINESS_CUE.unreadable} testId="detail-formula-unreadable"`; held → action badge plus that cue.
7. Copy (neutral — covers missing formulas and legacy-author rows; cross-reference `docs/runbooks/legacy-formula-authors.md`; soft-deleted formulas still execute): *"A formula in this strategy isn't readable by your account (missing, private to another user, or its author record needs repair), so readiness can't be shown here."*
8. `CopilotRail` / `copilot.ts:38-52` need no change (UNSPECIFIED rows tally under `OPPORTUNITY_ACTION[UNSPECIFIED].label`, as muted / fund_skip rows already do). Use design-role tokens only (no hex/oklch literals), no new `ui/*` primitive (C-17).
9. CLAUDE.md edits are in Step 13.

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-ui && pnpm install --frozen-lockfile && pnpm exec tsc --noEmit && pnpm run lint && pnpm run format:check && pnpm run test:unit
```
(Step 12 supplies the Playwright run.)

---

### Step 12 — test: UI fixtures, vitest, Playwright (C-12)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/readinessRollup.test.ts` — modify (new unreadable cases)
- `services/xstockstrat-ui/src/lib/opportunityShared.test.ts` — modify (`READINESS_CUE.unreadable` data-only assertions)
- `services/xstockstrat-ui/e2e/fixtures/opportunities.ts` — modify (MYSZ unreadable rows, exported separately and NOT added to `OPPORTUNITIES`; `READINESS_BUCKET_OVERRIDE` `MYSZ` entry + `formulaUnreadable?` type)
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify (catalog rows)
- `services/xstockstrat-ui/e2e/helpers/watchlistMock.ts` — modify (RESOLVED 0/0 with the marker)
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (`MARKERS` and the floor emulation; `listOpportunities` `MYSZ` pool branch)
- `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts` — modify (desktop, mobile and held cases via a per-test `page.route`)
- `services/xstockstrat-ui/e2e/insights/watchlist-readiness-list.spec.ts` — modify
- `services/xstockstrat-ui/e2e/trader/position-detail.spec.ts` — modify

**Reviewers**: xstockstrat-ui owner — trading UI correctness, analytics display accuracy, Connect-RPC call safety, no secret values rendered in UI

**Codebase Evidence**:
- C-12 inventory (cited `e2e/fixtures/INVENTORY.md`, lines `:40,41,43,71,74` at recon): "Opportunity queue — `OPPORTUNITIES`", "Fundamentals skip row (215) — `SCHD_FUNDAMENTALS_UNAVAILABLE_OPPORTUNITY`", "Symbol readiness — `symbolReadiness`", the `READY1/WATCH1/QUIET1/NODATA1` override row, "Watchlists (stateful mock) — `mockWatchlists`". **Reuse/extend**: `OPPORTUNITIES` (`fixtures/opportunities.ts:72`; the PLTR data-unavailable row `:163-176` is the template), `READINESS_BUCKET_OVERRIDE` (`:310-318`, `NODATA1` = 0/0), `symbolReadiness` (`:275`), `mockWatchlists` (`helpers/watchlistMock.ts`; `ReadinessStateOverrides = Record<string, 'pending' | 'unknown'>` `:39`; RESOLVED rows `:251`). New domain object (the unreadable row) gets a fixture + `INVENTORY.md` catalog row **in this step**; scenario one-offs stay inline.
- `e2e/mock-backend.ts`: `MARKERS = ['watchlist','position','denied','fundamentals_unavailable']` `:935`; floor emulation `:945-956` (`o.muted || o.dataUnavailable || fundamentalsUnavailable || o.conviction >= min`); facet filter `:985`; `evaluateReadiness` `:1008-1030` merges `READINESS_BUCKET_OVERRIDE`. `e2e/insights/opportunities.spec.ts:57` is the **only other** floor-exemption copy (feature 190 moved filtering server-side; there is no UI `useMemo` copy); it filters `OPPORTUNITIES`, which excludes the marked rows (served from a bespoke per-test `page.route`), so it needs no edit. Existing cue specs: `opportunities.spec.ts:380-399,425,586-588,651-669`, `watchlist-readiness-list.spec.ts:53-69`, `position-detail.spec.ts:827-833` (`detail-fundamentals-unavailable` pattern).
- Vitest: `src/lib/readinessRollup.test.ts` (`readinessState` `:6-13`, `rollupReadiness` `:34-55`), `src/lib/opportunityShared.test.ts:9-26` (cue data contract). Coverage threshold 40% scoped to `src/lib/**` (`CLAUDE.md` § Testing).

**TDD**: red-green required — Playwright and the new vitest cases are authored first and FAIL against the pre-Step-11 UI (no `formulaUnreadable` branch, `readinessState` ignores the flag, `READINESS_CUE.unreadable` undefined).

**Covers**: `AC-7, AC-27`

**Instructions**:
1. Vitest: `readinessState({passingConditions:0,totalConditions:0,formulaUnreadable:true})` → `'unreadable'` (not `'nodata'`), also with non-zero counts; false keeps the existing mapping; `rollupReadiness` counts an unreadable row in the `unreadable` bucket and `ready+watching+quiet+nodata+unreadable === requestedSymbols.length` for mixed input; `READINESS_CUE.unreadable` has a non-empty label, a valid role and a defined icon; the state list in the "exactly one entry per state" test includes `'unreadable'`.
2. Fixtures: in `fixtures/opportunities.ts` add `MYSZ_FORMULA_UNREADABLE_OPPORTUNITY` (non-held: action UNSPECIFIED, conviction 0, 0/0, `provenance ['watchlist','formula_unreadable']`, `formulaUnreadable: true`) and a held variant (`provenance […,'position','formula_unreadable']`, `action: OpportunityActionTag.REDUCE`, `formulaUnreadable: true`); `INVENTORY.md` rows for both.
   - **Neither is added to the `OPPORTUNITIES` array** (`fixtures/opportunities.ts:72`): that array drives the sort, count, facet, copilot-tally and mobile-overflow assertions in other specs. Follow the `SCHD_FUNDAMENTALS_UNAVAILABLE_OPPORTUNITY` precedent (exported separately, reachable only on demand). For the **queue surfaces** (`/insights/opportunities` desktop and mobile), serve the marked row from a per-test `page.route` in `opportunities.spec.ts` (the default mock-backend `listOpportunities` is not the place). For **`/trader/positions/MYSZ`**, add a `symbol === 'MYSZ'` pool branch in `mock-backend.ts` `listOpportunities` mirroring the SCHD branch (`:941-944`, `[... as unknown as Opp]`), serving the non-held variant only (the held variant is served by the per-test `page.route`; no assertion here exercises `evaluateReadiness` on the EXIT rule, so `exitReadiness` is untouched).
   - `mock-backend.ts`: add `'formula_unreadable'` to `MARKERS` (`:935`) and `(o as { formulaUnreadable?: boolean }).formulaUnreadable` to the floor emulation (`:945-956`) — the cast is required: `tsconfig.json:21` includes `**/*.ts` so `e2e/` is typechecked, and `Opp` (`typeof OPPORTUNITIES[number]`) has no `formulaUnreadable` (TS2339), exactly as for the existing `fundamentalsUnavailable` access at `:951`. If any test routes the marked row through `mockOpportunities`, require the same cast there.
   - **Readiness override is keyed by symbol** (`READINESS_BUCKET_OVERRIDE[s]` in `mock-backend.ts:1024` and `watchlistMock.ts:254`). The position-detail and watchlist assertions use `MYSZ`, so key the entry `MYSZ: { passingConditions: 0, totalConditions: 0, formulaUnreadable: true }` (not `UNREADABLE1`) — `MYSZ` appears in no other spec's readiness path (`grep -rn MYSZ e2e/` → no hit in this tree, so the key is collision-free). Extend the override's TS type to `{ passingConditions?: number; totalConditions?: number; formulaUnreadable?: boolean }` (`fixtures/opportunities.ts:310-313`). `watchlistMock.ts` then renders `MYSZ` as RESOLVED 0/0 with the marker (it already spreads the override). If a spec needs a second symbol on the watchlist panel, add `UNREADABLE1` as an additional entry rather than re-keying.
3. Playwright (`@AC-7` Scenario Outline, four surfaces; unique accessible names per C-17): `/insights/opportunities` → `opportunity-formula-unreadable-MYSZ` visible, `opportunity-unavailable-MYSZ` absent, no `0/0` progress; mobile project → `opportunity-formula-unreadable-mobile-MYSZ`; `/insights/watchlists` readiness panel → `readiness-cue-unreadable` with text "formula not readable" and not `readiness-unknown-*`; `/trader/positions/MYSZ?strategy=…` → `readiness-formula-unreadable` notice and `detail-formula-unreadable` header cue. `@AC-27`: held REDUCE row → the REDUCE action badge **and** the `formula not readable` cue are both visible, not the data-unavailable state. Row stays visible at the default `min_conviction` and a raised floor.
4. Keep imports from `e2e/fixtures` / `helpers/auth` (C-12): `grep -n "from '../fixtures'\|from './fixtures'\|helpers/auth"` on touched specs.

**Verification**:
```bash
cd /home/user/xstockstrat/services/xstockstrat-ui && pnpm run test:coverage && pnpm exec tsc --noEmit && pnpm run lint && pnpm run format:check && pnpm exec playwright test e2e/insights/opportunities.spec.ts e2e/insights/watchlist-readiness-list.spec.ts e2e/trader/position-detail.spec.ts
```
(`vitest.config.ts` thresholds: lines/functions/statements 40 on `src/lib/**`. `./scripts/run-e2e.sh` is the hermetic Docker alternative when Chromium is unavailable. Also confirm `INVENTORY.md` lists the new fixture symbols: `grep -n "MYSZ_FORMULA_UNREADABLE\|MYSZ" services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`.)

---

### Step 13 — docs: context files, runbook cross-references, strat-lab clause, operator note

**Status**: `pending`
**Service**: `docs/` and per-service `CLAUDE.md`
**Files**:
- `services/xstockstrat-analysis/CLAUDE.md` — modify
- `services/xstockstrat-ui/CLAUDE.md` — modify
- `plugins/strat-lab/skills/backtest/SKILL.md` — modify
- `plugins/strat-lab/skills/backtest/reference/output-handling.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `services/xstockstrat-analysis/CLAUDE.md:49-52` — "**Unreadable formula.** An indicators `NOT_FOUND` … the other surfaces skip the component with a warning." (this contract is a signed-off C-16 CHANGE: non-backtest traced surfaces now mark the row; the NOT_FOUND log string is kept). `:224-225` — the `ListOpportunities` bullet (`…Feature 185: …data-unavailable sentinel…`, floor sentence `OR provenance ? 'fundamentals_unavailable'`) and the `Fundamentals skip row` sub-bullet. `:432` "Backtest refusal", `:443` "Opportunity skip row", `:457-465` "Evidence exclusion (H)" incl. "Gate-off re-includes refused cells (Open Risk 3)" — gate-ON behaviour for a refused `GetFormula` changes here.
- Confirmed via: `services/xstockstrat-ui/CLAUDE.md:119-138` — the Decide-screens bullets incl. `:132` "**Fundamentals skip row (feature 215).**" sub-bullets; `:143` "Enum render maps"; `:157` "Mobile companion"; Key File Paths rows `:399`, `:401`.
- Confirmed via: `plugins/strat-lab/skills/backtest/SKILL.md:178-199` ("Fundamentals-gated strategies refuse un-evaluable symbols (feature 215)" — the `fundamentals fetch failed for <SYM> — rerun` warning; "Symbols that could not be evaluated are reported, never skipped (feature 275)" — `NOT_FOUND`/`PERMISSION_DENIED` → FORMULA_ERROR), and `reference/output-handling.md:25-36`. Root `CLAUDE.md` Context Guide: a change to `run_backtest` behaviour must update the `backtest` skill in the **same** PR. With the fundamentals gate ON, a refused formula now yields FORMULA_ERROR instead of the "rerun" warning — the skill's rerun advice for real outages is unchanged.
- `docs/runbooks/legacy-formula-authors.md` exists (cross-reference target).

**TDD**: N/A (docs)

**Covers**: —

**Instructions** (each edit ≤ the minimal sentence; comments-style rule: constraints not narration):
1. Analysis `CLAUDE.md`: (a) `:49-52` — rewrite to: on every non-backtest path that traces readiness (`_compute_opportunities`, `EvaluateReadiness`, kick/`GetWatchlistReadiness`, materializer, daily refresh, heal) an indicators `NOT_FOUND` **or** `PERMISSION_DENIED` on a formula the traced rule references yields `formula_unreadable` (0/0, `bar_epoch >= 0`); an unreferenced refused component is skipped with one log line; backtest unchanged; **the live loop still skips / isolates**, so on an OR rule it may fire while the queue shows "formula not readable" (recorded Open Risk, `@AC-5 @feature-224`). (b) `:224` — add the `formula_unreadable` marker to the provenance/floor/structural-marker sentence and the non-held/held rank rule. (c) The § Fundamentals availability guard (`:432`, `:443`, `:457-465`): with the gate ON a refused `GetFormula` is "not a fundamentals formula" (no UNKNOWN), reaching `ExecuteFormula` → FORMULA_ERROR in backtests, no ScoreStrategy abort, marker in opportunities; outages still UNKNOWN; gate OFF unchanged; the live twin `declared_formula_fundamentals` unchanged; per-owner formula cache in `recompute_unscored_pairs`; Open Risk 3 now also applies with the gate ON.
2. UI `CLAUDE.md`: add a "**Formula-unreadable row (289).**" sub-bullet after the 215 bullet (`:132-138`) — testids `opportunity-formula-unreadable-<sym>`, `opportunity-formula-unreadable-mobile-<sym>`, `readiness-formula-unreadable`, `detail-formula-unreadable`, `readiness-cue-unreadable`; held rows show the action badge plus the cue; `readinessState` takes a required `formulaUnreadable`; update `:119-125`/`:176-179`-style readiness mentions and the "Enum render maps (083)" / "Mobile companion (083)" rows only where they enumerate states/flags.
3. strat-lab: in `SKILL.md` (feature-215/275 paragraphs, `:178-199`) and `reference/output-handling.md:25-36` add one sentence, starting `(feature 289)`: with `analysis.backtest.fundamentals.enabled` on, a symbol whose formula indicators refuses is `NO_TRADE_REASON_FORMULA_ERROR` (warning `backtest symbol <SYM> not evaluated: NOT_FOUND|PERMISSION_DENIED`), not the `fundamentals fetch failed … rerun` warning.
4. Reference the filed follow-up defect `docs/reports/2026-11-05-analysis-readiness-batch-loss-on-indicator-outage-defect.md` in the analysis `CLAUDE.md` open-risk sentence (do **not** re-create the report).
5. Operator action (restated for the PR body, not a repo edit): run the blast-radius SQL from § Execution Summary and the `legacy_authors` report-mode command before the dev rollout; note the expected flip of quiet partial rows to marked rows.
6. **Teardown (root `CLAUDE.md`):** after editing context files run `/context-forge:context-constitution refresh` scoped to the touched `CLAUDE.md` files (analysis, UI, strat-lab docs); if the plugin is unavailable, re-read each touched file against the code, reconcile drift, and record both facts in the PR body.

**Verification**:
```bash
cd /home/user/xstockstrat && grep -n "formula_unreadable\|Formula-unreadable" services/xstockstrat-analysis/CLAUDE.md services/xstockstrat-ui/CLAUDE.md plugins/strat-lab/skills/backtest/SKILL.md plugins/strat-lab/skills/backtest/reference/output-handling.md && ! grep -q "skip the component with a warning" services/xstockstrat-analysis/CLAUDE.md && for f in plugins/strat-lab/skills/backtest/SKILL.md plugins/strat-lab/skills/backtest/reference/output-handling.md; do grep -q "feature 289" "$f" || { echo "missing feature 289 marker in $f"; exit 1; }; done
python3 plugins/strat-lab/scripts/validate.py --self-test && python3 plugins/strat-lab/scripts/validate.py
```
(The `skip the component with a warning` phrase (`services/xstockstrat-analysis/CLAUDE.md:52`) must not match after the edit; the first `grep -n` cannot confirm the strat-lab edits because Instruction 3 uses `FORMULA_ERROR`, not `formula_unreadable`, so the final per-file `for` loop (which fails if either file lacks it, unlike a two-file `grep -n` that passes on one hit) pins the distinctive `feature 289` marker Instruction 3 writes into both strat-lab files. The two `validate.py` runs are the strat-lab plugin validators required before the plugin changes ship, `docs/patterns/strat-lab-plugin.md:39-48`.) Plus `/proofread-claude-md services/xstockstrat-analysis/CLAUDE.md services/xstockstrat-ui/CLAUDE.md` if available.

---

### Step 14 — docs: promote scenarios into the durable per-service suites (integration PR only)

**Status**: `pending`
**Service**: `xstockstrat-analysis`, `xstockstrat-ui`, `xstockstrat-agent` durable acceptance suites
**Files**:
- `services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature` — modify
- `services/xstockstrat-analysis/acceptance/opportunities-server-side-filters.feature` — modify
- `services/xstockstrat-analysis/acceptance/readiness-caching-poll-discipline.feature` — modify (EXTEND: FAST-path marker, @AC-20)
- `services/xstockstrat-ui/acceptance/opportunity-compute-robustness.feature` — modify
- `services/xstockstrat-ui/acceptance/watchlist-opportunity-signal-cues.feature` — modify
- `services/xstockstrat-ui/acceptance/watchlist-readiness-list-ux.feature` — modify
- `services/xstockstrat-agent/acceptance/opportunity-compute-robustness.feature` — modify

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via: `services/xstockstrat-analysis/acceptance/opportunity-compute-robustness.feature:17-22` — `@AC-1 @FR-1 @feature-185` "A data-unavailable symbol is marked unavailable, not evaluated-0/0" ("Given a candidate symbol whose bars/indicator fetch fails…"); the file exists in all three services' `acceptance/` dirs (`ls services/*/acceptance`), as do `opportunities-server-side-filters.feature` (analysis) and `watchlist-opportunity-signal-cues.feature` / `watchlist-readiness-list-ux.feature` (UI).
- Rules per `design.md` § Business Rules Touched (C-16): **CHANGE** `@AC-1 @FR-1 @feature-185` — add a clarifying line (a formula-visibility refusal is not "indicator fetch fails"/data-unavailable; outage codes still are, pinned by this feature's `@AC-4`); **EXTEND** `@AC-5 @FR-1 @feature-185` (round-trip), `@AC-3 @FR-1 @feature-190` (floor survival), UI `@AC-3 @FR-2 @feature-185` / `@AC-6 @FR-7 @feature-181` / `@AC-4 @FR-1 @feature-155`, agent `@AC-10 @FR-6 @feature-185`; `@AC-7 @feature-275` now also holds with the gate ON.
- The durable-suite promotion is performed by the `/sdd-execute` integration PR (C-16; `/promote` backstop; `docs/sdd/business-rules/CLAUDE.md`). `/sdd-archiver` never deletes these files.

**TDD**: N/A (docs)

**Covers**: —

**Instructions**:
1. **Do not execute in the per-step PRs.** Perform this step only in the final integration PR, after Steps 1-13 are merged to `feature/fix-analysis-admin-formula-refusal`.
2. Add the clarifying line under `@AC-1 @feature-185` and promote this feature's scenarios as `@feature-289`-tagged scenarios (keep IDs; no renumbering; `@AC-14` stays retired) into the suites above per the CHANGE/EXTEND/PRESERVE list in `design.md`.
3. Record in the integration PR body the C-16 sign-off references (`context.md` round-1 decisions 1-2, round-2 decision 2, round-3 decision 2, round-4 decision 1).

**Verification**:
```bash
cd /home/user/xstockstrat && grep -rn "@feature-289" services/xstockstrat-analysis/acceptance services/xstockstrat-ui/acceptance services/xstockstrat-agent/acceptance | head && git diff --stat -- services/*/acceptance
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
