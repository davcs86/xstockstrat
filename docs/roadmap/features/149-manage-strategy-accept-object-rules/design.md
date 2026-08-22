# Design: manage-strategy-accept-object-rules

**Created**: 2026-08-22
**Rounds**: 3 (quick-mode, extended by operator to 3; termination: approved)
**Approved by**: user @ 2026-08-22
**Grounded in**: recon.md

---

## Chosen Approach

Widen the `manage_strategy` MCP tool's two rule params and normalize a dict to a JSON string inside
the agent tool wrapper; the backend contract is byte-identical to today.

- **Annotations** — `services/xstockstrat-agent/app/tools.py:579-580`: `entry_rule: str | dict | None`
  and `exit_rule: str | dict | None`. This makes the generated MCP input schema advertise
  `anyOf(string, object)`, so a compliant client's validation admits a JSON object (the case that is
  rejected today) and still rejects a list/number before the tool body runs. **Not** a `TypedDict` —
  that would duplicate the recursive rule grammar `xstockstrat-analysis` owns (the agent is a
  passthrough; recon "Objective"/"Existing Business Rules") and drift-risks the F-12 mirror family.
- **Coercion** — insert immediately before the `definition`/`supplied` build at
  `services/xstockstrat-agent/app/tools.py:666` (after the feature-070 comment):
  ```python
  if isinstance(entry_rule, dict):
      entry_rule = json.dumps(entry_rule)
  if isinstance(exit_rule, dict):
      exit_rule = json.dumps(exit_rule)
  ```
  Bare `json.dumps` — **no** `sort_keys` — so the existing string path stays byte-for-byte
  (`recon.md` Patterns to REUSE; the round-1 finding that `sort_keys` would make the dict path
  *diverge* from the untouched string path). `import json` already present
  (`services/xstockstrat-agent/app/tools.py:36`). Running the coercion *before* the
  `mask = [... if value is not None]` (`tools.py:678`) means an omitted `None` still drops out and an
  empty dict `{}` → `"{}"` correctly enters the mask (non-`None`); the feature-070 partial-merge
  machinery (`tools.py:666-698`) is untouched. No change to `client.py` (`entry_rule` reaches
  `client.py:707` as a `str` as before), proto, config, or DB.
- **Consumer surface (C-14)** — the `manage_strategy` MCP tool itself (`xstockstrat-agent`); the
  widened input type is the deliverable. No UI surface.
- **Docs (same PR, F-12 / ledger 2026-08-02)** — docstring `tools.py:598` (drop "a JSON string, not a
  raw object") and the worked-example closer `tools.py:622` (drop "as the entry_rule string"), both
  restated as "a JSON string **or** a JSON object (dict)"; a one-line fingerprint-non-equivalence note
  in the Note block near `tools.py:650`; `docs/runbooks/mcp-tools.md:473-474` type cells → "string or
  object"; a minimal "Rule encoding" note in `plugins/strat-lab/skills/backtest/SKILL.md` near its
  mutation-guard block (the skill makes no encoding claim today, but the root-CLAUDE.md strat-lab
  guardrail requires touching it in a `manage_strategy` change PR — and @AC-5 asserts the trio).

**`{}` + `clear_fields` (round 3, operator-steered).** Decided **doc-only, no code guard**. The
set-and-clear precedence (a field both supplied a value and named in `clear_fields` → value wins, the
clear is silently dropped) is **pre-existing** mask/clear logic (`tools.py:678-687`, feature-070 /
AIP-161), identical for the string case (`entry_rule="{}"`); the dict coercion routes `{}` through
the same path and introduces no new contradiction (CLAUDE.md §2/§3 — minimum diff, touch only what
the task requires). The *empty-object* case fails loud server-side —
`services/xstockstrat-analysis/app/services/evaluator.py:452-453` (`_validate_rule_refs({})` falls
through to `raise ValueError("unrecognized condition node structure")`) →
`services/xstockstrat-analysis/app/handlers/servicer.py:378-379` (`context.abort(INVALID_ARGUMENT)`).
A caveat line (docstring `clear_fields` row + `mcp-tools.md:480`) documents value-wins and "use
`clear_fields` alone to erase", scoped to structurally-empty `{}`/`"{}"` (a structured-but-vacuous
`{"op":"AND","conditions":[]}` passes validation — the caveat must not over-generalize). A fail-loud
guard for the genuinely silent *non-empty rule + clear* case is **deferred to a named follow-up
story `manage-strategy-reject-set-and-clear`** (recorded in `context.md`); 149 is not gated on it.

