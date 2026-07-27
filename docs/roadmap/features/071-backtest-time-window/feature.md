# Feature: backtest-time-window

**Lifecycle Status**: `design-approved`
**Development Branch**: `feature/backtest-time-window` (see context.md — implemented on the
harness-assigned `claude/features-070-071-rnbkqo` branch this session)
**Created**: 2026-07-26
**Last Updated**: 2026-07-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-26 | `draft` → (fail) | /sdd-review | FAIL — premise contradicted by code: `RunBacktestRequest.range` already ships end-to-end incl. UI; proposed proto fields would duplicate it |
| 2026-07-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved after re-scope (no proto change; agent plumbing + pre-window warm-up). 7 warnings addressed |
| 2026-07-26 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, quick+1 Floor round) and approved; recon.md + design.md written. R1 BLOCKED on F-07; resolved by deriving the prefix from declared params |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, 8 risks
- [Design](design.md) — chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec backtest-time-window`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Let the `run_backtest` **MCP tool** accept an explicit `start`/`end` window, and make the engine load
enough pre-window history to warm up indicators before `start`. Unblocks temporal out-of-sample /
walk-forward validation and makes backtest results deterministic across calendar days.

> **Scope corrected at review (2026-07-26).** `RunBacktestRequest.range` already exists
> (`analysis.proto:34`), is honored by the servicer (`servicer.py:273-297`), and is already sent by
> the UI form (`strategies/[id]/page.tsx:91`). **No proto change is required.** The real work is
> (1) plumbing the window through the agent tool/client, and (2) pre-window indicator warm-up.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and change
types. Override as needed for this feature. Snapshot finalized at /sdd-spec time — re-run /sdd-spec
if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-analysis` (service owner) | Backtest reproducibility, no look-ahead bias; window + indicator warm-up correctness (pre-window history must not leak future data) |
| `xstockstrat-agent` (service owner) | `run_backtest` MCP tool parameter/docstring accuracy, `docs/runbooks/mcp-tools.md` parity |
| `xstockstrat-ui` (service owner) | Backtest form / `BacktestDiagnostics` correctness — the window is already exposed, and the warm-up change alters existing UI-triggered results (FR-6 agent↔UI parity) |

_Proto Reviewer row removed at review: this feature makes no proto change (see product-spec
§Proto Contract Changes)._

## Next Action

`/sdd-spec backtest-time-window` — generate implementation spec from the approved design
