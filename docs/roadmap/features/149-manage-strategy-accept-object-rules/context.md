# Context: manage-strategy-accept-object-rules  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: A live attempt to register 4 strategies via the `manage_strategy` MCP tool failed because the Claude Code harness pre-parses JSON-object arguments and delivered `entry_rule`/`exit_rule` as a Python `dict`, which the tool's strict `str` pydantic signature rejected. The fix widened both params to `str | dict | None` and coerced a dict to a JSON string with a bare `json.dumps` inside the agent tool wrapper; the backend gRPC contract stayed byte-identical. Shipped as a single-commit PR on an operator-assigned `claude/*` branch via the `quick` SDD path.

**Why (irrecoverable rationale)**:
- The coercion uses **bare `json.dumps`, deliberately NO `sort_keys`** — a round-1 finding that `sort_keys` (or canonicalizing both paths) would make the dict path *diverge* from the untouched string path and risk altering/rejecting a string the server already tolerates. Code shows `json.dumps` with no flag; the *reason the flag is absent* is invisible without this note — a future "cleanup" that adds `sort_keys` would silently break byte-parity.
- Coercion is placed **before** the feature-070 `mask = [… if value is not None]` build so an omitted `None` still drops from the mask while an empty dict `{}` → `"{}"` correctly enters it. Ordering is load-bearing, not incidental.

**Rejected alternatives**:
- `TypedDict` for the rule param — lost: it would duplicate the recursive rule grammar that `xstockstrat-analysis` owns (the agent is a passthrough), creating drift risk in the F-12 doc-mirror family; `str | dict` already rejects lists/numbers at the pydantic schema edge.
- `json.dumps(sort_keys=True)` / canonicalize both paths — lost: would diverge the dict path from the string path or change existing string behavior.
- A runtime `ValueError` guard for non-str/dict — lost as speculative defense against an input already blocked at the schema boundary.
- `{}`+clear_fields options B (raise on set+clear) / C (clear wins) — lost for 149: both change pre-existing behavior for the string case and every field, needing their own product spec + C-16 sign-off.

**Scars & gotchas**:
- The MCP harness **pre-parses JSON-object tool arguments** — a JSON string literal arrives raw/double-encoded but an object arrives as a `dict`. Diagnosed end-to-end against staging. This is the non-obvious trap that motivated the whole feature.
- Raw `_tool_fn(...)` unit tests **bypass pydantic argument validation**, so a dict passed to `entry_rule=` exercises the coercion body but *not* the annotation change — the annotation had to be verified separately via a published-`inputSchema` (`anyOf`/object) assertion.
- D-1: the docstring rule line wrapped across 3 lines for ruff E501, so "JSON object" spans a line break; the `@AC-5` docstring assertion normalizes whitespace (`" ".join(description.split())`) before matching. A future edit that relies on the phrase being contiguous would break the test.

**Permanent deviations**: none material. Design and shipped agree; D-1 (docstring line-wrap, test normalizes) and D-2 (single-commit `claude/*` branch instead of per-step `/sdd-execute` PRs, operator override) are process/formatting deviations, not behavioral contradictions.

**Cross-feature signal**: Reinforces ledger F-12 (mcp-tools-alignment): any change to an agent tool must update the docstring, `docs/runbooks/mcp-tools.md`, and the `strat-lab` skill **in the same PR**. Notably the `strat-lab backtest` skill made *no* rule-encoding claim, yet the root-CLAUDE strat-lab guardrail still forced touching it — so the trio obligation fires even when a surface says nothing about the changed field.

**Deferred follow-ons**:
- Named story **`manage-strategy-reject-set-and-clear`** (its own `/sdd-story`): the set-and-clear collision (a field both given a value AND named in `clear_fields`) currently value-wins and silently drops the clear. The only case with *no* server backstop is a **non-empty rule + `clear_fields`** — an empty `{}`/`"{}"` fails loud server-side at `evaluator.py:452-453` → `servicer.py:378-379` INVALID_ARGUMENT. 149 ships a documented caveat only, scoped to structurally-empty rules (must not over-generalize: `{"op":"AND","conditions":[]}` still validates).
- **Fingerprint non-equivalence** (accepted, no code mitigation): a dict and a differently-spaced string of the *same* logical rule serialize differently, so switching a stored rule's encoding changes the definition fingerprint and clears the derived grade until a fresh backtest.

**Ledger entries written**: insights.md (3), fails.md (1) — see the 2026-08-26 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: (1) AGENT-* — the MCP/Claude Code harness **pre-parses JSON-object tool arguments** (string literals arrive raw, objects arrive as `dict`); any agent tool accepting a structured param must tolerate both. (2) ANALYSIS-* — the strategy **definition fingerprint is serialization-sensitive**: logically-identical rules with different whitespace/key-order produce different fingerprints and clear the derived grade.
**Scenario promotion (C-16)**: 5 `@AC-*` (AC-1/2/3/4/6) → `services/xstockstrat-agent/acceptance/manage-strategy-accept-object-rules.feature` (new suite); AC-5 (cross-surface doc-consistency) → `docs/sdd/business-rules/platform.feature`.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
