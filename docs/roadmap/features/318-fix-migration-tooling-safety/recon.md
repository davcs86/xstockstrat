# Recon: fix-migration-tooling-safety

**Created**: 2026-11-11
**From**: product-spec.md
**Tree**: detached origin/main-dev@c4fd48b0a (`origin/feature/fix-migration-tooling-safety` did not exist at recon time; the subagent digests were UNSTAMPED, and every citation below was re-grepped on this tree)
**Affected services**: platform tooling (`scripts/db-migrate.sh`, `scripts/migration-dirty-guard.sh`, `.github/workflows/ci.yml`, `docs/patterns/database.md`); migration dirs of xstockstrat-indicators, -ingest, -identity, -config, -portfolio, -analysis (dirty-replay exposure) and every `services/*/migrations` (ordering gate)

---

## Objective

Close two golang-migrate version-tracking hazards in the shared migrator.

1. **Dirty recovery (SEV-2).** On a dirty service, `db-migrate.sh up` runs `force 0` and replays every up-file from `001`. Many applied up-files are bare DDL and are immutable (F-01), so a dirty service with no contract floor, or one dirty below its floor, wedges the PRE_DEPLOY migrator.
2. **Ordering.** A migration numbered at or below the target branch's current maximum is silently skipped on persistent DBs. Nothing in CI or `docs/patterns/database.md` stops one from merging.

The fix touches tooling, CI and docs only. It adds no proto, config key or migration.

## Codebase Map

- **Migrator: `scripts/db-migrate.sh`** (bash; also the `scripts/Dockerfile.migrate` entrypoint)
  - Per-service function: `migrate_service`. Fixed call order at `scripts/db-migrate.sh:152-177`: config, ledger, identity, marketdata, trading, portfolio, notify, ingest, indicators, analysis.
  - `up` branch: `scripts/db-migrate.sh:65-105`. Steps in order:
    - `:68` probes the version with `ver="$(migrate ... version 2>&1 || true)"`.
    - `:71-76` runs the ahead-check (`0` proceed, `10` skip the service, anything else `exit 1`).
    - `:77-82` handles `case "$ver" in *dirty*)`: guard call `:78`, `echo "  [dirty] force-resetting $svc to version 0"` `:79`, **`migrate ... force 0` `:80`** (the AC-1 site).
    - `:88-99` is the analysis-only `SEED_USER_ID` envsubst scratch copy. It rewrites `dir`.
    - `:101-103` runs `render-migrations.sh`, then `:104` runs `migrate ... up`.
  - `force` subcommand `:111-121` forces every service to its highest up-file. The guard text warns against it.
- **Dirty guard: `scripts/migration-dirty-guard.sh`** `<migrations_dir> <schema> <version_output>`
  - Exit contract `:3`: 0 allows `force 0`; 3 refuses at or above the contract floor; 2 fails closed; 1 is a usage error (`:6-9`).
  - `:13` parses the dirty version with `sed -n 's/^\([0-9][0-9]*\) (dirty).*/\1/p'`. Unparsable input exits 2 (`:14-17`).
  - `:22-40` computes the floor: the lowest `-- contract-of:` target version in the first 5 lines of each up-file. A target outside the service's own dir exits 2.
  - **`:42` `[ -n "$floor" ] || exit 0`** lets a service with no contract file through to `force 0`. This is the AC-1 hole.
  - **`:43` `[ "$n" -lt "$floor" ] && exit 0`** lets a dirty state below the floor through to `force 0`. This is the second hole.
  - `:45-53` builds the refusal text: `prev=$((n - 1))`, the command `migrate -path services/xstockstrat-$schema/migrations -database "$DATABASE_URL&x-migrations-table=${schema}_schema_migrations" force $prev`, the `?` variant note and the `db-migrate.sh force` warning, then exits 3.
- **Ahead-check: `scripts/migration-ahead-check.sh`** (feature 279)
  - Exit codes: 0 proceed, 10 clean-ahead skip, 4 dirty-ahead refuse, 2 fail closed (`:3`).
  - Highest-up-file loop: `:31-44`.
  - Dirty-ahead refusal text with `force $prev`: `:55-62`.
