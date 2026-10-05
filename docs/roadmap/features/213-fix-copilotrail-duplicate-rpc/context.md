# Context Log: fix-copilotrail-duplicate-rpc

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-09-26 (/sdd-triage)

- Bug recorded via defect report `docs/reports/2026-09-26-copilotrail-duplicate-listopportunities-rpc-defect.md` (pruned 2026-10-05; `git show 2ce8de0a:docs/reports/2026-09-26-copilotrail-duplicate-listopportunities-rpc-defect.md`)
  (GitHub Issues are disabled on this repo — `--from-report` path). Surfaced during the feature 187
  QA back-fill as the reason @AC-7 could not be covered.
- Severity: SEV-3. Config-only: no. Impact type: redundant-backend-rpc.
- Routed to SDD path (Track C).
- Created: status.md (`draft`), feature.md (Type=bug), product-spec.md, acceptance.feature
  (regression scenario @AC-1: single page-1 ListOpportunities RPC), context.md.
- Affected services (from report): `xstockstrat-ui` — `src/components/copilot/CopilotRail.tsx`,
  the shared `src/hooks/useOpportunities.ts`, parity with `src/app/insights/opportunities/page.tsx`.
  Extra read fan-out lands on `xstockstrat-analysis` but no analysis-side change anticipated.
- Root cause: CopilotRail `useOpportunities(0)` defaults `sort=UNSPECIFIED` (0); the page passes
  `sortEnum` defaulting to `CONVICTION` (1). The feature-190 5-tuple query key
  (`['opportunities', minConviction, sources, actionFilter, sort]`) therefore differs on the trailing
  `sort`, so React Query keeps two cache entries and fires two RPCs. One-line fix: align CopilotRail's
  sort with the page default.
- Numbering: assigned **213** (max existing NNN 212 + 1; 212 is the just-imported
  `212-sysadmin-db-write-role`). Not the count-based formula in the Track C reference, which is unsafe
  in this repo (duplicate NNNs + gaps) — used the authoritative max+1 rule (root CLAUDE.md).
- Recommended design depth: **skip** → `/sdd-spec fix-copilotrail-duplicate-rpc` (SEV-3, single
  service, no proto/migration/config, clear one-line root cause).
- Follow-on: once this fix lands, add the deferred feature-187 @AC-7 strict single-RPC guard to
  `services/xstockstrat-ui/e2e/insights/opportunities.spec.ts`.
- Development branch: feature/fix-copilotrail-duplicate-rpc

---

## Session 2026-09-26 — sdd-design (quick, 1 round)

