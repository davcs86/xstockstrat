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

## Session 2026-11-02 — sdd-design

- Phase 0 Recon: wrote recon.md (service: xstockstrat-indicators; key reuse: injected `ask=input`, strict `la.load_users`, `la.ApplyRefused` exit 2, `sub.choices[...]` argparse pattern). Business rules: 8 guarantees from the 276 suite, none CHANGE.
- Phase 1 Grilling: 2 rounds (quick mandated 1; operator asked for a second). Round 1 adversary: NEEDS WORK, no Floor breach. Round 2 adversary: SOUND, no Floor breach, no blockers.
- Chosen approach: all code in `legacy_authors_ops.py`; pure helpers + `confirm(work,*,yes,maps=(),ask=input)`; validate-all-then-single-write; lazy strict `users.json`; per-author picker; one combined prompt. Rejected: classify-as-oracle, stored candidates, TTY switch, per-row picker, shared `_refused` helper touching apply.
- Operator decisions (AskUserQuestion): per-author picker; unreadable `users.json` without `--map` -> skip picker with warning; round-2 design approved incl. broader EOF reading (first EOF stops the picker).
- Round-2 fold-ins recorded in design.md; spec/acceptance amended (FR-3, FR-4, FR-5; `@AC-20`, `@AC-21`, `@AC-22` added).
- Constitution rules touched: C-08, C-11, C-13, C-14, C-15, C-16, C-18, P-03, F-04. Floor breaches: none.
- Status: spec-ready -> design-approved.

### Open Threads
- [ ] Piped-`y` silent no-op mitigated by the `Not confirmed` line + runbook wording — verify at the docs step.
- [ ] Parity test samples 5 authors only — revisit if `classify`'s rule changes.
- [ ] Teardown: context-forge refresh (or manual reconciliation) recorded in the PR body — at PR time.
- [ ] Overlap with 243 on `services/xstockstrat-indicators/CLAUDE.md` (disjoint hunks) — rebase at integration.

## Session 2026-11-02 — sdd-spec

- Generated implementation-spec.md with 6 steps. Status → implementation-ready.
- Key codebase findings:
  - All code is in `services/xstockstrat-indicators/app/maintenance/legacy_authors_ops.py`: `confirm` `:90-108` (single write at `:107`), `main()` confirm branch `:149-154`, apply-branch refusal pattern `:181-184` (reused inline for confirm). `legacy_authors.py` stays untouched (`APPLY_STATUSES :151`, `ApplyRefused :154`, candidate rule `:99-104`).
  - Default `ask=input` is bound at definition, so `main()` tests must patch `sys.stdin` (not `builtins.input`); the two existing confirm tests (`:62`, `:93`) run without `users.json`, which is why it is loaded lazily.
  - Acceptance examples differ from `conftest.USERS` (scenarios: `alice` x2 / inactive `bob` / unmapped `carol`; fixtures: `sam` x2 / inactive `olduser`, `carol` is active). Spec Step 2 pins the role mapping (ghost, sam, zed).
  - Baseline verified: `uv run --extra dev pytest --cov=app --cov-fail-under=50` = 393 passed, 80% coverage; `./scripts/check-context-map.sh` OK.
  - Test pairing: `@AC-9` and the `main()` EOF exit code pass on the old tree (marked green-on-arrival); red is carried by sibling assertions (prompt count, picker listing).
- Overlap: 243 edits `services/xstockstrat-indicators/CLAUDE.md` (different sections, rebase-level); 281 only cites the runbook.
- Teardown for the PR body is specified in Step 6 (context-forge refresh scoped to the runbook, indicators CLAUDE.md, and `INDICATORS-12`; manual reconciliation if the plugin is unavailable).

## Session 2026-11-02 — sdd-review impl-spec (advisory), pass 1

