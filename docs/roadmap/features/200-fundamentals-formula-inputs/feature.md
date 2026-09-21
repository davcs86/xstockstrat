# Feature: fundamentals-formula-inputs

**Development Branch**: `feature/fundamentals-formula-inputs`
**Created**: 2026-09-21
**Last Updated**: 2026-09-21

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-09-21 | `idea` → `draft` | /sdd-story | Product spec generated (initial scope: formula signal producer) |
| 2026-09-21 | `draft` → `draft` | /sdd-story | Rescoped after user correction: NOT a producer/loop — a fundamentals-fed custom formula usable as a strategy component; renamed from `formula-signal-producer` |
| 2026-09-21 | `draft` → `spec-ready` | /sdd-review | Product spec approved (2 advisory warnings: Open Questions deferred to design; GetIndicatorSeries added to FR-3 snapshot parity). Overlap clean. |
| 2026-09-21 | `spec-ready` → `design-approved` | /sdd-design | Design debated (2 rounds, full mode) and approved; `recon.md` + `design.md` written. Chosen: disjoint formula categories (indicator-only vs fundamentals-only), additive `FormulaDefinition.fundamental_inputs` = new `FundamentalMetric` enum, epoch-model PIT in backtest / `GetFundamentalsMulti` snapshot elsewhere, single reused `analysis.backtest.fundamentals.enabled` gate. No Constitution Floor breach; no C-16 sign-off (no rule CHANGED). |
| 2026-09-21 | `design-approved` → `design-approved` | /sdd-design | R3 (user-requested extra round). Adversary NEEDS-WORK → 4 MAJOR seam fixes: two-chokepoints/one-key gate (snapshot loader ≠ PIT loader), eval-time prefetch routing map + `_definition_wants_fundamentals_formula` predicate, scalar-broadcast keeping value-primary (`@AC-1` → `fscore.composite`), 0-warmup for bars-free formulas; +198 C-16 PRESERVE. User sign-off: **keep the closed enum** (declined the string reversal); `@AC-6` relocated to indicators `RegisterFormula`. Disjoint-kind untouched; still no Floor breach / no rule CHANGED. Design sharpened, gate not re-opened. |
| 2026-09-21 | `design-approved` → `design-approved` | /sdd-review | Post-design product-spec re-review: **PASS WITH WARNINGS**, no blockers, no Floor breach; all code-checkable claims verified. 4 doc-drift warnings addressed (FR-7 validation-point, Open Questions reconciled, DB `.down.sql`, UI badge firmed). Overlap CLEAN (migration/proto/config no collision); added merge-order row 200→198. Status kept `design-approved` (not regressed to `spec-ready`). |
| 2026-09-21 | `design-approved` → `design-approved` | /sdd-design | R4+R5 (user-requested; full-mode cap). Adversary NEEDS-WORK → resolved: branch → `_assemble_component_series` (not `_compute_component`); **indicators migration `006`** for `fundamental_inputs` persistence (corrects "Migration: NONE", +DBA gate); routing map at all 6 evaluate surfaces (2 prefetch + 4 bounded fan-out), warmup cache stays `{id:int}`; snapshot lowered to a 1-epoch `FundamentalPeriod`; shared `_decode_formula_output`; one derived metric list; C-14 read-only badge. **User sign-off: partial-row feed = option (b) omit-absent** (declined proto-zero parity) → FR-5 narrowed to full rows + new `@AC-8`. Disjoint-kind + enum untouched; no Floor breach, no durable rule CHANGED. Design converges — no R6. |
| 2026-09-21 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps (proto+enum → proto-gen → indicators migration 006 → indicators persist/validate/seed → analysis evaluator scalar-broadcast branch → analysis servicer routing map + snapshot loader + two-site gate + write-time XOR → UI badge → docs/teardown). Every step grounded in `path:line` evidence; all 8 `@AC-*` scenarios mapped to test steps (C-15). |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Acceptance Scenarios](acceptance.feature) — Gherkin `@AC-*` scenarios (single source of acceptance truth, C-15)
- [Recon Dossier](recon.md) — grounded codebase map, patterns to reuse, existing business rules (C-16)
- [Design](design.md) — debated, user-approved architecture (disjoint categories); rejected alternatives; open risks; Constitution rules touched
- [Implementation Spec](implementation-spec.md)
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Let a **custom formula used as a strategy component** (`COMPONENT_KIND_CUSTOM_FORMULA`) consume
**fundamentals as inputs** — the same input/output contract as the fundamentals *scoring formula*
(feature 063: fundamentals `input_data` → composite score `output`) — so a strategist can author one
fundamentals-scoring formula and use it directly in a strategy's entry/exit rules. The fundamentals
fed are **context-dependent**: point-in-time as-of each bar (feature 198's PIT store) in a backtest,
current snapshot in live/screener. No background loop or signal emission.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

Canonical snapshot — the deduplicated distinct `**Reviewers**` across all 12 implementation-spec
steps (governance matrix in `docs/runbooks/reviewer-registry.md`):

| Role | Review Focus | Steps |
|---|---|---|
| Proto Reviewer | Field-number uniqueness, no breaking change without deprecation, `buf lint`/`buf breaking` against dev trunk | 1, 2 |
| DBA | Migration NNN numbering (no gaps/conflicts), up+down pair, run-order compliance | 3 |
| `xstockstrat-indicators` owner | Formula sandboxing, numeric precision, no side-effects from formula execution; `fundamental_inputs` persistence + `FUNDAMENTAL_METRIC_UNSPECIFIED` rejection + seeded-formula protection | 1, 2, 3, 4, 5 |
| `xstockstrat-analysis` owner | Backtest reproducibility, strategy scoring determinism, **no look-ahead bias** (PIT epoch fundamentals feeding a formula component; snapshot on live) | 1, 2, 6, 7, 8, 9 |
| `xstockstrat-ui` owner | Analytics display accuracy, Connect-RPC call safety, no secret values rendered; read-only `ComponentEditor` fundamentals badge | 10, 11 |

(Step 12 is `docs` — Reviewers: none per the registry governance matrix.)

## Next Action

`/sdd-review fundamentals-formula-inputs impl-spec` — validate implementation spec, then `/sdd-execute fundamentals-formula-inputs`
