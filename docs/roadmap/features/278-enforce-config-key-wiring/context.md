# Context: enforce-config-key-wiring

**Feature**: `docs/roadmap/features/278-enforce-config-key-wiring/feature.md`
**Product Spec**: `docs/roadmap/features/278-enforce-config-key-wiring/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/278-enforce-config-key-wiring/implementation-spec.md`

---

## Session 2026-10-23 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from the operator's request.
- **Origin:** the operator demoted `277-fix-ingest-seeded-config-keys` at its round-4 design gate and asked for a follow-up that enforces, in the execution/validation loop, that every new config key is actually implemented as planned.
- **Consumer surface (C-14):** None (internal tooling and process). Stated in the product spec.
- **Evidence to reuse:** 277's recon.md and context.md (the sweep: 5 ingest and 13 analysis keys seeded bare but read dotted, `indicators.sandbox.*` owned by 243, dead seeds `analysis backtest.max_duration_seconds` and `ledger stream.notify_enabled`, unseeded `ingest.backfill.max_concurrent_jobs` and `retry_on_failure`). The CI baseline in FR-4 is that list.
- **Open for review:** the five questions in the product spec, especially which form (migration column vs live snapshot) the check treats as authoritative.

## Session 2026-10-23 — sdd-story (follow-up)

- The operator marked the ingest seeded-key defect report `wont-fix` (ref `feature:277-fix-ingest-seeded-config-keys`). The 18 known findings therefore have no open owner: they live only in 277's `context.md`, and FR-4's baseline entries must name 277 (or 278) as the owning feature, not a defect report.

## Session 2026-10-23 — sdd-review product-spec (FAIL)

