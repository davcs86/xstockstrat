# Context: config-dead-rows-prune  (archived 2026-11-10)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-11-10 — /sdd-archiver

**What**: Shipped config migration `046_config_dead_rows_prune` (up and down). It deletes 4 operator-signed global rows covering 2 keys: `analysis/opportunity.sparkline_bars` and `marketdata/alpaca.paper`, each in staging and production. The ledger key `stream.notify_enabled` was kept. Its baseline entry was re-owned to 306, which later deleted both the key and the entry. The feature also shipped:
- a log-evidence evaluator for "dead" verdicts;
- deletion of indicators' `config_allow296` tool;
- removal of the leftover `sparkline_bars` bounds entry.

All live verification ran against one database, DO dev staging. The design had planned for four, but the other three have no running instance.

**Why (irrecoverable rationale)**:
- **Why runtime log evidence was required at all.** The static extractor has known blind spots, so "no static reader" alone was not enough to call a row dead. Both spellings were queried, because 304 flipped consumer literals from prefixed to relative mid-window.
- **Why `platform/log_level` was out of scope.** A UI reader exists, so it can never be proven dead (306 later deleted it by operator decision).
- **One top-level CTE statement, no `LOCK TABLE`.** 044's lock-retry RAISE can exhaust and leave config dirty. Inside one statement, the DELETE re-checks each row's hash at lock time, which gives the same snapshot guarantee. A concurrently updated row is reported unmatched, never raised (F-01).
- **Nothing in content or actor names the migration number.** The actor is `system:config-migration-feature-305`. A merge-time renumber then only renames 3 files and regenerates the stored JSON, and both the block sha and the P2 file sha survive.
- **The marker INSERT is gated on the latch too.** `config_markers.name` is the PK, so an ungated insert would raise on the AC-6 replay.
- **The explicit audit CTE does not double-write.** DELETE fires no audit trigger; only BEFORE UPDATE and AFTER INSERT triggers exist.
- **The down selects rows carefully.** It uses `DISTINCT ON … ORDER BY snapshot_at ASC`, keyed on report rows with `run_at = marker.set_at`. `config_values_premigration_296` also holds 296's rename images, which keep the same ids and prefixed keys. Selecting by `id` or by a time window would restore 296's rows.
- **The permanent test checks the evidence's FROZEN subscriber set, not live `registry.receivers`.** A live check would go red on unrelated PRs and push people to edit a merged signed block (an F-01 trap). The frozen == live comparison ran once at P1, and its output was pasted into `signoff.md`.
- **The test asserts each signed sha equals its `inventory-fresh.jsonl` row.** That keeps 296's unscoped `unmatched-signed-tuple` count (`config-044.sql`) at 0 on CI, so 296's assertion did not need editing.
- **The evaluator functions are exported, but `run()` never calls them, and `membership()` is unchanged.**
  - If `run()` called them, they could suppress a `seeded-unread` finding (278 @AC-2/7/8, 295 @AC-19).
  - Narrowing the `305|306` regex would rewrite gate-7 and baseline-3 for no behaviour gain.
- **The kept ledger entry went to `feature 306`.**
  - Not to a defect report: `OWNER_RE` allows a report owner, but `SWEEP_277` baseline-3 then goes red and `membership()` stops checking the entry.
  - Not left as `feature 305`: a launched feature would then own an entry nobody settles.

