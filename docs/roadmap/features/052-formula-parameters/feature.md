# Feature: formula-parameters

**Lifecycle Status**: `in-progress`
**Development Branch**: `feature/formula-parameters`
**Created**: 2026-06-08
**Last Updated**: 2026-06-08

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-08 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-06-08 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 overlap warnings, advisory) |
| 2026-06-08 | `spec-ready` → `implementation-ready` | /sdd-spec | Implementation spec generated with 14 steps |
| 2026-06-08 | `implementation-ready` (re-run) | /sdd-spec | Re-verified all 14 steps' codebase evidence against current tree; no drift, spec unchanged |
| 2026-06-08 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential run started; Steps 1–2 (proto + stub regen) done on `claude/sdd-execute-formula-params-gy0lgo` |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — numbered steps with codebase evidence
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Promote formula inputs from an advisory, untyped `input_schema` map to first-class **typed
parameters** with defaults, validation, and descriptions — enforced by the indicators engine
and surfaced as dynamic parameter forms in the formula and strategy editors (UI + agent).

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| Proto Reviewer | Field number uniqueness, backward compatibility (no field removal or type change without deprecation), naming conventions; `buf lint`/`buf breaking` pass (Steps 1, 2) |
| `xstockstrat-indicators` (service owner) | Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution; validation before execution; persistence (Steps 1, 2, 3, 4, 5, 6, 7, 8) |
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias; backtest/live parity (Steps 1, 2, 9, 10) |
| `xstockstrat-ui` (service owner) | Trading UI correctness, config mutation safety, Connect-RPC call safety, no secret values rendered in UI (Steps 1, 2, 13) |
| `xstockstrat-agent` (service owner) | MCP tool contract carrying parameter definitions/values (Steps 11, 12) |
| DBA | Migration NNN numbering, up+down pair present, index correctness, run-order compliance (Step 3) |

## Next Action

`/sdd-review formula-parameters impl-spec` — validate implementation spec, then `/sdd-execute formula-parameters`
