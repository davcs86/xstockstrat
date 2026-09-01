# Context: fix-insights-offline-ticket  (archived 2026-09-01)
**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-01 — /sdd-archiver

**What**: One-line prop fix: `page.tsx:335` (`/trader/positions/[symbol]`) → added
`allowOfflineRecord={false}` to the inline `OrderForm` mount for the Signal-detail ticket. This
restored the documented broker-execution intent — `OrderForm` defaults `allowOfflineRecord=true`
and the missing prop caused an offline-only account auto-selected by `AccountContext` to flip the
heading from "Place Order" → "Record Offline Order", racing the e2e assertion.

**Why (irrecoverable rationale)**:
- The root cause was the feature-125 (unified-symbol-page) implementation of the Signal-detail
  order ticket. Feature-125 recreated the ticket inline at `page.tsx:335` without `allowOfflineRecord={false}`,
  which the original `SignalOrderTicket.tsx:22` carried explicitly. The prop regression was invisible
  until an offline account was auto-selected — an `AccountContext` hydration race made it flaky.
- Design depth was Track C / inline recon (not a full `/sdd-design quick` subagent debate) because the
  root cause was already fully pinned with path:line evidence and the fix was structurally a one-prop
  restoration. This is an explicit record of the design-depth decision for audit purposes.
- The `/insights/market/[symbol]` page is a redirect-only stub to `/trader/positions/[symbol]`
  (feature 125); the wrong-prop mount was only on the trader page.
- Defect hypothesis #1 (mobile SectionRenderer `form` section omitting the prop) did not apply;
  hypothesis #2 (auto-select re-render race) was the real cause.

**Rejected alternatives**:
- Full `/sdd-design quick` debate — overkill for a single-line restoration with fully pinned root
  cause. Track C inline recon recorded explicitly.

**Scars & gotchas**:
- Feature-125 (unified-symbol-page) is the source; if future edits to `positions/[symbol]/page.tsx`
  add additional `OrderForm` mounts, each must explicitly set `allowOfflineRecord={false}` for Signal
  contexts (only the `/trader` and `/trader/orders` flows should allow offline recording).
- The `e2e/trader/offline-accounts.spec.ts:257` assertion for @AC-1 is the regression guard.

**Permanent deviations**: None. Full Track C inline recon documented in prior context.md.

**Cross-feature signal**:
- Insight for Feature-125's offspring: any page that mounts `OrderForm` in a Signal-detail context
  must pass `allowOfflineRecord={false}` explicitly — the default is true.

**Deferred follow-ons**: None.

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-09-01 entries for 162-fix-insights-offline-ticket.

**Runtime-invariant recommendations (→ /context-constitution)**: None.

**Pruned artifacts**: product-spec.md, implementation-spec.md — last present at commit preceding
the archive branch `claude/archive-batch-2026-09-01`. (recon.md and design.md were not generated
for this Track C bug — not on deletion allowlist.)