- **Contract gate (the template for AC-2): `scripts/check-migration-contract.sh`** `<base_ref>`
  - Usage error exits 2 (`:7-10`).
  - `:13` lists the added up-files: `added="$(git diff --name-only --diff-filter=A "${base}...HEAD" -- 'services/*/migrations/*.up.sql')"`.
  - `:14-27` reports `contract-gate:` errors on stderr with `status=1`.
- **CI: `.github/workflows/ci.yml`**
  - `changes` → `migrations:` path filter `:71-78`. It lists `scripts/render-migrations.sh`, `migration-dirty-guard.sh`, `migration-ahead-check.sh`, `migration-rerun.sh` and `migration-assertions/**`. `check-migration-contract.sh` is not listed.
  - Lint: `shellcheck scripts/*.sh .claude/hooks/*.sh` `:699`; `shfmt -d -i 2 ...` `:702`.
  - Structural tests, one chained line at `:705`: `render-migrations.test.sh && check-migration-contract.test.sh && migration-dirty-guard.test.sh && migration-ahead-check.test.sh && sdd-allocate-feature-number.test.sh`.
  - Job `migration-rerun` `:709-745`:
    - It builds `scripts/Dockerfile.migrate`.
    - Image-contents assertion `:737`: `test -x /repo/scripts/migration-dirty-guard.sh && test -f /repo/scripts/migration-ahead-check.sh`.
    - The `:707-708` comment says "every up-file must be idempotent". That overstates what the script does (see Risks).
  - Job `migration-contract-gate` `:749-765`:
    - PR-only: `github.event_name == 'pull_request'` plus the `migrations`/`ci` filter.
    - `fetch-depth: 0`.
    - It runs `git fetch --no-tags origin main "${{ github.base_ref }}"`, then `scripts/check-migration-contract.sh "origin/${{ github.base_ref }}"`.
  - Aggregate gate: `needs:` `:1128-1129` and result echo `:1155-1156`. A new job must be added to both.
- **Migrator image: `scripts/Dockerfile.migrate`**
  - golang-migrate pinned at `ARG MIGRATE_VERSION=4.17.1` `:6`.
  - Scripts are COPY'd **by name** at `:12-15`: `db-migrate.sh`, `render-migrations.sh`, `migration-dirty-guard.sh`, `migration-ahead-check.sh`. Then `COPY services` `:16` and `ENTRYPOINT` `:19`.
- **DB-backed harness: `scripts/migration-rerun.sh`** (CI-only; this feature leaves it out of scope but couples to it)
  - Pass 2 replays only the 224 expand and 225 contract files. Comment at `:464-465`, list at `:466-478`: indicators `007`, ingest `013`/`014`, analysis `026`/`027`, config `R`/`R+1`.
  - Config dirty-at-41 leg `:270-291`: a direct guard call that expects rc 3 plus "config is dirty at version 41" and "force 40".
  - `guard_blocks <schema> <dirty> <recover>` `:683-693`. It expects `db-migrate.sh up` to fail, then checks the "<svc> is dirty at version N" and "force M" text. Called for config `:725`, ingest `:748` and analysis `:756`.
  - Pass 4 (feature 279) at `:790-847` copies the scripts it needs by name at `:793`: `db-migrate.sh render-migrations.sh migration-dirty-guard.sh migration-ahead-check.sh`.
  - It finds config migrations by slug or contract header, never by number (`:79`, `:104`).
- **Structural test harness: `scripts/migration-dirty-guard.test.sh`** (pure bash, no DB)
  - Helpers: `fail`, `new_dir <case>`, `expect <exit> <dir> <version_output> <label>`, `contract_line`.
  - **Case (a) `:38-41`** asserts `expect 0 "$da" "27 (dirty)"`: no contract file allows `force 0`.
  - **Case (d) `:57-60`** asserts `expect 0` for `25 (dirty)` and `20 (dirty)` below the floor.
  - Both encode the buggy behaviour and both must flip.
  - Siblings: `scripts/migration-ahead-check.test.sh`, `scripts/check-migration-contract.test.sh`, `scripts/render-migrations.test.sh`.
