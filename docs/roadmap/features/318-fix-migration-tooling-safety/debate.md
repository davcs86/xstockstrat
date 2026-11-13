# Debate Register: fix-migration-tooling-safety

**State**: in-debate
**Mode**: full
**Rounds run**: 3 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 4 | 3 | 0 | 6 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 4 | 3 | 3 | 0 | 0 | yes |
| 3 | 2026-11-13 | /sdd-batch | 6 | 2 | 0 | 1 | 0 | yes |

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
| D-9 | 3 | Port the guard tests to pytest. Add scripts/tests/test_migration_dirty_guard.py, which shells out to the bash guard. In the same PR, delete scripts/migration-dirty-guard.test.sh, its shell-allowlist.txt:18 line and its ci.yml:841 chain entry. Assert the exact 'Recover:' line, not a substring, using the D-5-consistent case table (gap, first-file, no-file-n, above-max, empty-dir, contract-dir 019/020/026/027, and the 000-based dirty 1 → force 0 case). | migration-dirty-guard.test.sh:39-83 fixtures re-derived under D-5; shell-allowlist.txt:18 (legacy); script-tooling.md:10-11; fails.md:139; adversary r3 objections 1 and 5 | settled |
| D-10 | 3 | Recovery text is a ratchet within D-6. The primary line is force <prev> (TRUNCATE for the first file) then up. Escalation to force K (K = n, then next) is allowed only after 'already exists' in file K and after the operator verifies K's effects are fully present. Never force forward on doubt. Contract and prune files are verified by their effect, not by objects existing. | A wrong force <prev> fails loudly and atomically (R-2); a wrong force <n> silently skips a seed file (config 048, indicators 008, ingest 016, analysis 028/029); adversary r3 objection 4 | settled |
| D-11 | 3 | --forbid-new applies to every base=main PR except a same-repo main-dev head: github.head_ref == 'main-dev' && github.event.pull_request.head.repo.full_name == github.repository. | A fork branch named main-dev would otherwise evade the check; promote.yml:233-234 opens the promotion with head main-dev from the same repo | settled |
| D-12 | 3 | The order gate also rejects an M (modify) of a base-tree *.up.sql, alongside D-3's D ban, mechanizing F-01. | F-01; D-3 delete ban; adversary r3 non-blocking objection (one more diff filter in the same script) | settled |
| D-13 | 3 | database.md states that `force 0` printed for a 000-based service dirty at 1 is ordinary prev recovery, and no test asserts that 'force 0' is absent from output. test_db_migrate.py asserts only that the stub's argv log contains no force invocation. | 000-based services: config, ingest, identity, ledger, marketdata, notify, portfolio, trading; adversary r3 objection 6 | settled |
| D-14 | 3 | Fix the stale comments in files this change touches: db-migrate.sh:66-69 and ci.yml:896-897. Record migration-rerun.py:7, :735 and :1067-1068 and the database.md:32 run-order drift in findings. | db-migrate.sh:66-69 and ci.yml:896-897 verified; CLAUDE.md §How to Act 5 | settled |

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
| R-7 | 3 | Judgment-first three-branch recovery text (force prev/n/next presented as equal options keyed to the operator's reading of schema state) | Picking force <n> when n had not applied skips the file silently and forever (the second defect's failure mode), and 'objects exist' is meaningless for contract or prune files. The ratchet removes that judgment. | locked |
| R-8 | 3 | Rewriting the legacy migration-dirty-guard.test.sh in place | Every case changes, which makes it a rewrite of a legacy .sh (script-tooling.md:10-11), and it duplicates the pytest harness already used for db-migrate. | locked |

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
| O-7 | 3 | Confirm that the guard pytest case table matches D-5 and D-10 as the adversary re-derived them. Under D-5, legacy cases (a), (c), (d), (f), (h) and (i) all change outcome. | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
