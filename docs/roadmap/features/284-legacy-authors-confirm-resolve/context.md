# Context: legacy-authors-confirm-resolve  (archived 2026-11-04)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-04 — /sdd-archiver

**What**: Follow-up to `276-fix-legacy-formula-authors`. `python -m app.maintenance.legacy_authors_ops confirm` (all code in `services/xstockstrat-indicators/app/maintenance/legacy_authors_ops.py`; frozen `legacy_authors.py` untouched, FR-7) now resolves `unmappable` and `ambiguous` plan rows through a repeatable `--map LEGACY=USER_ID` flag and a per-author numbered picker, so the repair no longer needs a hand edit of `plan.json` in an ephemeral DO console. Shipped in 6 steps (2 code+test pairs, 2 docs), no proto/migration/config/env change; indicators suite 445 passed, coverage 85.4% (gate 50%) (old context.md@1ed63958:136). No data repair ran as part of this feature; real runs stay behind the 276 DBA change record.

**Why (irrecoverable rationale)**:
- Process: the operator chose full SDD (story + `/sdd-design quick`) over amending 276, scoped to unmappable + ambiguous rows, active users in `users.json` only, mechanism = both `--map` and picker (AskUserQuestion 2026-11-02, old context.md@1ed63958:13).
- Ambiguous rows accept only their matched candidates for BOTH `--map` and the picker (one rule for both paths); an unmappable row accepts any active user. `--map` matches `old_author` exactly (case-sensitive) while classification stays case-insensitive; `--map --yes` is the non-interactive path and skips the confirmation (OQ-1..OQ-3, old context.md@1ed63958:19).
- Picker unit = once per legacy author covering all its rows incl. soft-deleted siblings (operator decision, round 1). The rejected per-row picker could leave soft-deleted siblings half-resolved (design.md@1ed63958:35; old context.md@1ed63958:39).
- Unreadable `users.json` with no `--map`: skip the picker with a warning and keep the suggested-only flow; with `--map`: refuse, exit 2 (operator decision, old context.md@1ed63958:40).
- First EOF stops the picker for ALL remaining authors, a deliberate superset of "EOF skips the author": a closed stdin otherwise re-prints the whole user directory once per author (design.md@1ed63958:18; operator-approved in round 2, old context.md@1ed63958:50).
- The picker lists every active user's email local part, which IS new console exposure (this corrected product-spec OQ-4, "no new PII exposure beyond format_plan", old context.md@1ed63958:41). The runbook says so and recommends `--map` for recorded/shared console sessions (design.md@1ed63958:26).
- A single write site in `confirm`, reached only after every prompt, keeps `plan.json` byte-identical on every abort, decline, EOF and refusal (design.md@1ed63958:16; old context.md@1ed63958:38). Refusals reuse `la.ApplyRefused` (exit 2) and are printed inline in `main()` through `la.log` as `[run_id=…] refused: <reason>`, the same shape as apply (design.md@1ed63958:20).
- 276's `@AC-3`/`@AC-7` say "left unchanged"; design scopes that as "the automatic fix never guesses", so an explicit operator override is EXTEND, not CHANGE, and needed no extra sign-off (recon.md@1ed63958:47; design.md@1ed63958:69-70).

**Rejected alternatives**:
- Reach candidates through `la.classify` — lost: it discards candidates for ambiguous rows and exposing them means editing `legacy_authors.py` (FR-7) (design.md@1ed63958:30).
- Store candidates on plan entries at `report` time — lost: changes the plan and its digest; `report` is out of scope (design.md@1ed63958:31).
- `SystemExit(2)` inside `confirm` — lost to a structured `la.ApplyRefused` (assertable reasons, one exit-2 convention); the naming misfit is accepted (design.md@1ed63958:32).
- Shared `_refused` helper that also touches the apply branch — lost: apply is out of scope, three inline lines are cheaper than an apply diff (design.md@1ed63958:33).
- TTY-gated picker — lost: blocks legitimate scripted answers, adds a second interactive switch next to `--yes`, over-built (C-18) (design.md@1ed63958:34).
- Eager `users.json` load — lost: breaks the two existing confirm tests that run without it (design.md@1ed63958:36).
- Refusals to stderr — lost: breaks the `refused:` stdout contract in runbook §6 (design.md@1ed63958:37).
- Uncapped re-ask loop — lost: never terminates under piped stdin; an immediate skip on the first invalid answer was also rejected because one typo would lose the author. Shipped `_PICK_ATTEMPTS = 3` (design.md@1ed63958:38).
- Lenient `_users_by_id` for validation — lost: swallows errors and has no `is_active` (recon.md@1ed63958:30). Used only for the display map when `users.json` was not strictly loaded.
- `--mapping <file>` input — out of scope: the console filesystem is ephemeral (product-spec.md@1ed63958:30).

