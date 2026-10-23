# Context Log: fix-ingest-seeded-config-keys

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-22 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md` (Issues disabled)
- Severity: SEV-3, environment dev (staging) → Track C
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md
- Affected services (from report): xstockstrat-ingest, xstockstrat-config
- Root cause hypothesis: mixed seed key convention; ingest seeds are namespace-stripped, readers use the dotted form
- Recommended design depth: full → `/sdd-design fix-ingest-seeded-config-keys` (rationale: two services, a config key change or migration, and an open platform-wide sweep)
- Development branch: feature/fix-ingest-seeded-config-keys
- The runtime effect (reads miss the snapshot) is inferred from code and the live key registry, not observed; the design must confirm it with a live `set_config` check on staging before choosing the fix shape.
- Open questions for design: re-key seeds vs change readers; handling of operator-edited rows on re-key; whether other namespaces' older bare seeds are also inert; INGEST-9 wording; whether the unseeded `max_concurrent_jobs` and `retry_on_failure` keys should be seeded.

## Session 2026-10-22 (live check, staging)

- Ran `get_config(namespace="ingest")` on staging (read-only; no `set_config` was issued). The served snapshot's `values` are keyed by the bare
  seeded names (`mcp_client.request_timeout_seconds`, `mcp_client.poll_interval_seconds`, `backfill.chunk_max_bars`,
  `backfill.chunk_window_days`, `backfill.max_concurrent_chunks`) with no `ingest.`-prefixed entries, and requesting the prefixed key returns the
  same snapshot. This confirms the snapshot shape that makes ingest's `values.get("ingest.…")` miss.
- Not observed: the behavioural effect (an edited value being ignored). No ingest log or metric exposes the effective timeout or poll interval,
  and a `set_config` write on staging would not be observable without adding one. The design should prove the effect with a unit test against a
  snapshot built from the seeds (AC-2) rather than a staging write.

## Session 2026-10-22 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria verdict: PASS WITH WARNINGS (no fails, no floor breaches). Trading-domain checks skipped (not a trading feature; C-1 to C-5 n/a).
- Warnings:
  - Criterion 9: four open questions remain (re-key vs change readers; bare+dotted conflict rule; seed `max_concurrent_jobs`/`retry_on_failure`; sweep scope). Deferred to /sdd-design; Q1 must be settled with 244 and 261 before /sdd-spec.
  - Criterion 8: AC-5 (FR-4) is either/or and defers to the approved design; pin it once FR-4 is decided.
  - Criterion 8: no scenario covers the both-rows-exist conflict (Open Question 2); add one (e.g. @FR-2 with a pre-existing dotted row) once the conflict rule is chosen.
  - Criterion 8: AC-6/AC-7 are documentation-state scenarios (not machine-verifiable); AC-1 to AC-3 assume the seeds-re-keyed outcome and need revising if the readers option is chosen.
  - Cross-feature migration numbering: 243 claims 031, 244 and 248 both claim 032. 277 needs 033 or later, re-derived across remote branches at spec time. Applied migrations 005 and 025 stay unedited.
  - Criterion 11: Consumer Surface section present and sufficient.
- Overlap findings: level WARN, no FAIL-level clash.
  - 277's migration slot 033 is unclaimed on trunk and on every live branch; no other live feature seeds the five ingest keys.
  - File collision (WARN): INGEST rules table in `services/xstockstrat-ingest/docs/context-constitution.md` is also edited by 244 and 261 (merge-order.md:82).
  - Conditional (WARN): the readers option would edit `app/config/watcher.py` and `app/engine/mcp_client_loop.py:133-138,162-167`, the same lines 244 rewrites to `int_positive`; the seeds option avoids it.
  - Config-key seam (WARN): 261 reuses `ingest.mcp_client.request_timeout_seconds` and references the bare 025 seed row; re-check 261's step against the final key form.
  - Low-risk shared context: `services/xstockstrat-ingest/CLAUDE.md:124-133`; unseeded `max_concurrent_jobs` (shared with 244's zero-trap test); `retry_on_failure` test surface.
  - Merge-order: no entry for 277 in `docs/roadmap/features/merge-order.md`. Proposed (not written; needs operator approval): 277 waits for 244 only if the readers option is chosen; 277's migration merges after 243's 031 and 244's/248's 032.
  - Note: the working-tree product-spec said no migration is anticipated while the branch copy requires one; the branch copy governs.

### OPERATOR DECISIONS (binding, recorded 2026-10-22)

- Triaged 2026-10-22 from docs/reports/2026-10-22-ingest-seeded-config-keys-never-read-defect.md; Track C; the feature dir lives on the base branch ccr-fac38b1f-6m24q2 (PR #1322, not yet merged to main-dev).
- Operator 2026-10-21 (standing, all features): x-trace-id must be propagated as much as possible; no C-03 waiver — request-derived emits/writes use context.WithoutCancel(ctx) (Go) / the inbound metadata (Python/Node), never a fresh background context; only work with no originating request (background sweepers/loops) may mint its own context, and it should still carry a trace id when one is available.
- Operator instruction 2026-10-22: run the full speccing (review, recon, full design debate, spec, impl-spec review). A live read-only staging check was done: get_config(namespace='ingest') serves a snapshot keyed by the BARE seeded names with no 'ingest.'-prefixed entries (recorded in context.md and the report). The behavioural effect on ingest was not observed; the design should prove it by a unit test over a snapshot built from the seeds, not by a staging write. Do not run any data or config change on staging or production during speccing.
- Design must include a platform-wide sweep of every seeded config key against its reader (all namespaces and both snapshot key forms), reported as findings; fixing other namespaces stays out of scope unless the operator extends it at the design gate. The sweep must also reconcile the INGEST-9 wording and the 2026-09-03 findings entry with the real snapshot shape, and decide whether the unseeded ingest.backfill.max_concurrent_jobs and ingest.backfill.retry_on_failure keys should be seeded. Re-keying seeds must preserve operator-edited rows.
- Review note 2026-10-22: the first two product-spec reviews failed on acceptance coverage (FR-5/FR-6 uncovered; AC-5 stated a process step). The branch already carries AC-6 (FR-5), AC-7 (FR-6) and a rewritten observable AC-5, so review the CURRENT branch text.

## Session 2026-10-22 — sdd-batch design gate (round 2)

Gate policy: halt. design.md NOT written; status.md unchanged. Debate state is resumable from the block below.

### Open Threads

- **Approach.** Re-key the five seeds (ingest.backfill.{chunk_max_bars,chunk_window_days,max_concurrent_chunks}, ingest.mcp_client.{poll_interval_seconds,request_timeout_seconds}) to full-dotted keys in a new config migration (number re-derived at spec time; 031/032 are claimed). Readers (watcher.py:199-210, mcp_client_loop.py:135,164) stay untouched. The migration snapshots guarded bare rows and winning dotted twins first (243 pattern), deletes bare rows that have a dotted twin (dotted wins; audit row each), renames the rest key-only with audit rows (global and per-user; `mcp_credential.*` secrets stay bare), then emits one `config_changed` pg_notify per environment. Down is an enumerated inverse driven by the snapshot table, or forward-only like 029 if too costly. FR-4: seed neither `max_concurrent_jobs` (read once at startup; 244 zero-trap) nor `retry_on_failure`. Verification: pass-0 `goto N-1` + `fixtures-pre-277.sql` + pass-2 replay entry + `config-033.sql` read-back assertions in `migration-rerun.sh`, plus an ingest pytest that builds a real `ConfigSnapshot` from the 005/025 seeds and drives the real `ConfigWatcher` getters (red before, green after).
- **Strongest open objection (blocking).** The design.md behaviour-change table and operator sign-off do not exist yet: production/staging live values from read-only `get_config`, the per-user caveat, the AC-5 @feature-166 timeout row, and explicit sign-off that (i) previously ignored edits take effect at migration commit via NOTIFY and (ii) `updated_at` on renamed rows shows migration time. The gate must not pass without them.
- **Other blocking items.** acceptance.feature AC-3 still lists a `dev` environment (forbidden by the 017 CHECK) and lacks per-user and twin examples; product-spec Fix Scope wording must be aligned. Harness changes (migration-rerun.sh pass-0/fixtures/pass-2, real-getter ConfigSnapshot test) must be listed in Touchpoints and the implementation spec.
- **Non-blocking.** AC-5 degradation needs a cited or new `request_timeout_seconds=1` test; verify `reloadNamespace` `user_id IS NULL` filtering; follow 243/031 snapshot shape exactly; python-test CI cwd access to config migrations; `system:migration-033` sentinel row and CONFIG-4 note land in the same PR.
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes (none covered by an operator decision).** AC-1 EXTEND, AC-2 EXTEND, AC-3 EXTEND; AC-4, AC-5, AC-6, AC-7 PRESERVE.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Re-key the five seeds, leave readers untouched (watcher.py:199-210, mcp_client_loop.py:135,164). Round 2 accepts all three adversary blockers and reshapes the verification and remediation record.\n\n1. Migration config/033_heal_ingest_seed_keys_full_dotted.{up,down}.sql. The number is re-derived across all remote branches at spec time (031/032 claimed, 032 twice). There is no BEGIN/COMMIT, per 029. It holds one literal map(old_key,new_key) VALUES CTE with five pairs: ingest.backfill.{chunk_max_bars,chunk_window_days,max_concurrent_chunks} and ingest.mcp_client.{poll_interval_seconds,request_timeout_seconds}.\n a. Snapshot first, following 243's structured pre-state pattern (CREATE TABLE IF NOT EXISTS ... AS, same naming and shape as 031 at spec time). It captures every guarded bare row (id, environment, user_id, old_key, new_key, value_data, value_type, updated_at, updated_by, update_reason) and every dotted twin that will win. This replaces free-text-only provenance and makes a faithful down possible.\n b. Twin delete: for each bare row (namespace='ingest' AND is_secret=false AND key=old_key) with a dotted twin of the same environment and COALESCE(user_id,''), write one config.config_audit row (changed_by='system:migration-033', old_value=bare value, new_value=NULL, reason naming the row id and the kept dotted key; new_value is nullable TEXT per 001:31), then delete the bare row. The dotted row wins because it is the only value ingest ever read (overlay keyed by row.key, configServiceImpl.ts:240), so this is behaviour-neutral for global and per-user rows. The delete runs before the rename so config_values_scope_uniq (017:101-102) is not violated.\n c. Rename: one audit row per remaining bare row (old_value=new_value=value_data, same sentinel), then a guarded UPDATE of key only, over global and per-user rows. The guard is namespace='ingest' AND is_secret=false AND key=old_key, which leaves mcp_credential.* secrets bare for GetSecret (authz.ts:120-125). The audit rows are written in addition to the snapshot because operators look in config_audit. The UPDATE trigger bumps updated_at (017:69-76) and writes no audit row for a key-only change.\n d. Notify: one pg_notify('config_changed', {namespace:'ingest',key:null,environment,user_id:null}) per staging and production, the SetConfig payload shape (configServiceImpl.ts:516). The listener reads only namespace and environment (:168-171). Replays fire again harmlessly, including pass 2 under psql -1. The gate table states that activation happens at migration commit.\n2. Down is an enumerated inverse driven by the snapshot table. It renames back only rows whose id is in the snapshot and whose key still equals new_key, and it restores deleted twins from the snapshot. It does not blind-rename dotted rows. If the spec shows this is too costly, fall back to a forward-only down (SELECT 1;, matching 029) with the stated reason \"matches 029/243, snapshot table is the manual recovery record\". The false premise \"renamed rows are indistinguishable\" is withdrawn.\n3. FR-4: seed neither ingest.backfill.max_concurrent_jobs (read once at startup, watcher.py:185-191, plus the zero-trap owned by 244) nor ingest.backfill.retry_on_failure. The operator can override at the gate with a whole-set seeding decision coordinated with 244.\n4. Verification, harness-native (answers adversary blocker 1).\n - scripts/migration-rerun.sh: add a pass-0 `config) migrate ... goto <N-1>` case, with N-1 re-derived at spec time and following the fixtures-pre-224 pattern (:81). Add scripts/migration-assertions/fixtures-pre-277.sql with: edited bare rows in staging and production, a per-user bare row, a bare+dotted twin (global and per-user), and a secret mcp_credential.* row. Pass 1 db-migrate.sh up applies the real 033. Add config:033_... to the pass-2 replay list (:93-95). Post-pass assertion scripts/migration-assertions/config-033.sql checks that the stored key equals each reader string (read-back per fails.md:2335); there are no bare or ingest.ingest.* rows; the twin resolved to the dotted value; the per-user row was renamed; the secret row is still bare; the snapshot and audit rows exist; and the row count is stable after the replay. It also pins the five reader strings in config-side SQL so a config-only change is gated (answers the cross-service coupling objection).\n - The ingest pytest (answers adversary blocker 2) parses the bare keys and values from the real 005/025 INSERTs (staging/production rows only, since 017 dropped dev). It applies the 033 map to them and builds a real config_pb2.ConfigSnapshot (harness at tests/test_config_watcher.py:56). It then asserts that the real ConfigWatcher properties backfill_chunk_max_bars, backfill_chunk_window_days and backfill_max_concurrent_chunks return the seeded values and not the code defaults 200000/90/3. It also asserts, with a real ConfigWatcher driving mcp_client_loop, that the 135/164 reads return seeded 300/30 values. It is red before the fix (bare keys, no map) and green after. _FakeCfgWatcher is used only for the loop-behaviour half of AC-1 (5s per-call timeout) and is not claimed as proof of snapshot keying. A map-completeness check (CTE new_key set equals the reader strings the real properties read) stays narrow. If the python-test CI cwd cannot read ../xstockstrat-config/migrations, the key set moves to a shared fixture.\n - AC-5 @feature-166: cite the existing unreachable/timeout health-degrade test, or add one with request_timeout_seconds=1, before the gate claims graceful degradation.\n5. Acceptance (answers blocker 3): before /sdd-spec, edit acceptance.feature AC-3 Examples to staging/production only (017 CHECK removes dev; 005 dev rows became staging). Add a per-user example and a twin example (dotted wins, bare dropped, audit row written). Align the product-spec Fix Scope text from \"dev, staging and production\" to \"staging and production\".\n6. Design gate deliverable in design.md: table of env x key x live value (read-only get_config(namespace='ingest')) x code default (200000/90/3/300/30) x changes-on-deploy (Y/N). It adds the @AC-5 @feature-166 short-timeout row. It states that per-user rows are invisible to get_config without a user_id, so they are covered by the snapshot/audit rows and the fixtures. Two explicit operator sign-offs are required: (i) previously ignored edits take effect at migration commit via NOTIFY, and (ii) updated_at on renamed rows shows migration time in config-ui ListKeys (CONFIG-7, feature 219), with the snapshot/audit rows as the way to recover the original edit time.\n7. Docs. INGEST-9 replacement text (ingest docs/context-constitution.md:28): \"the getter argument equals the stored key column, served verbatim; ingest's stored keys are full-dotted as of 033; secrets (mcp_credential.*) stay bare and are read through GetSecret\". This does not permit bare reads. Also: mark the 2026-09-03 findings entry reconciled; ingest CLAUDE.md:124-133; config-governance.md:375-376 plus the new system:migration-033 sentinel row (:95-103); CONFIG-9 \"survive only in 023 and 025\" claim; CONFIG-4 note that a migration may emit config_changed; re-check 261's implementation-spec.md. The FR-6 platform sweep table goes into design.md: analysis fundsignal.* (008) and scoring.signal_decay_half_life_hours (019) are inert-seed findings left to the operator at the gate; 243 owns indicators.sandbox.*; dead seeds analysis backtest.max_duration_seconds and ledger stream.notify_enabled; ui and agent namespaces are bare-to-bare OK.",
    "open_objections": [
      {
        "text": "Behaviour-change table and operator sign-off in design.md: the production (and staging) live values for the five keys from read-only get_config, the per-user caveat, the @AC-5 @feature-166 row, and explicit sign-off on activation-at-commit via NOTIFY and on the updated_at bump. The proposal designs the deliverable but the production values do not exist yet. The gate must not pass without them (ledger fails.md:2363-2365).",
        "blocking": true
      },
      {
        "text": "acceptance.feature AC-3 still lists a dev environment, which the 017 CHECK forbids, and has no per-user or twin example. It must be edited (staging/production, plus per-user and twin examples), and the product-spec Fix Scope wording aligned, before /sdd-spec. The edit is specified here but not yet made.",
        "blocking": true
      },
      {
        "text": "Harness change in migration-rerun.sh (pass-0 goto N-1, fixtures-pre-277.sql, pass-2 list entry) and the real-getter ConfigSnapshot test must be listed in Touchpoints and the implementation spec. The goto number depends on the 031/032 landing order, which must be re-derived at spec time.",
        "blocking": true
      },
      {
        "text": "AC-5 @feature-166 degradation claim needs a cited existing test or a new timeout=1 test.",
        "blocking": false
      },
      {
        "text": "reloadNamespace (configServiceImpl.ts:203) user_id IS NULL filtering is unread. Verify at spec time before relying on it for the NOTIFY reload.",
        "blocking": false
      },
      {
        "text": "Snapshot table naming and shape must follow 243/031 exactly (read 031 at spec time). Decide enumerated down vs forward-only with the stated reason.",
        "blocking": false
      },
      {
        "text": "python-test CI cwd must be able to read the 005/025 migration SQL, or the seeds move to a shared fixture. Otherwise the real-getter test cannot parse the seeds.",
        "blocking": false
      },
      {
        "text": "New system:migration-033 sentinel row and the CONFIG-4 migration-origin NOTIFY note must land in the same PR. Docs are re-audited against the code in the teardown.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-2",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-3",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Change the readers to bare keys: collides with 244's reader rewrite, invalidates 261's dotted request_timeout string, and goes against the full-dotted convention (029/feature 189, CONFIG-9).",
      "Blanket re-key of every bare ingest row: would break ingest.mcp_credential.* secrets, which must stay bare for GetSecret (authz.ts:120-125).",
      "Twin rule 'keep the most recently updated value': can silently change live behaviour. The dotted twin is the only value ingest ever read, so it wins.",
      "Stamp update_reason as the rename marker: overwrites the operator's edit reason, and a key-only UPDATE writes no trigger audit row. Replaced by explicit audit rows plus a snapshot table.",
      "Free-text audit rows as the only remediation record (r2 proposal): ids and keys have to be regexed out of reason, and the shape diverges from 243/031. Replaced by a snapshot table (243 pattern) plus audit rows.",
      "Self-contained BEGIN...ROLLBACK assertion that applies up twice: it would test a pasted copy of 033 rather than the shipped file (C-18 duplication), and the existing harness runs assertions only after all passes. Replaced by the goto N-1 + fixtures-pre-277 harness path.",
      "Set-equality test against retyped reader literals or _FakeCfgWatcher(ints=...): both pass before the fix and prove nothing about snapshot keying (fails.md:2360). Replaced by a real ConfigSnapshot over seeds parsed from 005/025 driven through the real getters.",
      "No-NOTIFY option (values apply when config restarts on deploy): makes activation timing non-deterministic. Kept the NOTIFY with a gate-table statement of activation at migration commit.",
      "Seed only retry_on_failure: an arbitrary half-measure next to max_retry_attempts and signals.dedup_window_hours.",
      "Seed max_concurrent_jobs: read once at startup (watcher.py:185-191), so live edits would not apply, and it carries 244's zero-trap.",
      "Separate config.remediation_277 table with bespoke shape: superseded by following 243's existing snapshot shape."
    ],
    "open_risks": [
      "Previously ignored operator edits take effect at migration commit (pg_notify reloads without a restart). Mitigated only by the production read-only values in design.md and operator sign-off at the gate.",
      "updated_at is bumped on renamed rows, so config-ui ListKeys shows migration time as the last edit. The original time lives only in the snapshot table.",
      "Pass-0 goto N-1 couples CI to the 031/032 landing order (032 double-claimed by 244 and 248). Re-derive at spec time.",
      "The first config migration to emit pg_notify. It relies on the listener reading only namespace and environment, and it fires on every pass-2 replay.",
      "An enumerated down depends on the snapshot table surviving. If it is dropped or the rows are edited again, rollback becomes a hand-written forward migration.",
      "Live twin and per-user rows are unverified: get_config cannot list per-user rows and production is unread. They are covered by fixtures and the snapshot/audit trail only.",
      "python-test CI may not be able to read the config migrations from the ingest working directory.",
      "The behavioural effect on ingest is proven only by unit and DB assertions, not observed live (operator instruction).",
      "Sweep findings (analysis fundsignal.*, scoring.signal_decay_half_life_hours) remain unfixed unless the operator extends scope at the gate."
    ],
    "constitution_rules_touched": [
      "C-03 (no new emit path; ingest code unchanged, standing trace-propagation decision honoured)",
      "C-07 (migration number re-derived at spec time)",
      "C-08 (migration-rerun.sh harness reuse)",
      "C-11 (design gate and ledger touch)",
      "C-14 (consumer-surface check, 261 re-check)",
      "C-15 (acceptance coverage AC-1..AC-7, AC-3 example fix)",
      "C-16 (no @AC regressions: @feature-166, @feature-173, secret rows)",
      "C-18 (no duplicated migration body in assertions)",
      "F-01 (005/025 not edited)",
      "F-04 (migration assertion coverage)",
      "F-06 (no pool change)",
      "F-07 (no hardcoded values; one mapping CTE)",
      "P-02 (mediator synthesis)",
      "P-03 (objections stay open until answered)",
      "P-06 (red-before-green tests)",
      "INGEST-9 (rewrite)",
      "CONFIG-4 (migration-origin notify)",
      "CONFIG-7 (updated_at in ListKeys)",
      "CONFIG-9 (seed-survival claim rewrite)",
      "PLAT-N1 (verify-before-claim)"
    ],
    "rationale": "The fork (re-key the seeds, leave the readers alone) survives with no Floor breach. The adversary's three blockers were valid and are absorbed. Verification moves onto the real harness path (goto N-1, fixtures-pre-277, pass-2 replay, post-pass read-back). The ingest test drives a real ConfigSnapshot built from the real seeds through the real getters, so it is red before the fix. The AC-3 dev example is replaced by staging/production plus per-user and twin examples. Remediation moves to a structured snapshot table in 243's shape plus audit rows, which also makes an enumerated down possible. The NOTIFY and updated_at side effects are kept but must be signed off at the gate. The production behaviour-change table, the AC-3 text edit and the harness Touchpoints stay open as blocking items because they have been specified but not yet produced. Everything else is non-blocking and resolvable at spec time."
  },
  "floor_breaches": []
}
```

