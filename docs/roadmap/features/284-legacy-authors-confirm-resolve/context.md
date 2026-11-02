# Context: legacy-authors-confirm-resolve

**Feature**: `docs/roadmap/features/284-legacy-authors-confirm-resolve/feature.md`
**Product Spec**: `docs/roadmap/features/284-legacy-authors-confirm-resolve/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/284-legacy-authors-confirm-resolve/implementation-spec.md`

---

## Session 2026-11-02 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Follow-up to `276-fix-legacy-formula-authors` (launched); extends `app/maintenance/legacy_authors_ops.py` only.
- Operator decisions (AskUserQuestion, 2026-11-02): mechanism = both `--map` and interactive picker; scope = unmappable + ambiguous; targets = active users in users.json only; process = full SDD (story + `/sdd-design quick`), not a 276 amendment.
- Next feature number computed as max(283)+1 = 284.
- Ledger read: no `fails.md` entry covers operator maintenance CLIs; nothing to carry.

## Session 2026-11-02 — open questions resolved

- Operator accepted all proposed defaults (OQ-1..OQ-4): ambiguous rows accept only matched candidates for both `--map` and the picker; `--map --yes` skips the second y/N; `--map` matches `old_author` exactly; no new PII exposure beyond `format_plan`.
- FR-2 amended to state the ambiguous-candidate rule; `@AC-6` already covers the picker side, `@AC-13` added for the `--map` side.

## Session 2026-11-02 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria verdict: PASS WITH WARNINGS (no fails, no Floor breaches). Warnings were fixed in the spec before advancing:
  - FR-4/FR-5/FR-6 interplay: one confirmation prompt covers `suggested` and resolved rows; `--yes` still confirms `suggested` rows as today (`@AC-16`, `@AC-17` added).
  - Exit codes: invalid `--map` exits 2; decline, EOF and nothing-to-confirm stay 0.
  - `--map` parsing: split on the last `=`; duplicate legacy author with different targets is invalid; unknown-user case added (`@AC-14`, `@AC-15`).
  - `@AC-5` made concrete (picker order = `users.json` order, expects `davcs86`); `@AC-11` reworded to an observable outcome.
- Design traps carried to `/sdd-design` (not spec defects):
  - Plan entries do not store the matched candidates, so the ambiguous-row candidate check must be recomputed from `users.json` with the same active, case-insensitive local-part rule as `classify`.
  - `_users_by_id` returns `{}` on any read error; the new validation must use strict `legacy_authors.load_users`.
- Overlap findings: WARN only. `services/xstockstrat-indicators/CLAUDE.md` is also edited by in-progress `243-fix-sandbox-seed-keys` in different sections (rebase-level, no merge-order entry needed). No config, proto or migration collision.
- Recommended design depth: quick (single service, no proto/config/DB, no consumer surface).

## Session 2026-11-02 — sdd-design round 1 (quick) — operator decisions

- Round 1: proposer + adversary ran; adversary verdict NEEDS WORK, no Floor breach. Single write site in `confirm` keeps `plan.json` byte-identical on every abort/decline/EOF (verified against code).
- OPERATOR DECISION (AskUserQuestion, 2026-11-02): picker asks **once per legacy author**, covering all its rows incl. soft-deleted siblings. FR-3 amended; `@AC-5` Then now asserts F1 and F2; `@AC-8`/`@AC-17` answer sequences reworded (skip F3 at the picker, then answer the confirmation).
- OPERATOR DECISION: with no `--map` and an unreadable `users.json`, **skip the picker with a warning** and keep today's suggested-only flow; `--map` still refuses with exit 2. `@AC-18` added. Also `@AC-19` (no eligible user -> skipped, no prompt).
- OQ-4 correction: the picker lists every active user's email local part, which IS new console exposure; runbook §5 must say so and recommend `--map` for recorded/shared sessions.
- Folded in without a fork (adversary SHOULD-FIX/NIT): parity test pinning the copied candidate rule to `la.classify`; keep the exact current prompt/"No suggested rows" wording when nothing was overridden; print `format_plan` before the picker and before the confirmation; build the display map from the strict `load_users` result.
- Operator chose to run another round before approving (round 2 follows).
