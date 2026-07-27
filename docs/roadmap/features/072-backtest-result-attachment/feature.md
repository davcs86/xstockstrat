# Feature: backtest-result-attachment

**Lifecycle Status**: `implementation-ready`
**Development Branch**: `feature/backtest-result-attachment`
**Created**: 2026-07-26
**Last Updated**: 2026-07-27

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-07-26 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-07-26 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS with 4 warnings, all addressed). No blockers, no Floor breach |
| 2026-07-27 | `spec-ready` → `design-approved` | /sdd-design | Design debated (1 round, quick; adversary verdict NEEDS WORK, no Floor breach, all objections resolved) and approved; recon.md + design.md written. OQ-1 → EmbeddedResource; OQ-2 → single compact-JSON TextResourceContents (CSV rejected on verified fidelity failure); OQ-3 → moot (no resource registered); OQ-4 → `mcp>=1.27.1` |
| 2026-07-27 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 5 steps (2 service+test pairs + 1 docs). Product-spec AC-1 rewording and stale line citations applied |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, 10 risks
- [Design](design.md) — chosen approach, rejected alternatives, open risks
- [Implementation Spec](implementation-spec.md) — 5 numbered steps with verified codebase evidence
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
types. Override as needed for this feature. **Snapshot finalized at /sdd-spec time (2026-07-27)** —
deduplicated across all 5 implementation steps; re-run /sdd-spec if the registry changes.)_

| Role | Review Focus | Steps |
|---|---|---|
| `xstockstrat-agent` (service owner) | `run_backtest` return-shape correctness, MCP attachment semantics, no fidelity loss vs the inline payload, FR-2 field retention, partial-dict totality, degradation behavior | 1, 2, 3, 4 |
| _none_ | Step category `docs` → no reviewer (`docs/runbooks/reviewer-registry.md:43-51`) | 5 |

> **Registry gap:** `docs/runbooks/reviewer-registry.md` has no `xstockstrat-agent` row in its
> Service Owners table, so the focus above is **inferred**, not registry-sourced. Same gap affects
> features 070 and 071 — see product-spec § Open Questions.

No Proto Reviewer row: this feature makes no proto change. No DBA row: no migration.

## Next Action

`/sdd-review backtest-result-attachment impl-spec` — validate the implementation spec, then
`/sdd-execute backtest-result-attachment`.

Carry-forward items from design **now discharged**: AC-1 has been reworded in `product-spec.md`
(design § 7 — "independent of window length; linear in symbol count"), and the stale line citations
(`servicer.py:507-511`/`:1295-1296`, `test_tools.py:485-527`, and eight more) are corrected there
with a recorded correction block. `implementation-spec.md` cites only lines verified on the
post-070/071 tree.

Still open (accepted, not blocking): a client may inline the `EmbeddedResource` anyway — revisit
after the first real-world connector run; escalation is a gzip blob, additive.

**Merge order:** 072 rebases onto `{070+071}` (PR #792) — see merge-order.md. 072 no longer edits
`tests/test_tools.py:534-577`, since the split lives in `tools.py` and `client.run_backtest` is
untouched, so the "contradictory test" overlap recorded there is resolved rather than merely sequenced.
Confirmed at `/sdd-spec`: the forward-looking `merge-order.md:84-88` escalation (a `ResourceLink`
forcing an `xstockstrat-analysis` `servicer.py` edit inside 071's `RunBacktest` span) **does not
fire** — the design chose `EmbeddedResource` and touches no analysis code, so this stays rebase-only
and needs no hard ordering row.
