# Context: formula-fundamental-inputs-authoring

**Feature**: `docs/roadmap/features/204-formula-fundamental-inputs-authoring/feature.md`
**Product Spec**: `docs/roadmap/features/204-formula-fundamental-inputs-authoring/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/204-formula-fundamental-inputs-authoring/implementation-spec.md`

---

## Session 2026-09-24 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the
  user request "expose fundamental inputs to formulas via the MCP and UI."
- **Duplicate check vs feature 201 (`fundamentals-formula-inputs`, code-completed):** distinct.
  201 wired fundamentals into the **analysis strategy evaluator** (formula-as-strategy-component,
  PIT-as-of-bar) and **explicitly excluded** a new agent tool / config-ui page beyond strategy
  authoring; its UI touch was a single read-only ComponentEditor badge. 204 is the **formula-authoring
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
- **Merge-order recorded:** added row `204 → 201` (hard consumed-seam dependency; 201 code-completed,
  not yet launched) to docs/roadmap/features/merge-order.md. 204's final integration PR must not merge
  before 201 lands. Soft rebase-only overlap with 187/197/198/199/200 in agent client.py/tools.py
  (disjoint functions) and mcp-tools.md (section-disjoint) — re-verify at Mode B.
- Next: /sdd-design (FULL, operator's choice) — starting this session.
