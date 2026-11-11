# Debate Register: fix-migration-tooling-safety

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 4 | 3 | 0 | 6 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 4 | 3 | 3 | 0 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Remove the `force 0` path from scripts/db-migrate.sh itself (:79-80). The dirty arm calls the guard for its text, then exits 1 whatever the guard returns. | scripts/db-migrate.sh:77-82; both sides agree; adversary raised no objection | settled |
| D-2 | 1 | Recovery text prints the highest existing up-file version below n, not n-1, and keeps the 'X is dirty at version N' / 'force M' wording and exit code 3. | scripts/migration-dirty-guard.sh:45; marketdata has no 007, config has no 024/035/036; scripts/migration-rerun.sh:276-278,689-690 | settled |
| D-3 | 1 | The ordering gate uses `--no-renames --diff-filter=A` against the tip of base with a 10# comparison. It also fails on a D of a base-tree *.up.sql and on a duplicate NNN within a service dir. | scripts/check-migration-contract.sh:13 idiom; adversary objections 6 and 7; F-01 | settled |
| D-4 | 1 | Ship both a CI ordering gate and a written forward-only rule in docs/patterns/database.md:38. | docs/patterns/database.md:38; fails.md:3770 | settled |
| D-5 | 2 | The guard fails closed (exit 2, 'cannot compute recovery') when the dir has no up-files, when no file n exists, or when n is above the local max. The TRUNCATE public.<schema>_schema_migrations first-file form prints only when file n exists and is the lowest up-file. No NilVersion `force -1` form is printed. | migration-dirty-guard.sh:42 (empty dir currently exits 0); migration-dirty-guard.test.sh:41,60 fixtures have no lower file; migration-rerun.sh:825; adversary r2 objection 1 | settled |
| D-6 | 2 | Recovery text is keyed to observed schema state: force <prev> (or TRUNCATE) if neither n's nor next's objects exist, force <n> if n's do, force <next> if next's do. It keeps the 'is dirty at version N' prefix and a literal `force <prev>` token. | R-2 atomic up-files plus separate dirty/clean flag writes; fails.md:3171-3173; migration-rerun.sh:278-279,325,689-690; adversary r2 objection 2 | settled |
| D-7 | 2 | The ordering gate passes --forbid-new when github.base_ref == 'main' && github.head_ref != 'main-dev', so only promotions add migrations to main. | adversary r2 objection 3; ci.yml:749-765 | settled |
| D-8 | 2 | D-2 applies to migration-dirty-guard.sh only. migration-ahead-check.sh:55-62 keeps n-1, reworded to 'previous version present in the newer release', and the gap is recorded in findings. | migration-ahead-check.sh:55-62; @AC-25; migration-rerun.sh:839 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Hotfix migration numbering at max(main, main-dev)+1, with collisions fixed by renumbering on main-dev | Prod applies the hotfix as soon as it merges to main, so the renumber re-applies a non-idempotent file, and the unpromoted lower main-dev migrations get skipped on prod. | locked |
| R-2 | 1 | Rejecting auto-recovery (b) on the grounds that a failed up-file is partially applied | False premise. No up-file contains COMMIT, BEGIN; or CONCURRENTLY (the only grep hit is prose at config/041:55,182), and golang-migrate runs each file as one implicit transaction. | locked |
| R-3 | 1 | Keeping the contract-floor scan in the guard only to vary the reason clause | YAGNI. Its exit-2 header paths suppress actionable recovery text, and CI's check-migration-contract.sh already validates headers. | locked |
| R-4 | 2 | Recovery text keyed to the failed operation (failed up -> force prev; failed down -> force n) | It names the wrong target when a clean-flag write fails (schema already at n) and after a failed down (schema at next(n)), so following it replays bare DDL. | locked |
| R-5 | 2 | --forbid-new triggered by startsWith(github.head_ref, 'hotfix/') | A mis-named branch into main bypasses it and lands a main-only migration at or below main-dev's max. | locked |
| R-6 | 2 | Push-triggered order check against HEAD~1 for the stale-base race | The only repair it could demand is a renumber, which D-3's delete ban forbids. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | OQ1 (refuse-all vs auto force<prev>+up) needs an operator decision recorded in context.md, made on the corrected trade-off (up-files are atomic; the real issue is direction ambiguity). If refuse-all is chosen, the record must say it overrides the spec's 'without manual intervention' outcome. | yes | open |
| O-2 | 1 | Verify the NilVersion recovery form (force -1 vs force -- -1) against golang-migrate 4.17.1 and pin it in the guard test before approval. | yes | closed @ round 2 (No NilVersion CLI form is printed. The first-file case prints TRUNCATE only under the guarded precondition (file n exists and is the lowest; otherwise exit 2). The adversary accepted this with the objection-1 fix.) |
| O-3 | 1 | C-16 sign-off required for the @AC-19 reversal and the @AC-28 last-clause rewording. | yes | open |
| O-4 | 1 | The operator must confirm the 'hotfixes carry no migration' rule (vs renumbering unpromoted main-dev migrations above the hotfix), and database.md must state the gate's verdict on promotion PRs. | yes | open |
| O-5 | 1 | The stale-base duplicate-NNN race is undecided: run the order step on push against HEAD~1, or require branch-protection 'up to date before merge'. | no | closed @ round 2 (Decided as a recommendation for the operator to set branch protection 'up to date before merge' on main-dev and main. The push-leg alternative is rejected. The adversary accepted this as non-blocking, and the residual duplicate-version assumption is tracked as an open risk.) |
| O-6 | 1 | Confirm that dropping the guard's contract-of header exit-2 paths leaves no durable @AC or test leg uncovered. | no | closed @ round 2 (No durable @AC pins the guard's header exit-2 paths (platform.feature grep: only :355 and @AC-19 at :386). Case (i) flips to 3, and the cross-dir header gap goes to findings. The adversary accepted this.) |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