- **Docs: `docs/patterns/database.md`**
  - `:32` states the run order without indicators or analysis. This is pre-existing drift against `db-migrate.sh:152-177`.
  - `:38` says "NNN is the next integer after `ls ... | sort | tail -1`". There is no forward-only rule and no rule against pre-reserving. A grep for `forward-only|next free|pre-reserv` finds nothing.
  - `:57-60`: the idempotency rule, and "`force 0` … is refused at or above a contract floor".
  - `:62-76`: the CI job list. `:73-74` says "Older up-files are not replayed".
  - `:78-104`: "Contract migration recovery", with Guard `:80-81`, Floor rule `:82-85`, Recovery `:86-92`, Ahead rule `:93-101` and Adjacency `:102-104`. The Floor rule at `:83` says "The guard allows `force 0` below the floor or when the service has no contract file". This sentence goes stale under any AC-1 fix.
- **Per-service migration state** (`ls services/*/migrations/*.up.sql` on this tree):

  | service | contract floor | max NNN | gaps |
  |---|---|---|---|
  | config | 40 (`044_config_keys_relative.up.sql:1` → `040`) | `047_config_alias_removal_rows` | 024, 035, 036 |
  | analysis | 26 (`027_contract_owner_dimension.up.sql:1`) | `027` | none (no `000`) |
  | ingest | 13 (`014_contract_signal_ownership.up.sql:1`) | `014` | none |
  | indicators | none | `007_private_formulas_templates` | none (no `000`) |
  | identity | none | `006` | none |
  | portfolio | none | `018` | none |
  | marketdata | none | `009` | **007** |
  | trading | none | `011` | none |
  | notify | none | `003` | none |
  | ledger | none | `003` | none |

  AC-2's "config maximum 025" is a fixture value. The real config maximum is 047, so the test must build a throwaway git tree, as the guard test builds throwaway dirs.

## Patterns to REUSE

- **AC-1 recovery or refusal** → reuse the guard's own `prev=$((n - 1))` and recovery text (`scripts/migration-dirty-guard.sh:45-52`). It already prints `force 4` for `5 (dirty)` and prints `$DATABASE_URL` as a literal (SC2016 note `:46`). The minimal change deletes or replaces the allow paths at `:42-43`, plus the `echo`/`force 0` lines at `scripts/db-migrate.sh:79-80`. The text must keep the exact strings that `migration-rerun.sh:277-278` and `:689-690` assert ("<svc> is dirty at version N", "force M").
- **Refuse-before-destroy ordering** → mirror the ahead-check call order in `db-migrate.sh:71-76` (insights.md:4166-4168: the new check runs ahead of the destructive branch, and a checker crash fails closed).
- **Ordering gate script** → copy the shape of `scripts/check-migration-contract.sh`:
  - `<base_ref>` argument, usage error exits 2.
  - The `git diff --name-only --diff-filter=A "${base}...HEAD" -- 'services/*/migrations/*.up.sql'` idiom (`:13`).
  - stderr lines with a gate prefix, `status=1`.
  - Base maximum: list `git ls-tree --name-only "$base" services/<svc>/migrations/` and take the max. This command is new; no existing script uses it.
