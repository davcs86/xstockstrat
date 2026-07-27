# Feature: backtest-result-attachment

**Lifecycle Status**: `code-completed`
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

| 2026-07-27 | `implementation-ready` (unchanged) | /sdd-design r2 | Second grilling round on the approved design: gzip'd `BlobResourceContents` swap **proposed and rejected** (it inverts this feature's own failure-asymmetry rule; measured 103 KB not the 53 KB assumed; needs two unobserved behaviors to pay off). Chosen approach unchanged. Three corrections adopted — measured sizes replace estimates, AC-1 test bound `8_000` → `3_000`, `mtime=0` reproducibility limit recorded |
| 2026-07-27 | `implementation-ready` (unchanged) | /sdd-design r3 | Third round: content-trimming measured and **rejected** (a 0-trade run keeps 0/2520 bars). Design unchanged again. Seven corrections — `profit_factor: "Infinity"` is unreachable (producer clamps); `structured_output=False` is a no-op for bare `list` so its guard test was inert; AC-1 bound re-aimed at marginal cost (gaps are not INSUFFICIENT-only); descriptor-parity guard; fixed `attachments_error` string; `quote()` the id; stale CI note. New `fails.md` entry rather than rewriting append-only ledger |
| 2026-07-27 | `implementation-ready` → `in-progress` | /sdd-execute | Step 1 done — `app/backtest_view.py` (summary projection + attachment block) |
| 2026-07-27 | `implementation-ready` → `in-progress` | /sdd-execute | Execution started on `feature/backtest-result-attachment` (fresh branch off `main-dev` @ `1d54d0b`). Steps 1–2 done: `app/backtest_view.py` + 12 unit tests, red-before-green recorded |
| 2026-07-27 | `in-progress` → `code-completed` | /sdd-execute | All 5 steps done, one commit each, both red-green cycles recorded. 109 tests pass, coverage 69.16% |
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

> **Registry gap — CLOSED 2026-07-27.** `docs/runbooks/reviewer-registry.md` previously had no
> `xstockstrat-agent` row, so the focus above was inferred. A row now exists (MCP tool-contract
> stability + `mcp-tools.md` parity, the six tool-count surfaces, OAuth statelessness, admin-scope
> forwarding, no secrets in tool output or `/api/tools`). Features 070 and 071 shared this gap.

No Proto Reviewer row: this feature makes no proto change. No DBA row: no migration.

## Next Action

Integration PR `feature/backtest-result-attachment` → `main-dev`. No merge-order entry applies:
`merge-order.md` has no 072 row, and the forward-looking escalation was discharged at design time
(it was conditional on a `ResourceLink` resolution forcing an `xstockstrat-analysis` edit; the design
chose `EmbeddedResource`).

**Carried forward, unresolved by design:** a client may inline the `EmbeddedResource` into model
context anyway. Recorded with a named disconfirming observable — a real connector run whose context
still balloons — and an additive escalation (gzip blob), gated on observing **both** that the
connector inlines **and** that a `gunzip`-able download affordance exists.
