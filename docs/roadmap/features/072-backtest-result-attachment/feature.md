# Feature: backtest-result-attachment

**Lifecycle Status**: `design-approved`
**Development Branch**: `feature/backtest-result-attachment`
**Created**: 2026-07-26
**Last Updated**: 2026-07-26

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS with 4 warnings, all addressed). No blockers, no Floor breach |
| 2026-07-27 | `spec-ready` → `design-approved` | /sdd-design | Design debated (1 round, quick; adversary verdict NEEDS WORK, no Floor breach, all objections resolved) and approved; recon.md + design.md written. OQ-1 → EmbeddedResource; OQ-2 → single compact-JSON TextResourceContents (CSV rejected on verified fidelity failure); OQ-3 → moot (no resource registered); OQ-4 → `mcp>=1.27.1` |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, 10 risks
- [Design](design.md) — chosen approach, rejected alternatives, open risks
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

`/sdd-spec backtest-result-attachment` — generate implementation spec from the approved design.

Carry forward: **AC-1 is reworded** by design § 7 ("independent of window length; linear in symbol
count") because FR-2 and the original AC-1 are strictly incompatible — apply that amendment to
product-spec.md. Also fix the product spec's stale line citations (`servicer.py:507-511`/`:1295-1296`,
`test_tools.py:485-527`); recon.md has the correct ones.

**Merge order:** 072 rebases onto `{070+071}` (PR #792) — see merge-order.md. 072 no longer edits
`tests/test_tools.py:535-577`, since the split lives in `tools.py` and `client.run_backtest` is
untouched, so the "contradictory test" overlap recorded there is resolved rather than merely sequenced.
