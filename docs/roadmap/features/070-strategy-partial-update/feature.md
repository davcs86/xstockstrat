# Feature: strategy-partial-update

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/strategy-partial-update` (see context.md — implemented on the
harness-assigned `claude/features-070-071-rnbkqo` branch this session)
**Created**: 2026-07-26
**Last Updated**: 2026-07-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-26 | `draft` → (fail) | /sdd-review | FAIL r1 — FR-2/FR-3 + AC-2/AC-3 described already-shipped behavior (`GetStrategy` exists; orphan-ref check exists) |
| 2026-07-26 | `draft` → (fail) | /sdd-review | FAIL r2 — two C-10 blockers: FR-4 listed 3 of 5 tool-inventory surfaces; `manage_strategy` tool's default-fabrication (`tools.py:338-344`) was unscoped despite being a co-cause |
| 2026-07-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved r3 (4 warnings, all advisory). OQ-1/OQ-2 deferred to /sdd-design |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec strategy-partial-update`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make `manage_strategy` "update" apply a **partial merge** instead of a destructive full-replace, so
changing a single field (e.g. `cooldown_days`) no longer silently drops a strategy's indicator
components and entry/exit rules. Validate the **merged** definition and reject writes that would
erase components or rules, so parameter tuning can no longer corrupt a definition. Expose the
existing `GetStrategy` RPC as an MCP tool so an agent can read a definition back.

> **Scope corrected at review (2026-07-26).** The `GetStrategy` RPC, its servicer handler, the UI
> hook, and the agent client wrapper all already ship — only the **MCP tool** is missing. Orphan-ref
> validation also already exists (`evaluator.py:323`) but short-circuits on empty rules
> (`evaluator.py:317-318`), which is why it did not catch the incident. Proto scope is limited to the
> merge mechanism on `ManageStrategyRequest` (next free field **3**).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and change
types. Override as needed for this feature. Snapshot finalized at /sdd-spec time — re-run /sdd-spec
if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias; `ManageStrategy` merge correctness |
| `xstockstrat-agent` (service owner) | `manage_strategy` MCP tool parameter/docstring accuracy, partial-update semantics, `docs/runbooks/mcp-tools.md` parity |
| `xstockstrat-ui` (service owner) | `StrategyWizard` edit-path correctness under partial updates, Connect-RPC call safety |
| Proto Reviewer | Field-number uniqueness, backward compatibility — scope is the merge mechanism only (`update_mask` on `ManageStrategyRequest`, next free field **3**, or a new patch RPC). `GetStrategy` already exists and must not be re-declared. No field removal or type change without deprecation |

## Next Action

`/sdd-design strategy-partial-update` — recon dossier + design debate; must close OQ-1 (merge
mechanism: `FieldMask` vs `patch` op — proto3 no-presence on `components`/`entry_rule`/`exit_rule` is
the deciding factor) and OQ-2 (feature-065 evidence wipe), plus FR-2(b)'s "explicitly requested"
erasure mechanism, which falls out of OQ-1
