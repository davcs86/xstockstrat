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

## Session 2026-11-01 — operator ruling: option A for every inverted test/impl pair

- **Binding operator decision:** the spec places each implementation step before its paired RED test step (3→4, 5→6, 7→8). Apply the same Option A already used for Steps 1+2 to every remaining pair: author the test step's test cases and fixtures first, capture RED, implement the implementation step, capture GREEN with both steps' Verification commands, and land each pair as **one** red-green commit that flips both Statuses to `done`, staging both steps' Files. Log one Deviation Log entry per pair ("executed as one TDD cycle, operator option A"). Do not raise a blocker for this ordering again.

## Session 2026-11-01 — sdd-execute sequential, Steps 3+4

### Step 3 — Reader extraction (Python `ast`, Go and TypeScript regex) [done]
- `scripts/config-wiring-py-reads.py` is new. It uses stdlib `ast` and runs as `python3 -I <helper> <root> <forwarders-json>`. It scans `services/*/app/**/*.py` and skips `tests/`, `test/`, `__pycache__/` and `.venv/`.
  - Reads come from the getter names (including the `*_present` aliases) and from `.values.get(...)` / `.values[...]`, with the key at argument 0 or `key=`.
  - It also handles calls to registered forwarders of the same service, with the key at `keyArg`.
  - A key argument resolves to a literal or to a module-level string constant. Anything else becomes `{"file","symbol","line","dynamic":true}`.
  - In a registered forwarder's body, a call that passes the forwarder's own key parameter is treated as pass-through and skipped.
- `scripts/check-config-wiring.mjs` gains `extractReads`, `extractPyReads`, `extractGoReads` and `extractTsReads`.
  - Go/TS matching uses a regex over comment-blanked source. A balanced argument scan handles calls split across lines.
  - Constants resolve in the same file, then the same package, then the service. A `pkg.X` constant resolves in the directory named `pkg`.
  - The forwarder rule is the same as for Python. `registry.dynamic` turns an enumerated site into reads.
  - `GetSecret`/`getSecret` are never matched. `run()` is unchanged; Step 5 wires the join and output.
- Real-tree smoke run (not a gate; it uses the four Step-3 minimum forwarders). It took about 0.4 s and found 213 reads (169 unique keys: 115 py, 83 go, 15 ts/tsx) and 46 dynamic sites. Breakdown of the dynamic sites:
  - The getter internals of the Python and TS watchers: `ConfigWatcher.get_*` in analysis/indicators/ingest, and `getString/getInt/getFloat/getBool` in config/identity/ledger/notify.
  - analysis `float_positive` and `str_nonempty`.
  - agent `client.py:get_config_value`.
  - `values`-index false positives in config `configServiceImpl.ts`, analysis `servicer.py:1858` / `evaluator.py:95`, ui `accountShared.tsx`/`indicatorChart.ts`, marketdata fundamentals and trading `ibkrTiming`.
  - Step 9 counts these and Step 11 records them in `registry.forwarders`/`registry.dynamic`. An empty `registry.dynamic` array silences a site.
- TDD red (before implementation): `node --test scripts/config-wiring.test.mjs` gave tests 21, pass 10, fail 11 (`cw.extractReads is not a function`).
- TDD green: `node --check scripts/check-config-wiring.mjs && python3 -I -m py_compile scripts/config-wiring-py-reads.py && node --test scripts/config-wiring.test.mjs` gave tests 21, pass 21, fail 0. `ruff check` on the helper passed.
- Files modified: `scripts/check-config-wiring.mjs`, `scripts/config-wiring-py-reads.py`
- Deviations: Steps 3+4 were executed as one TDD cycle (operator option A). TS uses lower-case `get*` names. The format of the dynamic `symbol` and the extractor API are defined here. See the Deviation Log.

### Step 4 — Reader-extraction fixtures and tests (authored red) [done]
- Cases (a)-(k) were added to `scripts/config-wiring.test.mjs`. They reach the new exports through `import * as cw`, so red fails per case and not for the whole module. The fixtures are under `scripts/config-wiring-fixtures/readers/` (the 9 files the spec lists).
  - `split_literal.go` also carries a commented-out `GetString` call.
  - `index_reads.ts` also carries a TS `getInt` read and a `getSecret` call.
- Red and green are as recorded for Step 3. Lint: `node --check scripts/config-wiring.test.mjs && python3 -I -m py_compile scripts/config-wiring-py-reads.py` passed.
- Files modified: `scripts/config-wiring.test.mjs`, `scripts/config-wiring-fixtures/readers/**` (9 files)
- Tooling: Node v22 (the root CLAUDE.md pins 24; the operator said this is not a blocker) and python3 3.13. No CI-equivalent fallback was used.
- Open items for Steps 9/11:
  - Register `float_positive`/`str_nonempty` (analysis, `keyArg` 1) and agent `get_config_value` (`keyArg` 0) as forwarders.
  - Handle the Python and TS watcher getter internals and the `values`-index false positives listed above, either through `registry` entries or by tightening the extractor.
- Severity: n/a.

## Session 2026-11-01 — sdd-execute sequential, Steps 5+6

### Step 5 — Join with collapse, finding kinds and output [done]
- `scripts/check-config-wiring.mjs` gains `join(stored, reads)` and `findingLine(f)`, and `run()` now prints the join's findings next to `unmodelled-rewrite`.
  - Joins are verbatim. A bare-seed/dotted-read pair, or a dotted-seed/bare-read pair, gives one `form-mismatch` and suppresses its `seeded-unread`/`read-unseeded` per environment.
  - Findings are grouped per `(namespace, key, kind)`.
  - Only `read-unseeded` carries `:env`, listing the environments where the key is missing when it is seeded in some environments but not others.
  - Dynamic sites are deduplicated per `file:symbol`.
  - Output is sorted. The exit code is 1 when there is any finding and 0 otherwise.
  - Secrets and `GetSecret` never enter the comparison.
