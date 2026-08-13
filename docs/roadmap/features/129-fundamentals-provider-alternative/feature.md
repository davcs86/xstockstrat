# Feature: fundamentals-provider-alternative

**Lifecycle Status**: `code-completed`
**Development Branch**: `claude/fmp-free-layer-ratios-dr0c4j`
**Created**: 2026-08-12
**Last Updated**: 2026-08-13

---

## Status History

| Date | Status | Updated by | Note |
|---|---|---|---|
| 2026-08-12 | `idea` → `draft` | /sdd-story | Product spec generated |
| 2026-08-12 | `draft` → `spec-ready` | /sdd-review | Product spec approved (PASS WITH WARNINGS: 3 open questions deferred to /sdd-design per feature-059 precedent; consumer-surface "None" flagged as re-check-if-scope-widens). Overlap scan: clean. |
| 2026-08-13 | `spec-ready` → `design-approved` | /sdd-design | Design debated (1 round, quick) and approved; provider = Finnhub (Twelve Data disqualified — free tier excludes fundamentals). Kept switchable-not-replaced pending live smoke test on 2 open risks (dividend yield, call shape). recon.md + design.md written. |
| 2026-08-13 | `design-approved` → `implementation-ready` | /sdd-spec | Implementation spec generated with 12 steps. Live-docs research (finnhub-python client.py, static GitHub source) confirmed base URL, `token` auth param, and no-batching/one-symbol-per-call shape for all 3 Finnhub endpoints — closing design.md's Open Risk #2 and deriving `symbols_per_minute=20`. Dividend-yield field name (Open Risk #1) remains unconfirmed; deferred to Step 2's live field-name check and Step 12's AC-3 smoke test. |
| 2026-08-13 | `implementation-ready` (unchanged) | /sdd-execute | **Renumbered 127 → 129.** `/sdd-execute`'s re-spec-gate `main-dev` merge surfaced that `docs/roadmap/features/127-consolidate-watchlist-signal/` (PR #926) had landed on `main-dev` claiming `127` first — a genuine cross-session numbering race (this feature's `127` was only ever pushed to this feature branch, never merged). Per the numbering rule (root CLAUDE.md § Feature Roadmap / feature-workflow.md), the later-to-merge feature renumbers: `129` is the next free `NNN` (127, 128 both taken on `main-dev`). Directory renamed, every internal `127-fundamentals-provider-alternative` path reference and bare "feature 127" mention updated across this feature's own artifacts + the 2 ledger entries this feature wrote (`insights.md`, `fails.md`). No content/decision changed — pure renumbering. |
| 2026-08-13 | `implementation-ready` → `in-progress` | /sdd-execute | Sequential-mode execution started. Step 1 (config migration `015_marketdata_finnhub`) done. |
| 2026-08-13 | `in-progress` → `code-completed` | /sdd-execute | All 12 steps done. Finnhub client + provider-dispatch quota guard implemented, tested (15 fundamentals unit tests, 63.3% coverage), and wired at boot; proto comments + service docs + config-governance log updated; both design.md Open Risks closed via live Finnhub API verification (AAPL, PLTR, SOFI). Ready for the integration PR to `main-dev`. |

---

## Artifacts

- [Product Spec](product-spec.md) — requirements and governance
- [Recon](recon.md) — grounded codebase dossier
- [Design](design.md) — debated, approved architecture
- [Implementation Spec](implementation-spec.md) — 12 steps, ready for /sdd-review impl-spec then /sdd-execute
- [Context Log](context.md) — session history, decisions, deviations

---

## Summary

Replace (or add as a switchable alternative behind the existing `source.FundamentalsSource`
interface) the FMP fundamentals client in `xstockstrat-marketdata` with a provider that has a
materially better free-tier cap than FMP's 250 req/day + restricted per-symbol `ratios-ttm`/
`profile` endpoints, while producing functionally equivalent data. Design phase must verify the
real free-tier limits and endpoint coverage of Finnhub and Twelve Data against their current live
API docs and select the better fit.

## Reviewers

_(Auto-populated from docs/runbooks/reviewer-registry.md based on affected services and
change types. Override as needed for this feature. Snapshot finalized at /sdd-spec time —
re-run /sdd-spec if the registry changes.)_

| Role | Review Focus |
|---|---|
| `xstockstrat-marketdata` (service owner) | OHLCV ingestion integrity (Alpaca path must stay untouched), Alpaca feed idempotency; here: new fundamentals-source client correctness, quota-guard behavior, cache correctness |
| `xstockstrat-config` (service owner) | Config key naming (`<service>.<category>.<key>`), environment/trading_mode scoping, WatchConfig stream stability |
| DBA | Migration NNN numbering (no gaps, no conflicts), up+down pair present |
| Proto Reviewer | Field number uniqueness (unaffected), `buf lint`/`buf breaking` pass on the comment-only edit |
| Security | No secrets in config service state, secret keys use `secret.*` prefix / secret-env-var convention, API key scoping correct |

## Next Action

`/sdd-review fundamentals-provider-alternative impl-spec` — validate implementation spec, then `/sdd-execute fundamentals-provider-alternative`