## Rejected Alternatives

- `TypedDict` for the rule param — rejected: duplicates the recursive rule grammar that
  `xstockstrat-analysis` owns (drift-risk, F-12 family); heavy recursive `$ref` schema that
  JSON-pre-parsing clients gain nothing from. `str | dict` already rejects lists at the schema edge.
- `json.dumps(..., sort_keys=True)` (or canonicalizing **both** paths) — rejected: would make the dict
  path diverge from the byte-for-byte string path (round 1), or change today's string behavior and
  risk rejecting/altering a string the server tolerates (round 2). Bare `json.dumps`, dict-path-only.
- A runtime guard raising `ValueError` for a non-str/non-dict rule — rejected: `str | dict` rejects
  lists at the pydantic schema boundary; a body guard is speculative defense against an
  already-blocked input (CLAUDE.md §2).
- `{}`+`clear_fields` options B (raise on set+clear) / C (clear wins) — rejected for 149: both change
  pre-existing behavior for the string case and *every* field, needing their own product spec + C-16
  sign-off. Deferred to the named follow-up.

## Open Risks

- [ ] **Fingerprint non-equivalence** — a dict and a differently-spaced string of the *same* logical
  rule serialize differently (default `json.dumps` separators), so switching encodings clears the
  strategy's derived grade. Accepted trade-off of the minimal path; documented in the docstring note.
  No code mitigation. — addressed at the implement step (docstring note).
- [ ] **Non-empty rule + `clear_fields` silent-drop** — the one case with no server backstop; covered
  only by the caveat wording in 149. Full fix deferred to `manage-strategy-reject-set-and-clear`. —
  tracked in context.md Open Threads.

## Constitution Rules Touched

- `C-01` — honored: the "empty rule fails loud" caveat cites the real mechanism
  (`evaluator.py:452-453` / `servicer.py:378-379`), not a guessed line.
- `C-08` / `C-15` — honored: every `@AC-1..6` maps to a test step; `@AC-1`'s boundary clause is covered
  by a schema-boundary test (published tool schema advertises `object`), `@AC-5` by a docs grep step.
- `C-10` — honored: the shared `clear_fields`/rule doc surface is updated at **both** instances
  (docstring + `mcp-tools.md`); the F-12 trio (docstring + runbook + strat-lab skill) all in this PR.
- `C-14` — honored: the consumer surface (`manage_strategy` MCP tool) is named and is the deliverable.
- `P-01`/`P-02`/`P-04`/`P-05` — honored: single-orchestrator writes, mediated proposer/adversary, the
  approval gate recorded here + in context.md, checkpointed as written.
- Floor: none touched (no migration/branch/config-hardcode/DB-budget). No F-* breach in any round.

## Business Rules Touched (C-16)

- PRESERVE (net-new): no existing promoted `@AC-*` scenario covers `manage_strategy` input or the
  rule encoding in any read suite (`recon.md` Existing Business Rules) — nothing to regress. The
  feature adds its own `@AC-1..6` in `acceptance.feature`, promoted into the agent's durable suite on
  launch.
- PRESERVE (behavioral, no scenario): the pre-existing `clear_fields` value-wins-over-clear precedence
  is left unchanged by Option A (round 3) — recorded here as an explicit non-regression.