- Real-tree smoke run (not a gate; no `config-wiring.json` yet, so no forwarders are registered) exited 1 with 150 lines:
  - 9 `form-mismatch`: the analysis `backtest.max_duration_seconds`, seven `fundsignal.*`, and `scoring.signal_decay_half_life_hours`.
  - 31 `seeded-unread`.
  - 64 `read-unseeded`, one of them env-scoped: `trading.fill_poller.interval_ms:production`.
  - 46 `dynamic-read`.
- The ingest `form-mismatch` group and the remaining `fundsignal.*` keys show up as `seeded-unread` here, because their reads go through `int_positive` and similar forwarders that are not registered yet. Steps 9 and 11 reconcile this once the forwarders are registered.
- TDD red (before implementation): `node --test scripts/config-wiring.test.mjs` gave tests 28, pass 23, fail 5. The five failures were join cases 1-5. Cases 7 and 8 assert no output, so they already passed.
- TDD green: `node --check scripts/check-config-wiring.mjs && node --test scripts/config-wiring.test.mjs` gave tests 28, pass 28, fail 0.
- Files modified: `scripts/check-config-wiring.mjs`
- Deviations: Steps 5+6 were executed as one TDD cycle (operator option A). The `join` signature, the per-kind key and file fields, and the rule that only `read-unseeded` carries an env are defined here. See the Deviation Log.

### Step 6 — Join and finding-kind tests (authored red) [done]
- Join cases 1-8 were added to `scripts/config-wiring.test.mjs`. Each asserts exact CLI lines. Case 6 (PRESERVE @AC-3) is folded into case 3, where two reader files read the same key and produce one finding. Case 4 reuses the `readers/` fixture.
- Fixtures are under `scripts/config-wiring-fixtures/join/{mismatch,seeded-unread,read-unseeded,env-collapse,negative-matches,secret}/` (17 files).
- Step 2 cases 4 and 5 no longer assert exit 0, because their fixtures' seeds now report `seeded-unread`. See the Deviation Log.
- Lint: `node --check scripts/config-wiring.test.mjs` passed.
- Files modified: `scripts/config-wiring.test.mjs`, `scripts/config-wiring-fixtures/join/**`
- Tooling: Node v22 (the root CLAUDE.md pins 24; the operator said this is not a blocker). No CI-equivalent fallback was used.
- Severity: n/a.

## Session 2026-11-01 — sdd-execute sequential, Steps 7+8

### Step 7 — Baseline ratchet, modes, declared keys and policy [done]
- `scripts/check-config-wiring.mjs` changes:
  - New: `validateState`/`loadState`. Every run validates `scripts/config-wiring.json` (a missing file counts as the empty shape). A bad entry (owner missing or not matching `^(feature )?(243|278)\b|^(defect|feature) .+`, kind outside the four FR-1 kinds, bad `envs`/`file`) or a bad policy is named on stderr and exits `2`. `loadRegistry` now reads through `loadState`.
  - New: `ratchet` (`--final`). New findings fail and print as plain lines, gone entries print `STALE:`, and oversized `envs` entries print `STALE-IN-PART:`. Under `policy.envReadUnseeded: reported`, env-scoped `read-unseeded` prints `REPORTED:` and stays out of the ratchet.
  - New: `stepTime` (default). Only declared keys gate, and missing-side legs print `PENDING:`. Keyless kinds (`dynamic-read`, `unmodelled-rewrite`) fail when they are not baselined. With no declared key the mode prints nothing and exits `0`.
  - New: `declaredFromSpec` (backticked keys inside `## Config Key Changes` only) and `declaredFromMigration` (`INSERT INTO config.config_values` rows, canonical dotted key). `--keys` takes a comma-separated list.
- `scripts/config-wiring.json` created with the empty shape (policy `reported`).
- Real-tree smoke (not a gate):
  - The default run prints nothing and exits 0.
  - `--final` gives 150 lines (149 new findings plus 1 `REPORTED:` for `trading.fill_poller.interval_ms:production`) and exits 1. That stays until Step 11 freezes `findings`.
  - `--keys analysis.fundsignal.enabled` prints the 008 `form-mismatch` and the 46 unbaselined `dynamic-read` lines, and exits 1.
- TDD red, captured before implementation: `node --test scripts/config-wiring.test.mjs` gave tests 37, pass 27, fail 10. The failures were ratchet 1-9 and join 5.
- TDD green: `node --check scripts/check-config-wiring.mjs && node -e "JSON.parse(...'scripts/config-wiring.json'...)" && node --test scripts/config-wiring.test.mjs` gave tests 37, pass 37, fail 0.
- Files modified: `scripts/check-config-wiring.mjs`, `scripts/config-wiring.json`
- Deviations, detailed in the Deviation Log:
  - Steps 7 and 8 ran as one TDD cycle (operator option A).
  - Defined here: declared-key matching, step-time keyless kinds, entry identity with an optional `file`, and the `STALE:`/`STALE-IN-PART:`/`PENDING:`/`REPORTED:` line forms.

### Step 8 — Ratchet, owner, mode and declared-key tests (authored red) [done]
- Ratchet cases 1-9 were added to `scripts/config-wiring.test.mjs`. A `stage()` helper copies fixture trees into a temp root and installs the chosen `config-wiring.json`.
- Fixtures are under `scripts/config-wiring-fixtures/ratchet/{new-finding,no-owner,stale-in-part,step-time,two-step/{seed-only,reader-only},declared,policy/{reported,blocking}}`, 16 files in all.
- The Step 2 case 5 and join 1-8 CLI calls now pass `--final`, and join 5 expects the `REPORTED:` prefix. See the Deviation Log.
- Lint: `node --check scripts/config-wiring.test.mjs` passed.
- Files modified: `scripts/config-wiring.test.mjs`, `scripts/config-wiring-fixtures/ratchet/**`
- Tooling: Node v22 (the root CLAUDE.md pins 24; the operator said this is not a blocker). No CI-equivalent fallback was used.
- Open item for Step 11: until `findings` and `registry.dynamic` are populated, any step-time run with a declared key fails on the real tree's 46 unbaselined `dynamic-read` sites.
- Severity: n/a.