- **NNN parsing** → `basename "$f" | sed 's/^\([0-9]*\)_.*/\1/; s/^0*//'` (`scripts/migration-ahead-check.sh:36`, `scripts/migration-dirty-guard.sh:31`). Compare as decimals (`10#`, `scripts/migration-rerun.sh:63`), per @AC-27.
- **CI job** → clone `migration-contract-gate` (`ci.yml:749-765`): PR-only, `fetch-depth: 0`, explicit `git fetch` of the base. Register it in the `needs`/echo lists at `:1128-1129` and `:1155-1156`. Add the script and its test to the path filter `:71-78` and the test chain `:705`.
- **Structural tests** → `scripts/migration-dirty-guard.test.sh` (`new_dir`/`expect` throwaway trees) for AC-1. `scripts/check-migration-contract.test.sh` (throwaway git repo against a base ref) for AC-2.
- **Image shipping** → any new script that `db-migrate.sh` calls needs a `COPY` in `scripts/Dockerfile.migrate:12-15`, a `test -x/-f` in `ci.yml:737`, and an entry in the pass-4 copy list at `migration-rerun.sh:793` (@AC-30). A CI-only gate script needs none of these.
- **Forward-only doc text** → precedent wording in `docs/patterns/config-governance.md:513` ("restores forward-only ordering; the skipped `024` is a permanent, harmless gap"). The candidate rule is recorded at `docs/roadmap/ledger/fails.md:3770`: "a CI gate that a new migration NNN exceeds the base branch max".

## Existing Business Rules (preserve / extend)

- **CHANGE** `@AC-19 @FR-8 @feature-225` "Dirty recovery below the contract floor is unchanged" (`docs/sdd/business-rules/platform.feature:384-388`).
  - It asserts that the guard allows automatic force-0 recovery for `20 (dirty)` below a floor and for `27 (dirty)` with no contract file. Feature AC-1 directly contradicts it.
  - This change **requires explicit user sign-off recorded in `context.md`** (C-16). None is recorded yet, since OPERATOR DECISIONS is empty.
  - Mirrored by guard test cases (a) and (d).
- **CHANGE (conditional, one clause only)** `@AC-28 @FR-3 @regression @feature-295` "Replaying the heal after a later key was created never deletes that key" (`services/xstockstrat-config/acceptance/fix-config-keys-drift.feature:102-109`).
  - Its last `And` reads "an automatic force 0 from a dirty 041 fails at migration 001 leaving row counts and audit functions unchanged, after which the probe-and-force runbook converges".
  - Config 041 is above floor 40, so today's guard already refuses there (`migration-rerun.sh:270-291`), and the clause's "automatic force 0" wording is already stale against the mechanism.
  - Any AC-1 policy rewords this clause. Its observable outcome must still hold: counts and audit functions unchanged, and `migrate force 40` plus `up` converges. The first two clauses are PRESERVE.
  - Needs sign-off if the wording changes.
- **PRESERVE** `@AC-18 @FR-8 @feature-225` "db-migrate refuses the force-0 replay for a dirty contract service" (`platform.feature:374`). It refuses at or above the floor, naming "analysis" and "force 25", and `force 25` plus `up` ends clean at 27. An automatic `force <n-1>`-then-`up` at or above a floor would break this rule. Any policy must stay refusal-only at or above a contract floor.
- **PRESERVE** `@AC-25 @FR-4 @feature-279` "An older migrator refuses a schema a newer release left dirty" (`platform.feature:1209`). It exits 1 with no `force 0`, names "force 8" and the literal `$DATABASE_URL`, and leaks no `postgres://`. This is the style template for any new recovery text.
- **PRESERVE** `@AC-24 @FR-4 @feature-279` "An older migrator skips a schema a newer release already migrated" (`platform.feature:1203`).
- **PRESERVE** `@AC-26 @FR-4 @feature-279` "The ahead check fails closed on input it cannot read" (`platform.feature:1215`).
- **PRESERVE** `@AC-27 @FR-4 @feature-279` "Zero-padded migration versions compare as decimal numbers" (`platform.feature:1227`). The ordering gate must compare NNN the same way.
- **PRESERVE** `@AC-30 @FR-4 @feature-279` "The migrator image carries every script db-migrate.sh calls" (`platform.feature:1247`).
- **PRESERVE** `@AC-5 @FR-5 @feature-225` "A contract migration whose expand file is not yet on main is rejected" (`platform.feature:353`). The existing `migration-contract-gate` must keep working beside the new gate.
- **PRESERVE** `@AC-6 @FR-5 @feature-225` "A contract migration's down-file refuses to run" (`platform.feature:360`). This is the source of the dirty-at-floor states, and no recovery change may bypass it.
- **PRESERVE** `@AC-12 @FR-5 @feature-225` "Contract up-files are replay-safe" (`platform.feature:368`). It covers `migration-rerun.sh` pass 2, which the spec puts out of scope.
- **PRESERVE** `@AC-13 @FR-5 @feature-225` "The ingest contract down-file refuses to run" (`services/xstockstrat-ingest/acceptance/private-by-default-enforce-contract.feature:25`).
- **EXTEND**: the feature's own AC-1 (no `force 0` without a floor) and AC-2 (CI NNN-ordering gate) are new guarantees. No existing `@AC` is an ordering gate.
- **No migration-tooling rules found** in the indicators, identity or analysis suites (keyword grep `dirty|schema_migrations|db-migrate|contract-of|migration-ahead|forward-only`). The portfolio suite listing was not enumerated (blind spot).