**Rejected alternatives**:
- **044-style lock retry loop:** lock exhaustion leaves config dirty.
- **Natural idempotence (`NOT EXISTS` on prior report rows) instead of a latch:** dedupes per tuple, makes down→up semantics fuzzy, and rewrites the report on every replay.
- **An irreversible down that RAISEs (044.down style):** FR-1/AC-6 require a down that restores.
- **Line-level Loki export with per-line timestamps:** the operator chose metric queries instead, because the template pieces were unverified and entry limits apply.
- **A per-service "≥1 hit" positive control:** lost to the `keys=` cross-check. A key dropped for a service that has other hits would slip past it.
- **A permanent frozen == live subscriber test:** goes red on unrelated PRs.
- **Local Docker/Timescale verification and step-branch pushes:** the sdd-execute HARD CONSTRAINTS forbid them. CI on the integration PR is the live check.
- **A new CI sign-off check:** `dead 2`, the file-sha pin, the draft-PR rule and operator commits were judged enough (C-18).
- **Partial-resolution notes written into defect-report bodies:** report bodies are point-in-time.
- **Deleting `ledger/stream.notify_enabled`:** the operator declined the C-16 CHANGE of 304 @AC-12 Then #3, so the earlier signed CHANGE of 295 @AC-15 went unused.

**Scars & gotchas**:
- **`dormantAlias.test.ts` assumed a single marker writer.** It counted every migration containing `INSERT INTO config.config_markers`, so 305's latch row failed it (331/332). The regex was narrowed to `('relative_keys_v1'`; both assertions are unchanged. The operator approved ("Narrow the test").
- **`migration-rerun.sh` hard-coded `R1` at the final version check,** which breaks for any config migration above R+1. 305 replaced it with `cfg_top` and slug-glob discovery. 280 must not re-pin `R1` (306 merged as 047 without doing so).
- **Loki streams cannot tell staging deployments apart.** They carry only `deployment_environment` and `service_name` (plus `service_instance_id` for Python), so DO dev cannot be separated from a homelab staging deployment. Pre-check (e) was only partial.
- **Go and Python log the read signals differently.**
  - Go emits `ns`/`key`/`keys` as structured metadata with a bare message body.
  - Python puts `config.read_* ns=… key=…` in the body.
  
  So each signal needs two disjoint query families. Analysis restarted about 17 times in the 66 h window, so coverage is the union across instances.
- **Absence of evidence was backed by controls.** Sibling keys (`alpaca.feed`, `opportunity.refresh_hour_utc`) came back `kept:read-hit`, which proves the parse works. A free-text search over 538k lines found no mention of either key. Blind spot: the `keys=` control cannot catch a key logged under an unexpected namespace.
- **The signed block shas came from committed inventories, not a fresh live read.** The inventories are from 2026-09 (staging) and 2026-11-07 (fresh). A drifted value would only have surfaced in the P2 rehearsal; P2 confirmed 4 deleted, 0 unmatched.
- **DO dev's `alpaca.paper` staging row has `value_type string` and no description,** unlike the `bool` seed. Only the sha is compared.
- **The first P2 attempt went to `defaultdb`** (never migrated). It failed harmlessly and was rolled back. The real target is `xstockstrat-staging` on `:25060`.
- **SQL verified offline with `pglast` when a DB was forbidden.** Both migration files, the `config-046.sql` DO bodies, the pass-2d heredoc, and every SQL string the harness builds were parsed with `pglast` (the real PostgreSQL grammar). CI on the integration PR was the live check.
- **Latent trap on fresh databases.** There, the seed rows (001/002/028) hash to the signed shas, so 046 deletes them too. 184 @AC-1 holds only because no test applies all migrations and then asserts the opportunity seed rows; a future test that does will go red.
- **Rollback asymmetry.** A `sparkline_bars` row restored by the down has no bounds entry, because S4 removed it. Harmless: nothing reads the key.
- **`canonical()` ADDS the `<ns>.` prefix.** Normalisation compares canonical forms. Recon's first draft said "strip".

**Permanent deviations**:
- **P2 rehearsal scope.**
  - Design: the rolled-back rehearsal runs on DO dev, DO prod and both homelabs, expecting 4/0 on each.
  - Shipped: DO dev only.
  - Because: DO production and the homelabs have no running instance (operator, 2026-11-10).
  - The `production` tuples are production-environment rows inside the DO dev staging DB and the CI fresh DB, not a separate database. P3 likewise runs on whatever DBs exist.