## Session 2026-10-22 — sdd-batch design gate (round 2)

Gate policy: halt. design.md NOT written; status.md unchanged. This entry supersedes the `sdd-batch-design-state` block of the earlier round-2 entry above (the earlier snapshot-table approach is rejected below); the next /sdd-batch run resumes from the block at the end of this entry.

### Open Threads

- **Approach.** One forward config migration `services/xstockstrat-config/migrations/NNN_rekey_inert_seeded_ingest_keys_full_dotted.{up,down}.sql` (NNN re-derived across all remote branches at spec time; 033 or next free, 031/032 are claimed) renames only the 5 named ingest rows from bare to `ingest.<key>`, the literal the readers use. No reader, proto or RPC change; 005 and 025 stay unedited (F-01). Ingest only; the 13 analysis keys (fundsignal.*, scoring.signal_decay_half_life_hours) are an FR-6 sweep finding with a named follow-up feature. UP is a single data-modifying CTE (UPDATE ... RETURNING feeding the config_audit INSERT), skipping rows with a dotted twin (RAISE NOTICE only), so replay adds nothing. DOWN is driven by NNN's own audit trail (changed_by `system:migration-NNN`, reason LIKE 'renamed%'), never touching pre-existing dotted rows. No pg_notify (db-migrator is PRE_DEPLOY; boot reloadAll plus watcher reconnect cover it). FR-4: do not seed the two backfill keys (C-18).
- **Strongest open objection (blocking, 3 items).** (1) Down must be trail-driven, with a fixture proving a pre-existing dotted no-twin row survives; (2) up replay must be a no-op (audit only rows actually renamed, audit count asserted unchanged); (3) a test must derive the key set from the NNN file and compare it to getter literals extracted from watcher.py and mcp_client_loop.py, with the snapshot keyed from the NNN-derived strings. The r3 proposer must show the concrete SQL and fixtures.
- **Non-blocking / operator gates.** Q1 add the 13 analysis keys to scope (default no); Q2 operator-edited ingest rows go live at deploy (production values unread; optional read-only staging get_config pre-check); Q3 seed the two backfill keys (default no); skipped bare-twin policy (keep, record as gate item); sibling assertions script instead of changing shared pass 0 of migration-rerun.sh; align heal semantics with 243's 031, note 244 and 261 collisions; spec-time checks (app.dev.yaml PRE_DEPLOY, no x-multi-statement, secretCallerAuthz.test.ts:38, UI fixtures, trigger double-audit).
- **Floor status.** No Floor breaches.
- **Uncovered @AC changes (none covered by an operator decision).** AC-5, AC-6, AC-7 PRESERVE; feature-182 AC-4 PRESERVE; feature-166 AC-2 FR-2 PRESERVE; features 224/225 AC-35 PRESERVE; analysis fix-fundamentals-signal-producer and fundsignal-watchlist-universe CHANGE only if scope is extended. INGEST-9 and CONFIG-9 CHANGE are covered by operator decision.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "One forward config migration, `services/xstockstrat-config/migrations/NNN_rekey_inert_seeded_ingest_keys_full_dotted.{up,down}.sql` (NNN re-derived across all remote branches at spec time; 033 or next free, since 031/032 are claimed). It renames only the 5 named ingest rows from bare to `ingest.<key>`, the literal the readers use (watcher.py getters, app/engine/mcp_client_loop.py). No reader, proto or RPC change; 005 and 025 stay unedited (F-01). Scope is ingest only. The 13 analysis keys (fundsignal.* from 008, scoring.signal_decay_half_life_hours from 019) are an FR-6 sweep finding with a named follow-up feature, not in Affected Services.\n\nChanges from r2, answering the adversary:\n1. UP is a single data-modifying CTE, so the audit matches exactly what was renamed. `WITH renamed AS (UPDATE config.config_values SET key='ingest.'||key WHERE namespace='ingest' AND key IN (<explicit 5>) AND is_secret=false AND key NOT LIKE 'ingest.%' AND NOT EXISTS (dotted twin, same namespace, environment, COALESCE(user_id,'')) RETURNING ...) INSERT INTO config.config_audit (namespace,key,old_value,new_value,changed_by,reason,environment,user_id,caller_identity) SELECT ...`. changed_by='system:migration-NNN', caller_identity NULL, reason 'renamed <old> -> <new>; edited|default'. Because an audit row is written only for a row actually renamed, a replay matches nothing and adds nothing (feature-182 @AC-4 idempotency). Skipped twins are reported with RAISE NOTICE only, never as audit rows. 029-style guards (029_heal_config_keys_full_dotted.up.sql:24-28) and implicit transaction (029 has no BEGIN/COMMIT) are kept.\n2. DOWN is driven by NNN's own trail. It sets key to the bare form only for rows that are currently dotted, is_secret=false, have no bare twin in scope, AND have a matching `config_audit` row (changed_by='system:migration-NNN', reason LIKE 'renamed%', same namespace/key/environment/COALESCE(user_id,'')). It writes 'reverted' audit rows. A dotted row that existed before NNN, with no renamed audit, is never touched. The 005/025 downs (delete by bare key) stay coherent.\n3. Reader-link test (fails.md:2333/2335/2360). One test takes the NNN up file itself as input: it extracts its enumerated key list and compares that set to the getter key literals extracted by regex/import from services/xstockstrat-ingest/app/config/watcher.py and app/engine/mcp_client_loop.py, with no retyped literals. The ingest unit test then builds the ConfigSnapshot from the key strings extracted from the NNN file, not from a Python `namespace + '.' + key` computation, and asserts the real getters return the seeded and the edited value. A bare-keyed snapshot asserting the code default proves the defect. The seed fixture is a hand-listed bare-key table plus an assertion that each bare key string appears in its 005/025 file (no INSERT-tuple parser).\n4. Harness: do not change the shared pass 0 of scripts/migration-rerun.sh. Add a sibling assertions script (for example scripts/migration-assertions/config-rekey-NNN.sql) run against the fully migrated schema under BEGIN...ROLLBACK. It sets up its own fixtures: bare default row, edited row, per-user row, dotted twin, a pre-existing dotted row with no twin and no audit, and an `ingest.mcp_credential.*` secret row. It runs up, down, up and asserts: the dotted-no-twin row survives down; the audit-row count is unchanged on an up replay; the secret row is byte-identical (key, value_encrypted, user_id) across the cycle; the per-user row keeps its id and value. If a pass-2 replay entry is wanted, add `config:NNN_...` to the replay list (migration-rerun.sh:93-95) and assert the audit count is stable.\n5. No pg_notify (C-18, 029 precedent 029:24-43). The assumption that migrations precede the config restart is confirmed: db-migrator is kind PRE_DEPLOY (.do/app.yaml:662-664), so reloadAll (configServiceImpl.ts:162-163,176-201) sees renamed rows; the watcher reconnects (watcher.py:80-92); per-user overlays are read from the DB per snapshot (configServiceImpl.ts:229-242). Spec must check that .do/app.dev.yaml has the same PRE_DEPLOY setting and drop this from Assumptions.\n6. Skipped dotted-twin policy: keep the bare twin (no data destroyed; no known twins per recon) and record in design.md as an operator gate item that a surviving bare twin stays editable-but-inert in config-ui. Runner-up if the operator objects: delete the bare twin after its value_data is written to the audit row, with the down restoring from audit.\n7. Audit-flag semantics: `edited` = value_data IS DISTINCT FROM default_value. SetConfig inserts never write default_value (configServiceImpl.ts:502-504, nullable per 001), so per-user rows always read 'edited'. State this in the reason text ('edited (or default_value unset)') and in design.md.\n8. Edited-row policy: rename all, flag edited in the audit; all five seeds equal the code defaults (200000, 90, 3, 300, 30), so only operator-edited rows change behaviour. Operator gate confirmation, not a design assumption. Optional hardening: before implementation, a read-only staging get_config of the five keys (reads are permitted; writes are banned) to turn the unknown into a known for staging. Production is not reachable from this session.\n9. FR-4: do not seed ingest.backfill.max_concurrent_jobs or retry_on_failure (C-18). Runner-up is seeding at the code default (int 3, bool true, feature 182 @AC-2), given the Semaphore(0) trap (watcher.py:185-191).\n10. Docs: rewrite INGEST-9 and reconcile the 2026-09-03 findings entry (ingest context-constitution.md:28, findings.md:41); correct CONFIG-9 (config context-constitution.md:26, 'survive only in 023 and 025'); fix ingest CLAUDE.md:124-133, config-governance.md:375-376 and historical-backfill.md:259-261; register `system:migration-NNN` in the Author-sentinel table (config-governance.md:93-103); the FR-6 sweep table goes in design.md. The sweep must cover all namespaces and both snapshot key forms.\n11. Merge-order notes: feature 243's 031 (indicators.sandbox.* heal) must use the same twin-skip, trail-driven down and sentinel semantics, checked explicitly at spec time; 244 edits the same INGEST rules table and reader lines; 261's step references the bare 025 row.",
    "open_objections": [
      {
        "text": "[adversary 1] Down renames rows it does not own. r2's filter (dotted, non-secret, no bare twin) would make a pre-existing dotted row (per-user override or hand-created global) inert, breaking feature-182 @AC-4 reversibility. Required: drive down from NNN's own config_audit trail (changed_by='system:migration-NNN', reason LIKE 'renamed%', joined on namespace/key/environment/COALESCE(user_id,'')); add a fixture with a pre-existing dotted no-twin row that must survive down. The proposer must show the concrete down SQL and fixture.",
        "blocking": true
      },
      {
        "text": "[adversary 2] Re-running up is not a no-op. r2 audited every matched bare row, so skipped twins get a new audit row on each replay. Required: audit only rows actually renamed (UPDATE...RETURNING feeding the audit INSERT in one CTE) and report skipped twins via RAISE NOTICE; assert an unchanged audit count on replay in the harness.",
        "blocking": true
      },
      {
        "text": "[adversary 3] Nothing links the migration output to the reader strings. The r2 ingest test computes namespace+'.'+key itself, restating the fix. Required: one test uses the NNN file's enumerated keys as input and compares them to getter literals extracted from watcher.py and mcp_client_loop.py (no retyped literals); the snapshot is keyed from the NNN-derived strings.",
        "blocking": true
      },
      {
        "text": "Operator gate (Q1): add the 13 analysis keys to scope? Default no (follow-up feature + sweep finding). If yes: product-spec and acceptance.feature need re-review (C-15), analysis joins Affected Services, and recon must be re-run over services/xstockstrat-analysis/acceptance/*.feature (C-16), with the fail-closed edited-row gate from r1. Not blocking while the default holds.",
        "blocking": false
      },
      {
        "text": "Operator gate (Q2): confirm that operator-edited ingest rows go live at deploy, flagged in the audit trail (behaviour flip, production values unread).",
        "blocking": false
      },
      {
        "text": "Operator gate (Q3): FR-4 seed the two unseeded backfill keys or not (default no).",
        "blocking": false
      },
      {
        "text": "Skipped dotted-twin policy: keeping the inert bare twin leaves a row editable in config-ui with no effect (the defect pattern). Record the choice in design.md as a gate item; the runner-up is to delete the twin after saving it to audit.",
        "blocking": false
      },
      {
        "text": "Harness scope creep: do not change migration-rerun.sh pass 0 to a feature-specific goto; use a sibling assertions script under BEGIN...ROLLBACK, or a documented helper, so later config heals (243/244/248) need no further special-casing.",
        "blocking": false
      },
      {
        "text": "Heal-semantics alignment with feature 243's 031 is a merge-order note with an explicit spec-time check, not an Assumption; also note 244 (same reader lines/INGEST rules table) and 261 (references bare 025 row).",
        "blocking": false
      },
      {
        "text": "Spec-time verifications: .do/app.dev.yaml db-migrator is PRE_DEPLOY like app.yaml:662-664; no x-multi-statement anywhere in scripts/; secretCallerAuthz.test.ts:38 is unaffected; services/xstockstrat-ui/e2e/fixtures/configKeys.ts holds no bare ingest keys; the AFTER INSERT trigger (010:27-29) and the BEFORE UPDATE trigger (017:69) do not double-audit (key-only rename fires neither).",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "INGEST-9",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "CONFIG-9",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-6",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-7",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4 (feature-182 readiness-materializer-config-keys.feature: migration idempotent and reversible)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-2 FR-2 (feature-166: ingest.mcp_credential.* secret rows)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-35 (features 224/225: system identity and secret rows)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "analysis fix-fundamentals-signal-producer.feature and fundsignal-watchlist-universe.feature (only if scope is extended)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Make the readers prefix-tolerant (read ingest.X, fall back to bare X): needs no migration or DBA gate, but collides with feature 244's rewrite of the same lines and 261's key strings, pushes dual-key ambiguity onto every future reader, and contradicts the feature-182/184 full-dotted convention.",
      "Change readers to the bare form: same collisions with 244/261 and the platform dotted convention.",
      "Delete the bare row and INSERT a dotted row (let the 010 AFTER INSERT trigger audit): loses row id and updated_at and doubles audit rows on down; UPDATE plus a CTE-written audit trail is better provided down is trail-driven.",
      "Down driven only by a state filter (dotted, no bare twin): renames rows the migration never owned; replaced by the audit-trail-driven down.",
      "Audit every matched row including skipped twins: replays add audit rows and break idempotency; replaced by the audit-only-what-was-renamed CTE.",
      "Include the 13 analysis keys by default: exceeds binding operator scope, C-16 analysis suites unread; remains a gate fork only.",
      "pg_notify in the migration (r1): unneeded because db-migrator is PRE_DEPLOY (.do/app.yaml:662-664), boot reloadAll plus watcher reconnect cover it, and 029 set the precedent; kept only as a fallback if the deploy ordering proves wrong.",
      "Snapshot table config_values_prerekey_NNN: new schema table, DBA entry, re-insert collisions on the scope unique index.",
      "Making config's pass 0 in migration-rerun.sh a derived goto: hard-wires one feature into a shared harness; replaced by a sibling assertions script.",
      "Parsing 005/025 INSERT tuples in the Python test: fragile (trading_mode column, || descriptions, two column orders, cross-service read); replaced by a hand-listed fixture plus an appears-in-file assertion.",
      "Manual production read-and-halt step: no production access; replaced by in-SQL audit flagging and an operator gate confirmation.",
      "Seed ingest.backfill.max_concurrent_jobs and retry_on_failure now: new keys plus an approval gate the defect does not need (C-18); the FR-4 runner-up."
    ],
    "open_risks": [
      "Production values for the five keys are unread: an operator-edited bare row (extreme chunk_max_bars or a 1s poll interval) goes live at deploy; the audit records it only afterwards. Operator must accept at the gate; optional read-only staging get_config pre-check.",
      "Trail-driven down is ambiguous if a user recreates a dotted key by SetConfig between up and down for a key that also has a renamed audit row; mitigated by the no-bare-twin guard and by matching the full scope, but not provably perfect.",
      "A surviving skipped bare twin stays editable but inert in config-ui.",
      "Divergent heal semantics if feature 243's 031 chooses a different twin, down or sentinel convention (two consecutive heals become C-18 duplication).",
      "Merge-order collisions with 244 (same reader lines and INGEST rules table), 261 (bare 025 reference), 248.",
      "Replay and pass-2 behaviour in scripts/migration-rerun.sh must be proven by CI; the 224/225 passes should be untouched by the sibling-script approach.",
      "Deploy ordering confirmed for .do/app.yaml only; app.dev.yaml unverified.",
      "The sweep may reveal other-namespace inert seeds (analysis 13 known); these stay findings unless the operator extends scope."
    ],
    "constitution_rules_touched": [
      "C-03",
      "C-08",
      "C-10(c)",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-01",
      "P-03",
      "P-04",
      "INGEST-9",
      "CONFIG-9",
      "PLAT-N1"
    ],
    "rationale": "The r2 shape (re-key seeds, ingest only, explicit list, skip twins, no notify) stands and no Floor is breached. The three blocking adversary objections are valid and r2 did not concretely answer them, so they stay open and blocking, each with a prescribed concrete fix for the r3 proposer: trail-driven down, renamed-only audit via one CTE, and a test that derives the key set from the NNN file and compares it to extracted reader literals. Non-blocking items are adopted as design decisions or gate items: sibling assertions script instead of changing shared pass 0, simpler seed fixture, secret row byte-identity, audit-flag semantics, twin-policy gate item, 243 alignment as a merge-order note, and deploy ordering confirmed from .do/app.yaml. Operator gates (analysis scope, edited rows going live, FR-4) stay with defaults and are not design blockers."
  },
  "floor_breaches": []
}
```

## Session 2026-10-23 — sdd-batch design gate (round 3)

### Open Threads

Synthesis (round 3, gate policy halt; design.md not written, status.md unchanged):

- Approach: one forward config migration (NNN re-derived across all remote branches at spec time; 033 or next free, 031/032 are claimed) re-keys the 5 ingest seeds (005/025) and 13 analysis seeds (008 fundsignal.* x12, 019 scoring.signal_decay_half_life_hours) from bare to `<namespace>.<key>`, the literal the readers use. Explicit (namespace, bare_key) targets list; one data-modifying CTE renames non-secret rows and audits only renamed rows (replay is a no-op, feature-182 @AC-4). No pg_notify (db-migrator is PRE_DEPLOY in both app specs). No reader, proto or RPC change; 005/008/019/025 stay unedited (F-01). indicators.sandbox.* stays with 243.
- Binding changes for round 4 (adversary answers): DOWN orders by config_audit.id DESC, never changed_at; UP and DOWN audit rows keyed by the dotted key so a post-DOWN operator-created dotted row survives a second DOWN; twin policy switches to preserve-in-audit then DELETE the bare twin (DOWN restores from audit; RAISE EXCEPTION fail-loud is the operator alternative); DOWN limited to targets, is_secret=false and migration-owned audit rows; per-key per-environment read-back verification (18 keys, at least 36 global rows plus per-user rows, never a count); reader-link tests per service plus a loop-level AC-1 test plus a sibling BEGIN...ROLLBACK assertions script; verdicts for the bare decay-key mock fixtures and a widened C-16 PRESERVE list (feature-161 decay suites); pre-deploy gate (e) reads all 18 keys and halts on any non-default value (P-04 artifact in this file before main promotion); FR-4 seeds nothing (C-18).
- Strongest open objection: B3, the twin policy. Keeping a bare twin leaves the editable inert seeded row FR-3 forbids and diverges from feature 243 (ledger fails.md:2970-2978); the proposer must show concrete preserve-then-delete SQL and a twin-restoring DOWN fixture. B1 (DOWN ordering), B2 (audit-key symmetry) and B4 (bare literals in mock fixtures, C-16 list) are also blocking with prescribed fixes.
- Floor status: no breach (floor_breaches empty).
- Uncovered @AC changes: INGEST-9 and CONFIG-9 CHANGE are covered by the operator decision. All other touched scenarios are PRESERVE and need no sanction (AC-5/AC-6/AC-7 of 277, feature-182 @AC-4, feature-166 AC-2 FR-2 secrets untouched, features 224/225 AC-35, analysis fundsignal feature files, private-by-default-templates.feature:64, config and ui surface-signal-weight-decay-config.feature). Nothing uncovered.

```sdd-batch-design-state
{
  "round": 3,
  "synth": {
    "approach": "One forward config migration, services/xstockstrat-config/migrations/NNN_rekey_inert_seeded_keys_full_dotted.{up,down}.sql (NNN re-derived across all remote branches at spec time; 033 or next free, since 031/032 are claimed). It re-keys the 5 ingest seeds (005/025) and the 13 analysis seeds (008 fundsignal.* x12, 019 scoring.signal_decay_half_life_hours) from bare to <namespace>.<key>, the literal the readers use. Scope is per the 2026-10-23 operator decision. Every analysis key was verified against its raw-lookup reader (analysis app/config/watcher.py getters; fundsignal_loop.py, live_loop.py:162, handlers/servicer.py:4879,5213), so all 13 are re-keyed. No reader, proto or RPC change. 005/008/019/025 stay unedited (F-01). indicators.sandbox.* stays with 243. Dead seeds (analysis backtest.max_duration_seconds, ledger stream.notify_enabled) and the unseeded analysis.fundsignal.retry_seconds / startup_jitter_seconds are report-only findings.\n\nUP: an explicit (namespace, bare_key) targets VALUES list (single source for the tests), then one data-modifying CTE. renamed = UPDATE config.config_values SET key = namespace||'.'||key for non-secret rows with no dotted twin in the same namespace/environment/COALESCE(user_id,'') (029 guard shape, 029_heal_config_keys_full_dotted.up.sql:24-28), RETURNING feeding an INSERT into config.config_audit (changed_by='system:migration-NNN'). Only renamed rows are audited, so a replay is a no-op (feature-182 @AC-4). No pg_notify: db-migrator is PRE_DEPLOY in .do/app.yaml:662-664 and .do/app.dev.yaml:664-666, so config reload-on-restart covers it.\n\nChanges required from the r3 proposal (answers to the adversary, binding on r4):\n1. DOWN ordering: config_audit.changed_at is NOW() (001:34), a transaction-start time, so same-transaction rows tie (ledger fails.md:3078). DISTINCT ON must order by config_audit.id DESC (BIGSERIAL, 001:27), never by timestamp.\n2. Audit-row key symmetry: both the UP 'renamed' row and the DOWN 'reverted' row are keyed by the DOTTED key (or by config_values row id), so they fall in one DISTINCT ON group. The assertions script adds the case: DOWN, then operator create_key of the dotted key, then second DOWN must NOT strip it.\n3. Twin policy: adopt the runner-up, matching feature 243 and ledger fails.md:2970-2978. Write the bare twin's value_data/old_value to a config_audit row (reason 'twin-removed; value preserved'), DELETE the bare twin, then rename. The DOWN restores the twin from that audit row. This removes the inert-but-editable row that FR-3 says must end, drops the RAISE NOTICE block (and its duplicated twin predicate), and keeps 031 and 033 consistent. The proposer must show the concrete SQL and a twin-restoring DOWN fixture. Alternative if the operator prefers fail-loud: RAISE EXCEPTION when a twin's value differs. That is an operator gate item.\n4. DOWN also stays joined to the targets list, is_secret=false, and 'owned' by the migration's audit trail, so pre-existing dotted rows are never touched.\n5. Verification is per-key, per-environment read-back of the stored key against the getter string, never a count. 18 is the key count; rows are at least 36 globals plus per-user rows (008:13-47; same for 005/019/025).\n6. Tests: (a) reader-link test per service (ingest, analysis) takes the NNN up file's targets as input and matches quoted full key literals across all of app/** (no file or call-shape anchor, tolerant of line-split literals, excluding event/table names like analysis.fundsignal.run_started and analysis.fundsignal_emitted), asserting target set is a subset of the literal set. It builds the ConfigSnapshot from NNN-derived strings with non-default values and asserts the real getters return them. A bare-keyed control snapshot returns code defaults, proving the defect by unit test and not by a staging write. (b) A loop-level AC-1 assertion (MCP loop 5 s timeout via _FakeCfgWatcher / tests/test_mcp_client_loop.py:122). (c) Sibling script scripts/migration-assertions/config-rekey-NNN.sql under BEGIN...ROLLBACK (up, down, up) with fixtures: bare default, edited, per-user decay, twin, pre-existing dotted no-twin, ingest.mcp_credential.* secret. Assertions: dotted-no-twin survives DOWN; replay leaves audit count unchanged; secret byte-identical; per-user row keeps id and value; twin restored by DOWN; no double-prefixed key. Shared pass 0 of migration-rerun.sh is unchanged. The test must fail, not skip, if the migration file is unreachable. Coordinate with 244, which moves literals into helpers.\n7. C-16/C-01 completeness: give each bare decay-key mock fixture a verdict (keep as stripped-probe coverage or move to dotted): config/src/__tests__/listKeysWire.test.ts:44,88,104,113,123; configServiceImpl.test.ts:45; setConfigScalarBounds.test.ts:30; ui e2e/config-ui/audit.spec.ts:25. Add to the PRESERVE list: config acceptance/surface-signal-weight-decay-config.feature @AC-7 (settable without create_key, so the existence gate must resolve the renamed row), @AC-11, @AC-12 @feature-161; ui acceptance/surface-signal-weight-decay-config.feature @AC-6 @feature-161 (bounds 0-8760 still served on ListKeys). The bounds registry needs no change (it probes the bare key first, configServiceImpl.ts:96-101). Its stale 'decay' comment is a findings entry.\n8. Pre-deploy gate (e): read all 18 keys (staging via read-only get_config; production by the operator) and HALT if any value differs from its code default, especially fundsignal.enabled (a bare true would switch the producer on). Record who/when/each value in context.md as a P-04 artifact before the main promotion. Do not run any staging/production write during speccing.\n9. FR-4: do not seed ingest.backfill.max_concurrent_jobs / retry_on_failure (C-18). Runner-up: seed at int 3 / bool true (watcher.py:185-191 Semaphore(0) trap).\n10. Spec text: widen description in product-spec.md and acceptance.feature; add xstockstrat-analysis to Affected Services; add FR-1b plus AC-8 Scenario Outline over the 13 analysis keys; AC-3 staging/production only plus per-user and twin examples (twin now deleted-and-preserved); AC-4 both namespaces. Docs to fix: INGEST-9 and the 2026-09-03 findings entry (ingest context-constitution.md:28, findings:41), CONFIG-9 (:26), ingest CLAUDE.md:124-133, config-governance.md:375-376, historical-backfill.md:259-261. Register system:migration-NNN in the Author-sentinel table (config-governance.md:93-103). The design.md sweep table covers all namespaces, both snapshot key forms, and the analysis verdicts plus the two unseeded fundsignal keys.\n11. Coordination: 243's 031 uses the same twin-skip/delete, id-ordered trail down and sentinel semantics (explicit spec-time check); 244 (reader literals/INGEST rules table); 261 (its step references the bare 025 mcp_client.request_timeout_seconds row, re-check against the dotted form); 248.",
    "open_objections": [
      {
        "text": "[adversary B1] DOWN DISTINCT ON must order by config_audit.id DESC (001:27), not changed_at (NOW() ties within one transaction, 001:34; fails.md:3078). Proposer must show the concrete DOWN SQL and an up/down/up fixture within one BEGIN...ROLLBACK.",
        "blocking": true
      },
      {
        "text": "[adversary B2] 'renamed' and 'reverted' audit rows must be keyed by the same (dotted) key or row id; otherwise a post-DOWN operator-created dotted row is stripped by a second DOWN. Proposer must add this fixture case and the SQL.",
        "blocking": true
      },
      {
        "text": "[adversary B3] Twin policy 'keep bare twin' leaves the FR-3 defect (editable inert seeded row) and diverges from feature 243 (fails.md:2970-2978). Not yet answered concretely: proposer must switch to preserve-in-audit then delete the bare twin (down restores it from audit), or justify the alternative RAISE EXCEPTION fail-loud, with SQL and fixture. Operator gate item.",
        "blocking": true
      },
      {
        "text": "[adversary B4] The 'no bare literal outside migrations' claim is false. Bare scoring.signal_decay_half_life_hours appears in config listKeysWire.test.ts, configServiceImpl.test.ts, setConfigScalarBounds.test.ts and ui e2e/config-ui/audit.spec.ts. Each needs a verdict, and the C-16 PRESERVE list must add the config and ui surface-signal-weight-decay-config.feature scenarios (@AC-7/@AC-11/@AC-12, ui @AC-6).",
        "blocking": true
      },
      {
        "text": "Row-count misstatement: 'exactly 18 rows' is wrong (18 keys; at least 36 global rows plus per-user). Verification must be per-key per-env read-back, never a count.",
        "blocking": false
      },
      {
        "text": "Reader-link regex fragility: match quoted full key literals across app/** (no file or call anchor); exclude event/table names (fundsignal_loop.py:186,192,212,244); handle the line-split literal at :149; must survive feature 244's helper refactor regardless of merge order.",
        "blocking": false
      },
      {
        "text": "AC-1 lacks a behavioural test: add a loop-level assertion (MCP loop uses 5 s timeout) via _FakeCfgWatcher or a real-watcher test.",
        "blocking": false
      },
      {
        "text": "C-18: audit-driven DOWN depends on free-text reason LIKE matching. Prefer a structured marker (changed_by plus a fixed reason prefix) or the premigration snapshot-table alternative (new schema object, DBA entry); proposer to justify the choice.",
        "blocking": false
      },
      {
        "text": "Production read-and-halt is the only guard on fundsignal.enabled: record the read as a P-04 gate artifact in context.md before the main promotion.",
        "blocking": false
      },
      {
        "text": "261 seam (bare 025 mcp_client.request_timeout_seconds reference) and the 243 031 twin/down alignment are unaddressed; add as explicit coordination checks.",
        "blocking": false
      },
      {
        "text": "Spec-time verifications remain: no x-multi-statement in scripts/; secretCallerAuthz.test.ts:38 unaffected; ui e2e/fixtures/configKeys.ts holds no bare ingest or fundsignal keys; analysis ConfigWatcher snapshot fixture exists. Already verified and dropped from Assumptions: audit column names and changed_at (001:26-35, 017:27-28,71); a key-only UPDATE writes no audit row (017:69,76); PRE_DEPLOY in both app specs.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "INGEST-9",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "CONFIG-9",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-5 (feature 277)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-6 (feature 277)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-7 (feature 277)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4 feature-182 readiness-materializer-config-keys.feature (idempotent and reversible)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-2 FR-2 feature-166 (ingest.mcp_credential.* secret rows untouched)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-35 features 224/225 (system identity and secret rows)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "analysis fix-fundamentals-signal-producer.feature (lines 13,38,42,57) and fundsignal-watchlist-universe.feature (lines 9-73): scenarios already state the dotted keys",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "private-by-default-templates.feature:64 (analysis.fundsignal.scoring_formula_id)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "config surface-signal-weight-decay-config.feature @AC-7, @AC-11, @AC-12 @feature-161",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "ui surface-signal-weight-decay-config.feature @AC-6 @feature-161 (bounds 0-8760 on ListKeys)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Make readers prefix-tolerant or change readers to the bare form: collides with 244 and 261 and the full-dotted convention, and pushes dual-key ambiguity onto all readers.",
      "Two migrations (one per namespace): duplicates CTE and down logic (C-18); one targets list is the single source for the reader-link tests.",
      "Blanket per-namespace UPDATE: would capture ingest.mcp_credential.* secrets, dead seeds and indicators.sandbox.* (243).",
      "Keep the bare twin (r3 twin policy): leaves an editable inert seeded row (FR-3 defect) and conflicts with 243's recorded fix, so replaced by preserve-in-audit then delete.",
      "DOWN ordering by audit changed_at: ties inside one transaction (NOW() is transaction start, fails.md:3078); replaced by id DESC.",
      "pg_notify in the migration: unneeded since db-migrator is PRE_DEPLOY in both app specs.",
      "Delete the bare row and INSERT a dotted one: loses id and updated_at and double-audits via the 010 AFTER INSERT trigger.",
      "Changing shared pass 0 of migration-rerun.sh: hard-wires one feature into a shared harness; a sibling assertions script is used instead.",
      "Seeding ingest.backfill.max_concurrent_jobs / retry_on_failure: new keys the defect does not need (C-18); runner-up only.",
      "Premigration snapshot table config_values_premigration_NNN: deterministic but adds a schema object and DBA entry; kept as a fallback if the audit-trail DOWN cannot be made unambiguous.",
      "Reader-link regex anchored to get_*( calls in named files: breaks when 244 refactors literals into helpers."
    ],
    "open_risks": [
      "Production values for all 18 keys are unread: a bare fundsignal.enabled=true or extreme chunk_max_bars / poll interval goes live when config restarts after the migration. The mitigation is the operator read-and-halt gate, which depends on a human doing it.",
      "Deleting twins discards their live value except in the audit row; the DOWN restore from audit must be proven by the fixture.",
      "Audit-trail-driven DOWN remains ambiguous if the audit reason convention is loose; structured markers and id ordering are required.",
      "Divergent heal semantics versus 243's 031 would make two consecutive heals C-18 duplication.",
      "Merge-order collisions with 244 (reader literals, INGEST rules table), 261 (bare 025 reference) and 248.",
      "Reader-link tests read the config migrations dir from a service test run and may be unreachable in Docker-only contexts; they must fail loudly rather than skip.",
      "Bounds-registry comment naming decay as a namespace-stripped example becomes stale; tracked as a findings entry.",
      "Analysis ConfigWatcher snapshot fixture comparable to ingest's is not yet traced.",
      "The sweep may reveal other inert seeds outside scope; these stay report-only findings."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-03",
      "C-08",
      "C-10(c)",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-01",
      "P-03",
      "P-04",
      "INGEST-9",
      "CONFIG-9",
      "PLAT-N1"
    ],
    "rationale": "No Floor breach: the seeds are untouched, nothing is hardcoded, and no path is invented. The r3 shape (one migration, explicit 18-key list, CTE-audited renames, no pg_notify, PRE_DEPLOY ordering confirmed in both app specs) holds, and the adversary's four blocking objections are valid. The DISTINCT ON ordering and the audit-key symmetry are concrete and cheap to fix, and the proposal did not answer either. The twin policy contradicts FR-3 and the recorded 243 fix, so it stays blocking with a prescribed switch. The 'no bare literal' claim is demonstrably false (mock fixtures), and the C-16 list lacks the feature-161 decay suites, so both stay open. Non-blocking items (row-count wording, regex robustness, AC-1 loop test, C-18 simplicity, P-04 gate artifact, 261 and 243 coordination) are adopted as binding spec-time requirements. Operator-decision coverage is limited to the INGEST-9 and CONFIG-9 rewrites. Every other touched scenario is PRESERVE and needs no sanction."
  },
  "floor_breaches": []
}
```

## Session 2026-10-23 — sdd-batch design gate (round 4)

### Open Threads

Synthesis (round 4, gate policy halt; design.md not written, status.md unchanged):

- Approach: one forward config migration (number re-derived across all remote branches at spec time; 033 or next free, 031/032 are claimed) re-keys 18 bare seeds to the exact string each reader uses: 5 ingest keys (005, 025), 12 analysis fundsignal.* keys (008) and analysis scoring.signal_decay_half_life_hours (019). No reader, proto or RPC change; migrations 005/008/019/025 stay unedited (F-01). The r4 UP SQL is adopted as-is (enumerated targets VALUES list, value_type RAISE guard, single-statement CTE with disjoint DELETE-twin and UPDATE-rename rows, is_secret=false and NOT LIKE guards, operator twin policy of preserve-then-delete-bare, rename in place keeping row id, no pg_notify, FR-4 seeds nothing).
- Required changes for r5: (1) DOWN is driven by a migration-owned log table config.rekey_033_log holding full rows (renamed / twin_removed), created in UP per the config_values_premigration_017 precedent and 243's snapshot-first rule; config_audit rows are visibility-only, tagged caller_identity='migration-033', and the twin-removed row is keyed by the BARE key; (2) the assertions harness gets a dedicated config goto-032 pass with fixtures-pre-033.sql (using \ir), because migration-rerun.sh:86 migrates to head before assertions run; shared pass 0 is untouched; (3) product-spec/acceptance widen before /sdd-spec (FR-1b for the 13 analysis keys, new analysis-reader @ACs, loop-level ingest AC-1 test, drop 'dev' from AC-3, analysis added to Affected Services, re-run /sdd-review product-spec); (4) the pre-deploy gate becomes an explicit step plus an AC, run before the merge to main-dev (staging db-migrator is PRE_DEPLOY) and again before promotion to main: read-only listing of edited non-default rows and differing bare/dotted twin pairs with per-row operator sign-off, recorded as a P-04 artifact.
- Strongest open objection: B2/B1 pair, DOWN reversibility. Audit-table replay contradicts the snapshot-first heal rule (fails.md:2970-2978, insights.md:1215-1217) and 243's mechanism, and the assertions harness would never exercise the rename path because fixtures become twins after migrate-to-head. B3 (spec widening) and B4 (gate on the wrong merge) are equally blocking but are process fixes, not design forks.
- Floor status: no breach (floor_breaches empty); F-01 and F-04 hold.
- Uncovered @AC changes: INGEST-9 CHANGE, CONFIG-9 CHANGE and the new analysis-reader AC-8 EXTEND are covered by the operator decision. AC-3 (drop 'dev', a correction) is NOT covered and needs review. All other touched scenarios (277 AC-5/6/7, feature-182 AC-4, feature-166 AC-2 FR-2, features 224/225 AC-35, analysis fundsignal feature files, private-by-default-templates:64, feature-161 decay suites) are PRESERVE and need no sanction.
- Non-blocking items adopted as binding spec requirements: RAISE NOTICE with skipped-scope count in DOWN; name the dirty-state recovery for the UP RAISE in PRE_DEPLOY (correct the row, then force 32); document that a concurrent SetConfig create_key fails the migration dirty rather than corrupting; add the system:migration-033 sentinel to config-governance.md:93-103; record analysis.backtest.max_duration_seconds doc drift (analysis CLAUDE.md:468) in the FR-6 sweep; coordinate with 243 (031), 244, 261 and 248; keep/edit the test literals as listed in the state block.

```sdd-batch-design-state
{
  "round": 4,
  "synth": {
    "approach": "One forward config migration, services/xstockstrat-config/migrations/033_rekey_inert_seeded_keys_full_dotted.{up,down}.sql (number re-derived across all remote branches at spec time, since 031/032 are claimed). It re-keys 18 bare seeds to the exact string each reader uses: 5 ingest keys (005, 025), 12 analysis fundsignal.* keys (008_analysis_fundsignal_keys.up.sql:13-47) and analysis scoring.signal_decay_half_life_hours (019:11,17). No reader, proto or RPC change. Migrations 005/008/019/025 stay unedited (F-01). Adopt from r4 as-is: the enumerated targets VALUES list (identical in UP, DOWN and assertions, cross-checked); the UP value_type RAISE guard; the single-statement CTE (DELETE twins and UPDATE-rename on disjoint rows, so the 017:101-102 unique index cannot collide); is_secret=false and NOT LIKE guards (029:26-27); the operator twin policy (preserve bare twin in audit/log, delete bare, dotted twin wins); rename in place keeping row id; no pg_notify (db-migrator is PRE_DEPLOY); FR-4 seeds nothing.\n\nChanges required for r5 (resolve the adversary's four blockers):\n1. DOWN source of truth becomes a migration-owned snapshot/remediation log table config.rekey_033_log (full rows: namespace, key, bare_key, environment, user_id, value_type, value_data, description, default_value, consuming_service, updated_by, updated_at, action in {renamed, twin_removed}), created in UP, precedent config_values_premigration_017 (017:31-33), matching 243's snapshot-first rule (fails.md:2970-2978, insights.md:1215-1217). DOWN restores exact rows from the log (exact value_type, description, updated_at; no reason-vocabulary parsing, no DISTINCT ON replay, no targets-derived value_type workaround) and marks entries restored so DOWN-after-DOWN and the B2 operator-dotted-row case are trivial. config_audit rows are kept only for human visibility, tagged caller_identity='migration-033' (column exists on both tables, 014_config_caller_identity.up.sql:9,12). The twin-removed audit row is keyed by the BARE key (the row actually removed), not the dotted key. The log table is dropped by a later cleanup, not by DOWN, or DOWN drops it only after a successful full restore (spec decides; state it).\n2. Assertions harness fix: scripts/migration-rerun.sh:86 runs db-migrate.sh up before migration-assertions/*.sql (:183-190), so real seed rows are already dotted and bare fixtures would become twins (AC-3 rename path never exercised, DOWN1 would also replay real markers). Add a config pass that migrates to 032 (goto, like analysis goto 25 at :75), loads fixtures-pre-033.sql, runs up/rerun/down/rerun/up/operator-insert/down inside the script, then restores to head; use \\ir not \\i. Do not change shared pass 0. Keep fixtures F1-F7 including per-user F3/F5 and the secret F7.\n3. Product-spec/acceptance widening is a gate item before /sdd-spec: add FR-1b for the 13 analysis keys, new @AC rows for the analysis readers (fundsignal_loop.py:136-232, servicer.py:4879,5213) and a loop-level ingest AC-1 test, drop 'dev' from AC-3 (017:41 CHECK rejects it), add analysis to Affected Services, and re-run /sdd-review product-spec.\n4. Pre-deploy gate becomes an explicit step AND an AC, and runs before the merge to main-dev (staging deploys on main-dev push via db-migrator PRE_DEPLOY, .do/app.yaml:662-664), then again before promotion to main: a read-only check on each environment listing every edited non-default row of the 18 keys and every bare/dotted twin pair whose values differ, with operator sign-off per row (analysis.fundsignal.enabled=true would start the system-identity producer). Where the operator wants current behaviour preserved, apply 029's per-row precedent (029:30-43). Record as a P-04 artifact. No data/config change on staging or production during speccing.\n\nNon-blocking items adopted as binding spec requirements: RAISE NOTICE with skipped-scope count in DOWN (ON CONFLICT DO NOTHING / NOT EXISTS skips); name the dirty-state recovery for the RAISE in PRE_DEPLOY (correct the row, then force 32); document that a concurrent SetConfig create_key fails the migration (dirty) rather than corrupting (insights.md:1220-1222); add the system:migration-033 sentinel to docs/patterns/config-governance.md:93-103; add the analysis.backtest.max_duration_seconds doc drift (analysis CLAUDE.md:468, no reader in app/) to the FR-6 sweep findings; keep config_values_premigration-style naming consistent with 243; coordinate with 243 (031), 244 (reader rewrite, zero-trap test), 261 (request_timeout_seconds string) and 248.\n\nTest literals: KEEP configServiceImpl.test.ts:45, listKeysWire.test.ts:44,88-123, setConfigScalarBounds.test.ts:30 (plus one dotted-key sibling case), ui e2e/config-ui/audit.spec.ts:25 (historical audit row); edit the stale decay example in the comment at configServiceImpl.ts:98. Reader-link tests (tests/test_config_watcher.py:56, tests/test_mcp_client_loop.py:122, analysis tests/test_analysis_servicer.py:4724) must fail loudly when unreachable and survive 244's helper refactor (assert on the snapshot built from the seeds, not on a regex over source). Docs to update: INGEST-9, 2026-09-03 findings entry, CONFIG-9, ingest CLAUDE.md, config-governance.md:375-376.",
    "open_objections": [
      {
        "text": "[adversary B1, r4] Assertion harness ordering: migration-rerun.sh:86 migrates to head before migration-assertions/*.sql (:183-190), so bare fixtures become twins, the AC-3 rename path is never exercised, and DOWN1 replays real pass-1 markers. Proposal must add a goto-032 pass with fixtures-pre-033.sql (or in-transaction deletion of dotted real rows) and use \\ir. Unanswered by r4.",
        "blocking": true
      },
      {
        "text": "[adversary B2, r4] DOWN replays config_audit (free-text-ish reason vocabulary, DISTINCT ON, value_type-from-targets, loses description/updated_at), contradicting the snapshot-first heal rule (fails.md:2970-2978, insights.md:1215-1217) and 243's mechanism (C-18). Replace with migration-owned config.rekey_033_log restoring full rows; keep audit for visibility only. Unanswered by r4.",
        "blocking": true
      },
      {
        "text": "[adversary B3, r4] Scope grew to 13 analysis keys but product-spec FRs/ACs did not: add FR-1b, analysis-reader @ACs (fundsignal_loop.py:136-232, servicer.py:4879,5213), drop 'dev' from AC-3, re-review product-spec (C-15/P-04).",
        "blocking": true
      },
      {
        "text": "[adversary B4, r4] Read-and-halt gate is only an Assumption and guards the wrong merge: staging db-migrator is PRE_DEPLOY on main-dev push (.do/app.yaml:662-664). Make it an explicit step plus AC before the main-dev merge, listing edited non-default rows and differing twin pairs with operator sign-off per row (P-03/C-15).",
        "blocking": true
      },
      {
        "text": "twin-removed audit row keyed by the dotted key with new_value NULL reads as deletion of the live dotted key in config-ui; key it by the bare key.",
        "blocking": false
      },
      {
        "text": "UP RAISE leaves golang-migrate dirty inside PRE_DEPLOY, blocking every service deploy; spec must name recovery (force 32 after correcting the row) and the gate must make it unreachable.",
        "blocking": false
      },
      {
        "text": "DOWN skips scopes silently (ON CONFLICT DO NOTHING / NOT EXISTS); emit RAISE NOTICE with skipped count (P-03).",
        "blocking": false
      },
      {
        "text": "Docs: add system:migration-033 to the author-sentinel table (config-governance.md:93-103); record analysis.backtest.max_duration_seconds documented-but-unread drift (analysis CLAUDE.md:468) in the FR-6 sweep.",
        "blocking": false
      },
      {
        "text": "243 alignment (031 twin/down/log convention) and 261 request_timeout_seconds seam unverified on their branches; coordination check required at spec time.",
        "blocking": false
      },
      {
        "text": "Spec-time verifications remain: no x-multi-statement flag in scripts/ (DO block plus CTE is two statements), secretCallerAuthz.test.ts:38, ui e2e/fixtures/configKeys.ts:97, analysis ConfigWatcher snapshot fixture.",
        "blocking": false
      },
      {
        "text": "Production values for the 18 keys unread; P-04 artifact required before promotion to main.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "INGEST-9",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "CONFIG-9",
        "kind": "CHANGE",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-8 (feature 277, new: analysis fundsignal.* and decay readers see seeded values)",
        "kind": "EXTEND",
        "covered_by_operator_decision": true
      },
      {
        "ac_id": "AC-3 (feature 277, drop 'dev' environment example)",
        "kind": "CHANGE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-5 (feature 277)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-6 (feature 277)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-7 (feature 277)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-4 @feature-182 readiness-materializer-config-keys.feature (idempotent and reversible)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-2 FR-2 feature-166 (ingest.mcp_credential.* secret rows untouched)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "AC-35 @feature-224 and 225 (per-user scope, system identity, secret rows)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "analysis fix-fundamentals-signal-producer.feature (lines 13,38,42,57) and fundsignal-watchlist-universe.feature (lines 9-73)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "private-by-default-templates.feature:64 (analysis.fundsignal.scoring_formula_id)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "config surface-signal-weight-decay-config.feature @AC-7, @AC-11, @AC-12 @feature-161",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "ui surface-signal-weight-decay-config.feature @AC-6 @feature-161 (bounds 0-8760 on ListKeys)",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Make readers prefix-tolerant or change readers to the bare form: collides with 244's reader rewrite and 261's key string, touches feature-173 surfaces",
      "Two migrations (one per namespace): no benefit, doubles number allocation and harness passes",
      "Blanket per-namespace heal (029 shape) for analysis: would re-key dead backtest.max_duration_seconds and obsolete signals.source_weights; enumerated targets win",
      "Keep the bare twin (r3 policy): leaves the FR-3 defect and diverges from 243; superseded by operator twin policy",
      "Audit-table replay for DOWN (r4 DISTINCT ON over config_audit with four-word reason vocabulary): couples reversibility to an operator-visible table, needs value_type workaround, loses description/updated_at, diverges from 243's snapshot rule",
      "DOWN ordering by config_audit changed_at: ties inside one transaction; id (BIGSERIAL) would be required if audit replay were kept",
      "Forward-only DOWN (SELECT 1): breaks @AC-4 @feature-182 reversibility unless operator waives it",
      "pg_notify in the migration: db-migrator is PRE_DEPLOY and services reload on restart",
      "Delete the bare row and INSERT a dotted one: loses row id, description, updated_at",
      "Changing shared pass 0 of migration-rerun.sh: blast radius across all services; use a dedicated config goto-032 pass",
      "Seeding ingest.backfill.max_concurrent_jobs / retry_on_failure: code defaults apply (watcher.py:185-191) and it would collide with 244's zero-trap test",
      "Reader-link regex anchored to get_*( calls in named files: fragile under 244 refactor; assert on a snapshot built from the seeds instead"
    ],
    "open_risks": [
      "Production values for all 18 keys are unread: an edited bare analysis.fundsignal.enabled=true, or extreme chunk_max_bars / poll interval, goes live after the migration; mitigation is the explicit pre-main-dev and pre-main gate with per-row operator sign-off.",
      "Deleting twins discards their live value except in the log/audit row; the bare=5/dotted=30 case silently keeps 30; gate must list differing twin pairs.",
      "UP RAISE on value_type mismatch leaves migrate state dirty in PRE_DEPLOY and blocks all service deploys; recovery must be documented.",
      "Divergent heal semantics versus 243's 031 would be C-18 duplication; align on snapshot-log convention.",
      "Merge-order collisions with 244, 261 and 248 (migration number, reader strings).",
      "Assertion harness extension (goto 032 pass) must not disturb other services' passes; reader-link tests may be unreachable in Docker-only contexts and must fail loudly.",
      "Concurrent SetConfig create_key during the migration makes it fail dirty rather than corrupt.",
      "Analysis ConfigWatcher snapshot fixture and caller_identity on config_values not yet traced in code (adversary cites 014:9,12).",
      "Sweep may reveal further inert seeds outside scope (report-only); indicators.sandbox.* stays with 243."
    ],
    "constitution_rules_touched": [
      "C-01",
      "C-03",
      "C-05",
      "C-08",
      "C-10(c)",
      "C-11",
      "C-13",
      "C-15",
      "C-16",
      "C-18",
      "F-01",
      "P-03",
      "P-04",
      "INGEST-9",
      "CONFIG-9",
      "PLAT-N1"
    ],
    "rationale": "No Floor breach: F-01 holds (005/008/019/025 untouched, new migration), F-04 paths verified by the adversary. The r4 SQL for UP is sound and adopted, but four adversary blockers are not answered by the proposal and stay open: the assertions harness runs after migrate-to-head so its fixtures take the twin path (B1); DOWN via audit replay contradicts the recorded snapshot-first heal rule and 243's mechanism and should use a migration-owned log table (B2); the widened analysis scope has no FR/AC and AC-3 still lists 'dev' (B3); the read-and-halt gate is only an assumption and sits on the wrong merge, since main-dev push deploys staging via PRE_DEPLOY (B4). The log-table change also makes the twin-removed audit-key and DOWN skip-notice items cheap, so they are folded in as binding spec requirements. Business-rule impact: INGEST-9 and CONFIG-9 changes are sanctioned by the 2026-10-23 scope decision and the sweep instruction; the new analysis AC is an EXTEND under the same decision; AC-3 'dev' removal is a correction not covered by an operator decision and must be reviewed."
  },
  "floor_breaches": []
}
```