- Result: 0 failures, 2 warnings, 7 nits (advisory — did not block). No Floor risk.
- Unresolved ✗ / ⚠ carried into execution:
  - Step 4 / Step 2: AC-3, AC-13, AC-14, AC-15 assert "exit 2 and byte-identical plan" but only the pure `_parse_maps` reason text is tested; the `main()` refusal test covers AC-2 and AC-4 only (C-15, C-08) — [x] addressed in spec revision 1 (2026-11-02)
  - Step 6: Instructions allow fixing drift in `docs/runbooks/legacy-formula-authors.md` and `services/xstockstrat-indicators/docs/context-constitution.md` but Files lists only `services/xstockstrat-indicators/CLAUDE.md` (F-08) — [x] addressed in spec revision 1 (2026-11-02)
  - Step 1: verification prints a set literal (nondeterministic repr); say "pre-existing 6 + Step 2 tests" — [x] addressed in spec revision 1 (2026-11-02) (NIT)
  - Step 2: replace the `grep -c "ghost\|USERS"` C-13 count with a pass/fail check; state `_Ask` appends to `.prompts` before raising `EOFError` — [x] addressed in spec revision 1 (2026-11-02) (NIT)
  - Step 3 / Step 5: document that the second plan listing shows the proposed `[confirmed]` state before the prompt — [x] addressed in spec revision 1 (2026-11-02) (NIT)
  - Step 5: soften the brittle `! grep "still a hand edit"` — [x] addressed in spec revision 1 (2026-11-02) (NIT)
