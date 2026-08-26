# Context Log: fix-screener-soft-criterion  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; `product-spec.md` pruned (recoverable via git history). This bug fix never had recon/design/impl-spec files.

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: The screener's soft/weighted scoring emitted a hardcoded `0.5` "neutral" `technical_score` whenever a candidate had zero usable data for every configured soft criterion (the `weight_total == 0` division-guard fallback), making a data-less ETF like QQQ look like a real mid-range result and outrank symbols with genuine, worse P/E data. The shipped fix added an additive `ScreenResult.score_unavailable` bool set only when criteria were configured but all were skipped for that candidate, plus a server-side rank-last sort — the data-less case stays visible/actionable but can never outrank a genuinely-scored candidate. This is the soft-criterion sibling of the hard-filter null-as-zero bug fixed earlier in PR #971 (which only touched the `passed` boolean, never the ranking `score`).

**Why (irrecoverable rationale)**: The fix deliberately did **not** reuse the existing `SCREEN_RESULT_STATUS_INSUFFICIENT_DATA` status for two reasons that no longer live in code once the spec is gone: (1) that status drives an **active UI re-poll loop** (`useScreenSymbolsPoll` filters `pendingRows` on `status === INSUFFICIENT_DATA`) intended for genuinely-transient absences (bars catching up, fundamentals source recovering); an ETF having no P/E is **permanent**, so reusing it would have mis-signaled "retry-eligible / Fundamentals pending" forever and driven pointless polling. (2) Reusing it would have flipped a **pinned** hard-filter test (`test_fundamental_hard_filter_missing_for_one_symbol_fails_closed`) that asserts `status == OK` for the same `weight_total == 0` condition reached via the hard-filter path. So `status` was kept `OK` and a new orthogonal bool carries the signal instead.

**Rejected alternatives**:
- Reuse `SCREEN_RESULT_STATUS_INSUFFICIENT_DATA` — lost: mis-signals a permanent absence as transient/retry-eligible and would break the pinned hard-filter test.
- Exclude the data-less candidate from `results` entirely — lost as more destructive than needed; discards caller visibility (e.g. manually watchlisting QQQ anyway).
- Just change the fallback constant `0.5 → 0.0` — lost: a real candidate can legitimately score `0.000` (AAPL did in the original repro), so it stays indistinguishable from genuine data, merely at the other end of the range.

**Scars & gotchas**:
- Proto stubs had to be regenerated via the **host-provisioned** codegen toolchain (Docker daemon unavailable in the sandbox) per `codegen-toolchain-host-setup.md`, validating an empty stub diff first.
- 3 of 21 Playwright `screener.spec.ts` tests fail in-sandbox, but they are **pre-existing global-mock-backend timing failures**, not a regression — proven by `git stash` + re-run on the pristine pre-fix baseline. Don't chase them as this fix's breakage.
- The internal `technical_score` `0.5` fallback was **left in place** (still feeds `combine_score`) as an explicit scope boundary — not an oversight.

**Permanent deviations**: None — no `design.md` existed (a lightweight bug fix; grounded design reasoning was performed inline here in lieu of running `/sdd-design quick`, because no human was present to drive the adversarial debate in the harness session).

**Cross-feature signal**: The "magic neutral fallback for missing data" anti-pattern (`x / n if n else 0.5`) recurs across subsystems: PR #971 (hard-filter path, `passed`), this fix (soft-criterion `score`), and an **unfixed twin** at `app/engine/fundsignal_loop.py:294` (`_builtin_score`, `sum(parts)/len(parts) if parts else 0.5`). Same shape, different blast radius.

**Deferred follow-ons**: `app/engine/fundsignal_loop.py:294` `_builtin_score` has the identical neutral-fallback shape, feeding the fundamentals signal producer's cross-sectional buy/sell/hold quantile. Consciously left unfixed (different subsystem, out of this spec's acceptance scope) and flagged for a human to rate/track — **not** filed as a formal defect. The next `/sdd-story` or triage should not rediscover this from scratch.

**Ledger entries written**: insights.md (2), fails.md (1) — see the 2026-08-26 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: ANALYSIS-* / UI-* — `SCREEN_RESULT_STATUS_INSUFFICIENT_DATA` is behaviorally load-bearing: the UI (`useScreenSymbolsPoll` → `pendingRows`) treats it as an active retry/re-poll signal. It must only ever mark **genuinely transient** data absence (bars catching up, fundamentals source recovering), never a permanent absence. This cross-module contract between `xstockstrat-analysis` scoring and the `xstockstrat-ui` screener poll loop is non-obvious and easily violated by a future author reaching for the "nearest" status enum.
**Scenario promotion (C-16)**: none — this bug fix has no `acceptance.feature` file.
**Pruned artifacts**: product-spec.md — last present at 996210e4. (Defect report retained at `docs/reports/2026-08-17-screener-missing-data-neutral-score-defect.md`; this context.md retained.)
