# Context: formula-fundamental-inputs-authoring

**Feature**: `docs/roadmap/features/205-formula-fundamental-inputs-authoring/feature.md`
**Product Spec**: `docs/roadmap/features/205-formula-fundamental-inputs-authoring/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/205-formula-fundamental-inputs-authoring/implementation-spec.md`

---

## Session 2026-09-24 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the
  user request "expose fundamental inputs to formulas via the MCP and UI."
- **Duplicate check vs feature 201 (`fundamentals-formula-inputs`, code-completed):** distinct.
  201 wired fundamentals into the **analysis strategy evaluator** (formula-as-strategy-component,
  PIT-as-of-bar) and **explicitly excluded** a new agent tool / config-ui page beyond strategy
  authoring; its UI touch was a single read-only ComponentEditor badge. 205 is the **formula-authoring
  exposure layer** 201 left out, built on 201's `fundamental_inputs` field + `FundamentalMetric` enum.
- Grounding facts from recon this session:
  - 201 added `fundamental_inputs` (`repeated FundamentalMetric`) to `FormulaDefinition`,
    `RegisterFormulaRequest`, `UpdateFormulaRequest`, and the 11-value `FundamentalMetric` enum
    (`packages/proto/indicators/v1/indicators.proto:136-169,195,232`), persisted via indicators
    migration `006_add_formula_fundamental_inputs`.
  - Gap confirmed: agent `manage_formula` (tools.py:842) / `test_formula` (:1200) have **no**
    `fundamental_inputs` handling; the `/insights` FormulaEditor/FormulaWorkspace/useFormulas have
    **zero** fundamental references. So authoring cannot declare/view/test/discover fundamentals today.
  - Authoring surfaces: agent `manage_formula`/`get_formula`/`list_formulas`/`test_formula`
    (`services/xstockstrat-agent/app/tools.py`); UI `services/xstockstrat-ui/src/components/insights/
    Formula{Editor,Workspace,ReferencePanel}.tsx`, `hooks/useFormulas.ts`, `app/insights/formulas`.
  - `ExecuteFormula.input_data` (Struct) already carries scalars — test-with-fundamentals needs no
    wire change, only an agent/UI path that builds the input_data map.
- **Operator scope decisions (AskUserQuestion, this session):**
  - Capabilities: all four — declare, view, discover catalog, test with fundamentals.
  - Test data: **symbol-prefill + editable** (marketdata `GetFundamentalsMulti` snapshot prefill,
    author may override; no symbol = author-supplied values).
  - Design depth: **full** (2–5 rounds).
- **Known traps flagged (ledger):**
  - F-3/F-10 (fails.md:308): agent hand-written dict→proto request builders (`app/client.py`) drop
    new proto fields; tool docstrings + `docs/runbooks/mcp-tools.md` drift from protos. Thread
    `fundamental_inputs` through the builder AND docs in the same PR + a declare→get_formula round-trip test.
  - F-C-10 / Connect-JSON (fails.md:81-83,677-679): UI must send `FundamentalMetric` as NAME-strings
    and keep any exhaustive TS enum map complete.
- Depth this session: story written; **/sdd-design (full) to run next** (operator asked to start design
  after creating the feature). Proto changes anticipated additive-at-most (field already exists); no
  migration, no config key expected.

## Session 2026-09-24T00:00:00Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready (criteria: PASS WITH WARNINGS, no blockers; overlap: CLEAN).
- Warnings (all advisory):
  - Criterion 9: six unchecked Open Questions — all legitimately design-deferred HOW-questions +
    two "Known trap" notes (which are constraints, not questions). Reviewer suggests reclassifying
    the trap bullets as design constraints. Resolve at /sdd-design.
  - Criterion 8 NOTE: AC-2 ("sends NAME-strings") and AC-6 ("prefilled from GetFundamentalsMulti")
    each name a mechanism in an `And`, but are paired with observable `Then`s — acceptable, tighten at spec.
- Code-checkable claims verified: `fundamental_inputs` at FormulaDefinition=14, RegisterFormulaRequest=10,
  UpdateFormulaRequest=11; ExecuteFormula.input_data=3 (Struct); FundamentalMetric = 11 real values +
  _UNSPECIFIED (indicators.proto:136-149); migration 006 up+down exist; agent tools lack fundamental_inputs
  today; UI Formula{Editor,Workspace,ReferencePanel}.tsx + useFormulas + app/insights/formulas exist;
  /insights/formulas route already registered (C-10 satisfied, no new route).
