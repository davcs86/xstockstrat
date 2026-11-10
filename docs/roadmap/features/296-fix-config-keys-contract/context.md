# Context: fix-config-keys-contract  (archived 2026-11-10)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-10 — /sdd-archiver

**What**: This was the contract release of the config-key canonicalisation. It shipped:
- rename migration R (`044`) and CHECK migration R+1 (`045`);
- server rejection of prefixed `SetConfig`/`create_key`/`GetSecret` keys, with one poller exception;
- FQN display in config-ui and the agent;
- gate kind `prefixed-read` (baseline 180 entries, owned by 304);
- contract docs flipped to the new form, with an alias caveat.

It reached staging out of order. PR #1471 merged before the operator's Step 16 sign-off, so R ran with an empty allowlist, refused on the 5 staging twins, and left config dirty at 44. A data-only repair fixed it, with R's file unchanged. The consumer rewrite, dead-row prune and alias removal were split off as 304, 305 and 306.

**Why (irrecoverable rationale)**:
- **Split into 4 features, not one PR.** ~600 literal/test sites in one change would repeat 295's test-blast-radius halt. `/sdd-execute` opens only one integration PR, and C-16 promotion would leave stale guarantees for weeks. The alias keeps consumers safe after R.
- **C-05 wording flipped in the contract PR,** with the caveat "readers may still use the prefixed spelling via the alias until 304's baseline is empty". This was chosen over waiting for the final consumer PR (round-2 decision 2).
- **R takes `SHARE ROW EXCLUSIVE`, not `ACCESS EXCLUSIVE`.** A racing `SetConfig` probe is a SELECT and is unblocked either way, so `ACCESS EXCLUSIVE` would only stall every `GetConfig`/`ListKeys`/`WatchConfig`/NOTIFY reload. R+1 resolves the racing row without data loss.
  - Root cause of the race: the 295 `SetConfig` probe (`configServiceImpl.ts`) and its upsert are separate non-transactional `pool.query` calls.
  - So "a 295 SetConfig cannot create a twin" was false (round-4 MAJOR-1).
- **R+1 gap-twin rule:** newest `updated_at` wins, a tie goes to P, and a P whose author is NULL or `system:%` always loses.
  - NULL counts as migration-seeded because `SetConfig` always writes a non-empty author, while 001/042 seed with no author (round-4 MAJOR-2).
  - The rule works ONLY because R disables the `config_value_audit` trigger, which sets `updated_at = NOW()` unconditionally (017). With the trigger off, Rel keeps its original time, a racing P is newer, and a later write to Rel is newer still.
  - Disabling the trigger also preserves feature 219's "Row last modified" display (round-5 operator decision 1).
- **Per-user rows in an unread spelling are parked:** snapshotted, audited and reported, never deleted or renamed. This preserves 295 `@AC-5`.
  - Selector S1 matches ANY 041 run (no `run_at` filter).
  - Rule (a) parks the row whether or not a global relative twin exists.
  - The "symmetric" round-4 rule missed the real staging row `analysis`/`fundsignal.min_conviction_to_emit` and would have raised `oracle-mismatch` on every staging run (round-5 B-1).
- **The gate hoist is narrow:** it covers `ns.key` only for a RELATIVE seed.
  - Before R the alias is dormant, so a relative read of a prefixed seed returns its code default. It must stay visible as `form-mismatch`.
  - The prefixed-read direction was reclassified 1:1 into `prefixed-read`. Keeping both kinds would double every finding (~2×184).
- **R's dirty-guard floor is 40, not R−1.** R is not adjacent to 040. A recovery that lands below 043 replays 041–043, and their INSERTs recreate prefixed rows next to the renamed ones. R is latched by then, so only R+1 cleans them up. Rerun pass 3 exists to prove this.
- **R+1's only RAISE is a mixed-class gap twin.** A racing SetConfig copies `is_secret` from the pre-R row, so a race twin is both-secret or both-plain; a mixed twin cannot come from SetConfig. Both-secret twins resolve by the rule with NULL audit values, since the cipher has no AAD (design §4.2).
- **Signed tuples name the loser by (stored spelling + value sha256).** Never by hash alone, which breaks on equal-valued twins, and never by spelling alone, which would raise on every fresh DB. The operator may sign either direction per tuple. The machinery is inert in 044, but this is the reusable rationale for any future embedded signed allowlist.
- **One non-transactional order:** snapshot, then delete losers, then a separate rename UPDATE. The rename must be a separate statement because `config_values_scope_uniq` is a non-deferrable per-row index.

