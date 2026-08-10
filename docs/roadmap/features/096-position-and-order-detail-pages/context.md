# Context Log: position-and-order-detail-pages

Append-only session log. **Read this before touching any feature file.**

---

## Live State (header)

- **Feature**: 096-position-and-order-detail-pages
- **Status**: implementation-ready → in-progress
- **Branch**: `feature/position-and-order-detail-pages` (off `main-dev` @ f8b7197)
- **Scope**: frontend-only (`xstockstrat-ui`); additive; no proto/migration/config.
- **Two deliverables**: dedicated `/trader/positions/[symbol]` page + upgraded `/trader/orders/[id]`
  ticket page.

## Open Threads

- [ ] Exposure Sheet vs. full page — keeping the Sheet as a quick peek AND adding the full-page link
  (design.md Open Risks). Revisit if redundant.
- [ ] `getPosition` e2e mock must land with the page (Step 6) or the page 404s in e2e.

---

## Session — 2026-08-02 (design + spec authoring)

- Origin: Claude Design handoff (`design-handoff/xstockstrat UI.dc.html` — POSITION DETAIL +
  ORDER EDITOR screens). User asked for the single Position page + single Order page at high
  fidelity (desktop + mobile), Copilot excluded, via the SDD process.
- **Prior art discovered**: #853 (on main-dev) raised the single-Position **Sheet** + Signal-detail
  fidelity and **reserved feature 095** (`opportunity-live-market-enrichment`) for the un-faked
  Decide-surface live-data extras. 096 is therefore the *pages* (Book surface) — numbered 096
  because 095 is taken.
- **Overlap review vs 095: CLEAN.** 095 owns live price/change, sparkline, per-condition live value
  chips, target/stop overlays + R:R/sizing **on the Decide surface**. 096 reuses only fields that
  already exist (`Position` risk fields, `Order`, `getBars`); its chart avg-cost/stop overlays use
  `avgEntryPrice`/`stopPrice`, which are already-authoritative, not the 095 marketdata-quote gap.
- **No-fake decision (P-03)**: the prototype's prose thesis, price target, reward:risk, and
  realized-P&L have no backend source → **omitted**, deferred to 095. "Why it's held" becomes a
  factual Risk & exit block. Owning strategy **derived** from the symbol's orders' `strategyId`.
- **GetPosition**: the RPC exists (`portfolio.proto:12`) but is not wired through the trader BFF;
  096 adds the BFF method + `usePosition` hook (additive) so the page reads one authoritative
  position (cleaner C-10(b) parity than filtering `listPositions`).
- Artifacts written: feature.md, product-spec.md, recon.md, design.md, implementation-spec.md (6
  steps), this context.md.
- Delivery: implemented directly in this session (frontend-only, additive) rather than as separate
  per-step PRs, then one integration PR to `main-dev`. Recorded as a sequential-mode consolidation.

---

## Session — 2026-08-10 (status correction, discovered while starting a follow-up feature)

- A user asked to reshape this feature into one unified per-symbol page. Before writing a new
  product spec, checked out `feature/position-and-order-detail-pages` to continue from it and
  found it 95 commits behind `main-dev`; merging surfaced conflicts because **the same files this
  branch's own commit `4a10ceb` touches were already shipped to `main-dev` via PR #855
  (`7f6f65e`)** on 2026-08-02 — the same day this spec was written. `feature.md`/
  `implementation-spec.md` were never updated past `implementation-ready`/all-`pending`, so this
  feature has actually been **live in production since PR #875 promoted it to `main` on
  2026-08-06** (commit `c1d1882`) while its tracking docs said otherwise for over a week.
- Root cause: the delivery note above ("implemented directly in this session... one integration
  PR to main-dev") never flipped the implementation-spec.md step statuses to `done` or feature.md
  to `code-completed` before the integration PR merged, so CI's `ci-validate-feature-status.yml`
  — which only auto-promotes features already at `code-completed` when a promotion PR merges —
  silently skipped this feature at promotion time (2026-08-06).
- **Fix (user-approved)**: corrected `feature.md` to `launched` (`Committed to main: c1d1882`,
  `Launched date: 2026-08-06`) and all 6 `implementation-spec.md` steps to `done`, using the exact
  fields/format CI's automation would have written, with an explicit deviation-log entry
  documenting this was a retroactive doc fix, not new work. No code changed by this correction.
- **Consequence for the follow-up feature**: it is not building two new pages from scratch — it
  consolidates two already-live production pages (`/trader/positions/[symbol]`,
  `/trader/orders/[id]`) plus new scope into one unified per-symbol page. Per user decision, it
  gets its **own new feature number** rather than reusing this slug (096's code already shipped
  under its original narrower scope, so repurposing this directory would misrepresent what
  actually happened). See `docs/roadmap/features/` for the new feature's directory.
- This `feature/position-and-order-detail-pages` branch is now superseded by `main-dev` and not
  used further; no more commits are planned against it.