- **Sign-off authorship.**
  - Design: the operator personally authors the P1/P2 commits, since FR-4 checks consistency but not authenticity.
  - Shipped: the agent wrote the `signoff.md` section and recorded the P2 output.
  - Because: the operator said "You have my sign off" and told the agent to write it. The attestation is the operator's, recorded in the section's `Authorship` bullet and flagged to PR reviewers.
- **Blast-radius tests.**
  - Design: these tests run but are not edited, and no config-service test is in Files.
  - Shipped: the `dormantAlias.test.ts` regex was narrowed.
  - Because: the test's real intent is "one migration activates the `relative_keys_v1` alias".
- **Evidence loader.**
  - Design: the loader throws on a "wrong header".
  - Shipped: a TSV with no header line (fixed at spec time).
- **Config CLAUDE.md banner.**
  - Design: edit the `services/xstockstrat-config/CLAUDE.md` line-3 banner.
  - Shipped: untouched.
  - Because: its `SCALAR_BOUNDS_REGISTRY guarding unread values` clause tracks the still-open `signal_decay_half_life_hours` bounds finding.
- **Signed shas.**
  - Design: re-confirm the signed shas against live data.
  - Shipped: inventory-derived shas, with no live re-probe. The P2 rehearsal served as the check.

**Cross-feature signal**:
- **305, 306 and 280 compete for the config migration number,** and share `migration-rerun.sh` and the gate files. A soft row in `merge-order.md` records this, and 305 had to merge before 306's FR-6.
- **`config.config_markers` was treated as single-writer** by a test from an earlier feature (fails.md 2026-11-10 test-blast-radius entry).
- **304 merged mid-design** and added a durable scenario that recon missed (fails.md, 2026-11-09 entry).

**Deferred follow-ons**:
- **306 (done)** deleted `ledger/stream.notify_enabled` and its entry. 306's context says the owner flip happened in "305's step S2"; it actually landed in Step 4.
- **Unowned cleanup:** the `305|306` branches in `membership()` (`scripts/check-config-wiring.mjs`) and baseline-3 now match nothing.
- **P3 post-launch probe** (checklist; nothing records that it ran):
  - the marker is present, with `set_by` = actor;
  - 0 live global rows for the 4 tuples;
  - 0 per-user rows for the 2 keys;
  - 0 `feature 305:%` unmatched rows.
- **Defect reports closed in substance but still `open`,** awaiting `/sdd-triage`:
  - `2026-10-19-dead-config-keys` (the alpaca.paper and sparkline items);
  - `opportunity-sparkline-removal-residue`.
- **Open operator question:** confirm which deployment `deployment_environment="staging"` maps to in Loki.

**Ledger entries written**: insights.md (3), fails.md (1) — see the 2026-11-10 entries. Existing entries were skipped as duplicates: fails.md 2026-11-09 recon and 2026-11-10 test-blast-radius. Their evidence resolves via `git show 2d91b5671335fcce267679b50caa494440205f51:<path>`.

**Runtime-invariant recommendations (→ /context-constitution)**:
- **PLAT (observability).**
  - Loki streams carry only the `deployment_environment` and `service_name` labels (plus `service_instance_id` for Python).
  - Go config-watch logs put `ns`/`key`/`keys` in structured metadata, while Python/Node put them in the body. LogQL needs two query families.
- **CONFIG.**
  - DELETE on `config.config_values` fires no audit trigger.
  - `config_values_premigration_296` is a shared snapshot table, so restores must key on report `run_at`.
  - A global `SetConfig` on a missing key without `create_key=true` returns NOT_FOUND.
- **Platform DB topology (a changeable fact; operator to confirm before treating it as an invariant).** As of 2026-11-10 only DO dev staging (`xstockstrat-staging` on `:25060`) runs.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 2d91b5671335fcce267679b50caa494440205f51.

## Retained verbatim records

Operator decisions and C-16 sign-offs copied verbatim from the pre-archive session log, because durable suites and later features cite "<NNN> context.md" as their provenance. Headings are demoted one level.