- Phase 0 Recon: wrote recon.md (service: xstockstrat-ui). **Key finding: 5 callers of `useOpportunities`, not 2** — four ambient consumers default `sort=UNSPECIFIED` (`CopilotRail.tsx:37`, `SignalReadiness.tsx:28`, `WatchlistDetail.tsx:72`, `trader/positions/[symbol]/page.tsx:176`); only the opportunities page passes `CONVICTION`. CopilotRail's hook runs on every route (global rail, above the `showCopilot` guard).
- Phase 1 Grilling: 1 round (quick). **Chosen approach:** single-source the default sort — change `useOpportunities` `sort` param default `UNSPECIFIED`→`CONVICTION` (`useOpportunities.ts:27`), matching the page's existing fallback; update CopilotRail's stale `:36` comment. **Rejected:** the product-spec's "pin only CopilotRail" minimal fix — it relocates the duplicate RPC to `/insights/watchlists` and `/trader/positions/[symbol]` because three other ambient consumers still default to `UNSPECIFIED`.
- **Deviation from product-spec scope:** product-spec says "single-file front-end fix … Out of Scope: refactoring useOpportunities." The robust fix touches the shared hook (the DRY root of the drift). This is a scope widening from the approved spec — flagged for user sign-off at the consolidated 189/213 impl-spec review before any code is written.
- Constitution rules touched: C-14 (surface-level e2e verification), F-04/P-03 (server sort semantics carried as Open Risk, not guessed), DRY. Floor breaches: none.
- Open risk carried: confirm `sort=UNSPECIFIED` vs `CONVICTION` return the same opportunity *set* from analysis (order-only difference; ambient consumers don't depend on order). Verify at execute step.
- Status: draft → design-approved. Approval consolidated into the caller's 189/213 impl-spec review pause (design not yet independently user-approved via the P-04 gate).

---

## Session 2026-09-26 — sdd-spec

- Generated implementation-spec.md with **2 steps**. Status → `implementation-ready`.
- Step 1 (service, xstockstrat-ui): change `useOpportunities` `sort` param default
  `OpportunitySort.UNSPECIFIED` → `CONVICTION` at `src/hooks/useOpportunities.ts:27`; update the
  stale cache comment at `CopilotRail.tsx:36`. Step 2 (test): `@AC-1` regression in
  `e2e/insights/opportunities.spec.ts` asserting a single page-1 ListOpportunities RPC with
  CopilotRail mounted (red-before-green: 2 RPCs pre-fix, 1 post-fix).
- Key codebase findings (grounded, this session):
  - Hook default is at `useOpportunities.ts:27`; 5-tuple query key at `:30`
    (`['opportunities', minConviction, sources, actionFilter, sort]`) — preserved (fails.md:1648).
  - **5 callers confirmed** via `grep -rn "useOpportunities("`: page passes `CONVICTION`
    (`opportunities/page.tsx:105,116`); 4 ambient consumers rely on the default and converge
    automatically (`CopilotRail.tsx:37`, `WatchlistDetail.tsx:72`, `SignalReadiness.tsx:28`,
    `trader/positions/[symbol]/page.tsx:176`).
  - `OpportunitySort` enum values confirmed in `packages/proto/analysis/v1/analysis.proto:546-550`
    (UNSPECIFIED=0, CONVICTION=1, EXPIRY=2, SYMBOL_SCORE=3).
  - CopilotRail is mounted globally at `PlatformHeader.tsx:180`; its hook runs above the
    `showCopilot` guard (`:100`), so the second RPC fires on every route.
  - e2e mock `mockOpportunities` (`opportunities.spec.ts:53`) branches ordering only on
    `isExpirySort(req.sort)` (`:35`) → UNSPECIFIED and CONVICTION return the same set+order in the
    mock, resolving the design Open Risk for the e2e path. Confirm the analysis handler treats
    UNSPECIFIED as conviction-default at execute (carried as an Open Risk in the spec).
- Scope note: the spec widens the product-spec's "single-file / pin-CopilotRail" scope to the shared
  hook default (design.md rationale). Flagged in the spec's Execution Summary for user sign-off at
  the consolidated 189/213 impl-spec review (context.md:39, C-14/P-04).
- Reviewers snapshot written to feature.md: xstockstrat-ui owner for both the `service` and `test`
  steps.

---

## Session 2026-09-26 — sdd-review impl-spec (advisory)

- Result: 0 failures, 2 warnings (+2 notes). No Floor breach. Overlap: CLEAN (UI-only; `useOpportunities.ts`/`CopilotRail.tsx`/`opportunities.spec.ts` disjoint from all in-flight features; only reads `OpportunitySort`, re-numbers nothing).
- Items carried into execution:
  - Step 1 W1 (C-10/C-14 ripple): [x] added a Codebase-Evidence note that the three non-CopilotRail ambient consumers (`WatchlistDetail:72`, `SignalReadiness:28`, `trader/positions/[symbol]:176`) consume the queue by symbol lookup, not ranked position → the `UNSPECIFIED`→`CONVICTION` shift is display-safe; folded into the Step-2 set-equality verification.
  - Step 1 W2 (P-04/C-14/**F-10**): [x] **scope-widening sign-off REQUIRED before any Step-1 write.** The design widens beyond the product-spec's "single-file, don't touch `useOpportunities`" boundary. F-10 forbids writing Step-1 code until the user's explicit sign-off is recorded here in `context.md`. PENDING at the consolidated 189/213 review gate.
  - Step 2: [x] no numeric coverage threshold — correct for `xstockstrat-ui` (e2e is the gate); documented. No action.

---

## Session 2026-09-26 — scope-widening sign-off (F-10, P-04)

- **User explicitly approved the robust fix** at the consolidated 189/213 review gate: change the shared `useOpportunities` `sort` parameter default (`UNSPECIFIED`→`CONVICTION`), widening beyond the product-spec's "single-file, don't touch the hook" boundary. This is the recorded sign-off F-10 requires before any Step-1 write. The rejected alternative (pin only CopilotRail) relocates the duplicate RPC to `/insights/watchlists` and `/trader/positions/[symbol]` and was declined.
- Step-1 code writes are now unblocked.

---

## Session 2026-09-26 — sdd-execute (sequential; single-branch adaptation)

Executed on `claude/pending-roadmap-features-9z01mn`; integration via shared PR #1191. UI tooling already present (189 install).

### Step 1 — service: align the shared opportunity-sort default [done]
- Changed `useOpportunities` `sort` param default `OpportunitySort.UNSPECIFIED`→`OpportunitySort.CONVICTION` (`src/hooks/useOpportunities.ts:27`); refreshed the stale CopilotRail cache comment (`src/components/copilot/CopilotRail.tsx:36`). All five callers now converge on the page's default page-1 key.
- Files modified: `src/hooks/useOpportunities.ts`, `src/components/copilot/CopilotRail.tsx`
- Deviations: scope-widened to the shared hook (signed off, F-10, prior session note).

### Step 2 — test: @AC-1 single page-1 RPC regression [done]
- Added the `Opportunities — single page-1 ListOpportunities RPC (feature 213 @AC-1)` describe to `e2e/insights/opportunities.spec.ts` (counting shim `route.fallback()`s to `mockOpportunities`). Red→green captured: pre-fix 2 RPCs (`UNSPECIFIED`+`CONVICTION`), post-fix 1. Full suite 36/36 green.
- Files modified: `e2e/insights/opportunities.spec.ts`
- Deviations: CI-equivalent e2e verification (Docker unavailable) — see Deviation Log.

- Review-warning dispositions (from the sdd-review impl-spec note above):
  - Step 1 W1 (ambient-consumer order-independence): [x] noted in spec Step 1 evidence + empirically confirmed (36/36 green, incl. sort tests).
  - Step 1 W2 (F-10 scope-widening sign-off before write): [x] user signed off; recorded in the prior context session before any Step-1 edit.

## Session 2026-09-26 — sdd-execute (213 complete)
**Steps this session**: 1, 2
**Progress**: 2 done / 2 total
**Stopped at**: all complete (code-completed)
**Next**: feature 211 (next in sequence)

## Session 2026-09-27 (CI: feature status automation)

- Promotion PR #1194 merged to main
- Feature promoted and committed: 5fd9faf88fa1a93f41adced9eebff0ad0852634c
- Status updated: `code-completed` → `launched`
- Launched date: 2026-09-27