- Overlap: CLEAN — no resource collision. No in-flight feature edits indicators.proto (196 makes zero
  .proto edits), the agent formula tools, or the /insights formula UI. Additive `ListFundamentalMetrics`
  RPC (if design adds it) lands on an uncontested surface.
- **Merge-order recorded:** added row `205 → 201` (hard consumed-seam dependency; 201 code-completed,
  not yet launched) to docs/roadmap/features/merge-order.md. 205's final integration PR must not merge
  before 201 lands. Soft rebase-only overlap with 187/197/198/199/200 in agent client.py/tools.py
  (disjoint functions) and mcp-tools.md (section-disjoint) — re-verify at Mode B.
- Next: /sdd-design (FULL, operator's choice) — starting this session.

## Session 2026-09-24T00:00:00Z — sdd-design

- Phase 0 Recon: wrote recon.md (services: agent, ui, indicators, marketdata; scenario-recon).
  Key reuse: existing `fundamental_inputs`/`FundamentalMetric` plumbing (feature 200/201, backend
  unchanged), `ParameterEditor` list-editor, `GetFundamentalsMulti` + analysis `_FUNDAMENTAL_METRIC_DATA_KEY`.
- Phase 1 Grilling: **3 rounds (full)**, approved.
  - Chosen approach: additive `ListFundamentalMetrics` RPC on indicators (single source of truth) +
    code-only threading of fundamental_inputs through agent tools + /insights builder; two-vocabulary
    contract (declare=enum NAME-strings, test input_data=snake_case data-keys); UI-side symbol-prefill.
  - Operator decisions: R1 gate chose the catalog RPC over static surfacing (single source of truth);
    R3 gate approved keeping guard G6 (analysis-suite third-leg parity test) + recording the analysis touch.
  - Rejected: static two-map catalog (drift), agent-side symbol-prefill (no marketdata client),
    execute-time input_data validation (nothing to validate — test sends raw source), folding
    strategyCatalog FUNDAMENTAL_METRICS (different screener vocabulary).
  - Guards folded in: G1 cross-service data_key contract test; G2 fail-loud handler; G3 verify existing
    insights marketdata client; G4 header propagation; G5 same-PR docs + descriptor-parity test; G6
    analysis third-leg parity test (test-only touch — recorded scope addition).
- Constitution rules touched: C-04, C-09, C-10, C-14, C-15, C-17, C-18, C-03, C-01/F-04, F-07, F-01. Floor breaches: none.
- Business rules: PRESERVE @AC-4 (feature-173), @AC-5 (feature-176); @AC-1..7 net-new EXTEND. No CHANGE.
- acceptance.feature corrected (C-15): AC-3 camelCase `fundamentalInputs`; AC-5/AC-6 snake_case
  `input_data` data-keys + null-not-NaN; AC-7 numeric round-trip parity. Intent clarification, not a
  rule change (scenarios are net-new, never promoted).
- Scope note: G6 adds a **test-only** touch to xstockstrat-analysis (recon originally excluded it) —
  recorded in recon.md Addendum + design.md; no analysis runtime change.
- Status: spec-ready → design-approved.

## Session 2026-09-24T00:00:00Z — sdd-spec

- Wrote implementation-spec.md (14 steps) from the approved design.md and recon.md.
- Codebase discovery read all referenced files to confirm drop points with path:line evidence (C-01):
  - Proto: indicators.proto lines 14-41 (service block), 136-149 (enum), 244-246 (last message)
  - Agent: tools.py lines 842-932 (manage_formula 3 drop points), client.py lines 1042-1077
    (register/update builders), test_formula_builders.py lines 26/31 (intentionally-unset sets)
  - UI: useFormulas.ts lines 28-87, FormulaWorkspace.tsx lines 62-250, insightsBff.ts lines 87-158,
    indicatorsClient.ts, ParameterEditor.tsx/OutputEditor.tsx (pattern to mirror)
  - Analysis: evaluator.py lines 144-155 (_FUNDAMENTAL_METRIC_DATA_KEY)
  - Docs: mcp-tools.md lines 562-839, strat-lab SKILL.md lines 100-129
  - Fixtures: formulas.ts FORMULA_FUNDAMENTALS, fundamentals.ts FUNDAMENTALS_AAPL
- Step decomposition: 6 advisory boundaries from design.md expanded into 14 steps (7 service + 5
  test + 1 proto + 1 proto-gen). No migration step (feature 201's migration 006 already persists
  fundamental_inputs). No config key step.
- Scenario coverage (C-15): all 7 AC scenarios (AC-1..AC-7) mapped to covering test steps. AC-7
  covered by Step 13 (analysis G6 parity — test-only analysis touch recorded in design.md).
- Consumer-surface coverage (C-14): both named surfaces (Agent steps 5-8, UI steps 9-12/14).
- Cross-cutting constraints applied: header propagation (C-03) cited for Steps 5, 7, 9, 11; C-13
  non-frontend test data compliance noted for Steps 4, 6, 8, 13; C-12 test-data inventory noted
  for Step 14 (reuses existing fixtures, no new fixture files).
- Status: design-approved → implementation-ready.

## Session 2026-09-24T00:00:00Z — sdd-review impl-spec (advisory)

- Result: 0 failures, 3 warnings (advisory — did not block).
- Unresolved ⚠ carried into execution:
  - Step 2: Files contain wildcards for auto-generated proto stubs (C-01) — [x] addressed — added "(wildcards inherent to codegen output)" annotations to each wildcard entry
  - Step 10: No explicit coverage threshold in Verification; hook outside vitest coverage scope (C-18) — [x] addressed — added note that `src/hooks/` is outside `src/lib/**` vitest coverage scope; test is behavioral correctness, not threshold-impacting
  - Step 12: Coverage threshold implicit in vitest config, not stated in step Verification text (C-18) — [x] addressed — added explicit note that `pnpm run test:coverage` enforces threshold via vitest config and `src/lib/fundamentalMetrics.ts` is inside the scope
- Overlap findings: 0 FAIL-level collisions. WARN-level file overlaps with features 187, 188, 202,
  203, 204 — all section-disjoint (different functions/service registrations/fixture blocks).
  Feature 204 (`backfilled-data-queryable`) has the densest overlap (7 shared files including
  `insightsBff.ts`) but touches `MarketDataService` while 205 touches `IndicatorsService`. Merge-order
  205→201 already recorded; no new merge-order entries needed.

## Session 2026-09-24 — sdd-execute (sequential)

Feature 4 of the 202→205 run. Branch `feature/formula-fundamental-inputs-authoring` off current
`main-dev` (has 202+203; 204's PR #1173 still open, so 204's tool-count/shared-file changes are NOT
on this base — the tool-count/insightsBff/mock-backend overlaps with 204 resolve at whichever PR
merges second). Toolchain: host-native buf 1.72.0 (`/root/go/bin/buf`; Docker Hub still 429s the
codegen image), go1.27, uv/ruff, node/pnpm.

### Step 1 — proto: ListFundamentalMetrics RPC + messages [done]
- Additive: `rpc ListFundamentalMetrics` on IndicatorsService; `ListFundamentalMetricsRequest{}`,
  `FundamentalMetricInfo{metric, data_key, meaning}`, `ListFundamentalMetricsResponse{repeated metrics}`.
- `buf lint` clean; `buf breaking` vs main-dev exit 0 (additive). Files: `indicators/v1/indicators.proto`.

### Step 2 — proto-gen: regenerate stubs [done]
- Host-native `buf-gen.sh` (AGAINST_BRANCH=main-dev). indicators Go/Python/TS stubs carry the new RPC
  + messages. Reverted the recurring analysis.pb.go gofmt whitespace drift; diff scoped to `indicators/v1`.
- Files: `packages/proto/gen/{go,python,ts}/indicators/v1/**`.

### Steps 3-4 — indicators ListFundamentalMetrics handler + tests (G1/G2) [done]
- `servicer.py`: `_FUNDAMENTAL_METRIC_MEANING` (11-entry enum→meaning dict) + `ListFundamentalMetrics`
  handler — iterates the enum descriptor (single source of truth), skips UNSPECIFIED, derives
  `data_key = name.removeprefix("FUNDAMENTAL_METRIC_").lower()`, fails loud (INTERNAL abort) on a
  missing meaning (G2), returns `FundamentalMetricInfo(metric, data_key, meaning)`.
- `tests/test_fundamental_metrics.py`: G2 (11 entries, all non-empty key+meaning), completeness (enum
  set parity), G1 cross-service contract (every data_key is a real `marketdata.Fundamentals` field —
  imports `gen.marketdata.v1.marketdata_pb2`). 3 passed.
- Verify: ruff clean; full suite 143 passed, coverage 81.44% (≥50).
- Files: `app/handlers/servicer.py`, `tests/test_fundamental_metrics.py`.