## Session 2026-11-01 — sdd-execute 278 step 9

### Step 9 — First offline run on the real tree [done]
- Command: `node scripts/check-config-wiring.mjs --final --json > <scratchpad>/first-run.json`, run against the committed `scripts/config-wiring.json` (empty `findings`, empty registry, policy `reported`). It exited 1. No staging or production read or write was made.
- Stored set: 180 rows, plus 8 secrets that are excluded from the comparison. Migrations 000-034.
- First-run counts per kind (150 findings in all):

  | Kind | Count |
  |---|---|
  | `form-mismatch` | 9 |
  | `seeded-unread` | 31 |
  | `read-unseeded` | 64 (63 blocking, 1 printed `REPORTED:`) |
  | `dynamic-read` | 46 |
  | `unmodelled-rewrite` | 0 |

- `read-unseeded env=` entries (1): `trading.fill_poller.interval_ms:production` (`services/xstockstrat-trading/internal/service/trading.go`). It prints `REPORTED:` under `policy.envReadUnseeded: reported`.

**Reconciliation against the Step 9 expected set.**
- The first run differs from the expected set mainly because no forwarder is registered yet. Reads through `int_positive`, `str_nonempty`, `float_positive` (analysis/indicators/ingest `watcher.py`) and `resolvePositiveInt` (marketdata) are not attributed to a key. So:
  - The ingest group, four `fundsignal.*` keys, `fundsignal.source_slug` and the 031-healed sandbox keys show as `seeded-unread`.
  - The forwarder bodies show as `dynamic-read`.
  - Three of the seven expected unseeded keys are missing: `ingest.backfill.max_concurrent_jobs`, `indicators.sandbox.max_concurrent` and the other `int_positive` readers.
- Diagnostic re-run, not committed: a scratch `--root` symlinked the real `services/` and used a scratch `config-wiring.json` that registered six forwarders, each with `keyArg` 1. They were the four the Step 11 spec lists plus analysis `watcher.py:str_nonempty` and `watcher.py:float_positive`. Result:

  | Kind | Count |
  |---|---|
  | `form-mismatch` | 19 |
  | `seeded-unread` | 9 |
  | `read-unseeded` | 91 |
  | `dynamic-read` | 40 |

- `form-mismatch` 19 matches the expected set exactly:
  - Ingest (5): `backfill.chunk_max_bars`, `backfill.chunk_window_days`, `backfill.max_concurrent_chunks`, `mcp_client.poll_interval_seconds`, `mcp_client.request_timeout_seconds`.
  - Analysis (14): the twelve `fundsignal.*` keys, `scoring.signal_decay_half_life_hours` and `backtest.max_duration_seconds`.
  - `fundsignal.source_slug` is read through `str_nonempty` (`fundsignal_loop.py:44`). That forwarder is absent from Step 11's expected forwarder list, and without it the analysis count is 13.
- All seven expected `read-unseeded` keys are present: `ingest.backfill.max_concurrent_jobs`, `ingest.backfill.retry_on_failure`, `ingest.backfill.max_retry_attempts`, `ingest.signals.dedup_window_hours`, `analysis.fundsignal.retry_seconds`, `analysis.fundsignal.startup_jitter_seconds` and `indicators.sandbox.max_concurrent`.
- Expected-gone keys are confirmed gone:
  - No `indicators.sandbox.timeout_ms`/`memory_bytes`/`allowed_imports` finding remains once forwarders are registered.
  - There is no `portfolio.snapshot.interval_minutes` finding.
  - There is no `ledger.stream.resolve_timeout_ms` finding.
- The expected `seeded-unread` is `ledger` `stream.notify_enabled` (001:65). It is present. The run also reports 8 more `seeded-unread` that were not in the 277-derived expected set:
  - `marketdata.alpaca.paper`, `platform.log_level` and `trading.risk.daily_loss_limit` (002).
  - `agent` `signal.alert_threshold` (004).
  - `marketdata.fmp.cache_ttl_hours` (007).
  - `marketdata.finnhub.cache_ttl_hours` and `marketdata.finnhub.enabled` (015).
  - `analysis.opportunity.sparkline_bars` (028).

  A grep found no non-test reader for seven of them. The exception is `signal.alert_threshold`: the agent reads it through the module constant `_ALERT_THRESHOLD_CONFIG_KEY` (`services/xstockstrat-agent/app/tools.py:78`) passed to `get_config_value`. That read is reported as `dynamic-read` (`services/xstockstrat-agent/app/client.py`), so this `seeded-unread` is an extractor gap. Step 11 Instruction 4 says to fix it in the extractor and not to baseline it.
- The run also reports 84 `read-unseeded` keys beyond the expected 7. These are readers with in-code defaults and no seed row, across:
  - analysis: `scoring.*`, `backtest.default_*`, `opportunity.*`, `screener.*`, …
  - marketdata: `stream.*`, `edgar.*`, `fundamentals.history.*`, `quotes.*`, …
  - trading: `reconciliation.*`, `order.*`, `order_intent.*`, `broker.*`, …
  - portfolio: `risk.*`, `marketdata.*`, `exposure.factor_map`.
  - identity: `jwt.*_ttl_seconds`.

  The 277 sweep covered only ingest/analysis/indicators/ledger, so it never listed them. They are real FR-1 findings.
- The 40 remaining `dynamic-read` sites are the per-service getter bodies (`ConfigWatcher.get_*`, `getInt`/`getBool`/…) and a few runtime-built keys. Step 11 classifies each as either a registered `dynamic` entry or an extractor fix. The false-dynamic-read count must reach zero.

