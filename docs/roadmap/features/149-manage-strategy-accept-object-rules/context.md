# Context: manage-strategy-accept-object-rules

**Feature**: `docs/roadmap/features/149-manage-strategy-accept-object-rules/feature.md`
**Product Spec**: `docs/roadmap/features/149-manage-strategy-accept-object-rules/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/149-manage-strategy-accept-object-rules/implementation-spec.md`

---

## Session 2026-08-22 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Origin: a live attempt to register 4 strategies via `manage_strategy` from the Claude Code MCP
  harness failed because the harness pre-parses JSON-object arguments, delivering `entry_rule`/
  `exit_rule` to the tool as a `dict`, which the strict `str` pydantic signature rejects. Diagnosed
  end-to-end against staging (a JSON string literal arrives raw/double-encoded; an object arrives as
  a dict) before choosing the agent-side fix.
- Known trap surfaced from ledger (2026-08-02 mcp-tools-alignment, F-12): a same-PR change to an
  agent tool must update the docstring, `docs/runbooks/mcp-tools.md`, and the `strat-lab` skill
  together — captured as FR-4 + @AC-5.
- Operator override recorded: the user explicitly directed running the SDD `quick` pipeline
  (`/sdd-story` → `/sdd-design quick`) then implementing on the assigned harness branch
  `claude/register-trading-strategies-uoqhuk` (PR → main-dev), rather than the nominal
  `feature/<slug>` branch. Product-spec `/sdd-review` was skipped per that quick-path direction
  (status went `draft` → `design-approved` directly); design proceeded from `draft` under the
  quick-mode allowance.

## Session 2026-08-22 — sdd-design

- Phase 0 Recon: wrote recon.md (service: xstockstrat-agent). Key reuse: existing `import json`
  (tools.py:36), the feature-070 `supplied`/`mask`/`update_mask` partial-merge machinery
  (tools.py:666-698), and the `_tool_fn` + AsyncMock test pattern (test_tools.py). scenario-recon
  confirmed NO existing `@AC-*` covers `manage_strategy` input → no C-16 regression surface.
- Phase 1 Grilling: 3 rounds (quick-mode, extended twice by operator).
  - R1: fixed the `sort_keys` fork → bare `json.dumps` (sort_keys would make the dict path DIVERGE
    from the byte-for-byte string path).
  - R2: added a schema-boundary test (published tool schema advertises `object`) to make `@AC-1`'s
    "not rejected for invalid argument type" clause honest — the raw `_tool_fn` unit tests bypass
    pydantic, so they don't exercise the annotation change alone. Appended `@AC-6` (empty dict).
  - R3 (operator-steered to `{}`+`clear_fields`): decided doc-only caveat, no code guard — the
    set-and-clear collision is pre-existing/orthogonal (tools.py:678-687); the empty-object case
    already fails loud server-side (evaluator.py:452-453 → servicer.py:378-379 INVALID_ARGUMENT).
- Chosen approach: widen `entry_rule`/`exit_rule` to `str | dict | None`; bare `json.dumps` a dict
  before the definition build; string path byte-for-byte unchanged. Rejected: TypedDict, sort_keys /
  canonicalize-both-paths, a non-str/dict runtime guard, and `{}`+clear_fields options B/C.
- Constitution rules touched: C-01, C-08, C-10, C-14, C-15, P-01/02/04/05. Floor breaches: none.
- Status: draft → design-approved (user approved @ 2026-08-22 via the P-04 gate).

## Session 2026-08-22 — sdd-spec

- Generated implementation-spec.md with 3 steps. Status → implementation-ready.
- Structure: Step 1 `service` (tools.py: widen annotations + json.dumps coercion + docstring), Step 2
  `docs` (mcp-tools.md + strat-lab skill — F-12 mirror trio), Step 3 `test` (paired unit tests
  covering @AC-1..6). Docs sequenced before the test so @AC-5's docs-consistency assertion sees all
  three surfaces. All design.md line citations re-verified against the live tree.
- Key codebase findings (grounded, not from recon alone):
  - `services/xstockstrat-agent/app/tools.py` — `manage_strategy` at `:573`; `entry_rule` annotation
    `:579`, `exit_rule` `:580`; `import json` already at `:36`; feature-070 build `definition` `:666`,
    `supplied` `:667-677` (entry `:670`/exit `:671`), `mask` `:678`; docstring rule contract `:598` +
    `:622`, Note block `:648`, `clear_fields` line `:637`. Coercion inserts before `:666`, above the
    `is not None` mask — bare `json.dumps`, no `sort_keys`.
  - Test grounding: `test_tools.py` `class TestManageStrategyTool` `:793`, pattern
    `test_calls_client_with_args` `:795` (`_tool_fn` `:23`, `_make_server` `:17`, `AsyncMock`, assert on
    `m.call_args.kwargs["definition"]`/`["update_mask"]`). Schema-boundary check uses
    `server._tool_manager.get_tool("manage_strategy").parameters["properties"]` (pattern at
    `test_config_tools.py:337,348,367`) — needed because raw `_tool_fn` calls bypass pydantic.
  - Coverage: agent threshold 40%, `cov_source=app` (`.github/workflows/ci.yml:346-347`); lint
    `ruff check . && ruff format --check .`. Reviewers: `service`/`test` → agent service owner; `docs` → none.

## Session 2026-08-22 — direct implementation (Phase 3)

- Implemented all 3 spec steps directly on `claude/register-trading-strategies-uoqhuk` (operator
  override; single commit + one PR → main-dev), not via /sdd-execute per-step PRs.
  - Step 1 (tools.py): widened `entry_rule`/`exit_rule` to `str | dict | None`; inserted bare
    `json.dumps` dict→string coercion before the definition build (`tools.py:678-686`); updated the
    docstring (rule-encoding line, worked example, fingerprint note, clear_fields caveat).
  - Step 2 (docs): `docs/runbooks/mcp-tools.md` entry_rule/exit_rule rows → "string or object" +
    clear_fields caveat; strat-lab `backtest/SKILL.md` "Rule encoding" note.
  - Step 3 (tests): 7 new tests in `TestManageStrategyTool` — dict→string, string passthrough,
    omitted-drop, both-dicts, empty-dict, published-schema boundary (proves the annotation admits
    object), and docs-consistency across the 3 surfaces.
- Verification: 273 agent tests pass, coverage 78% (≥40); ruff check + format clean;
  `test_strategy_builders.py` proto-parity guard green. Red-before-green (P-06) demonstrated by
  reverting tools.py alone → the 3 code-dependent tests fail (schema string-only, dict path absent).
- Deviation D-1: docstring line wrapped for ruff E501, so "JSON object" spans a line break; the
  @AC-5 docstring assertion normalizes whitespace before matching. Recorded in implementation-spec
  Deviation Log.
- Status: implementation-ready → code-completed.

## Open Threads

- **Named follow-up — `manage-strategy-reject-set-and-clear`** (own `/sdd-story`): make the
  set-and-clear collision fail loud at the tool edge (a field both supplied a value AND named in
  `clear_fields` currently value-wins and silently drops the clear; the only case with no server
  backstop is a NON-empty rule + `clear_fields`). Deferred from 149 as pre-existing/out-of-scope;
  149 covers it with a documented caveat only. Not a blocker for 149.
- **Fingerprint non-equivalence** (accepted, documented in design.md + the docstring note): a dict and
  a differently-spaced string of the same logical rule serialize differently → switching encodings
  clears the derived grade. No code mitigation in 149.
