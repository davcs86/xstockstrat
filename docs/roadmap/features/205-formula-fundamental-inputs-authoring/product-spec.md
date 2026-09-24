# Product Spec: formula-fundamental-inputs-authoring

**Created**: 2026-09-24

---

## Problem Statement

Feature 201 (`fundamentals-formula-inputs`, code-completed) added `fundamental_inputs`
(`repeated FundamentalMetric`, an 11-metric closed enum) to `FormulaDefinition` /
`RegisterFormulaRequest` / `UpdateFormulaRequest` and wired the analysis strategy evaluator to
feed fundamentals into a fundamentals-scoring formula. But the **authoring surfaces expose none
of it**: the agent tools `manage_formula` / `test_formula` / `get_formula` / `list_formulas`
have no `fundamental_inputs` handling, and the `/insights` `FormulaEditor` / `FormulaWorkspace`
UI has no fundamentals affordance at all. An author therefore cannot declare, view, discover, or
test a fundamentals-scoring formula from the MCP or the UI — the capability is reachable only
implicitly through strategy authoring.

## User Story

As a formula author, I want to declare, see, discover, and test a formula's fundamental inputs
from both the MCP agent tools and the `/insights` formula builder, so that I can build and
validate a fundamentals-scoring formula directly — without editing a strategy or hand-crafting
proto payloads.

## Functional Requirements

FR-1. **Declare** — `manage_formula` (agent) and the `/insights` FormulaEditor let an author set
a formula's `fundamental_inputs` from the `FundamentalMetric` catalog on create and update. The
value is validated as it is today at indicators registration (zero-sentinel rejected — feature 201).

FR-2. **View** — `get_formula` / `list_formulas` (agent) responses and the FormulaEditor /
reference panel display a formula's declared `fundamental_inputs` on read (round-trips what FR-1 wrote).

FR-3. **Discover catalog** — the available `FundamentalMetric` values (name + human meaning) are
discoverable via the MCP (a list tool or a documented arg) and a UI picker, so an author sees the
valid input set without reading the proto.

FR-4. **Test with fundamentals** — `test_formula` (agent) and the UI test harness can run a
fundamentals-scoring formula with a fundamentals `input_data` map (not just OHLCV closes), returning
the formula's `output` score for the supplied inputs.

FR-5. **Test data = symbol-prefill + editable** — the test harness prefills the fundamentals values
from a chosen symbol's current snapshot (marketdata `GetFundamentalsMulti`) and lets the author
override any value before running. A run with no symbol uses author-supplied values only.

FR-6. **One contract, no drift** — the `fundamental_inputs` an author declares here is the exact
field/enum feature 201 consumes in the strategy evaluator; a formula authored via these surfaces
behaves identically when later used as a strategy component. The agent tool docstrings, the
`docs/runbooks/mcp-tools.md` runbook, and any hand-written request builder are updated in the same
PR so they do not drift from the proto (ledger F-3/F-10).

## Out of Scope

- Changing feature 201's strategy-evaluator behavior, the PIT/snapshot resolution, or the
  `FundamentalMetric` enum membership (consumed as-is).
- Adding new fundamental metrics or a new fundamentals data source.
- A fundamentals **backfill** trigger from the formula UI (that stays `trigger_backfill`).
- Any change to how strategies reference formula outputs (feature 201 already covers the strategy side).
- Persisting anything new — `fundamental_inputs` is already persisted by feature 201's indicators
  migration `006_add_formula_fundamental_inputs`.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-agent` — **primary (MCP)**: `manage_formula` (declare), `get_formula`/`list_formulas`
  (view), `test_formula` (test with fundamentals), and catalog discovery (tool/arg).
- `xstockstrat-ui` — **primary (UI)**: `/insights` FormulaEditor/FormulaWorkspace — fundamental-input
  picker (declare/view) + test harness (symbol-prefill + editable) via `useFormulas`.
- `xstockstrat-indicators` — **mostly consumed**: `RegisterFormula`/`UpdateFormula`/`GetFormula`
  already carry/persist `fundamental_inputs`; `ExecuteFormula` already accepts `input_data`. Design
  decides whether a catalog RPC (`ListFundamentalMetrics`) is added here or the enum is surfaced statically.
- `xstockstrat-marketdata` — **consumed**: `GetFundamentalsMulti` snapshot for symbol-prefill (FR-5).

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` `/insights` formula builder (`FormulaEditor` / `FormulaWorkspace`,
  `src/app/insights/formulas`): fundamental-input picker (declare + view) and a test harness that
  prefills from a symbol and runs `ExecuteFormula` with fundamentals input_data. Reachable per **C-10**
  (`/insights` formulas route already registered).
- [x] **Agent** — `xstockstrat-agent` MCP tools: `manage_formula` (new `fundamental_inputs` arg),
  `get_formula`/`list_formulas` (surface the field), `test_formula` (new fundamentals input path +
  optional symbol prefill), and catalog discovery (a list tool/arg — design decides).
- [ ] **None.**

## Proto Contract Changes

- **Likely none required for declare/view** — `fundamental_inputs` already exists on
  `FormulaDefinition` / `RegisterFormulaRequest` / `UpdateFormulaRequest` (feature 201) and
  `ExecuteFormula.input_data` already carries scalars.
- **Possible additive change (design decides):** a `ListFundamentalMetrics` RPC (or an enum-catalog
  helper) for FR-3 discovery, and/or a `test_formula` symbol-prefill path that may route a marketdata
  read. Any such change is additive/non-breaking. If none is added, this is a code-only feature.

## Config Key Changes

- [x] No new config keys.

## Database Changes

- [x] No schema changes — `fundamental_inputs` is already persisted (indicators migration
  `006_add_formula_fundamental_inputs`, feature 201).

## Feature Workflow Notes

Branch to create: `feature/formula-fundamental-inputs-authoring` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] Service owner approval — `xstockstrat-agent`, `xstockstrat-ui`, `xstockstrat-indicators`
- [ ] 2 service owners + platform lead (breaking proto change) — not expected (additive at most)
- [ ] DBA review + service owner (schema migration) — not expected (no migration)

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Catalog exposure mechanism (FR-3):** a new indicators `ListFundamentalMetrics` RPC vs the
  agent/UI surfacing the generated enum statically (name→meaning map). Design decides.
- [ ] **Symbol-prefill routing (FR-5):** does `test_formula`'s symbol prefill call marketdata
  `GetFundamentalsMulti` from the agent, or does indicators expose a helper? Where does the
  snapshot→input_data mapping live?
- [ ] **test_formula input shape:** how the fundamentals `input_data` map is passed by the agent tool
  (metric-name keys matching the enum names?) and how the UI harness represents an editable value grid.
- [ ] **UI gating hint:** should the FormulaEditor repeat feature 201's read-only "requires the
  fundamentals gate / use `.composite`" strategy hint, or is that out of scope for the authoring surface?
- [ ] **Known trap (ledger F-3/F-10, fails.md:308):** the agent's hand-written dict→proto request
  builders (`app/client.py`) silently drop new proto fields, and tool docstrings/`mcp-tools.md` drift
  from the protos. `fundamental_inputs` must be threaded through the builder AND the docs in the same PR,
  with a round-trip test (declare → get_formula returns it).
- [ ] **Known trap (ledger, hand-authored Connect-JSON):** the UI must send `FundamentalMetric` as
  NAME-strings over Connect-JSON, and any exhaustive TS map over the enum must be complete (F-C-10).
