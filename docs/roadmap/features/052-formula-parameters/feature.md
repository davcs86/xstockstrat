# Feature: formula-parameters

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/formula-parameters`
**Created**: 2026-06-08
**Last Updated**: 2026-06-08

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-06-08 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-06-08 | `draft` → `spec-ready` | /sdd-review | Product spec approved (3 overlap warnings, advisory) |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec formula-parameters`_
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
| Proto Reviewer | Field number uniqueness, backward compatibility (no field removal or type change without deprecation), naming conventions |
| `xstockstrat-indicators` (service owner) | Formula sandboxing, numeric precision, timeout enforcement (`indicators.sandbox.timeout_ms`), no side-effects from formula execution |
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, strategy scoring determinism, no look-ahead bias |
| `xstockstrat-ui` (service owner) | Trading UI correctness, config mutation safety, Connect-RPC call safety, no secret values rendered in UI |
| DBA | Migration NNN numbering, up+down pair present, index correctness, run-order compliance |

## Next Action

`/sdd-spec formula-parameters` — generate implementation spec from the approved product spec
