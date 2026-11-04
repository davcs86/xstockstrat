# Context: fix-stored-edgar-periods  (archived 2026-11-04)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-04 — /sdd-archiver

**What**: After feature 211 launched financial-debt D/E, stored EDGAR periods still held the old total-liabilities D/E (AXP Q2-2026 8.808 = 266,578 / 30,264; 211 @AC-3 expects ~1.73) because no write path ever rewrote a stored row's statement-derived columns. The fix stamps a derivation version on every row, upgrades stale rows in place on the next fundamentals backfill, invalidates the cached edgar snapshot, and a golden-hash test fails CI if the derivation changes without a version bump. The same version (=1) also covers 222's TTM quarterly ROE, so one re-backfill after both deploy fixes both.
**Why (irrecoverable rationale)**: Root cause was confirmed by reading code, not data: `InsertHistoricalFundamentals` is `ON CONFLICT DO NOTHING` (feature 198's earliest-filing pin) and feature 216's existing-row path rewrites only the five price-join columns, so no code path admits another outcome; staging DB and deploy timeline were never queried (triage said "confidence low, unverified"). The operator chose the fork via AskUserQuestion 2026-10-06: a versioned conditional upgrade over a one-off fix so drift cannot silently return. Feature 211 recorded "manual purge + re-backfill" only for amendments and never considered existing rows going stale — the gap 223 closes.
**Rejected alternatives**:
- Purge + re-backfill runbook only — drift silently recurs on the next derivation change.
- Unconditional `ON CONFLICT DO UPDATE` — overwrites the as-reported earliest filing, breaking feature 198 @AC-1.
- Rewriting `currency` during the upgrade — would desync the stored price-join columns (computed in the old currency). The runbook says currency is "untouched" without saying why; this is the why.
**Scars & gotchas**: Execute log recorded no build-time traps. Only collision: 217's PR claimed MARKETDATA-12, so this invariant was numbered MARKETDATA-13.
**Permanent deviations**:
- Design: migration `008` lands after 217's `007` → shipped: 223 holds `008` and 217 was renumbered to migration `009` (`009_symbol_classification.*`) because 222/223 merged first; no further reason recorded.
- Design: 222 and 223 merge separately in sequence → shipped: 222 rode in inside 223's squash merge (feature.md Next Action); no reason recorded.
**Cross-feature signal**: Features 198 (earliest-filing pin), 211 (D/E change), 216 (price-only recovery) and 222 (TTM ROE) together created a class of bug — derived values frozen at first write — that no single feature saw because each assumed new semantics would reach stored rows. `DerivationVersion` is now the shared contract for any future EDGAR builder change. Stacked 222→223 share version semantics, so they ship and re-backfill together.
**Deferred follow-ons**: Run ONE fundamentals re-backfill for the fundamentals universe after 222+223 deploy (never recorded as done). The deferred `fundamentals_macd_blend` exit-rule backtests (see 222 context) are blocked until then. After it, calibrate 217's sector `de_bad`/`roe_bad` thresholds.
**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-11-04 entries.
**Runtime-invariant recommendations (→ /context-constitution)**: MARKETDATA-13 already exists (`services/xstockstrat-marketdata/docs/context-constitution.md:29`); optionally add why `currency` must never be rewritten during an upgrade (price-join desync) — recorded above, since it otherwise lived only in the pruned design.md.
**Pruned artifacts**: product-spec.md, design.md, implementation-spec.md — last present at 1ed63958.
