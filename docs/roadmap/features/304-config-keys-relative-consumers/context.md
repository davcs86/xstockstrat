# Context: config-keys-relative-consumers

**Feature**: `docs/roadmap/features/304-config-keys-relative-consumers/feature.md`
**Product Spec**: `docs/roadmap/features/304-config-keys-relative-consumers/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/304-config-keys-relative-consumers/implementation-spec.md`

---

## Session 2026-11-07 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the story text in `296-fix-config-keys-contract/design.md` §1.
- Number `304` reserved on `origin` by `scripts/sdd-allocate-feature-number.sh` (cursor ref `sdd/feature-cursor`; 303 was skipped by the allocator and is burned).
- **Provenance:** created as slice **B** of the four-way split of feature 296 (operator decisions, 296 `context.md` rounds 2–5); `Type: feature`. The `/sdd-story` bug guard (`SKILL.md:274`) is not triggered: this is a planned slice of an approved contract, created on the operator's explicit direction, not a triaged defect (296 stays `Type: bug`).
- Binding inputs: 296 `design.md` §1 (ownership/merge order), §6 (gate close-out), §8 (test blast radius), §9 (documents), §10 (spec edits); baseline owner constant `PREFIXED_READ_OWNER = 'feature 304'`.
- Ledger read (`fails.md`): the 295 test-blast-radius entry is recorded as a Known trap in the product spec's Open Questions.

## Session 2026-11-08 — open questions resolved (operator decisions)
- Q1 (known trap) resolved as a standing constraint on recon/spec (grep every test and fixture root of all 11 services per rewritten literal).
- Q2 (C1–C6/N2 split): operator chose to **defer to `/sdd-spec`**. Evidence gathered now: the 15 pre-approved scenarios (C1 @243 AC-1/4/5, C2 @182 AC-1/2/4, C3 @184 AC-1/2, C4 @278 AC-1, C6 @182 AC-6, N2 @247 AC-1–5) contain no `Then` pinning a reader literal; stored-seed ones are 296's and already noted, N2 names no keys. 295 `@AC-15` is the one 304 CHANGE (FR-7). A regex scan of all durable suites found 25 scenarios outside 296's signed list that quote a prefixed key near a read verb; read by title they are FQN prose, OTel metric names (@294 AC-12/32/38) or fixtures, and need a per-scenario call at spec time (`@154` AC-6/9, `@158` AC-8, `@173` AC-1/2/4, `@186` AC-3, `@147` AC-6/7/11/13, `@258` AC-7, `@243` AC-3, `@295` AC-24, `@278` AC-2/3).
- Q3 (PR strategy): operator confirmed **one integration PR** (the design's choice) over three family PRs or per-service PRs. Gate sizing, from `check-config-wiring.mjs --final --json` on `main-dev` (180 records, all with a file): analysis 75, marketdata 44, trading 27, ingest 9, portfolio 9, notify 6, indicators 3, ledger 3, agent 2, identity 2. Risk accepted: a large diff and review; mitigation is per-family steps and the sequential-mode checkpoints.
- Files modified: `product-spec.md` (Open Questions), this `context.md`.

## Session 2026-11-08 — sdd-review product-spec
- Product spec approved. Status: draft → spec-ready. Result: PASS WITH WARNINGS, 0 blockers, no Floor breach. Tree: ccr-e901c541-u0cmts@a00ca39 (origin/main-dev ee9a301 + the open-question resolutions under review).
- Warnings fixed in the spec: AC-2's portfolio example default `20.0` → `0.1` (seed default, migration 041); AC-3 and AC-6 `Then` clauses reworded as observable outcomes; FR-4's citation `config-wiring.json:91-108` → `:1156` (`dynamic`) and `:38` (`broker.paper`).
- Advisory, carried to /sdd-spec: no scenario of its own for the respelled `dynamic` lists, `broker.paper`, `plugins/strat-lab/skills/backtest/SKILL.md:81` and the `sandbox_keys_check.py` inversion; the 25 FQN-near-read-verb scenarios must be classified with `scenario-recon` (C-16, escalate to the operator only for a `Then` that pins a reader literal).
- Overlap findings: no FAIL-level collision. File-level only (rebase) with 305 and 306 on `scripts/check-config-wiring.mjs`, `config-wiring.json`, `config-wiring.test.mjs` and `config-wiring-stored.json`; merge-order rows 30/31 already cover them. `merge-order.md` row 29 (304 waits for 296) still reads Resolved = No although 296 is merged: proposed flip to Yes, not applied without the operator's confirmation. 280, 305 and 306 each take "next free" config migration numbers above 045 with no pin: consider an ordering row when they reach spec-ready.
- Recommended design depth: **full** (11 services; overlap findings present).
