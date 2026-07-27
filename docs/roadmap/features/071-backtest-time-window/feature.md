# Feature: backtest-time-window

**Lifecycle Status**: `in-progress`
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
| 2026-07-27 | `design-approved` → `in-progress` | implementation | Steps 1–8 of 8 implemented (warm-up sizing, paged GetBars, `trade_start_idx`, prefix wiring, agent `start`/`end`, parity/determinism suite, docs, UI e2e + C-12 fixture). **OQ-1 fail-loud vs. short-warm remains an open product decision** — see context.md |

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

**Resolve OQ-1 before this ships.** Implementation of all 8 designed steps is complete and verified,
but the designed fail-loud shortfall behavior has a wider blast radius than the design quantified:
the UI always sends an explicit range, so a backtest whose start predates the symbol's stored
history now reports `INSUFFICIENT_DATA` where it previously ran short-warmed. The rejected
alternative — run short-warmed and emit a **non-fatal** `CoverageGap` — may be the better trade.
Reversing a recorded design decision is a product call; see context.md § "Behavior change that
needs a product decision".

Then verify in CI and open the integration PR.