#### Operator decisions at design round-2 gate (AskUserQuestion, 2026-11-09)

- **Evidence form**: metric queries (aggregated coverage per (service, ns) per 6 h bin + one instant read-hit query for the 3 keys, both spellings), not the line-level export.
- **C-16 CHANGE sign-off — GRANTED**: ledger `fix-config-keys-drift.feature` 295 @AC-15 Then #1 ("still exists") and the suite Feature description sentence ("…without deleting dead rows") are superseded by feature 305; expressed as a supersession header comment (no `@superseded-by-*` tag convention); Thens #2/#3 (read-key/read-coverage logging) PRESERVED; 184 @AC-1 and 296 @AC-21 stay PRESERVE. Operator: davcs86 (AskUserQuestion answer) — 2026-11-09.
- **Spec amendments GRANTED** (P-03): FR-3 third argument = frozen subscriber set; FR-4 evidence is metric-form and carries subscriber rows; AC-10 Then reworded to the supersession header; AC-3 uses short name `notify`. IDs unchanged (C-15).
- **Design gate**: operator chose *Run round 3* (not approve). Round-2 adversary changes to carry: P2 = rolled-back rehearsal of the exact final file on DO dev/prod/both homelabs + file sha; pass 2d applies 305 down/up files by direct psql (no 306/280 downs) + propose (not write) a 305↔306↔280 merge-order row; probe asserts marker present / 0 live rows for the 5 tuples / 0 per-user rows for the 3 keys (SetConfig is an upsert, so the "waits and finds row gone" claim is wrong); S4 bounds test red-first (SetConfig of 10000 reaches INSERT); new append-only 305 entry in config-governance (not edits of :290/:395/:528); partially-resolved notes on the 3 open defect reports; indicators coverage measured in the FR-6 step; pin details (marker lines in the block, `snapshot_at DESC`, no `-- Migration: NNN` header, one asserted replay, assertion/test file rename on renumber); S2 verification path (CI-only harness; blocked-until-sha rather than red branches).

#### Operator decisions at design round-3 gate (AskUserQuestion, 2026-11-09)