## Dependencies

- Proto/RPC: none
- Migration: none. The spec rules it out, and F-01 forbids editing applied files.
  - For reference only, the next free numbers are config 048, analysis 028, ingest 015, indicators 008, identity 007, portfolio 019, marketdata 010, trading 012, notify 004, ledger 004.
- Config keys: none
- Inter-service edges: none (shell tooling + CI)
- New env vars / ports: none
- New files (proposed names; they do not exist): `scripts/check-migration-order.sh` and `scripts/check-migration-order.test.sh`.
- Touched files:
  - `scripts/db-migrate.sh`
  - `scripts/migration-dirty-guard.sh` and `.test.sh`
  - `.github/workflows/ci.yml`
  - `docs/patterns/database.md`
  - possibly `scripts/migration-rerun.sh` (assertion text only; see Risks)
  - `docs/sdd/business-rules/platform.feature` @AC-19 at promotion (C-16)
- CI overlap: `.github/workflows/ci.yml` is shared with batch peers 298 (`migration-contract-gate` job, the highest-risk pair per the review), 297 and 324 (context.md Session 2026-11-10 review).

## Risks / Not-found

- **OQ1 is unresolved and gates the design (C-11, PLAT-4).** There are two candidate policies.
  - (a) Refuse every dirty state with `force <n-1>` text. This is the minimal change and keeps @AC-18 and @AC-25 intact.
  - (b) Automatic `force <n-1>` then `up` below the floor or with no floor. This replays the failed file N, whose partial application may make even that replay fail.
  - Neither may run `force 0`. Changing @AC-19 needs user sign-off in `context.md`.
- **`force <n-1>` can name a missing version.** marketdata has no `007` and config has no `024`/`035`/`036`.
  - A dirty `8` on marketdata gets `force 7` from both the guard (`:45`) and the ahead-check (`:55`). Dirty `25` and `37` on config get `force 24` and `force 36`.
  - golang-migrate fails when the DB version has no matching source file (the `versionExists` failure in insights.md:4166), so the printed recovery would likely wedge `up`. Not verified against golang-migrate v4.17.1 here.
  - The design should consider "previous existing up-file version" instead of `n-1`, and must keep `force 40`/`force 25`/`force 12` unchanged for the adjacent contract cases.
