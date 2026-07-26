# Feature: backtest-result-attachment

**Lifecycle Status**: `spec-ready`
**Development Branch**: `feature/backtest-result-attachment`
**Created**: 2026-07-26
**Last Updated**: 2026-07-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS with 4 warnings, all addressed). No blockers, no Floor breach |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Implementation Spec](implementation-spec.md) — _not yet generated — run `/sdd-spec backtest-result-attachment`_
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Make the `run_backtest` MCP tool return a **compact inline summary plus an attached file** carrying
the full result, instead of one large inline payload containing every diagnostic bar. Headline
metrics, coverage gaps and the per-symbol `no_trade_reason`/`warmup_bars` stay inline so a 0-trade run
is still diagnosable without opening the attachment (protecting feature 064); the per-bar diagnostics
and full trade list move to the attachment.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and change
types. Override as needed for this feature. Snapshot finalized at /sdd-spec time — re-run /sdd-spec
if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-agent` (service owner) | `run_backtest` return-shape correctness, MCP resource/attachment semantics, no fidelity loss vs the inline payload, `docs/runbooks/mcp-tools.md` parity |

> **Registry gap:** `docs/runbooks/reviewer-registry.md` has no `xstockstrat-agent` row in its
> Service Owners table, so the focus above is **inferred**, not registry-sourced. Same gap affects
> features 070 and 071 — see product-spec § Open Questions.

No Proto Reviewer row: this feature makes no proto change. No DBA row: no migration.

## Next Action

`/sdd-design backtest-result-attachment` — recon dossier + design debate. Must close OQ-1
(`EmbeddedResource` vs `ResourceLink` — load-bearing; the feature-068 reuse has four verified gaps),
OQ-2 (format), OQ-3 (resource-read auth), OQ-4 (MCP SDK floor if ResourceLink wins)