**Scars & gotchas**:
- Existing tests `tests/test_legacy_authors_ops.py:72` (`test_confirm_marks_only_suggested…`) and `:103` (`test_confirm_declined_leaves_plan_untouched`) — `:62`/`:93` on the pre-284 tree — call `confirm()` with NO `users.json` and assert the `(int, str|None)` return, so `users.json` is loaded lazily and the return shape cannot change (recon.md@1ed63958:61).
- `confirm`'s default `ask=input` is bound at definition, so `main()`-level tests must patch `sys.stdin`, not `builtins.input` (old context.md@1ed63958:66).
- A scripted `printf 'y\n' | confirm` against a plan with unresolved rows lands its `y` on the picker and writes nothing, with exit 0. Mitigated only by the `Not confirmed; plan.json unchanged.` line and the runbook wording "`--yes --map` is the only scripted path" (design.md@1ed63958:42).
- The candidate rule is enforced at `confirm` ONLY. `validate_for_apply` does not re-check it, so a hand-edited `plan.json` can still bypass it; docs must not claim apply-time enforcement (recon.md@1ed63958:49; design.md@1ed63958:22).
- The copied candidate predicate (twin of `classify`, `legacy_authors.py:99-104`) cannot be imported without editing the frozen file; drift is pinned by `test_candidates_match_classify_rule`, which samples only 5 authors (`sam`, `SAM`, `davcs86`, `olduser`, `ghost`) (design.md@1ed63958:22, :43).
- `load_users`'s malformed-entry message echoes one user's `email_local` into the refusal/warning line; unavoidable under FR-7 and documented in the runbook PII note (design.md@1ed63958:44).
- Plan entries do not store matched candidates, so the ambiguous check is recomputed from `users.json`; `_users_by_id` returns `{}` on any read error, so validation must use strict `la.load_users` (old context.md@1ed63958:30-32).
- Acceptance examples (`alice` x2, inactive `bob`, unmapped `carol`) differ from `conftest.USERS` (`sam` x2, inactive `olduser`, and `carol` is active). Tests map roles instead: F1=`ghost`, F2=`ghost` soft-deleted, F3=`sam`, F4=`davcs86`, F5=`zed`; formula-id constant is `SAM_FID` so the case-folding parity string `"SAM"` cannot be confused with it (old context.md@1ed63958:67, :88).
- Round-1 adversary found `@AC-8`/`@AC-17` answer sequences mismatched the real prompt count (picker prompts plus one combined confirmation); the sequences were reworded to "skip F3 at the picker, then answer the confirmation" (old context.md@1ed63958:39).
- Weak-RED fixes: invalid picker answers `"0"`, `"-1"`, `"abc"` (catch an unbounded `options[int(a)-1]`), a two-bad-maps case asserting both reasons collected in order, and the capped-attempts test uses a single-author plan (design.md@1ed63958:24).
- `@AC-9` (`--yes` without `--map` never resolves a row) and the `main()` EOF exit code pass on the old tree (preserved behavior); the red gate is carried by sibling assertions (old context.md@1ed63958:69, :115). Observed RED: 30 new helper tests failed with `AttributeError` on `_candidates`/`_parse_maps`/`_pick` (5/13/12), then 21 flow tests failed (10x `TypeError … 'maps'`, 7x argparse `SystemExit: 2`, plus prompt-count/listing/warning assertions) (old context.md@1ed63958:96, :115).
- `./scripts/check-context-map.sh` OK; `markdownlint-cli2` was not installed locally, so the lint of the edited indicators `CLAUDE.md` paragraph was left to the CI `markdownlint` job (old context.md@1ed63958:128).
- `/context-forge:context-constitution refresh` was unavailable in the execute session (only `context-scrubber` installed); the teardown was done by hand: runbook, indicators `CLAUDE.md` § Maintenance and `INDICATORS-12` re-read against the final code, no stale claim found, `INDICATORS-12` needed no edit. It was recorded in `old context.md@1ed63958:128` for the integration PR body; whether it landed in the PR body is not recorded.
- Next feature number was computed locally as `max(283)+1 = 284` (old context.md@1ed63958:14), contrary to the root CLAUDE.md rule that `scripts/sdd-allocate-feature-number.sh` reserves it on `origin`; same practice as the 081 local `max(NNN)+1` entry. `[DUP:fails.md:212]` No ledger entry.

**Permanent deviations** (design/spec said X → shipped Y → because Z):
- Spec Step 2 added `io`, `re`, `sys` imports to the test module → shipped `re` only; `io`/`sys` arrive in Step 4 → because nothing in Step 2 uses them and ruff F401 fails the step's own lint gate (D-1, implementation-spec.md@1ed63958:366-372). This is the only deviation recorded during execution (old context.md@1ed63958:137).