**Open-risk checks.**
- (a) No migration after 017 renames environments. `SET environment` appears only at `017_config_secrets_and_scoping.up.sql:38-39`. The `environment` references in 029:42 and 031:23/72 are predicates or conflict targets, not renames. **Closed.**
- (b) No migration trips the fail-closed trigger. The run produced 0 `unmodelled-rewrite`, so every `UPDATE`/`DELETE` on `config.config_values` was classified by the Step 1 closed model: 009, 016, 017, 020, 029, 031, 032 and 034. 002, 005, 025 and 033 are INSERT-only. `registry.rewriteAllow` stays empty. No model extension and no fixture were needed. **Closed.**

**Proposed owners (Instruction 3).**
- `feature 278`: every `form-mismatch` (19), the dead seed `ledger` `stream.notify_enabled`, every other `seeded-unread`, and every `read-unseeded`, including `indicators.sandbox.max_concurrent`. This follows the 2026-11-01 operator ruling that 277 entries collapse to 278.
- `feature 243`: none. No `indicators.sandbox.*` finding inside 243's scope remains after 031.

**Open items for Step 11.**
1. Register `str_nonempty` and `float_positive` (analysis `watcher.py`, `keyArg` 1) next to the four listed forwarders. Without them, `fundsignal.source_slug` mis-classifies as `seeded-unread`.
2. Before freezing, resolve `signal.alert_threshold` (module-constant key) through the extractor and not the baseline.
3. The baseline will be far larger than the 277 sweep: roughly 19 + 9 + 91 findings, before `dynamic` triage. The Platform Lead and `xstockstrat-config` owner reviewers on Step 11 should expect this.

- TDD: N/A (non-code-bearing: records a run, writes no code).
- Verification: `node scripts/check-config-wiring.mjs --final --json | node -e "…console.log(Object.keys(j))" && grep -n "sdd-execute 278 step 9" …/context.md` printed `[ 'findings', 'results', 'counts' ]` and the session-header line.
- Files modified: `docs/roadmap/features/278-enforce-config-key-wiring/context.md`.
- Tooling: Node v22 (the root CLAUDE.md pins 24; the operator said this is not a blocker). No CI-equivalent fallback was used.
- Deviations: none.
- Severity: n/a.
- Step 10 confirmed: reported-only (2026-10-23 operator ruling), 1 env-scoped findings reported (`trading.fill_poller.interval_ms:production`, printed `REPORTED:` and kept out of the ratchet; `policy.envReadUnseeded` is `reported`; no environment was read or written).

## Session 2026-11-02 — re-spec at the Step 11 blocker (operator option C)