**Rejected alternatives**:
- One atomic PR with the contract plus 11 consumers — repeats the 295 blast-radius halt.
- 7 PRs from one `ccr-*` branch as one feature with checkpoints — only one integration PR, and C-16 promotion goes stale.
- Resolving twins from `catalog.tsv` / `read_044` / `--emit-rename-data` — the catalog was already stale (it lacks 042's key). Deleting twins without a signed allowlist contradicts 295's `allow_041` discipline and the decision to keep the 5 staging twins.
- "Re-sign after drift" recovery — edits an applied migration (F-01 Floor breach).
- `ListKeys` returning a server-composed FQN — reintroduces write-side stripping and touches `ConfigKeyMeta`; the relative key round-trips.
- `ACCESS EXCLUSIVE` in R — see Why.
- R+1 rules for gap twins:
  - "relative always wins" — silently discards an operator's newest write;
  - "non-system P always wins" (the round-4 operator choice) — superseded in round 5, because it misses a write landing on Rel after P exists;
  - "any non-system gap twin raises" — an ordinary race would block every main-dev deploy.
- A `prefixed-seed` finding kind — the CHECK plus the real `migrate up` in `config-wiring-stored.sh` already fail it with 23514.
- Dropping the `form-mismatch` special case, or hoisting in both directions — silently covers an unsafe relative read.
- Cut under C-18:
  - a runbook-regex doc check plus its AC-22;
  - the `signed-unused` and `per-user-twin-unsigned` classes;
  - an "allow block verbatim" test (the sha pin already implies it).
- Folding FR-9 into 306 — the operator kept it as its own feature, 305, capped at 5 tuples.
- `-- requires-env` on the happy-path R copy — every production PRE_DEPLOY would then need a variable.

**Scars & gotchas**:
- **PR #1471 carried recon and design from 2026-11-07, then all the code.** Per D1, the code went on the harness `ccr-*` branch, not `feature/fix-config-keys-contract`. It was the one PR merged before Step 16.
- **Merging before the Step 16 sign-off shipped R with a permanently empty `allow_296` block.**
  - R refused on staging and left config dirty at 44.
  - DO's automated rollback to the pre-merge image ALSO stopped at the dirty guard ("dirty at version 44, newer than this image's highest migration 43"). Services stayed healthy on the previous release.
  - A local edit pasting the block into R was prepared and discarded before any commit (F-01).
  - `044`'s header comment ("Never apply to a shared database until allow_296 holds the operator-signed tuples") is stale by design and can never be corrected (F-01). Do not read every applied DB as non-compliant.
  - Fix: a rolled-back rehearsal of repair + R + R+1, then one guarded transaction that deleted the 5 prefixed members, with audit rows, and set the version to 43, not dirty (`scripts/config-heal/signoff.md`).
- **The migration-rerun harness was written without starting a database, and CI found its bugs one per run:**
  - `shasum` is absent in the CI container; use `sha256sum` via the `sha256_of` helper.
  - `shfmt` rejected a command substitution inside a heredoc.
  - `grep | head | cut` died with SIGPIPE (exit 141) under `pipefail`; replaced by one `awk`.
  - psql `\quit 1` exits 0, because the argument is ignored; the failure branch must RAISE.
  - `by` is reserved in a PL/pgSQL record reference ("record w has no field by"); the column became `author`.
  - golang-migrate echoes the whole SQL in its error, so "no value printed" heuristics match the echoed text. The working check greps only for the specific plaintext fixture value (`legacy-fmp-value-295`).
- **gitleaks flagged fixture key `happy6.secret`.** The scan covers every PR commit, so renaming the key was not enough; the historical commit line had to be allow-listed in `.gitleaks.toml`.
- **Stored-set ordering.** The stored set is sorted `(namespace, key, environment) COLLATE "C"`, so stripping the prefix reorders rows and `config-wiring-stored.json` had to be re-sorted.
- **Node 22.23 test filtering.** `--test-name-pattern='^(?!baseline [12] )'` does NOT exclude tests; `--test-skip-pattern='baseline [12] '` does.
- **Step 3's log-literal change is load-bearing.** Without it the `@AC-54` test fails (`d.targetState` is undefined), because the poller exception canonicalises the key before the old literal comparison.
- **Blast radius had to be measured.** Three read-based impl-spec review cycles each found new blast-radius gaps. An empirical worktree run (apply Step 3, run the suite) measured exactly 84 red tests in 7 files and ended the loop.
- **Vacuous test.** `configServiceImpl.test.ts:647` stays green only vacuously after Step 3.
- **Agent tests:** bare `pytest` lacks `grpc`; use `uv run pytest`.
- **The slow DO migrator build during the incident was not R.** R and R+1 ran in 170 ms and 294 ms.
- **Fresh CI DB twin count matched exactly:** 2 violations (`secret-class-twin marketdata/fmp.api_key/staging`, `uncovered-twin analysis/fundsignal.valid_days/staging`). D5's fear of extra twins from 008's bare seeds did not materialise; the generic repair stays.

**Permanent deviations**:
- **Allowlist.**
  - Design: R embeds a hand-signed `allow_296` block of 5 tuples; fresh/production/homelab DBs report exactly 5 `unmatched-signed-tuple` rows; the sha pin covers the signed file.
  - Shipped: the block is permanently EMPTY (`044_config_keys_relative.up.sql`), and `allow-296-signed.sql` was never created. Staging twins were cleared by a hand data repair with the RELATIVE spelling winning all 5 (operator decision, `signoff.md`). Fresh DBs report 0 unmatched rows (AC-21 asserts N = tuples in the rendered block = 0). The pinned sha `1508c083…` is the empty-block R.
  - Because: the PR merged before Step 16, and F-01 forbids editing a merged R.
  - Consequence: R's allowlist, `stale-signature` and `ambiguous-signature` machinery is effectively inert on every real DB.
- **Sign-off procedure.**
  - Design: from the operator workstation via `psql` under the PRE_DEPLOY direct role.
  - Shipped: a DO-console tool, `services/xstockstrat-indicators/app/maintenance/config_allow296.py` (`draft`/`rehearse`), on the indicators pooled `:25061` URL (a recorded fidelity gap against the migrator's direct `:25060`).
  - Because: operator instruction.
  - It became obsolete after D8 (feature 305 deleted it).
- **Agent `get_config` alias filter.**
  - Design: drop any `${ns}.`-prefixed entry.
  - Shipped: drop it only when its relative twin is present.
  - Because: an un-migrated DB would otherwise be emptied.
- **config-ui `actions-${k.key}` test ids** stay on the stored key, because no spec depends on them.
- **config-ui reason guard.**
  - Design: `namespace==='platform' && key==='trading_state'`.
  - Shipped: `configFqn(namespace,key) === 'platform.trading_state'`.
  - Because: it works for both spellings.
- **`scopeResolution.test.ts`.** Design listed it as unchanged; it sends a real prefixed `setConfig`, so it was respelled.
- **`migration-rerun` real-file test.**
  - Design: assert exactly two lines and repair exactly those.
  - Shipped: a header-pattern assertion plus a generic repair.
  - Because: the CI twin count was unprovable offline.
- **Integration precondition (ii), "295's one-staging-release window closed",** was never confirmed. The feature launched with it open.
- **C-16 promotion.**
  - Plan: promote scenarios at integration.
  - Actual: promoted only AFTER launch, because #1477 promoted main-dev→main first and `/promote` did not flag the gap.
  - AC-11/12 were deliberately not promoted. AC-10 lives in `platform.feature`, because it spans two services.

**Cross-feature signal**:
- **The 295 test-blast-radius trap recurred** in three review cycles here and was ended only by an empirical worktree run. Read-based blast-radius review does not converge.
- **A dirty migration in one service blocks DO's automated rollback of the whole app,** not just forward deploys.
- **280 and 299 must re-seed.** 280 (`identity.sso.*`) and 299 (`agent.logs.*`) seeded PREFIXED keys that 296's CHECK rejects. They must seed relative keys and take the next free config migration number at their merge (the `047` owner is whichever of 306/280 merges first).
- **An expand/contract pair joined by `-- contract-of:` needs a `main-dev`→`main` promotion between the two merges.** `migration-contract-gate` blocks the contract PR until the target migration is on `origin/main`; here, 040 was promoted via #1472. Plan for it.
- **304 later fixed a runtime first-hit-wins shadowing risk** that 296 recon had flagged ("Trading lookup shadowing").

**Deferred follow-ons**:
- **304 (done):** drain the 180 `prefixed-read` entries, banners, the strat-lab literal, `excluded()` normalisation and list receivers.
- **305 (done):** prune 3 keys / 5 tuples.
- **306 (done):** remove the alias, the write tolerance, the poller exception, the agent filter and the gate `form-mismatch` alt path.
- **Historical:** the feature launched without operator confirmation that 295's staging window closed. Likely moot, since 304/305/306 launched afterwards.
- **Accepted, not gated:**
  - runtime shadowing by an operator `create_key trading/trading_state`;
  - the newest-`updated_at` rule is wrong for out-of-band `psql` writes with explicit timestamps (the runbook forbids direct writes during deploy);
  - a SetConfig whose INSERT queues behind R+1's lock fails once with INVALID_ARGUMENT (23514), and the poller retries;
  - for the seconds between R's and R+1's commits, relative readers see Rel while prefixed readers see P.
  - Running R and R+1 in one PRE_DEPLOY is what retired 295's M5 dirty-PRE_DEPLOY race.
- **Pre-existing, not this feature:** `e2e/config-ui/fundamentals-scan.spec.ts` failures.
- **Homelab recovery path:** documented for a future non-fresh homelab. A4b is moot by operator statement only.

**Ledger entries written**: insights.md (2), fails.md (2) — see the 2026-11-10 entries. These already existed and were skipped: the 2026-11-07 split/gate-hoist design insight, the embedded-data recovery entry, and the merge-before-sign-off entry.

**Runtime-invariant recommendations (→ /context-constitution)**:
- **CONFIG:** the `SetConfig` probe and upsert are separate non-transactional queries. Any key-rewriting migration must expect a racing write that recreates the old spelling.
- **CONFIG:** two helpers named `canonical` do opposite things. The gate's (`scripts/check-config-wiring.mjs`) returns the FQN; the server's (`services/xstockstrat-config/src/grpc/authz.ts`) returns the relative key.
- **CONFIG:** the dirty-guard floor is 40, derived from R's `-- contract-of: …040_config_markers` header (`scripts/migration-dirty-guard.sh`).
  - Recovery is `force <n−1>`, never `force 0`.
  - 041–043 replay below 043 and recreate prefixed rows that only R+1 cleans up.
- **CONFIG:** R's `allow_296` block is permanently empty, and `relativeKeysMigration.test.ts` pins R's sha to `signoff.md`.
- **PLAT:** on DO, a dirty migration version blocks the PRE_DEPLOY migrator for every later deploy, including DO's automated rollback to an older image.
- **PLAT:** the stored-set generator sorts `COLLATE "C"`, so a key rename reorders `config-wiring-stored.json`.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 2d91b5671335fcce267679b50caa494440205f51.

## Retained verbatim records

Operator decisions and C-16 sign-offs copied verbatim from the pre-archive session log, because durable suites and later features cite "<NNN> context.md" as their provenance. Headings are demoted one level.

### Session 2026-11-07 — sdd-design (round 3 of full debate) + C-16 sign-off

- Round 3: proposer revised under the 3-feature split; adversary verdict **approve with listed fixes** and **the F-01 Floor item RESOLVED** (every RAISE in R / R+1 is a data predicate cleared by a data repair then `migrate force <R-1>` + `up` with the file unchanged; 041 cannot replay after the CHECK because the dirty-guard floor refuses `force 0`; feature C's migration reports and never raises; a rolled-back staging "R rehearsal" immediately before merge catches drift while R is still editable). No Floor breach remains.
- Contested point settled by the adversary: the proposer was right that the prefixed-read direction is reclassified ONE-FOR-ONE into the new `prefixed-read` kind (keeping `form-mismatch` there would double every finding, about 2x184 baseline entries); `form-mismatch` survives only for the inverse direction. Narrower defect found in the proposer's partner-cover hoist: it must cover only `ns.key` when the seed is RELATIVE (otherwise a relative read of a prefixed seed is silently covered when a second reader reads the prefixed spelling, and in a tree without R that read returns its code default).
- Fixes carried into round 4 / design.md: M1 (`fixtures-pre-041.sql:37-41` seeds an unsigned twin `analysis` `fundsignal.valid_days` that 041 keeps by design; the real R would RAISE in pass 1 and turn CI red; make it the real-file AC-19 test: RAISE, repair data, `force cfg_pre`, rerun); M2 (report-vs-raise keyed on twin existence, match on (loser spelling, hash), never hash alone or spelling alone); M3 (`scripts/config-wiring.test.mjs:603` has its own `RULE_SENTENCES`; `doc 1` goes red when the documents are rewritten; import `DOC_RULE_SENTENCES`; also retitle `join 1`, `ratchet 4`); M4 (documents that still teach the old rule: `.claude/skills/sdd-review/reference/product-spec-criteria.md:25`, `.claude/skills/sdd-spec/reference/spec-template.md:136`, `.claude/agents/spec-reviewer.md:20`, `docs/runbooks/config-rollout.md:221`; keep the CONTRACT string intact, tests `doc 4/5` pin it); M5 (apply the FR-2/FR-9 and AC-2/7/13/14 moves to product-spec/acceptance at design approval and re-run `/sdd-review product-spec`, because uncovered scenarios block impl-spec review under C-15); M6 (the narrower hoist); minors m1-m8 (stepTime collision during B's window, merge-order wording "merge order only", adopt a `sha256(R)==signoff.md` CI test, run the rehearsal under the PRE_DEPLOY role and assert no BEGIN/COMMIT in R, oracle must match rows from any 041 run, R+1 delete-rel and rename-P as separate statements, `readers-disagree` is lost across spellings mid-B, a failed staging PRE_DEPLOY blocks every `main-dev` deploy, X3 numeric rule limited to `config-` files, `excluded()` normalisation for prefix-catalog rows in B, simplify R+1 gap-twin: a `system:%` P loses, any other twin RAISEs).
- **C-16 SIGN-OFF (davcs86, 2026-11-07, at the round-3 gate): the following existing business-rule CHANGEs are signed off in feature 296**, because 296's own rename migration or FR-1 rejection breaks the stated Gherkin:
  - (a) 295 config suite `@AC-1`, `@AC-34`, `@AC-25`, `@AC-14`, `@AC-20`, `@AC-21`, `@AC-26`; 295 `@AC-28(a)(b)(c)` (mechanism becomes `migrate goto $cfg_pre` + a direct dirty-guard call that exits 3); 295 platform `@AC-19` (baseline owners become B/C/D, not 296);
  - (b) feature-219 config `@AC-6/7/13` and ui `@AC-8/@AC-12` (ListKeys returns relative keys; the FQN is composed client-side); ui e2e selectors;
  - (c) seed / ListKeys / prefixed-SetConfig Thens: `@AC-2` @feature-243 (indicators), `@AC-2/@AC-4` @feature-182, `@AC-2` @feature-184, `@AC-19` @feature-281, `@AC-27` @feature-282, `@AC-1/3/5/7/10/12/13` @feature-293;
  - (d) pre-approved 295 decision 10 items C1-C6 and N2 stand as signed; C4 is confirmed to cover reclassifying the finding from `form-mismatch` to the new kind `prefixed-read`.
  - Only 295 `@AC-15` (ledger `read_key` log spelling) stays with feature B. PRESERVED: 295 `@AC-2/3/4/5/10/11/31/33/35`, `@AC-54` @feature-294, 254 `@AC-3/4/6`, 161 `@AC-8`, 264 `@AC-5`, 278 `@AC-2/3/7/8/9`.
- Gate decision: **run round 4** (not approve yet). No further steer from the operator.

_From: Session 2026-11-07 — sdd-design (Phase 0 recon + round 1 of full debate)_

- Round 1: proposer = one atomic PR-B + FR-9 PR-C; adversary verdict BLOCKED (no Floor breach; unresolved C-16: 295 `@AC-5` broken by dormant per-user rows going live, `@AC-28(c)` changed while labelled PRESERVE, feature-219 "last updated" destroyed by the `config_value_audit` BEFORE UPDATE trigger's unconditional `updated_at = NOW()` at `017:66-79`). Also: "a 295 SetConfig cannot create a twin" is false (probe `configServiceImpl.ts:778` and upsert `:856` are separate non-transactional `pool.query` calls); twin deletion without a signed allowlist contradicts 295's `allow_041` discipline and the operator's decision to keep the 5 staging twins (`scripts/config-heal/signoff.md:21-23`); `prefixed-seed` is unreachable (stored set is built by a real `migrate up` ending at the CHECK); runbook examples `config-rollout.md:98,121,275` use prefixed `set_config` keys.

_From: Session 2026-11-08 — sdd-review impl-spec (advisory), cycle 1_

- Tree `ccr-e901c541-u0cmts@882e4ca`, `origin/main-dev@0d97dda` merged. Result: **PASS WITH WARNINGS** — 19 steps checked, 3 criterion failures (Steps 6, 8, 10), 10 steps with warnings, 6 clean (2, 7, 11, 12, 17, 19); no definite Floor breach (Step 6 was a potential F-08 risk). Verdicts of the two deliberate deviations from `design.md`: **both justified** (agent `get_config` twin guard; config-ui reason guard via `configFqn(namespace,key)`, `actions-<key>` test id left on the stored key). R/R+1 fidelity to design §3/§4 confirmed point for point; the four atomic units (3+4, 9+10, 11+12; Step 3 alone cannot pass) and the C-16 list (matches the signed list; nothing 304-owned) confirmed. Red window precise (`^(?!baseline [12] )` filters exactly `baseline 1/2`).

_From: Step 15 — `migration-rerun.sh` reshape and the config migration assertions [done] (CI-only; not executed locally)_

- `scripts/migration-rerun.sh`: derives R (the one config migration whose first 5 lines carry `contract-of: …040_config_markers.up.sql`, else exit 1), `cfg_pre = R-1`, R+1, the actor strings and the number of tuples in the rendered `allow_296` block; the helper definitions are hoisted above pass 1; pass 2b moved before pass 1 and made config-only (`goto $cfg_pre`; legs (a)/(b) are `force 40` + `goto`, leg (c) calls `migration-dirty-guard.sh` directly and asserts exit 3 / `config is dirty at version 41` / `force 40`); new pass 2c at `cfg_pre`: the pre-R `config-NNN.sql` files, the real-file AC-18/AC-19 test of R (`up 1` must raise with the secret-class-twin and uncovered-twin lines in rank order, no values, dirty at R, counts unchanged, no report tables, no marker, guard exit 3), a by-hand repair with audit rows, `cfg_force $cfg_pre`, and the signed-tuple happy path on an awk-built copy of R inside `BEGIN … ROLLBACK` (AC-9 twin loser preserved + per-user rename, AC-16 metadata, AC-20 per-user prefixed row renamed not parked, AC-21 lone-tuple row reported and renamed, equal-valued twin; plus stale-signature and ambiguous-signature raises); pass 1 starts a `LISTEN config_changed` session (waited on after pass 3 for the marker and per-(namespace, environment) payloads) and checks R's sha256 is unchanged after the repair; pass 2 replays R and R+1; pass 3 adds `refuse_down config $cfg_pre`, the staging gap rows F1–F7, `guard_blocks config`, the R+1 mixed-class raise (F7) with its repair, and `config:$R1` in the recovery `want` loop; the end loop skips `config-NNN.sql` below R by rule.
