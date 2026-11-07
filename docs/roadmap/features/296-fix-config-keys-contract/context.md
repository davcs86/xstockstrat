# Context Log: fix-config-keys-contract

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-11-04 (split from 295 /sdd-design)

- Created by the 295 design-phase re-scope (295 `context.md`, operator decision 13): Release B
  (contract) became a separate feature, so 295 launches cleanly at its promotion. This feature
  carries a merge-order row "waits for `fix-config-keys-drift` launched".
- Number 296 was reserved via `scripts/sdd-allocate-feature-number.sh`.
- Binding inherited operator decisions (295 context.md): 1 (relative canonical key), 10 (C-16
  CHANGE sign-off C1–C6, N2), 12 (alias activates only after the rename, via marker + pg_notify),
  13 (this split).
- Moved from 295: product-spec FR-1/FR-2 (enforcement and literal rewrite), the rollout/rollback
  ACs (295's former AC-1, AC-2, AC-5, AC-21), and the relative half of AC-19/AC-20.
- Design input: 295's `recon.md` and `design.md` (once approved). Notably R1 (two-release
  sequencing), and the round-1 adversary objection M5 (the 037/038 race leaves PRE_DEPLOY dirty) and
  minor m9 (contract-of proves the file, not the deployed alias code).
- Development branch: feature/fix-config-keys-contract.

## Session 2026-11-04 (from 295 design round 2)

- Inherits **295 decision 15**: dead-row deletion (formerly 295 FR-6/AC-15) moves here, gated on
  static and runtime evidence: FR-9 / AC-7.
- The rename migration's `-- contract-of:` anchors on **295's 036 marker DDL** (round 2 MAJOR-7).

## Session 2026-11-05 (from 295 design approval)

- 295's design was approved on 2026-11-05 (5 rounds). Binding inputs for 296:
  - **Migration anchor:** `-- contract-of: …/035_config_markers.up.sql` (floor 35). 295's heal is
    `036`.
  - **Marker contract:** row `relative_keys_v1` plus a
    `pg_notify('config_changed','{"marker":"relative_keys_v1"}')` in the rename transaction. 295's
    servers read the marker in the same statement as the rows (reloadAll, reloadNamespace, overlay),
    behind a `to_regclass` guard.
  - **Inputs:**
    - the 296-owned `seeded-unread` baseline entries;
    - the `twin-secret-class` / `twin-kept-unsigned` / `per-user-unread` heal report rows;
    - heal rows with `updated_by='system:config-migration-036'`.
  - **Dead-row evidence rule:** zero `config.read_key` hits plus complete `config.read_coverage`
    across the staging release window. UI-read namespaces are never proven dead.
  - **Gate (295 decision 23):** 295 merged to `main-dev` plus one full staging release. No
    production DB exists (295 decision 24).
- Must also own:
  - the agent `get_config` FQN dedupe;
  - removing the FR-1 internal-caller canonicalisation exception in its follow-up.

## Session 2026-11-05 — sdd-review product-spec (correction, supersedes the 035/036 pins above)

- 295's implementation spec renumbered its migrations: marker `040_config_markers`, heal
  `041_heal_config_keys_to_reader_catalog` (heal artifacts `config_heal_report_041`,
  `system:config-migration-041`). 296's `-- contract-of:` anchor is `040_config_markers`; the final
  number is recorded by 295 Step 38. Disregard "035"/"036" in the entries above.
- Dead-row evidence window is one full **staging** release (295 decisions 23/24), not production.
- 296's own migrations are numbered max+1 after 295's chain at spec time.