- **Dirty at the first file.** For `1 (dirty)` (or `0` on services with a `000`), `n-1` is 0 or -1. Decide whether the refusal text then names `force -1` (golang-migrate NilVersion) or something else. Unverified.
- **Rename bypass in the ordering gate.** `--diff-filter=A` with git's default rename detection reports a renumber (e.g. `048_x` → `046_x`) as `R`, not `A`, so the late-lower renumber escapes the gate. Use `--no-renames` or include `R`. `check-migration-contract.sh:13` has the same blind spot, which is out of scope.
- **Stale-base merges.** The gate checks against the base at CI time. Two PRs that each add `048`, or a `048` PR that merges after a `049` PR, both pass unless the branch must be up to date or CI re-runs on base change. Branch-protection settings were not inspected. This is the residual case for a written forward-only rule (OQ2), which insights.md:900 (pre-assign ascending numbers in merge-order.md) partly contradicts.
- **Hotfix and back-merge.** A hotfix to `main` adding `NNN` = main max + 1 can sit at or below main-dev's max. The back-merge PR into `main-dev` then fails the gate, which is correct: the dev DB would skip it. The design must say whether that is the intended block and what the recovery is (renumber on back-merge). The gate must also behave on `main-dev → main` promotion PRs, where `base_ref` is `main`.
- **Gaps and equal NNN.** The gate must tolerate existing gaps (marketdata 007, config 024/035/036) because it compares only to the base maximum. It must fail on NNN equal to the maximum (a duplicate) as well as below it, and ignore `.down.sql`.
- **Coupled assertions.** Changing the guard's exit codes or wording breaks `migration-rerun.sh:276-278` (rc 3, "config is dirty at version 41", "force 40") and `guard_blocks` `:689-690`. The spec puts `migration-rerun.sh` out of scope (feature 224 workaround), so keep the strings stable or carry a scoped exception into design.md.
- **No unit harness runs `db-migrate.sh up` with a stubbed `migrate`.** The only execution is the DB-backed `migration-rerun.sh`. An AC-1 test that observes "force 0 is not executed" needs either a PATH-stubbed `migrate` (new pattern) or a new `migration-rerun.sh` leg, which conflicts with its out-of-scope status. Guard-level tests alone cover only the guard verdict.
- **Doc drift to fix in passing or record:**
  - `database.md:32` run order omits indicators and analysis.
  - The `ci.yml:707-708` comment "every up-file must be idempotent" contradicts `migration-rerun.sh:464-465`.
  - Record these in `docs/context-constitution-findings.md` if not fixed.
- **Ledger traps that apply:**
  - fails.md:3152 (the full-chain replay was never exercised; about 14 applied up-files are not idempotent).
  - fails.md:3171-3173 (a refused down manufactures a dirty state below a naive floor, so the floor is the expand version).
  - fails.md:3687-3689 (a dirty config at 44 stopped every later migrator run, including DO's rollback).
  - fails.md:2909-2911, 3134-3136, 3770, 3815-3817 (late or colliding migration numbers; re-check max at merge).
  - insights.md:4166-4168 (enumerate clean/dirty × ahead/behind; refusal as default; check before the destructive branch).
- **Not found:**
  - Any existing NNN-ordering check in `scripts/` or `ci.yml`.
  - A forward-only rule in `database.md`.
  - A `contract-of` file outside ingest, config and analysis.
  - Portfolio up-file idempotency (not read).
  - The source defect reports' full text (fix candidates were taken from product-spec.md).
  - Branch-protection "require up to date" settings.

## Recommended Scope

Advisory only.

1. **Guard policy (AC-1).** Change `scripts/migration-dirty-guard.sh:42-43` per the OQ1 decision.
   - Remove the `force 0` echo and call at `db-migrate.sh:79-80`. If option (b) is chosen, replace them with the bounded `force <prev>`.
   - Decide `prev` = previous existing up-file version rather than `n-1`.
   - Flip guard test cases (a) and (d) and add a gap case and a first-file case.
2. **Ordering gate (AC-2).** Add a new `scripts/check-migration-order.sh <base_ref>` plus `.test.sh` (throwaway git repo fixture: base max 025, added 024 fails naming 024 and 025; equal fails; renamed-lower fails; gaps tolerated).
   - Wire it as a PR-only job cloned from `migration-contract-gate`, or as a second step in that job. That choice is a design question given the ci.yml overlap with 298.
   - Add it to the path filter, the test chain and the aggregate `needs`/echo.
3. **Docs.** Rewrite the `database.md` Floor rule (`:82-85`), `:57-60` and `:73-74`, and add a forward-only / next-free-at-merge rule at `:36-41` (OQ2, so the written rule ships with the gate). Fix the run-order drift at `:32` if in scope.
4. **C-16 bookkeeping.** Get user sign-off for the @AC-19 change (and the @AC-28 clause wording) in `context.md` before design approval. Update `platform.feature` @AC-19 at promotion.