- Verdict FAIL on criterion 9 (five unresolved Open Questions). Overlap WARN only (`264-fix-portfolio-snapshot-surface` also appends to `docs/patterns/config-governance.md`; keep 278's edit to the rule section).
- Resolutions recorded in product-spec.md: check is a `scripts/` script covering Go/Python/TS, runtime-built keys reported as `dynamic-read` (new finding kind in FR-1, @AC-9); stored form = live snapshot key `values[row.key]`, never normalized; baseline (not fix-first), contents = 277's full sweep (18 form mismatches plus dead seeds, unseeded keys, `indicators.sandbox.*` owned by 243), each entry owned by 277/278/243; 243/244/261 interaction deferred to /sdd-design with constraints; ledger traps adopted as constraints.
- Warnings addressed: baseline count wording fixed (18 is the form-mismatch subset only); added @AC-10 (migration trigger for FR-2) and @AC-11 (snapshot-built test for FR-3); scenario key names are illustrative (comment in acceptance.feature); the bare seeded form in @AC-1 is a finding kind, not a C-05 breach by this spec.
- Operator decisions (binding, 2026-10-23): created as follow-up when 277 was demoted; run full speccing (review, recon, full design debate, spec, impl-spec review). x-trace-id standing rule (2026-10-21) applies. Repo tooling only: no runtime service, proto, migration or config key change; check must work across Go/Python/TS, survive 244's refactor, and state how runtime-built keys are treated. No staging/production writes.

## Session 2026-10-23 — sdd-review product-spec (PASS WITH WARNINGS)

- Product spec approved. Status: draft → spec-ready.
- Warnings (resolved in the spec): AC-10 `Then` rewritten as an observable outcome (step stays not-done, output names the check result) with a finding added to its `Given`; AC-9 `Given` now names a concrete expression (`f"analysis.{name}.enabled"`, `name` a function parameter); FR-1 split into the four named finding kinds; FR-2 states where a feature declares a key (product-spec `Config Key Changes` or a migration step), exact source pinned at design; approval-gate boxes struck (none apply).
- Warnings (carried to design): four Open Questions are deferred to `/sdd-design` (reader discovery mechanism, 243/244/261 ordering, exact baseline count; AC-7 needs the final count); Affected Services lists paths, not registry names (NOTE-level deviation, no runtime service).
- Overlap findings (WARN, rebase-only): `docs/patterns/config-governance.md` is also edited by 264, 243, 244, 248, 241, 249 (keep 278's edit to the rule section). Live dependency: 278's baseline must keep the `indicators.sandbox.*` entries owned by 243 until 243's migration `031_heal_indicators_sandbox_keys_full_dotted` lands. Incidental, not 278: migration 032 is claimed twice in config (244 and 248). `ci.yml`, `.claude/skills/*`, `scripts/` have no collisions. No merge-order entry required.

OPERATOR DECISIONS (binding, recorded 2026-10-23):
- Operator 2026-10-23: created as the follow-up when 277-fix-ingest-seeded-config-keys was demoted; run the full speccing (review, recon, full design debate, spec, impl-spec review). The feature dir lives on the base branch ccr-fac38b1f-6m24q2 (PR #1322, not yet merged to main-dev).
- Operator 2026-10-21 (standing, all features): x-trace-id must be propagated as much as possible; no C-03 waiver — request-derived emits/writes use context.WithoutCancel(ctx) (Go) / the inbound metadata (Python/Node), never a fresh background context; only work with no originating request (background sweepers/loops) may mint its own context, and it should still carry a trace id when one is available.
- Evidence base: feature 277's recon.md and context.md (the sweep of 18 inert bare-seeded keys, the dead seeds analysis backtest.max_duration_seconds and ledger stream.notify_enabled, the unseeded ingest.backfill.max_concurrent_jobs/retry_on_failure, indicators.sandbox.* owned by feature 243) on branch feature/fix-ingest-seeded-config-keys and in the base branch; the ingest defect report was closed wont-fix by the operator, so FR-4's baseline entries must name feature 277/278 as owner. Read 277's design state (rounds 1-4, the binding amendments) for what a faithful check must prove: stored key read back against the reader string, not just counted (fails.md:2335).
- This feature is repo tooling and process only: no runtime service, proto, migration or config key change; it must not change any reader or seed. The check has to work across Go, Python and TypeScript readers and survive feature 244's refactor that moves reader literals into helpers, and it must say how keys built at runtime are treated. Do not run any staging or production read or write during speccing beyond read-only get_config if needed.

## Session 2026-10-23 — sdd-batch design gate (round 2)

Status unchanged (`spec-ready`); design.md NOT written. The /sdd-design full debate halted at its approval gate after round 2 (gate policy: halt). Severity: n/a.

## Open Threads

- **Approach (round-3 best):** zero-dependency Node script `scripts/check-config-wiring.mjs` plus `scripts/config-wiring.json` (`findings` and `registry` sections), a `node --test` suite with fixtures, CI job `config-wiring` wired into `ci-gate`, a Phase 3 execute gate, a B2 review row, a sdd-story template pin, and an appended section in `docs/patterns/config-governance.md`. Changes applied this round: (1) per-environment join keyed `(namespace, key, environment)` modelling the 017 rename, then collapsed by `(namespace, key, kind)` so @AC-1/@AC-3 still yield one finding, with `env=<e>` only on partial seeding and no fifth kind; (2) parser scope pinned by fixture (`config.config_values` only, `user_id IS NULL`, `*.down.sql` excluded, allow-list keyed on migration file plus statement content hash, 029 heal with exact guards); (3) a single `--final` run at the feature completion gate, step time runs the non-final mode only, B2 third clause dropped; (4) stdlib `ast` for Python, regex for Go/TS, with a zero-target gate on false-dynamic-read entries; (5) an env-baseline decision gate step (first offline pass recorded, read-only `get_config` sample of 2-3 keys, operator rules blocking vs reported-only) before `findings` is frozen; (6) governance section states runtime-created keys show as `read-unseeded` by design; (7) build order and baseline owners (277/278, 'feature 278', 'feature 243').
- **Strongest open objection:** env-baseline inflation. Offline, 001-era keys not re-inserted for production by 002:46-72 appear staging-only (002:7 column default 'dev', 017:38 rename dev to staging), and the offline model cannot see runtime-created rows. Only the impl-spec decision-gate step plus an operator ruling can settle it (non-blocking for design).
- **Other non-blocking objections:** no migration after 017 renames environments again and no other migration trips the fail-closed trigger (002, 005, 025 unchecked); ownership of the four extra unseeded keys set to 'feature 278' (operator may overrule); `reference/sequential-mode.md:112`, `check-duplication.sh` and `.jscpd.json` unverified; env-list ratchet semantics need an explicit validator and fixture.
- **Floor status:** no Floor breaches.
- **Uncovered @AC changes (none covered by an operator decision):** 182:@AC-1 PRESERVE; 278:@AC-1 EXTEND; 278:@AC-3 PRESERVE; 278:@AC-5 PRESERVE; 278:@AC-10 PRESERVE.
- **Rejected:** fifth kind `env-partial`; per-key `--final`; keeping the B2 third clause; per-line Python regex with raw threshold; unioning environments; bash/Python script language; declared per-service registry readers must match; allow-listing 017/029 by shape or NNN; in-code annotations.

```sdd-batch-design-state
{
  "round": 2,
  "synth": {
    "approach": "Round-3 best approach: keep the round-2 design (zero-dependency Node script `scripts/check-config-wiring.mjs`, `scripts/config-wiring.json` with `findings` and `registry` sections, `node --test` suite with fixtures, CI job `config-wiring` wired into `ci-gate` after `.github/workflows/ci.yml:676-692` / `:776-818`, Phase 3 execute gate, B2 review row, sdd-story template pin, appended section in `docs/patterns/config-governance.md`) and apply these changes.\n\n1. Per-environment join with collapse. The stored set is keyed `(namespace, key, environment)` and models the 017 rename (`SET environment='<lit>' WHERE environment='<lit>'` on `config.config_values` only, in NNN order). Findings are then grouped by `(namespace, key, kind)` before output. A key missing from every environment yields one finding with no `env`. `env=<e>` is emitted only when the key is seeded in some environments and absent in others. The two cases are in the spec, and @AC-1 and @AC-3 are each tested for exactly one finding. No fifth kind. The baseline records the env list per entry, and the ratchet compares env lists.\n\n2. Parser scope, one fixture each, pinned in the spec. (a) Rewrite model and fail-closed trigger match `UPDATE config.config_values` only, not `config.config_audit` (017:39). (b) Only `user_id IS NULL` rows enter the stored set (`configServiceImpl.ts:181,207`). (c) `*.down.sql` excluded. (d) Allow-list entries are keyed on migration file plus a content hash of the statement, never on a shape such as `DELETE ... USING ranked`. The 029 heal is modelled with its exact guards (`NOT LIKE ns.'%'`, `is_secret=false`, `namespace IN (...)`, 029:26-28).\n\n3. `--final` runs once, at the feature completion gate (last step done or integration-PR gate), not per key. Step time runs the non-final mode only: `form-mismatch`, `dynamic-read`, unmodelled-rewrite, and declared-key findings that are not missing-side. Missing-side `seeded-unread` and `read-unseeded` for declared keys are PENDING at step time and enforced at completion and in CI. This needs no \"last step touching K\" parsing and no step-body quoting convention, so it works for impl-specs written before 278 (243, 244, 261) and F-09 holds. The B2 third clause (backticked key in the reader step) is dropped. The two-step fixtures (seed then reader, reader then seed) pass at step time and fail under `--final` when a leg is missing.\n\n4. Python extraction: default to stdlib `ast` now (no dependency cost). It resolves multi-line calls (`fundsignal_loop.py:148`) and same-file constants (`tools.py:78,628`, `_ALERT_THRESHOLD_CONFIG_KEY`). Go and TS stay on regex extraction. The O2 threshold is replaced by a gate on false-dynamic-read entries (literal argument, split across lines) in the Go/TS extractors, which should be zero.\n\n5. Env-baseline decision gate. Before freezing `findings`, the impl-spec has a step that (i) runs the first offline pass and records the count and list of `read-unseeded env=` entries in 278's `context.md`; (ii) does a read-only `get_config` on 2-3 sampled 001-era keys in production, which the operator permits and which writes nothing, and records the result. The operator then rules whether env-scoped `read-unseeded` is blocking in CI or reported-only (kept out of the ratchet). Evidence for why the gate is needed: 002:7 back-fills only via the column `DEFAULT 'dev'`, and 017:38 renames dev to staging, so every 001-era key that 002:46-72 does not re-insert for production appears staging-only offline.\n\n6. The governance section states that runtime-created keys (`SetConfig create_key=true`, config-ui) are invisible to the migration-derived stored set and show as `read-unseeded` by design, with the remedy to seed them in a migration. It also states the dynamic-read, forwarder and registry rules.\n\n7. Build order: parser + fixtures, ast and regex reader extraction + join with collapse, first real run (fills `findings`, records counts, runs the env decision gate), CI job + `ci-gate`, skills (execute Phase 3 completion-gate mirror in `reference/sequential-mode.md`, B2 row with two clauses, story template), governance doc, `scripts/check-context-map.sh`. Baseline owners: the 18 inert keys and the dead seeds name feature 277/278; the four extra unseeded keys and unresolved gaps are owned by 'feature 278'; indicators.sandbox.* by 'feature 243'. Output is `file:key:kind[:env]` lines, never values.",
    "open_objections": [
      {
        "text": "Env-baseline inflation: whether production genuinely lacks rows for 001-era keys, or the offline model is blind to rows created at runtime (SetConfig create_key=true, config-ui), cannot be decided offline. Resolved only by the impl-spec decision-gate step (first-run list, read-only get_config sample of 2-3 keys, operator ruling blocking vs reported-only) before the baseline is frozen.",
        "blocking": false
      },
      {
        "text": "Assumption unverified: no migration after 017 renames environments again, and no other migration trips the fail-closed rewrite trigger (002, 005, 025 unchecked). The first run tests this; any new shape is added to the closed list with a fixture rather than weakening the trigger.",
        "blocking": false
      },
      {
        "text": "Ownership of the four extra unseeded keys (backfill.max_retry_attempts, signals.dedup_window_hours, fundsignal.retry_seconds, fundsignal.startup_jitter_seconds) is set to 'feature 278'. Operator may overrule; the choice is recorded in context.md.",
        "blocking": false
      },
      {
        "text": "Unread inputs: reference/sequential-mode.md:112 (gate mirror location) and the contents of check-duplication.sh and .jscpd.json were not verified; the impl-spec must confirm them before citing line numbers.",
        "blocking": false
      },
      {
        "text": "Env-list ratchet semantics (one baseline entry covers several environments; a fix in one environment must shrink the entry rather than leave it stale) need an explicit validator and fixture in the spec.",
        "blocking": false
      }
    ],
    "floor_breaches": [],
    "business_rule_changes": [
      {
        "ac_id": "182:@AC-1",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "278:@AC-1",
        "kind": "EXTEND",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "278:@AC-3",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "278:@AC-5",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      },
      {
        "ac_id": "278:@AC-10",
        "kind": "PRESERVE",
        "covered_by_operator_decision": false
      }
    ],
    "rejected_alternatives": [
      "Fifth finding kind `env-partial`: goes beyond the product spec's four kinds and forces an AC amendment; replaced by `env=` as a field on the existing kinds.",
      "Per-key `--final` at 'last step touching K': depends on the reader step quoting the key, which impl-specs already written (243, 244, 261) cannot satisfy and F-09 forbids editing; a seed step could look last and block with no unblock path. Replaced by a single completion-gate `--final`.",
      "Keeping the B2 third clause (reader step must quote the backticked stored key): dropped because the completion-gate design no longer parses step bodies.",
      "Per-line regex extraction for Python with a raw 20-entry dynamic-read threshold: measures parser weakness (multi-line calls) not real dynamic reads; replaced by stdlib `ast` for Python.",
      "Dropping the environment axis and unioning environments: silently confirms keys seeded only in staging that are inert in production.",
      "Bash or Python as the script language: Node already runs `node --test` in CI (`ci.yml:723-724`) and bash 3.2 cannot parse multi-language sources.",
      "Declared per-service key registry that readers must match: a second source of truth that can claim wiring that does not exist (fails.md:2335 class).",
      "Allow-listing migration 017 or 029 by statement shape or by NNN alone: a later non-key-neutral dedupe DELETE would pass unreviewed; replaced by file plus statement content hash.",
      "In-code annotations naming dynamic key sets or forwarders: violates the no-reader-edit constraint; the registry lives in `config-wiring.json`."
    ],
    "open_risks": [
      "Env-scoped read-unseeded findings may inflate the baseline and make the ratchet noisy; mitigated by the decision-gate step and an operator ruling (blocking vs reported-only) before the baseline freezes.",
      "Go and TS regex extraction still mis-resolves cross-file constants, aliased watchers and 244's helper refactor; these surface as dynamic-read and are managed via same-service imported-constant resolution and registry.forwarders keyed `file:symbol`.",
      "Ratchet couples 243, 244, 261 and any key-fixing feature to editing `scripts/config-wiring.json`; ordering against PR #1322 (base branch ccr-fac38b1f-6m24q2 not yet merged) and merge-order drift.",
      "Completion-gate `--final` finds a missing reader or seed at the last step rather than mid-feature, so a wrong-side defect can survive several steps; step-time form-mismatch and dynamic-read checks bound this.",
      "Offline stored set cannot see runtime-created rows, so production reality may differ from the model; documented as by-design and sampled once read-only.",
      "Unverified: sequential-mode.md:112, check-duplication.sh, .jscpd.json, and migrations other than 002/017/029 against the rewrite trigger.",
      "The x-trace-id operator rule does not apply: the check makes no requests and performs no staging or production writes; the single read-only get_config sample is the only environment access."
    ],
    "constitution_rules_touched": [
      "C-11",
      "C-15",
      "C-16",
      "C-18",
      "F-08",
      "F-09",
      "P-03",
      "C-14 (precedent for advisory FAIL row)",
      "C-03 (not applicable: no requests)"
    ],
    "rationale": "The adversary found no Floor breach but two correct blockers, and the proposal's own env-baseline risk was confirmed by the migrations (002 default 'dev', 017 rename). First, a per-environment join emitting one finding per environment contradicts @AC-1/@AC-3 'one finding'; grouping by (ns, key, kind) and emitting env only on partial seeding keeps the acceptance wording intact and adds no kind. Second, per-key `--final` relies on step-body quoting that already-written impl-specs cannot satisfy and F-09 forbids fixing, which could create an unblockable step; a single completion-gate `--final` removes the dependency and the B2 clause. Adopting stdlib `ast` for Python removes the arbitrary threshold and the multi-line misclassification at no dependency cost. The parser-scope items (config_values-only table filter, user_id IS NULL, exclude down.sql, hash-keyed allow-list with exact 029 guards) are pinned as fixtures. The one question that cannot be settled offline, whether production really lacks rows, becomes an explicit impl-spec decision gate with a permitted read-only sample and an operator ruling, so nothing is guessed. Remaining objections are non-blocking and carried into the spec as steps."
  },
  "floor_breaches": []
}
```

## Session 2026-10-23 — sdd-design

- Phase 0 Recon: wrote recon.md (services: none at runtime, tooling only: scripts/, ci.yml, sdd-execute, sdd-review, config-governance.md; key reuse patterns: migration-contract-gate job shape, node --test precedent).
- Phase 1 Grilling: 2 rounds (full), operator approval at the round-2 gate. Chosen approach: zero-dependency Node `scripts/check-config-wiring.mjs` + `scripts/config-wiring.json` (findings, registry), per-environment join collapsed by (ns, key, kind), stdlib ast for Python and regex for Go/TS, non-final mode at step time and a single `--final` at the completion gate and in CI, CI job `config-wiring` in ci-gate. Rejected: env-partial kind, per-key --final, B2 third clause, regex-only Python, env union, registry-as-truth, shape-keyed allow-list, in-code annotations.
- Constitution rules touched: C-11, C-15, C-16, C-18, F-08, F-09, P-03 (C-14 precedent, C-03 n/a). Floor breaches: none.
- Business rules: PRESERVE 182:@AC-1, 278:@AC-3/@AC-5/@AC-10; EXTEND 278:@AC-1; no CHANGE.
- Status: spec-ready → design-approved.

### Open Threads (from design.md Open Risks)

- Env-baseline decision gate: OPERATOR step in the impl-spec (first-run `read-unseeded env=` list, read-only production `get_config` on 2-3 sampled 001-era keys, operator rules blocking vs reported-only) before `findings` freezes; CI must not depend on it until ruled.
- First-run step must test: no migration after 017 renames environments; 002/005/025 do not trip the fail-closed trigger (add shapes with fixtures, never weaken).
- Ownership of backfill.max_retry_attempts, signals.dedup_window_hours, fundsignal.retry_seconds, fundsignal.startup_jitter_seconds set to "feature 278"; operator may overrule (record here).
- /sdd-spec must verify sequential-mode.md:112, check-duplication.sh and .jscpd.json before citing lines.
- Env-list ratchet validator + fixture (entry shrinks when one environment is fixed).
- Go/TS regex mis-resolution (cross-file constants, aliased watchers, 244 helpers) handled via same-service constant resolution and registry.forwarders `file:symbol`; gate on false-dynamic-read = 0.
- Ratchet couples 243, 244, 261 to editing config-wiring.json; ordering vs PR #1322 and merge-order.md.
- Accepted: --final finds missing legs only at completion; runtime-created rows invisible offline (documented by design).


## Session 2026-10-23 — sdd-spec

- Generated implementation-spec.md with 18 steps. Status → implementation-ready.
- Key codebase findings:
  - Seed side: 002 re-inserts production rows only for platform, trading (4 approval/risk keys), indicators, marketdata, portfolio, analysis; `ledger stream.notify_enabled` and `trading fill_poller.interval_ms` are staging-only offline. They are the sampled keys in the Step 10 operator gate. Migrations are 000-030 with no 024; only 001, 009, 010, 016, 017, 020, 029 contain UPDATE/DELETE.
  - `get_config` takes only `namespace` (+ `user_id`) and reads its own deployment's environment, so the production sample must be run by the operator against the production-deployed agent; the staging session cannot.
  - `reference/sequential-mode.md:112` (design's gate-mirror cite) is inside §5.5b checkpoints; the correct mirror anchors are §5.5 (`:80-93`) and §5.6 (`:145`). `.jscpd.json` / `check-duplication.sh` are threshold-only, no per-entry owner baseline, so the owner ratchet is built new.
  - Config-wiring tests live in `scripts/config-wiring.test.mjs` (not under `workflow-tests/`, which the `context-map` job globs), run by the new `config-wiring` CI job.
- Decisions: `policy.envReadUnseeded` defaults to `reported` in `scripts/config-wiring.json` until the operator rules at Step 10, so CI never depends on the ruling; Step 13 (CI job) is ordered after Step 11/12.
- Open Threads carried into steps: env-baseline gate (10), unmodelled-rewrite shapes check (9), extras ownership "feature 278" (11), env-list ratchet (7/8), forwarders/dynamic registry (3/11), merge-order coupling with 243/244/261 and PR #1322 (18).

## Session 2026-10-23 — sdd-review impl-spec

Verdict: PASS WITH WARNINGS (no FAIL). Overlap: WARN (file-level only; no key/proto/migration collision owned by 278).

### Addressed (implementation-spec.md)

- B2 Files: Steps 2, 4, 6, 8 now enumerate fixture files/directories.
- Step ordering: Step Dependencies now states how red is manufactured for Steps 12 and 17 (scratch root from Step 7 empty shape; pre-Step-14 skill text via git show) rather than renumbering.
- Verification dependency on `config-wiring.test.mjs` (created in Step 2): stated that paired test steps run first.
- Step 11 retyped `config` -> `docs`.
- Step 13 scan-root/filter-root equality: instruction added, plus Step 12 test (5).
- Step 18 context-map: resolved at spec time to no edit (map registers only workflow helpers); removed from Files.
- Step 9: added re-run instruction if 243/244/248/264 migrations land first (stored-set drift).
- Reader evidence re-verified: watcher.py:104, fundsignal_loop.py:136/148, config.go:112, marketdata_service.go:982-987, sequential-mode.md:80/145, merge-order.md:82, ci.yml:676.

### Still open (Open Threads for the /sdd-execute checkpoint)

- Design quality (C-18): `policy.envReadUnseeded` toggle and env-list partial-stale ratchet are the most speculative mechanisms; executor should confirm they are justified by the Step 9 first-run data, and drop either if the data does not need it.
- Not individually re-read: remaining watcher getters (analysis `:136`, indicators `:98`), TS configWatcher lines; re-verify during Steps 3-4.
- Migration collisions between other features (244 vs 248 both 032) are not 278's; Step 9 baseline must be re-read after any of 243/244/248/264 lands.
- Merge-order row for 243/244/261 coupling is recorded only on the 278 side until Step 18 adds it (both directions in the row text).

## Session 2026-10-23 — environment-baseline decision (operator)

- **Fact from the operator:** there is no production deployment. Step 10's production sampling is therefore not applicable; the production-only gap it was designed to probe has no running deployment behind it.
- **Samples read on staging (read-only `get_config`, nothing written):** `get_config(namespace="ledger")` has `stream.notify_enabled` = true, stored **bare** (the other ledger keys are dotted: `ledger.export.enabled`, `ledger.export.max_window_days`). `get_config(namespace="trading")` has `trading.fill_poller.interval_ms` = 5000.0, stored **dotted** (the 029 heal), alongside the dotted `trading.risk.*` and `trading.approval.*` keys. `get_config(namespace="platform")` has `platform.maintenance_mode` = false, stored **dotted**, alongside `platform.log_level` and `platform.trading_state`. All three match what the offline model predicts for staging. `ledger.stream.notify_enabled` being bare supports the 277 finding that it is a dead seed with no reader.
- **environment-baseline decision (operator ruling): reported-only.** Findings that exist only in the `production` environment (a key the migrations seed for `staging` but not for `production`) are printed as `REPORTED:` and kept out of the ratchet. Staging findings are blocking. `policy.envReadUnseeded` stays `reported`. Re-open Step 10 and run the production sampling when a production environment exists.

## Session 2026-11-01 — operator ruling at the sdd-batch-execute up-front gate

- **Baseline ownership (operator decision, binding):** feature 277 (`fix-ingest-seeded-config-keys`) is `demoted/canceled`, so no baseline entry may name it. Every entry the spec assigned to "feature 277" is owned by **278** instead, and the owner regex drops 277 (`^(feature )?(243|278)\b`). Re-spec Steps 7, 9 and 11 accordingly.
- Re-spec must also re-derive the stored set against the current migration tip (`034_retire_portfolio_snapshot_interval`; 031-034 landed under numbers the spec did not anticipate), re-evaluate `indicators.sandbox.*` now that 243's `031_heal_indicators_sandbox_keys_full_dotted` is on the branch, and treat Step 10 as already resolved (2026-10-23 ruling: reported-only) — confirm and flip it rather than reopening an operator gate.

## Session 2026-11-01 — sdd-execute sequential re-spec (§5.3)

- Branch setup: `git merge --no-edit origin/main-dev` was a no-op ("Already up to date"); `scripts/ledger-guard.py --own-slug enforce-config-key-wiring --base origin/main-dev --fix` reported clean, so no merge commit was needed.
- Re-specced the bodies of Steps 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 18 (directive re-spec, implementation-spec.md):
  - **Migration set** is now 000-034 (tip `034_retire_portfolio_snapshot_interval`). The closed rewrite model (Step 1) gains: a literal-list prefix heal and a twin-dedupe DELETE (031), a literal DELETE (009, 020, 034), a key-neutral UPDATE (016, 031:74, 032), and a statement splitter that ignores comments and `CREATE TRIGGER ... BEFORE UPDATE` (001:50, 010). New Step 2 fixtures cover each shape. `rewriteAllow` is expected to stay empty: the model is extended, the trigger is not weakened.
  - **Readers** (Step 3/4): `get_*_present` are class-attribute aliases, not `def`s, and are still matched by call name. Feature 244's module-level `int_positive(cfg, key, default)` (analysis/indicators/ingest `watcher.py`) is a registered forwarder with `keyArg` 1, like Go `resolvePositiveInt` (`marketdata_service.go:986`). Its body's pass-through `get_int(key)` is not counted as a read. Without the forwarder entries, `ingest.backfill.max_concurrent_jobs`, the `mcp_client` keys and about 30 analysis keys would be missed.
  - **Expected first-run set** (Step 9): analysis `backtest.max_duration_seconds` changes from dead seed to `form-mismatch` (`servicer.py:795-796` reads it dotted). `indicators.sandbox.{timeout_ms,memory_bytes,allowed_imports}` are healed by 031. `indicators.sandbox.max_concurrent` is read but unseeded and sits outside 243's scope, so it is owned by 278.
  - **Owners** (Steps 7/9/11): the 2026-11-01 operator ruling is applied. The owner regex is `^(feature )?(243|278)\b|...`, and no entry names 277.
  - **Step 10** is now a confirmation of the recorded 2026-10-23 `reported-only` ruling. It is flipped after Step 9 and is no longer an operator stop.
  - **Anchors**: ci.yml (`changes` :14 / filters :39-108, migration-contract-gate :693-709 with `fetch-depth: 0` not copied, ci-gate :899-945, context-map :787/:801, shell-lint :643/:646/:649, setup-node :459); sequential-mode.md §5.5 :81 / §5.5b :110 / §5.6 :146; config-governance.md `## Per-Feature Registered Keys` :109. The fails.md:1040 citation in Step 13 was removed because it is unrelated.
  - **Step 18**: merge-order.md already has a 278 row (:101, 281 vs 278). Only a soft 243-vs-278 row is added. 244, 261 and 264 have launched, and the PR #1322 / `ccr-fac38b1f-6m24q2` reference is stale.
- Not re-specced (outside the directive): Step 5 still cites `configServiceImpl.ts:188` (now :276), and the Step Dependencies bullet still mentions PR #1322. Both are stale and do not affect execution.
- Severity: n/a.

## Session 2026-11-01 — sdd-execute sequential (sdd-batch-execute)

- Mode-entry and up-front confirmation: given by the operator, who approved the up-front plan for `/sdd-execute enforce-config-key-wiring sequential` through the sdd-batch-execute workflow. Steps run as one commit each on `feature/enforce-config-key-wiring`, and there is a single integration PR at the end.
- Status: `implementation-ready` → `in-progress`.
- Step 10 is confirmed after Step 9 against the recorded `reported-only` ruling. It is not an operator stop.
- Severity: n/a.

## Session 2026-11-01 — sdd-execute sequential, Steps 1+2

### Step 1 — Seed-side parser (stored set) and CLI skeleton [done]
- Created `scripts/check-config-wiring.mjs`: a zero-dependency ESM script. It has a tokenizer that drops comments and handles quoted, `$$` and double-quoted text, and a statement splitter. `buildStoredSet(root)` replays `*.up.sql` in NNN order against `config.config_values` only, using the closed model of Instructions 3 (cases 1-7). It returns `stored` (global, non-secret rows keyed `(namespace, key, environment)`, each carrying its inserting migration), `secrets` (keys only, never values) and `unmodelled`. The fail-closed `unmodelled-rewrite` honours `registry.rewriteAllow` (file name plus SHA-256 of the comment-stripped, whitespace-normalised statement). The CLI accepts `--root/--final/--declared-from/--declared-migration/--keys/--json`; only `--root` and `--json` act at this step. Exit codes are 0, 1 and 2, and errors print to stderr with the prefix `config-wiring:`.
- Real tree (000-034): exit 0, zero `unmodelled-rewrite`, 180 stored entries, 8 secret entries. The four `alpaca`/`fmp`/`finnhub` keys stay bare in `secrets`. `indicators.sandbox.{timeout_ms,memory_bytes,allowed_imports}` are dotted in both environments. `ledger stream.notify_enabled` is staging-only. `analysis backtest.max_duration_seconds` is bare in both environments. `portfolio snapshot.interval_minutes` and `analysis signals.source_weights` are gone.
- Discovery-digest blocker resolved without allow-listing. The re-spec had already added the 031/034/009/020/016/032 shapes (cases 4-7). 029's second UPDATE (`value_data` only) is key-neutral. The 017 `WITH ranked ... DELETE` collapse is CTE-led, so it is not classified (see Deviation Log).
- TDD red (captured before implementation): `node --test scripts/config-wiring.test.mjs` failed with `ERR_MODULE_NOT_FOUND ... scripts/check-config-wiring.mjs`, pass 0 / fail 1, so no case could run.
- TDD green: `node --check scripts/check-config-wiring.mjs && node --test scripts/config-wiring.test.mjs` gave tests 10, pass 10, fail 0.
- Files modified: `scripts/check-config-wiring.mjs`
- Deviations: executed as one TDD cycle with Step 2 (operator Option A); a CTE-led DELETE is not classified; non-`VALUES`/non-`DO NOTHING` INSERTs fail closed; the unmodelled line is `file:L<line>:unmodelled-rewrite`. Full detail is in the Deviation Log.

### Step 2 — Parser fixtures and tests (authored red) [done]
- Authored `scripts/config-wiring.test.mjs` (`node:test`, `node:assert/strict`) with cases 1-9 of the Instructions plus a CLI usage-error case (exit 2). Fixtures are under `scripts/config-wiring-fixtures/seed/{bare-insert,heal-029,rename-017,unmodelled,scope-and-secret,multi-row,heal-031,literal-delete,key-neutral}/`.
  - `rename-017` also carries the 017 CTE collapse.
  - `key-neutral` also carries a `$$` function body containing `UPDATE ... SET key`.
  - `multi-row` carries `''`, `--` and `;` inside string literals and a comment inside VALUES.
  - The case-5 allow-list and the case-9 negative cases run on temp copies (`fs.mkdtempSync`). This mirrors the merge-train test style, so no extra fixture files were needed.
- Red and green are as in Step 1, since both steps were one TDD cycle. Lint: `node --check scripts/config-wiring.test.mjs` passed.
- Files modified: `scripts/config-wiring.test.mjs`, `scripts/config-wiring-fixtures/seed/**` (16 files, including the `scope-and-secret/.../001_seed.down.sql` sibling)
- Deviations: none beyond the shared TDD-cycle entry.
- Tooling: Node v22.23.4. The root CLAUDE.md pins 24; the operator noted this is not a blocker. No CI-equivalent fallback was used, because Steps 1-2 need only `node`.
- Open item: the fail-closed trigger does not see CTE-led (`WITH ...`) DML. No current migration other than the 017 collapse uses that shape.
- Severity: n/a.