- Overlap findings: WARN only — `services/xstockstrat-indicators/CLAUDE.md` also edited by in-progress 243 (disjoint sections; 243 Step 4's `:12` target has drifted and its wording already appears at `:14` on trunk); no migration, proto or config collision; no merge-order entry needed. 284 must not add a `docs/runbooks/CLAUDE.md` index row (281 edits that table).

## Session 2026-11-02 — sdd-review impl-spec (advisory), pass 2

- Result: 0 failures, 0 warnings, 6 nits (advisory). Both pass-1 warnings and all seven pass-1 nits confirmed fixed against the code. No Floor risk.
- All 6 pass-2 nits fixed in spec revision 2 (wording only): Step 1 constants-vs-functions placement; Step 2 formula-id constant renamed `SAM` -> `SAM_FID` so the case-folding parity string `"SAM"` cannot be confused with it, and the four user ids spelled out in full; Step 3 evidence names `_load_plan`; Step 4 gained the pass/fail C-13 check; Step 6 Files marks the two doc files conditional and lists this `context.md` as append-only. - [x] addressed
- Overlap findings: WARN only — `services/xstockstrat-indicators/CLAUDE.md` vs `243-fix-sandbox-seed-keys` (disjoint hunks; Step 6 must re-read the file before editing). No new collision on the two files added to Step 6 Files. No merge-order entry needed.
- Review loop ended: pass 2 had no FAIL or WARN. Spec is clear for `/sdd-execute`.

## Session 2026-11-03 — sdd-execute (sequential)

- Mode-entry and per-feature confirmations given by the operator. Branch `feature/legacy-authors-confirm-resolve` created from `main-dev` (`eeb98ebf`) and pushed; ledger-guard clean. Re-spec gate: every cited path, symbol and line matched the live code, no re-spec.
- Tooling setup (Steps 1-6): python 3.13 ✓ · uv 0.11.32 ✓ · ruff 0.16.9 ✓ · pytest ⬇ via `uv sync --extra dev`. Baseline before changes: 6 tests pass, ruff clean.
- TDD (Steps 1+2 cycle): RED — 30 new tests failed with `AttributeError: module 'app.maintenance.legacy_authors_ops' has no attribute '_candidates' / '_parse_maps' / '_pick'` (5/13/12). GREEN — all 36 pass; full indicators suite 423 passed, coverage 81.5% (gate 50%); `ruff check` + `ruff format --check` clean; `git diff -- app/maintenance/legacy_authors.py` empty (FR-7).

### Step 1 — `--map` validation and picker helpers [done]
- Added `_UNRESOLVED`, `_PICK_ATTEMPTS`, `_candidates`, `_parse_maps`, `_pick` to `legacy_authors_ops.py`; `confirm` and `main` untouched. Reason and notice strings match the spec exactly.
- Files modified: `services/xstockstrat-indicators/app/maintenance/legacy_authors_ops.py`
- Deviations: none

### Step 2 — helper and picker unit tests [done]
- Added constants, helpers (`_users_dict`, `_entry`, `_Ask`, `_listing`, `_unresolved`) and 30 test cases covering AC-2, 3, 4, 5, 6, 7, 13, 14, 15, 19, 22 (reason-text and picker legs) plus the `_candidates`/`classify` parity drift guard. TDD: RED `AttributeError` on `_candidates`/`_parse_maps`/`_pick` (30 failed) -> GREEN 36 passed (see session header above).
- Files modified: `services/xstockstrat-indicators/tests/test_legacy_authors_ops.py`
- Deviations: D-1 — `io`/`sys` imports moved to Step 4 to satisfy ruff F401 (full detail in Deviation Log).

### Step 3 — `confirm` resolves unmappable/ambiguous rows; `--map` flag; docstring [done]
- Rewrote `confirm(work, *, yes, maps=(), ask=input)` (return shape unchanged): validate all `--map` first, lazy strict `users.json` (refusal with `--map`, warning + picker skipped without), per-author picker, in-memory overrides, one combined prompt, a single write site; `main()` gains `confirm --map` (repeatable) and prints `refused:` lines / exits 2 on `la.ApplyRefused`; module docstring updated. `apply`, `report` and `legacy_authors.py` untouched.
- Files modified: `services/xstockstrat-indicators/app/maintenance/legacy_authors_ops.py`
- Deviations: none

### Step 4 — `confirm` flow and `main()` exit codes [done]
- Added 22 flow/`main()` tests covering AC-1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 20, 21 (the `main()` refusal test is parametrized over AC-2/3/4/13/14/15, each asserting exit 2, the `refused:` line, and a byte-identical plan); `io`/`sys` imports added here (see D-1). AC-11 drives `report` -> `confirm --map` -> `apply` and asserts `rewritten == 3`, `skipped_concurrent == 0`, no `refused:`.
- TDD: RED (against the pre-Step-3 `confirm`) — 21 failed: 10x `TypeError: confirm() got an unexpected keyword argument 'maps'`, 7x argparse `SystemExit: 2` (unrecognized `--map`), and failed prompt-count / listing / warning assertions (`assert 0 == 1`, missing `1) davcs86 (...)`, missing `users.json could not be read`). Green-on-arrival by design: `test_yes_without_map_never_resolves_a_row` (AC-9, preserved behavior; the red gate is carried by its siblings). GREEN — 58 passed in `tests/test_legacy_authors_ops.py`; full suite 445 passed, coverage 85.4% (gate 50%).
- Verification: ruff check/format clean; exactly one `_write_private(plan_path` in `confirm`; `git diff -- app/maintenance/legacy_authors.py` empty (FR-7); `confirm --help` shows `--map`; C-13 check passes (no new inline users literal).
- Files modified: `services/xstockstrat-indicators/tests/test_legacy_authors_ops.py`
- Deviations: none beyond D-1.

### Step 5 — runbook intro and §5 describe `confirm --map` and the picker [done]
- Rewrote the wrapper paragraph (`confirm` now resolves unmappable/ambiguous rows), added a `confirm --map … --yes` line to the command block, retitled §5 "report, then confirm (or edit) the plan", added the "With the wrapper" flow (exact-match `--map`, exit 2 + `refused:` line shape, per-author picker, one prompt, `--yes --map` as the only scripted path, PII note, 276 scoping, candidate rule not enforced by APPLY) and demoted the hand edit to a fallback. TDD: N/A (docs).
- Verification: `--map`/`picker` hit in the intro and §5; the only remaining "hand-edit" is the sentence that a hand-edited plan can bypass the candidate rule; the apply+candidate grep shows APPLY does NOT enforce it; `./scripts/check-context-map.sh` OK. Nothing else links to the retitled §5 heading.
- Files modified: `docs/runbooks/legacy-formula-authors.md`
- Deviations: none

### Step 6 — indicators `CLAUDE.md` § Maintenance and teardown audit [done]
- Extended the `## Maintenance` paragraph in place: `confirm` also resolves `unmappable`/`ambiguous` rows via repeatable `--map LEGACY=USER_ID` or a numbered picker (active users only, ambiguous accepts only its candidates, an invalid `--map` exits 2 with `plan.json` untouched) and the candidate rule is enforced at `confirm` only. The code block is unchanged. TDD: N/A (docs).
- **Teardown audit (root CLAUDE.md § Teardown) — for the PR body.** The `context-forge:context-constitution refresh` command was **unavailable** in this session (only the `context-forge:context-scrubber` skill is installed), so the equivalent was done **by hand**: re-read `docs/runbooks/legacy-formula-authors.md`, `services/xstockstrat-indicators/CLAUDE.md` § Maintenance and `services/xstockstrat-indicators/docs/context-constitution.md` (INDICATORS-12) against the final `legacy_authors_ops.py` and the frozen `legacy_authors.py`. Findings: (1) no stale claim anywhere in the repo — a repo-wide grep for "only marks suggested" / "still a hand edit" finds nothing outside this feature's and 276's own dirs; (2) the runbook's quoted behavior matches the code — flag `--map`, exit 2 on refusal, the `[run_id=…] refused:` line shape (same `la.log` as APPLY), `Not confirmed; plan.json unchanged.`, the picker warning, 3 invalid attempts, first-EOF-stops-picker, `--yes` semantics; (3) INDICATORS-12 needs **no edit** — the sole repair entry point and the system/UUID guard in `REWRITE_SQL` (`legacy_authors.py:32-36`, verified) are unchanged and `confirm` only writes `plan.json`; (4) the runbook was edited in Step 5 and needed no further drift fix; (5) `./scripts/check-context-map.sh` OK. `markdownlint-cli2` is not installed locally (npx would need a download), so the lint of the edited `CLAUDE.md` paragraph is left to the CI `markdownlint` job.
- Files modified: `services/xstockstrat-indicators/CLAUDE.md`
- Deviations: none (the two conditional Files, the runbook and `context-constitution.md`, needed no edit in this step).

### Feature end — integration gates (sequential mode §5.6)
- Config-key wiring gate `node scripts/check-config-wiring.mjs --final`: exit 0. Its single `REPORTED:` line concerns `xstockstrat-trading` (`trading.fill_poller.interval_ms`, read-unseeded) — pre-existing baseline, unrelated; this feature declares no config key.
- Merge-order gate: no `merge-order.md` entry for this feature.
- C-16 promotion (operator-approved via AskUserQuestion, 2026-11-03): created `services/xstockstrat-indicators/acceptance/legacy-authors-confirm-resolve.feature` with 21 scenarios (`@AC-1`..`@AC-11`, `@AC-13`..`@AC-22`), each tagged `@feature-284`; `@AC-12` skipped as doc-only (it asserts runbook text). Planned by the `scenario-promoter` subagent: 0 duplicates / overlaps / conflicts against the 276 suite or `platform.feature`.
- Final state: 6/6 steps done; indicators suite 445 passed, coverage 85.4% (gate 50%); status `code-completed`.
- Accountability: out-of-scope changes — none; open items — none unresolved (design risks tracked above); unaddressed review warnings — none; deviations — D-1 only.

## Session 2026-11-03 — sdd-execute
**Steps this session**: 1, 2, 3, 4, 5, 6
**Progress**: 6 done / 6 total
**Stopped at**: all complete (integration PR opened next)
**Next**: merge the integration PR into main-dev

## Session 2026-11-04 (CI: feature status automation)

- Promotion PR #1406 merged to main
- Feature promoted and committed: 86132e77a5e1a8da3e2b24f2fc58809cfc008d9a
- Status updated: `code-completed` → `launched`
- Launched date: 2026-11-04