Spec-review / design-phase corrections (NOT shipped-vs-design deviations; the approved design never differed from the code):
- Product-spec review (2026-11-02) fixed FR-4/5/6 prompt interplay (one confirmation covers suggested and resolved rows), exit codes (invalid `--map` exits 2; decline, EOF and nothing-to-confirm stay 0), `--map` parsing (split on the last `=`, duplicate author with different targets invalid), made `@AC-5` concrete and `@AC-11` observable (old context.md@1ed63958:25-29).
- Design round 1 (operator): FR-3 picker unit changed from per-row to per-author; FR-3 amended to skip the picker on an unreadable `users.json` without `--map`; `@AC-18`, `@AC-19` added (old context.md@1ed63958:39-41). Round 2: first-EOF-stops-picker, `Not confirmed` line, `--yes --map` prints override targets (a second `format_plan`, because in a DO console stdout is the only change record, design.md@1ed63958:20), picker cap; `@AC-20`..`@AC-22` added (old context.md@1ed63958:50-51).
- Design said one test per AC plus two `main()`-argv tests (design.md@1ed63958:24) → spec revision 1 made the `main()` refusal test parametrized over AC-2/3/4/13/14/15 (exit 2, `refused:` line, byte-identical plan) because impl-review pass 1 found only AC-2/AC-4 reached `main()` (C-15/C-08) (old context.md@1ed63958:77, :114). Shipped 30 helper + 22 flow tests (:104, :114).
- Impl-spec review pass 1 (2 warnings, 7 nits) and pass 2 (0 warnings, 6 nits) were wording/coverage fixes applied in spec revisions 1-2, e.g. the Step 6 Files list gained the two conditional doc files and a pass/fail C-13 check replaced a `grep -c` count (old context.md@1ed63958:76-89).

**Cross-feature signal**:
- Direct follow-up to `276-fix-legacy-formula-authors`: 276's design rejected the DO console as an execution environment ("no file upload and stdout is lost, so plan/result artifacts are not durable", 276 design.md@1ed63958:39) and left hand-editing `plan.json` as the only disposition for unmappable authors (276 product-spec OQ-3, "Design decides", 276 product-spec.md@1ed63958:58). PR #1386 (`bead11de`, 2026-10-31, "console-runnable formula-author repair workflow") then made the repair console-runnable, which made the hand edit unworkable and created this feature. See `fails.md` 2026-11-04 entry.
- `243-fix-sandbox-seed-keys` also edits `services/xstockstrat-indicators/CLAUDE.md` in disjoint sections (rebase-level, no merge-order entry); `281-signal-watchlist-expiry-pruning` only cites the runbook as a shape reference; 284 must not (and did not) add a `docs/runbooks/CLAUDE.md` index row because 281 edits that table (old context.md@1ed63958:83). Resolution of the 243 rebase is not recorded.
- Business rules: PRESERVE 276 `@AC-1/4/5/8/9`, EXTEND `@AC-2/3/7`, no CHANGE (design.md@1ed63958:62-72).

**Deferred follow-ons**:
- Parity test samples 5 authors only: revisit if `classify`'s candidate rule (`casefold`/`strip`) changes (design.md@1ed63958:43; old context.md@1ed63958:57).
- Apply-time enforcement of the candidate rule was out of scope (FR-7); a hand-edited plan can bypass it. Reason for not adding it: FR-7 freezes `legacy_authors.py` and changing apply semantics is out of scope (product-spec.md@1ed63958:23, :28; recon.md@1ed63958:49). No follow-up filed.
- Real staging/prod runs of the new flow stay out of scope (product-spec.md@1ed63958:32); 276's DBA change record (runbook §2) still governs.

**Ledger entries written**: insights.md (0 new; candidate is `[DUP:insights.md:3774]`, the `2026-11-02 — legacy-authors-confirm-resolve — design` entry), fails.md (1) — see the 2026-11-04 entries.

**Runtime-invariant recommendations (→ /context-constitution)**: none new. `INDICATORS-12` (sole repair entry point plus the system/UUID guard in `REWRITE_SQL`) was re-read and is unchanged. Candidate note, not verified against the current constitution: the candidate rule is enforced at `confirm` only, not by `validate_for_apply`.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 1ed63958.

**Promotion (C-16)**: already done at feature end. 21 scenarios (`@AC-1`..`@AC-11`, `@AC-13`..`@AC-22`, each `@feature-284`) live in `services/xstockstrat-indicators/acceptance/legacy-authors-confirm-resolve.feature` (commit `0269a13f`); `@AC-12` omitted as doc-only (checked by grep at Step 5 rather than at impl-review as design said, old context.md@1ed63958:122); 0 duplicates/overlaps/conflicts against the 276 suite or `platform.feature` (old context.md@1ed63958:135). Scenario text re-checked verbatim against the deleted `acceptance.feature@1ed63958`; only the header comment and the `@feature-284` tags differ.