- **Blocker (Step 11, freeze baseline):** after registering the forwarders and enumerable dynamic sites, 7 `dynamic-read` sites remained that are not config reads. 3 are assignment targets in `services/xstockstrat-config/src/grpc/configServiceImpl.ts` (`reloadAll` :50-54, `reloadNamespace` :276, `toProtoSnapPayload` :300) — the TS/Go `INDEX_RE` (`scripts/check-config-wiring.mjs:382`) counts `values[k] = ...` writes, while the Python extractor counts only `ast.Load`. 4 index a non-config `values` container (ui `accountShared.tsx:57`, ui `indicatorChart.ts:33`, analysis `servicer.py` `_load_fundamentals`, analysis `evaluator.py:95`). Former Step 11 Instruction 4 forbids hiding a fixable extractor cause in the registry, but its Files excluded the extractor. Nothing was committed by the blocked run.
- **Operator decision (2026-11-02): option C — re-spec first.** Options A (expand Step 11's Files) and B (registry only, waive Instruction 4) were declined.
- **Re-spec (this commit):** inserted a new **Step 11** (`scripts/check-config-wiring.mjs` + test case (l) + two reader fixtures; red-green inside the step) that skips `values[...]` sites whose closing `]` is followed by an assignment operator. The baseline freeze is now **Step 12**, whose Codebase Evidence lists the 4 non-config sites to register as `registry.dynamic` `[]`.
- **Renumbering map (old → new):** 11 → 12, 12 → 13, 13 → 14, 14 → 15, 15 → 16, 16 → 17, 17 → 18, 18 → 19. Step numbers in earlier entries of this file are pre-re-spec and are left as written (append-only log); `implementation-spec.md` cross-references were all updated. Steps 1-10 are unchanged.
- External references checked: `merge-order.md` row 101 and feature 281's artifacts cite **281's own** Step 13, not 278's; no other feature cites a 278 step number.

## Session 2026-11-02 — sdd-execute sequential re-spec (§5.3), Steps 12-14

- **Branch setup:** `git merge --no-edit origin/main-dev` into the detached `origin/feature/enforce-config-key-wiring` checkout. It was a normal merge with no conflicts; main-dev brought tooling/docs changes only. `scripts/ledger-guard.py --own-slug enforce-config-key-wiring --base origin/main-dev --fix` reported clean, so no repair was needed. `status.md` was already `in-progress`, so no status flip was needed.
- **Step 12 (freeze baseline):** the mismatch was that "four dynamic-read sites remain after Step 11" holds only after registration. Today's `--final` prints 46 `dynamic-read` sites, and 43 remain after Step 11. A scratch `--root` run, with the real `services/` symlinked and nothing committed, classified all 43:
  - **8 forwarders.** The four `int_positive`/`resolvePositiveInt` entries, plus analysis `float_positive`/`str_nonempty` (`keyArg` 1) and agent `client.py:get_config_value` (`keyArg` 0). Those three close Step 9 open item 1. Registering `get_config_value` exposed agent `tools.py:_agent_policy`, a `key` passthrough at `:2536-2540`, so it is the eighth (`keyArg` 0).
  - **28 getter bodies** as `[]`.
  - **4 closed-set runtime keys.** Marketdata `fundProvider` ∈ {fmp, finnhub} at `GetFundamentalsMulti`/`resolveFundamentals` (`cache_ttl_hours`) and `fundamentalsEnabled` (`enabled`), and trading `ibkrTiming` (three `trading.ibkr.*` keys).
  - **4 non-config containers** as `[]`.
- **Step 9 open item 2 (`signal.alert_threshold`):** resolved with no extractor change. Once `get_config_value` is a forwarder, the Python extractor's same-file constant lookup resolves `_ALERT_THRESHOLD_CONFIG_KEY` (`tools.py:78`) at `:656`, so the key leaves `seeded-unread`. The same run shows `marketdata.fmp.cache_ttl_hours`, `marketdata.finnhub.cache_ttl_hours` and `marketdata.finnhub.enabled` were extractor gaps, not dead seeds. Their reads are the `fundProvider`-built keys.
- **Step 12 projection (scratch run without Step 11's fix):** 19 `form-mismatch`, 5 `seeded-unread`, about 101 `read-unseeded` lines (1 `REPORTED:`), and 3 `dynamic-read`, which are exactly the `configServiceImpl.ts` sites Step 11 removes. The real run at Step 12 is authoritative.
- **Step 13:** `scripts/check-config-wiring.mjs` exports no scan-roots constant, and adding one would modify a file outside Step 13's Files. The scan-root/CI-filter assertion (former test (5)) could also never pass at Step 13, because the filter is created in Step 14. It moved to Step 14. Step 13 now also asserts that no baseline entry has kind `dynamic-read`.
- **Step 14:** the extractors do not scan `app/`/`internal/`/`src/` uniformly. Go walks all of `services/<svc>` (`check-config-wiring.mjs:542`), TS walks `services/<svc>/src`, and Python globs `services/*/app/**/*.py` (`config-wiring-py-reads.py:108`). `services/xstockstrat-marketdata/cmd/server/main.go` holds config reads that a `services/*/internal/**` filter would miss.
  - **Directive choice (keep the extractor, widen the filter):** the filter uses language-root globs (`services/**/*.go`, `services/*/app/**/*.py`, `services/*/src/**/*.ts`, `services/*/src/**/*.tsx`, config migrations). Narrowing the extractor was rejected because it would drop real reads.
  - Step 14 now owns test (5), which checks that every file `extractReads` reports matches a filter glob. `scripts/config-wiring.test.mjs` was added to Step 14's Files, and Step 14's TDD is now red-green.
  - Corrected the ci-gate anchors: `needs` `:902-921` and echoes `:926-944` end at `secret-scan`, after `otel-signals` and `ledger-guard`. Setup-node is at `:459-462`.
- Files modified: `implementation-spec.md` (Steps 12, 13, 14 bodies only), `feature.md` (history row), `context.md` (this entry).
- Severity: n/a.

## Session 2026-11-02 — sdd-execute 278 step 11 (sequential)

- **Step 11 done:** `extractRegexReads` (`scripts/check-config-wiring.mjs`) now tags `INDEX_RE` sites and skips one whose balanced closing `]` is followed by `=` or a compound assignment (`+=`, `??=`, `||=`, `&&=`, `**=`, shifts, …), but not `==`/`===`/`=>` (`ASSIGN_AFTER_RE`). Getter and forwarder sites are unaffected. No registry entry was added.
- **TDD:** red first. Fixtures `readers/services/xstockstrat-ui/src/lib/index_writes.ts` and `readers/services/xstockstrat-marketdata/internal/config/index_writes.go` plus test (l) gave 38 tests, 36 pass, 2 fail: (l), where `performance.window_days` was read from a literal write, and (d), where `index_writes.go:writes` was a false `dynamic-read`. Green: 38/38.
- **Real-tree diff (Instruction 4):** the `extractReads` read and dynamic set was captured before and after. Only 7 lines disappeared, all `dynamic-read` in `services/xstockstrat-config/src/grpc/configServiceImpl.ts`: lines 50-54 (`toProtoSnapPayload` symbol), 276 and 300. No read key disappeared or appeared. `--final` counts by kind went from dynamic-read 46 → 43, with read-unseeded 64, seeded-unread 31 and form-mismatch 9 unchanged. This matches the re-spec projection of 43 dynamic sites for Step 12.
- **Verification:** `node --test scripts/config-wiring.test.mjs && node --check scripts/check-config-wiring.mjs && ! node scripts/check-config-wiring.mjs --final | grep -E 'configServiceImpl\.ts:[A-Za-z_]+:dynamic-read' && echo OK` printed `OK`. Lint: `node --check scripts/config-wiring.test.mjs` was clean.
- Files modified: `scripts/check-config-wiring.mjs`, `scripts/config-wiring.test.mjs`, the two `index_writes` fixtures, `implementation-spec.md` (Step 11 Status, Deviation Log), `feature.md`, `context.md`.
- Tooling: Node v22.23.4. The pin is 24; the operator ruled this is not a blocker.
- Deviations: one, in the Deviation Log. The TS fixture has an extra `??=` write, and case (d) also went red.
- Severity: n/a.

## Session 2026-11-02 — sdd-execute 278 step 12 (sequential)

- **Step 12 done:** `scripts/config-wiring.json` frozen. `policy.envReadUnseeded` stays `reported` (Step 10 ruling). `registry.rewriteAllow` stays `[]`, since every current rewrite is modelled (Step 9 open-risk check b).
- **Registry, filled first.** Justification per group:
  - **`forwarders` (8).** Each is a helper that passes its key parameter to a getter. Registering it attributes reads to the callers and silences the pass-through body.
    - `int_positive` in analysis, indicators and ingest `app/config/watcher.py` (`keyArg` 1).
    - Analysis `watcher.py:float_positive` and `watcher.py:str_nonempty` (`keyArg` 1). `str_nonempty` closes Step 9 open item 1 (`fundsignal.source_slug`).
    - Marketdata `marketdata_service.go:resolvePositiveInt` (`keyArg` 1).
    - Agent `client.py:get_config_value` and `tools.py:_agent_policy` (`keyArg` 0). With these, `signal.alert_threshold` resolves through `_ALERT_THRESHOLD_CONFIG_KEY`, which closes Step 9 open item 2.
  - **`dynamic` getter bodies (28, `[]`).** These are `ConfigWatcher.get_bool/get_float/get_int/get_str` in the analysis, indicators and ingest watchers, and `getBool/getFloat/getInt/getString` in the config, identity, ledger and notify `configWatcher.ts`. They are getter implementations whose keys are already attributed at each call site by the built-in getter matchers.
  - **`dynamic` closed-set runtime keys (4).**
    - Marketdata `MarketDataService.GetFundamentalsMulti` and `MarketDataService.resolveFundamentals` produce `marketdata.{fmp,finnhub}.cache_ttl_hours`.
    - `MarketDataService.fundamentalsEnabled` produces `marketdata.{fmp,finnhub}.enabled`. `fundProvider` is one of `fmp` or `finnhub`.
    - Trading `TradingService.ibkrTiming` produces `trading.ibkr.{lst_refresh_margin_ms,handshake_timeout_ms,reauth_min_interval_ms}`.
  - **`dynamic` non-config containers (4, `[]`).** These sites index a `values` variable that is not a config snapshot:
    - ui `accountShared.tsx:credsFromWatch`, a local array.
    - ui `indicatorChart.ts:toLineData`, a series array.
    - analysis `servicer.py:AnalysisServicer._load_fundamentals` and `evaluator.py:_fundamental_as_of_series`, both over fundamentals period values.
- **Re-run with the registry, before `findings` were filled:** `--final` printed 0 `dynamic-read` lines. None of `signal.alert_threshold`, `marketdata.fmp.cache_ttl_hours`, `marketdata.finnhub.cache_ttl_hours` or `marketdata.finnhub.enabled` appeared.
- **Final counts (frozen `findings`, 124 entries, all `owner: "feature 278"`):**

  | Kind | Count |
  |---|---|
  | `form-mismatch` | 19 |
  | `seeded-unread` | 5 |
  | `read-unseeded` | 100 blocking (+1 printed `REPORTED:`, `trading.fill_poller.interval_ms:production`, kept out of `findings` per the reported-only ruling) |
  | `dynamic-read` | 0 |

  - The 5 `seeded-unread` are `ledger` `stream.notify_enabled`, `marketdata.alpaca.paper`, `platform.log_level`, `trading.risk.daily_loss_limit` and `analysis.opportunity.sparkline_bars`.
  - No `feature 243` entry: no `indicators.sandbox.*` finding inside 243's scope remains. `indicators.sandbox.max_concurrent` is a `feature 278` `read-unseeded`.
  - No entry names 277.
- **Delta from the projection:** none. The projection was 19 / 5 / about 101 `read-unseeded` lines (1 `REPORTED:`) / 3 `dynamic-read`. The real run matches it, except that the 3 `configServiceImpl.ts` `dynamic-read` lines are gone, because Step 11 removed them.
- **Owner overrules:** none. Every entry carries the Step 9 proposed owner.
- **TDD:** N/A (config data file; verified by Step 13's real-tree test).
- **Verification:** `node scripts/check-config-wiring.mjs --final && node -e "…" && echo OK` exited 0. It printed only the `REPORTED:` line, then `OK`. As an extra check, `node --test scripts/config-wiring.test.mjs` passed 38/38.
- Files modified: `scripts/config-wiring.json`, `implementation-spec.md` (Step 12 Status), `feature.md`, `context.md`.
- Tooling: Node v22. The pin is 24; the operator ruled this is not a blocker.
- Deviations: none.
- Severity: n/a.

## Session 2026-11-02 — sdd-execute 278 step 13 (sequential)

- **Step 13 done:** `scripts/config-wiring.test.mjs` gains four tests that run against the real repo root (`REPO = path.resolve(HERE, '..')`):
  - `baseline 1` (@AC-7): `--final` on the real tree exits 0.
  - `baseline 2` (@AC-8): `findings` is non-empty, every entry has a non-empty `owner` and a kind among the four, and none is `dynamic-read`.
  - `baseline 3` (@AC-7): the baseline contains `SWEEP_277`, which holds 19 `form-mismatch`, `seeded-unread` `ledger/stream.notify_enabled` and the 7 `read-unseeded` keys. The list is copied from the Step 9 reconciliation above. This file does not enumerate the 12 `fundsignal.*` names, so they come from 277's recon.md row "fundsignal.* x12 (008)" and match the frozen baseline.
  - `baseline 4`: each entry has only `namespace`/`key`/`kind`/`owner`/`envs`/`file` and the JSON has no `value`-like field. No `key` equals a secret row's key, bare or `<namespace>.`-prefixed. Secret rows come from `buildStoredSet(REPO).secrets`, which has 8 rows.
- **TDD:** red first, in a scratch root (scratchpad `red13/`). It had the new test file and the script copied, `services/`, the fixtures and `config-wiring-py-reads.py` symlinked, and the Step 7 empty-shape `config-wiring.json` (from `9ed19573`). Result: 42 tests, 39 passed, 3 failed (`baseline 1`, `baseline 2` "findings is empty", `baseline 3`). `baseline 4` passes vacuously on an empty baseline, which is expected for a guard. Green in the worktree: 42/42.
- **Verification:** `node --test scripts/config-wiring.test.mjs` passed 42/42. Lint `node --check scripts/config-wiring.test.mjs` was clean.
- Files modified: `scripts/config-wiring.test.mjs`, `implementation-spec.md` (Step 13 Status), `feature.md`, `context.md`.
- Tooling: Node v22. The pin is 24; the operator ruled this is not a blocker.
- Deviations: none.
- Severity: n/a.

## Session 2026-11-02 — sdd-execute 278 step 14 (sequential)

- **Step 14 done:** `.github/workflows/ci.yml` changes:
  - `changes` gains a `config-wiring` filter after `otel-signals`. It holds the ten globs from Instruction 2, the language roots plus the checker files.
  - New job `config-wiring` ("Config key wiring (whole-tree)"), placed after `otel-signals`. It has `needs: changes`, an `if:` on matched `config-wiring` or `ci`, and no `pull_request` guard. Steps: `actions/checkout@v7` (shallow), `actions/setup-node@v7` with `node-version: "24"` and no pnpm cache, `node --test scripts/config-wiring.test.mjs`, then `node scripts/check-config-wiring.mjs --final`.
  - `ci-gate` gains `- config-wiring` in `needs:` and a `config-wiring:` echo, both after `secret-scan`.
- **Test `baseline 5` (@AC-7)** in `scripts/config-wiring.test.mjs`. It reads `ci.yml` as text and collects the quoted globs under the `config-wiring:` filter key. It asserts the five language-root globs literally, then checks that every `file` in `extractReads(REPO)` `reads`/`dynamic` (27 files, including `services/xstockstrat-marketdata/cmd/server/main.go`) matches a glob. The in-test glob-to-regex treats `**/` as zero or more directories and `*` as one segment.
- **TDD:** red first. Before the ci.yml edit the suite ran 43 tests, 42 passed, and `baseline 5` failed with `filter lacks services/**/*.go`. Green after the edit: 43/43.
- **Verification:** the PyYAML assertion passed, `grep -n config-wiring` listed the filter, job and gate lines, `node --test` passed 43/43, `node --check` was clean, and `--final` exited 0 with only the `REPORTED:` line.
- Files modified: `.github/workflows/ci.yml`, `scripts/config-wiring.test.mjs`, `implementation-spec.md` (Step 14 Status), `feature.md`, `context.md`.
- Tooling: Node v22. The pin is 24; the operator ruled this is not a blocker.
- Deviations: none.
- Severity: n/a.

## Session 2026-11-02 — sdd-execute 278 step 15 (sequential)

- **Step 15 done:** `.claude/skills/sdd-execute/SKILL.md` changes:
  - Phase 3 step 3 gains a **Config-key wiring gate** sub-bullet, placed after Verification and before the step 4 `done` flip. It triggers on a `config` step, a migration inserting into `config.config_values`, or a key from the product spec's `## Config Key Changes`. It runs `node scripts/check-config-wiring.mjs --declared-from <FEATURE_DIR>/product-spec.md` (plus `--declared-migration <file>` for a migration step) in step-time mode. Non-zero keeps the step not-done; `PENDING:` lines do not block; unrelated baseline findings do not block a keyless step.
  - Step 4's all-steps-done branch runs `--final` first; non-zero blocks the `code-completed` flip; output goes to `context.md` (F-09).
  - ALL-DONE PATH gains item 0: `--final` gates the integration PR.
  - `reference/repo-conventions.md` config-key line now points at the check (verbatim stored key, runtime-created keys surface as `read-unseeded`, seed them in a migration).
- **Discovery note:** the workflow's discovery digest described the former numbering (sequential-mode mirror, now Step 16). This step followed the current spec's Step 15 (SKILL.md + repo-conventions.md).
- **TDD:** N/A (docs/skill text; structural assertions in Step 18).
- **Verification:** `grep -n check-config-wiring` matched SKILL.md:160, :304, :314 and repo-conventions.md:31; `./scripts/check-context-map.sh` printed `OK - all context-map and doc references resolve.` As a sanity check, the step-time command against 278's own product spec exited 0.
- Files modified: `.claude/skills/sdd-execute/SKILL.md`, `.claude/skills/sdd-execute/reference/repo-conventions.md`, `implementation-spec.md` (Step 15 Status), `feature.md`, `context.md`.
- Deviations: none.
- Severity: n/a.

## Session 2026-11-02 — sdd-execute 278 step 16 (sequential)

- **Step 16 done:** `.claude/skills/sdd-execute/reference/sequential-mode.md` gets two edits, as the Instruction asks, without restating the gate rules:
  - §5.5 step loop gains one bullet: Phase 3's config-key wiring gate (`node scripts/check-config-wiring.mjs`, step-time mode) applies unchanged, per step.
  - §5.6 per-feature integration PR gains a first bullet: on the feature's last step, run `node scripts/check-config-wiring.mjs --final` before creating the integration PR; non-zero blocks it; output recorded in `context.md`.
- **Discovery note:** the workflow's discovery digest described the former numbering again (the `/sdd-review` B2 row and `/sdd-story` declared-key format, now Step 17). This step followed the current spec's Step 16.
- **TDD:** N/A (docs/skill text; structural assertions in Step 18).
- **Verification:** `grep -n check-config-wiring` matched sequential-mode.md:97 and :150; `./scripts/check-context-map.sh` printed `OK - all context-map and doc references resolve.`
- Files modified: `.claude/skills/sdd-execute/reference/sequential-mode.md`, `implementation-spec.md` (Step 16 Status), `feature.md`, `context.md`.
- Deviations: none.
- Severity: n/a.

## Session 2026-11-02 — sdd-execute 278 step 17 (sequential)

- **Operator decision:** Option A on the Step 17 blocker (stale discovery digest read a pre-Step-14 tree), operator's words 2026-11-02: "continue 278, and start wave 2 in parallel if possible". Executed against `origin/feature/enforce-config-key-wiring` at c6d48b5f.
- **Step 17 done:**
  - `.claude/skills/sdd-review/reference/impl-spec-criteria.md`: B2 row `Config key wiring` after the `C-14` row, two FAIL clauses only — (a) no step names the reader file and symbol for a declared key (@AC-6); (b) no snapshot-built test asserts the real reader returns the seeded value (@AC-11; model `test_config_watcher.py:56,74`, `test_ingest_servicer.py:77`). Reviewer cites the key by name; prominent despite Mode B advisory, per `C-14`.
  - `.claude/skills/sdd-story/SKILL.md` `## Config Key Changes` template: one declared key per bullet, a single backticked `<namespace>.<key>` exactly as the migration stores it; the section is the declared set read by `--declared-from`.
- **Extraction check:** `declaredFromSpec('.claude/skills/sdd-story/SKILL.md')` returns `[]` — the template's angle-bracket placeholders never match `DECLARED_KEY_RE`, so a verbatim-copied template declares nothing.
- **TDD:** N/A (docs/skill text; structural assertions in Step 18).
- **Verification:** `grep -n "Config key wiring"` matched impl-spec-criteria.md:32; `grep -n declared` matched sdd-story/SKILL.md:201-203; `./scripts/check-context-map.sh` printed `OK - all context-map and doc references resolve.`; `node --test scripts/config-wiring.test.mjs` 43/43 pass.
- Files modified: `.claude/skills/sdd-review/reference/impl-spec-criteria.md`, `.claude/skills/sdd-story/SKILL.md`, `implementation-spec.md` (Step 17 Status), `feature.md`, `context.md`.
- Deviations: none.
- Severity: n/a.

## Session 2026-11-02 — sdd-execute 278 step 18 (sequential)

- **Discovery note:** the workflow's discovery digest described the former numbering (governance doc + merge-order row, now Step 19) and a stale tree. This step followed the current spec's Step 18 on `origin/feature/enforce-config-key-wiring` at 24d21ee1.
- **Step 18 done:** `scripts/config-wiring.test.mjs` gains four whitespace-normalized text assertions over the real skill files:
  - `skill 1` (@AC-4/5/10): in `sdd-execute/SKILL.md` Phase 3, the wiring gate follows Verification; the `--declared-from <FEATURE_DIR>/product-spec.md` command precedes the `done` flip; the gate names the three triggers (`config` step, migration inserting into `config.config_values`, `## Config Key Changes` key) and the keyless-step carve-out; `--final` precedes `code-completed` in the all-steps-done branch.
  - `skill 2` (@AC-4/10): `sequential-mode.md` §5.5 holds the step-time mirror; §5.6 runs `--final` before `create_pull_request`.
  - `skill 3` (@AC-6/11): the `Config key wiring` B2 row has exactly clauses `(a)` (reader file and symbol) and `(b)` (snapshot-built test) and no backtick/stored-key-quote clause.
  - `skill 4`: `sdd-story/SKILL.md` `## Config Key Changes` pins one backticked `<namespace>.<key>` per bullet read by `--declared-from`.
- **TDD:** red first in a scratch root (scratchpad `red18/`, `git archive` of b997cab9, the commit before Step 15, with the new test file copied in): 47 tests, 43 passed, the 4 `skill` tests failed (missing gate span, no §5.5 mirror, no B2 row, no declared-key format). Green in the worktree: 47/47.
- **Verification:** `node --test scripts/config-wiring.test.mjs` passed 47/47. Lint `node --check scripts/config-wiring.test.mjs` was clean.
- Files modified: `scripts/config-wiring.test.mjs`, `implementation-spec.md` (Step 18 Status), `feature.md`, `context.md`.
- Tooling: Node v22. The pin is 24; the operator ruled this is not a blocker.
- Deviations: none.
- Severity: n/a.

## Session 2026-11-02 — sdd-execute 278 step 19 (sequential)

- **Discovery note:** the workflow's discovery digest described a stale tree (18 steps, no `scripts/*config-wiring*`). This step followed the current spec's Step 19 on `origin/feature/enforce-config-key-wiring` at d51d0b3b, where Steps 1-18 are done.
- **Step 19 done:**
  - `docs/patterns/config-governance.md`: new `## Wiring check (config key must be read under its stored key)` after `## Registering a new config key`, plus registering-list item 5 pointing at it. Registered-keys log untouched.
  - `docs/roadmap/features/merge-order.md`: one Soft row, `fix-sandbox-seed-keys` (243) / `enforce-config-key-wiring` (278), stating that once 278 lands any further 243 config-key or reader change updates `scripts/config-wiring.json` (shrink-only) in the same PR. The existing 281 vs 278 row is unchanged; no 244/261 row and no PR #1322 mention. The current baseline holds no `feature 243`-owned entry (243's migration 031 is on the tree), so the row names no specific entries.
  - `.claude/context-map.yaml` not edited (it registers workflow helpers/tests only).
- **Teardown:** `/context-forge:context-constitution` is not loadable in this session (only `context-forge:context-scrubber` is listed as a skill), so it was done by hand. Every context file this feature touched (`docs/patterns/config-governance.md`, `.claude/skills/sdd-execute/SKILL.md`, `.claude/skills/sdd-execute/reference/repo-conventions.md`, `.claude/skills/sdd-execute/reference/sequential-mode.md`, `.claude/skills/sdd-review/reference/impl-spec-criteria.md`, `.claude/skills/sdd-story/SKILL.md`) was re-read against `scripts/check-config-wiring.mjs` (usage line flags `--final`, `--declared-from`, `--declared-migration`, `--keys`; `PENDING`/`REPORTED`/`STALE` output; `is_secret` rows kept out of the join), `scripts/config-wiring.json` (`policy.envReadUnseeded: reported`, every entry has `owner`) and `.github/workflows/ci.yml` (job `config-wiring` runs the suite and `--final`). No drift found. Out-of-tree line citations of `config-governance.md` (`insights.md:1206`, `fails.md:2744`) were already historical before this step and are ledger evidence; left as is. The integration PR body must record both that the plugin was unavailable and this reconciliation.
- **TDD:** N/A (docs-only).
- **Verification:** `./scripts/check-context-map.sh` OK; `grep -n "Wiring check"` hits `config-governance.md:62,64`; the merge-order grep hits line 102; `node --test scripts/config-wiring.test.mjs` 47/47; `node scripts/check-config-wiring.mjs --final` exit 0 (one `REPORTED:` env-scoped `read-unseeded`, `trading.fill_poller.interval_ms:production`, non-blocking under the `reported` policy).
- Files modified: `docs/patterns/config-governance.md`, `docs/roadmap/features/merge-order.md`, `implementation-spec.md` (Step 19 Status), `feature.md` (history row; artifact step count 18 → 19), `context.md`.
- Deviations: none.
- Severity: n/a.