## Session 2026-11-05 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready (pass 3 of 3; passes 1–2 failed/warned on C-15 FR-3/6/7/8 coverage, then on evidence-window and placeholder items, all fixed).
- Warnings: FR-1 internal-caller exception scope (fixed: `SetConfig` only, grant `trading-reconciliation-poller`); generated contract key table deferred to design.
- Overlap findings: 296 vs 295 is a sequential expand/contract complement, no FAIL. Informational (not 296's): 291/295 on migration 035, 282/293 on 038, shared `scripts/config-wiring.json`. merge-order row 26 re-anchored to `040_config_markers`.
- Recommended design depth: full (DB migrations, 12 services, overlap warnings).


## Session 2026-11-07 — sdd-design (Phase 0 recon + round 1 of full debate)

- Tree: `ccr-e901c541-u0cmts@79435f9 ≡ origin/main-dev`. Working branch is the session-mandated `ccr-*` branch, not `feature/fix-config-keys-contract` (the remote feature branch holds no unique content: its 296 docs are byte-identical to `main-dev`). `feature.md` `**Development Branch**` to be updated at COMPLETION.
- Phase 0: `recon.md` written and pushed (PR #1471). Verified by the orchestrator: config chain ends at `043` (rename/CHECK will be max+1 at merge); `040_config_markers` is NOT on `origin/main`, so `migration-contract-gate` (`ci.yml:744`, `check-migration-contract.sh:21-23`) blocks any PR with `-- contract-of: …040` until a `main-dev`→`main` promotion lands it.
- Round 1: proposer = one atomic PR-B + FR-9 PR-C; adversary verdict BLOCKED (no Floor breach; unresolved C-16: 295 `@AC-5` broken by dormant per-user rows going live, `@AC-28(c)` changed while labelled PRESERVE, feature-219 "last updated" destroyed by the `config_value_audit` BEFORE UPDATE trigger's unconditional `updated_at = NOW()` at `017:66-79`). Also: "a 295 SetConfig cannot create a twin" is false (probe `configServiceImpl.ts:778` and upsert `:856` are separate non-transactional `pool.query` calls); twin deletion without a signed allowlist contradicts 295's `allow_041` discipline and the operator's decision to keep the 5 staging twins (`scripts/config-heal/signoff.md:21-23`); `prefixed-seed` is unreachable (stored set is built by a real `migrate up` ending at the CHECK); runbook examples `config-rollout.md:98,121,275` use prefixed `set_config` keys.
- **Operator decisions (davcs86, 2026-11-07, at the round-1 gate):**
  1. **Delivery shape — contract PR, then per-family consumer PRs.** PR-1 (merges after a promotion carries migration 040): 044/045, FR-1, ListKeys/UI/agent display, the `prefixed-read` gate with a generated shrink-only baseline owned by feature 296. Then one PR per consumer family, each deleting its own baseline entries. Final PR: `--doc-check` sentences + empty-baseline assertion. (Chosen over the proposer's single atomic PR.)
  2. **FR-9 stays in 296 as a later PR** with a hand-signed allowlist of at most 4 tuples plus a small pure evidence evaluator (no emitter tooling). (Chosen over the adversary's recommendation to fold it into the FR-8 follow-up; accepted consequence: 296 reaches code-completed only after the evidence window, which delays the follow-up's earliest start. Round 2 must reconcile AC-12's Given.)
  3. **Per-user rows in an unread spelling are snapshotted, audited and parked** by 044 (removed from `config_values`, listed in a report table for operator review) so 295 `@AC-5` is preserved.
- Round 2 state fed to the proposer: the decisions above plus fixes B2, B3, M1, M2, M4, M5, M6, m1–m6 from the adversary (adversary text itself withheld, P-02).

## Session 2026-11-07 — sdd-design (round 2 of full debate)

- Round 2: proposer revised for D1-D3 + fixes F1-F11 (7-PR sequence); adversary verdict **BLOCKED on one Floor breach, F-01**: the documented recovery for a drifted twin ("`migrate force <R-1>`, re-sign, redeploy") edits R's embedded `allow_296` block after R is on `main-dev`, i.e. edits an applied migration. Fix required in round 3: recovery repairs the DATA (restore the signed state or operator deletes the drifted twin under `docs/runbooks/operator-db-access.md`), then `migrate force <R-1>` + `up` re-runs the unchanged R; sign-off taken immediately before merge with a pre-merge re-inventory check.
- Orchestrator-verified adversary findings: (M1) `scripts/check-config-wiring.mjs:611-612` `continue`s on a seeded key that is already read relative BEFORE covering its prefixed partner, so once one family rewrites a shared key (e.g. `platform/trading_state` read by trading and ui) the other family's prefixed read becomes an un-baselined blocking `read-unseeded` and `--final` goes red in the first family PR; (M2) `scripts/migration-assertions/config-031.sql` (no bare `sandbox.*` rows) and `config-043.sql` (no stripped `engine.*` rows) fail after the rename and must run at the pre-R point.
- Other accepted findings folded into round 3: M6 (295 `@AC-28(a)(b)`, `@AC-21`, `@AC-26` join the CHANGE list: their Gherkin describes prefixed SetConfig calls that FR-1 rejects), M8 (list every `scripts/config-wiring.test.mjs` fixture root touched by the `attribute()`/`join()` changes in a step's Files; pin the `prefixed-read` finding shape and owner rule: the 295 blast-radius trap, `fails.md:3660-3679`), minors m1-m7, and C-18 cuts (drop the `docCheck` runbook regex and AC-22; fold `signed-unused` into one unmatched-tuple report; R+1 gap-twin "P wins" = delete the relative row and rename P instead of copying six columns).
- **Operator decisions (davcs86, 2026-11-07, round-2 gate):**
  1. **Execution vehicle: split into 3 features.** 296 keeps the contract PR (R/R+1 migrations, FR-1, FR-4, FR-5 gate, FR-6 display, the docs that become true with the contract, the FR-8 follow-up stub). Two NEW features are created with `/sdd-story`: (B) consumer literal rewrite (FR-2 + service banners/tables + final doc/gate flip), (C) dead-row deletion (FR-9). Each has its own spec, integration PR, C-16 promotion and merge-order row. AC-12 re-anchors to the last feature.
  2. **C-05 window: flip the wording in PR-1.** C-05 / CONFIG-9 / `--doc-check` change in the contract PR to: the stored key is namespace-relative; readers may still use the prefixed spelling via the alias until the consumer feature's baseline is empty. The final consumer PR only removes the alias caveat.
  3. **FR-9 cap raised to 5**: all three qualifying keys (`ledger/stream.notify_enabled` 1 staging tuple; `analysis/opportunity.sparkline_bars` 2; `marketdata/alpaca.paper` 2; hashes dedupe across the staging DB and fresh). `platform/log_level` (UI reader) and `trading.risk.daily_loss_limit` (documented future key) are re-owned to the FR-8 follow-up. (Corrects round 2's "6 tuples".)
  4. **Spec amendments signed off:** FR-3 (twin resolution from a hand-signed allowlist, operator may sign either direction per tuple; the catalog-driven selection and the "heal rows by `updated_by`" input are replaced by the signed allowlist plus the `config_heal_report_041` two-way oracle) and FR-5 (no separate "prefixed seed" finding kind: the CHECK plus the real `migrate up` in `config-wiring-stored` already fail one; the gate adds `prefixed-read`). Applied to `product-spec.md` at COMPLETION with a re-review flag (C-15); `acceptance.feature` text edits keep their IDs, new ACs are appended.
- Next: round 3 (proposer revises under decisions 1-4 + the F-01/M1/M2/M6/M8 fixes; adversary re-attacks). Approval stays locked until the F-01 Floor item is resolved (F-11).

## Session 2026-11-07 — sdd-design (round 3 of full debate) + C-16 sign-off

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

## Session 2026-11-07 — sdd-design (round 4 of full debate)

- Round 4: proposer delivered one self-contained final design; adversary verdict **approve with listed fixes**, **F-01 still RESOLVED**, no Floor breach; fixes M1-M6 and minors m1-m8 verified applied (except where noted). Open items folded into round 5:
  - MAJOR-1: R+1's documented repair for a racing prefixed row P ("delete P") would restore the older value and could silently revert a `REDUCE_ONLY`/`HALTED` escalation (a SetConfig issued DURING R's run probes the old prefixed row, `SHARE ROW EXCLUSIVE` does not block the probe SELECT, `configServiceImpl.ts:778`, then blocks on the INSERT and creates P when R commits, `:856-869`).
  - MAJOR-2: `updated_by IS NULL` is a migration seed (SetConfig always writes a non-empty author, `:738-742`; 001 and 042 seed with no author), not an operator write.
  - MAJOR-3: `deploy/homelab/compose.yml:32-55` runs its own `db-migrator` against persistent databases; neither sign-off covers them; "failed PRE_DEPLOY keeps previous images" is DigitalOcean-specific.
  - MAJOR-4: test blast radius outside the gate is not enumerated (config `src/__tests__` 12 files / 41 hits; agent `tests/test_config_tools.py` 28 hits; ui e2e selectors) — repeats the 295 trap (`fails.md:3660-3679`).
  - Minors: regenerate `config-wiring-stored.json` in the sign-off step; make parking rule (a) symmetric with (b); pin violation-class precedence and drop `per-user-twin-unsigned`; stale durable-suite header `services/xstockstrat-config/acceptance/fix-config-keys-drift.feature:6` and gate comments `check-config-wiring.mjs:578,716`; name the two different `canonical` helpers (gate returns the FQN, config server returns the relative key); add missing recovery-table rows; cite the retirement precedent accurately (`platform.feature:1437-1449` is a durable-suite supersession note) and record each retirement here; `/sdd-story` bug guard (`.claude/skills/sdd-story/SKILL.md:274`) — give B, C, D their Types; note non-adjacent contract (041-043 replay) as the reason pass 3 exists.
- **Operator decisions (davcs86, 2026-11-07, round-4 gate):**
  1. **R+1 gap-twin rule: a non-system P ALWAYS WINS** (delete the relative row with audit, then rename P over it as separate statements, `updated_at` kept). A P written by `NULL` or `system:%` loses. No RAISE, no deploy block, no hand repair.
  2. **Homelab databases are fresh / not yet used** (operator confirmation recorded here and in `signoff.md` at sign-off). The design still documents the compose failure path for `deploy/homelab` in `config-rollout.md`. If this proves wrong, R fails loud on the first homelab deploy.
  3. **Development Branch for implementation = `feature/fix-config-keys-contract`** (C-06/F-03). Design documents continue to land through the `ccr-*` PR #1471; `feature.md`'s Development Branch is left as `feature/fix-config-keys-contract`.
  4. **Gate: run round 5 (last allowed).** After round 5 the options are: approve as-is, accept documented open risks, or stop.

## Session 2026-11-07 — sdd-design: COMPLETION (round 5 of full debate, design approved)

- Round 5: proposer produced the final self-contained design; adversary verdict **approve with listed fixes**, **F-01 RESOLVED**, no Floor item open; round-4 MAJORs 2/3 closed, MAJOR-4 mostly closed. New blocker B-1 verified against the committed data: the round-4 "symmetric" per-user parking rule would not select `analysis`/`fundsignal.min_conviction_to_emit` (user_sha `73833c35…`, `report-staging-041.jsonl:25`) because its global twin was kept (`:26`, `signoff.md:21-23`), so R would RAISE `oracle-mismatch` on staging on every run. Fixed in design.md §3 step 3 (selector S1 = every still-present `per-user-unread` row of any 041 run; (a) parks regardless of a global relative twin).
- Folded into design.md as binding items: B-1; M-2 (R+1 raises only on a MIXED-class gap twin, both-secret twins resolve by the rule with audit values NULL); M-3 (295 `@AC-5` and `@AC-33` supersession notes); M-4 (each new/edited AC written out as Given/When/Then with its `@FR` tag; FR-8 start condition aligned with ⟨D⟩'s merge-order row); m-1 (⟨D⟩ story text carries "Depends on 296" and its two re-owned entries); m-2 (S9 Files list every renumber-touched file); m-3 (`scripts/integration-test.sh:516-552`, `config-rollout.md:246`, `configServiceImpl.ts:813` stale text, telemetry-test hit confirmation, `DOC_BANNED` vs `config-governance.md` log lines); m-4 (sha pin kept, "allow block verbatim" test dropped).
- **Operator decisions (davcs86, 2026-11-07, round-5 gate):** (1) **R+1 gap-twin rule = newest `updated_at` wins** (ties to P); a P authored by NULL or `system:%` always loses (replaces the round-4 "non-system P always wins", per the adversary's M-1: the probe and upsert are separate autocommit calls, `configServiceImpl.ts:778` vs `:856`); (2) **approve with the listed fixes folded in**.
- Retirements recorded (C-15; IDs never reused, kept as comments in `acceptance.feature`): **AC-2** (→ feature ⟨B⟩), **AC-7, AC-13, AC-14** (→ feature ⟨C⟩); FR-2 (→ ⟨B⟩) and FR-9 (→ ⟨C⟩) are moved to `## Retired requirements` in the product spec. AC-6, AC-8, AC-9, AC-11 text edited (IDs kept); AC-16..AC-24 appended with `@FR` tags. AC-24 states the inverse-direction case 9b exactly (a second prefixed reader makes the relative read `read-unseeded`).
- Spec edits made at design approval (M5): product-spec FR-1/FR-3/FR-5/FR-7/FR-8 amended, FR-2/FR-9 retired, Depends on + Followed by + Affected Services + Config Key Changes + Database Changes updated; acceptance.feature rewritten as above. `/sdd-review product-spec` must run again before `/sdd-spec`.
- Constitution rules touched: C-02, C-05 (amended), C-06, C-07, C-08, C-10, C-14, C-15, C-16, C-18, P-01..P-05, F-01, F-04, F-06, F-07, F-08, F-09, F-11. Floor breaches: one (F-01 recovery path, round 2) — resolved round 3, re-verified rounds 4-5.
- Ledger: `fails.md` (migration: embedded-data recovery and data-dependent rules) and `insights.md` (design: split a gated contract change into features; narrow gate hoists) entries appended.
- Open threads (also in design.md Open Risks): staging drift between sign-off and PRE_DEPLOY (S9); homelab/production "fresh" is an operator assertion (A4b: homelab-edge's app-deploy gate is outside this repo, verify at spec time); newest-`updated_at` rests on one DB clock and default timestamps (out-of-band `psql` writes with explicit timestamps can mis-order); B-window banner contradiction + `readers-disagree` gap + step coupling; C1-C6/N2 per-rule split between 296 and B at `/sdd-spec`.
- Status: spec-ready → design-approved. Next: `/sdd-review fix-config-keys-contract product-spec`, `/sdd-story` for ⟨B⟩ ⟨C⟩ ⟨D⟩, then `/sdd-spec fix-config-keys-contract`.

## Session 2026-11-07 — operator confirmation after design approval

- **Operator confirmation (davcs86, 2026-11-07):** the homelab databases **will be in a fresh state when 296 is launched**. This is a commitment about launch time, not a statement that they are fresh today: the operator is responsible for making it so before the first deploy that carries R. It must be repeated in `signoff.md` ("Feature 296 — R sign-off") at S9. If it is not true at launch, R raises on the first homelab deploy (recovery: `design.md` §2 homelab recovery).
- **Still open for `/sdd-spec` (not resolved by the confirmation):** assumption A4b — whether the old homelab containers keep running after a failed `db-migrator` is decided by homelab-edge's app-deploy gate (`deploy-homelab.yml:1`, homelab-edge `docs/runbooks/deploy-compose-app.md`), which is not in this repository. Verify it at spec time and record the result in `config-rollout.md`'s per-platform failure section.

## Session 2026-11-07 — sdd-review product-spec (re-review after design approval)

- Tree: `ccr-e901c541-u0cmts@f844975` after merging `origin/main-dev@0d97dda` (3 commits: promotion #1472 and its status/CHANGELOG commits). Status stays `design-approved` (a PASS must not regress it to `spec-ready`); history row appended as "(unchanged)".
- **Precondition (i) is now satisfied:** promotion #1472 (2026-11-07) put `040_config_markers`, `041_heal_config_keys_to_reader_catalog` and `043_analysis_live_loop_keys` on `origin/main` (verified with `git cat-file -e origin/main:…`), and 295 is `launched`. The remaining time precondition ("295's one full staging release closed") still needs the operator's explicit confirmation here before 296's integration PR merges.
- Criteria review (`spec-reviewer`): **PASS WITH WARNINGS**, no blockers, no Floor breach, every live FR (1,3,4,5,6,7,8) covered, retirements acceptable under C-15 (precedent 286, 297). Warnings and disposition: (1) criterion 6 wording must change in the same change — FR-7 now names `product-spec-criteria.md` criterion 6 explicitly [fixed]; (2) name where the dirty-guard floor comes from — Database Changes now says `scripts/migration-dirty-guard.sh:22-43` derives it from R's `contract-of` header, no guard code change [fixed]; (3) Depends on wording stale — reworded as satisfied 2026-11-07 [fixed, also in design.md §2]; (4) tighten AC-8 / AC-19 / AC-22 / AC-23 (implementation-flavoured Then clauses, `<B>` placeholder) [deferred to /sdd-spec]; also added `secret-parked-candidate` and the oracle mismatch to FR-3's raise list [fixed].
- Overlap scan (`feature-overlap`): no duplicate key / proto / migration number with any live feature. **FAIL-level contract conflicts with two drafts:** 280 `third-party-sso-oidc` seeds `identity.sso.*` (`280/product-spec.md:60-67`) and 299 `agent-log-query` seeds `agent.logs.*` (`299/product-spec.md:99-105`) in the PREFIXED spelling that 296's CHECK rejects (23514). Operator approved the merge-order proposal: **new blocking rows added** (280 and 299 wait for 296, merge order only — 296 need not be launched; seeds must be relative; migration numbers above 296's two) and **row 26 marked Resolved 2026-11-07**. 280 and 299 product specs are NOT edited by this review (their authors must follow the rows). Note: merge-order row 95 still names 280 `smoke-check-runtime` and pins `035`/`036` (not on trunk) — stale, left for 280's owner. WARN-only: shared edits to `ci.yml` (298), `services/xstockstrat-agent/app/tools.py` (299, disjoint functions), `docs/patterns/config-governance.md` (280's key registry; append-order). Stale text noted: `298/context.md:21` (GAP-2 says 295 is implementation-ready); this file's `context.md:63` "291/295 on migration 035" (historical).
- Next: `/sdd-story` for ⟨B⟩ ⟨C⟩ ⟨D⟩ (this session), then `/sdd-spec fix-config-keys-contract`.

## Session 2026-11-07 — follow-on features created (`/sdd-story`)

- Created the three follow-on features from this design, at the operator's explicit direction ("Yes, go for them"), each `Type: feature`, `status: draft`, with provenance recorded in their `context.md`: **B = 304** `config-keys-relative-consumers`, **C = 305** `config-dead-rows-prune`, **D = 306** `config-keys-alias-removal` (numbers reserved on `origin`; 303 was skipped by the allocator and is burned).
- Replaced every ⟨B⟩/⟨C⟩/⟨D⟩ placeholder in this feature's `design.md`, `product-spec.md`, `acceptance.feature` and `feature.md` with 304/305/306 (this `context.md` and `recon.md` are append-only/historical and keep the letters). The baseline owner constants are `feature 304` (`PREFIXED_READ_OWNER`), `feature 305` (three dead-row entries) and `feature 306` (`platform/log_level`, `trading/risk.daily_loss_limit`).
- `merge-order.md` rows added for 304 (waits for 296, merge order only), 305 (waits for 296, merge order only, independent of 304) and 306 (waits for 304 and 296, both launched; earliest start one staging release after 304 launches with zero poller-exception WARNs).
- AC-12 holds: feature 306's directory and product spec exist and declare `Depends on` this feature.
- Next: `/sdd-spec fix-config-keys-contract`.
