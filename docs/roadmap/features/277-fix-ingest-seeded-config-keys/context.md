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