- **Second C-16 CHANGE (304 @AC-12 Then #3 + binding comment (c)) — NOT signed off.** Consequence (re-scope): the `ledger` / `stream.notify_enabled` tuple is dropped from the signed set → **4 tuples, 2 keys** (`analysis` / `opportunity.sparkline_bars` staging+production; `marketdata` / `alpaca.paper` staging+production). No ledger durable scenario changes. The earlier grant for 295 @AC-15 / suite description (design round-2 gate) is therefore **unused** (the CHANGE does not happen); no supersession header is written. FR-7 / AC-1 / AC-3 / AC-5 / AC-6 / AC-7 / AC-8 / AC-10 / Problem Statement / Affected Services / Consumer Surface / Config Key Changes rewritten accordingly.
- **Spec amendments GRANTED**: FR-1 (global rows only; snapshot = DELETE…RETURNING in one statement; per-user rows probed, never deleted) and FR-4 (superset read-hit export; frozen subscriber set limited to receivers on signed namespaces; per-(service, ns) positive control for watch/list subscribers, ui exempt).
- **Positive control chosen**: `keys=` cross-check — distinct canonical read-hit keys ≥ `keys=N` of that pair's last coverage line in the window.
- **Design gate**: operator chose *Run round 4*.
- **Open for the next gate**: who owns the surviving `seeded-unread` baseline entry for `ledger` / `stream.notify_enabled` (currently `feature 305`, which would never close it). Recommended: re-own to `feature 306` (precedent: `trading` / `risk.daily_loss_limit`, "documented future key; deletion is a product decision"); needs a one-line edit of 306's product spec and the baseline owner string. Not done unilaterally.
- Adversary round-3 mechanical amendments adopted for design.md (no operator decision needed): O-2 offline S2 verification (hand-derived stored JSON + `storedInputsSha256`, no local DB, no step branches; integration-PR CI is the live check); O-3 marker INSERT gated on the latch; O-6 down `ORDER BY snapshot_at ASC`; O-7 W0 on a 6 h UTC boundary and a `service_name=~` restriction; O-8 P3 = post-launch checklist item, integration PR draft until the file-sha is pinned; O-9 `config-NNN.sql` counts scoped to the current marker's run_at; O-10 name the seed migrations (alpaca.paper 001/002, sparkline_bars 028); O-5 `baseline 2` non-empty assertion hazard (`config-wiring.test.mjs:593`) when 306 also empties the baseline — in S2 Files, and in the proposed 305↔306↔280 merge-order row (NOT written).

#### Step 3 — P1 operator sign-off (Loki evidence, signed block, sign-off section) [done]
- Operator decisions (2026-11-10, davcs86): keep all 4 tuples (both keys, `staging` and `production` environment rows — parity between environments); DO production and homelab databases are out of scope (no running instance), verification/rehearsal on DO dev only; "You have my sign off" — the operator authorised the agent to write the `# Feature 305 — dead-row sign-off` section of `scripts/config-heal/signoff.md` on their behalf. Recorded in the section itself (`Authorship` bullet). The attestation is the operator's; the file was written by the agent at that instruction, so the "operator personally authors this commit" intent of FR-4 is met by explicit in-session sign-off, not by operator-typed text (flagged for the integration PR reviewers).
- Artifacts: `scripts/config-heal/dead-row-evidence.tsv` (sha256 `daf034070fbb1bc66d7bd834ac4306b240e355ff5fb1401b112015935624cae6`), `scripts/config-heal/dead-rows-signed.sql` (block sha256 `fbdf4714617e6225f947f8cccdfed9f52e5c4e5c857ff255f9e896c9369ea481`), `signoff.md` section with the labelled bullets Step 6 reads. Verification: 4 tuples; both signed keys `dead`; evidence/block shas recomputed and equal the section's bullets; subscriber-equality proof pasted.
- Not done (accepted): no fresh live read of the DO dev database — shas are from `inventory-fresh.jsonl` / `inventory-staging.jsonl` (both agree); a drifted value surfaces in the Step 13 rehearsal as `unmatched-signed-tuple`.
- Files modified: `scripts/config-heal/dead-row-evidence.tsv`, `scripts/config-heal/dead-rows-signed.sql`, `scripts/config-heal/signoff.md`
- Deviations: Step 13 and P3 narrowed to DO dev (see Deviation Log at Step 13 time); sign-off authored by the agent under explicit operator instruction.

_From: Session 2026-11-09 — sdd-review product-spec_

  - [ ] AC-10: ledger @AC-15 supersession is a **C-16 CHANGE needing operator sign-off**; check the `@superseded-by-*` tag convention and record sign-off here.

_From: Session 2026-11-09 — sdd-design (in progress)_

- Round 1 synthesis (proposer → adversary, no Floor breach): shape accepted (latched signed delete, no data-dependent RAISE, one atomic step for migration + baseline + stored regen + FR-4 test, `membership()` unchanged). Carried into round 2: (1) FR-4 test must evaluate the *frozen* subscriber set committed with the evidence, not live `registry.receivers`; (2) down must mirror `041_*.down.sql` (report-row keyed, `updated_by`/`update_reason` set, explicit conflict target) instead of a time-window heuristic; (3) assert the down in `migration-rerun.sh`; (4) post-deploy probe of `config_keys_report_296` on every DB, result in `signoff.md`; (5) drop the table lock (single-statement delete+snapshot) so lock exhaustion cannot leave config dirty; (6) number-independent actor so a merge-time renumber does not edit content; (7) pin LogQL + environment selector; (8) halt rule for any `kept:*` verdict; (9) operator authors the sign-off commit; (10) C-16 tag convention for the ledger @AC-15 split; (11) production sha256s are already in committed inventories (proposer's "strongest risk" retired).
