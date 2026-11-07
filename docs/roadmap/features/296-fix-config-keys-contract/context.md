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
