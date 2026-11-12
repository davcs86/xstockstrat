# Context: seed-curated-templates

**Feature**: `docs/roadmap/features/335-seed-curated-templates/feature.md`
**Product Spec**: `docs/roadmap/features/335-seed-curated-templates/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/335-seed-curated-templates/implementation-spec.md`

---

## Session 2026-11-12 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Source of truth for the seed payloads: the operator's private instances in the `xstockstrat-staging`
  app, read on 2026-11-12 via the agent MCP tools `list_formulas`, `list_strategies(include_inactive=true)`
  and `list_signal_sources`. All three template catalogs were empty at that time.
- Operator decisions (2026-11-12, asked before the story was written):
  - Delivery = seed migrations, chosen over payload files for config-ui and over a new MCP
    `manage_template` tool. Operator's rationale: "Low risk, as they are templates and don't execute
    anything."
  - Formulas = curated, de-duplicated set of 7 (skip probes and near-duplicate z-score/ER variants).
  - Signal sources = all 5 verbatim, including the derived `fundamentals` source and the SEC
    `request_headers` User-Agent as stored.
  - Strategies = all non-junk strategies, not only the 3 `live_enabled` ones.
- Not yet decided — carried as product-spec Open Questions OQ-4..OQ-7.

## Session 2026-11-12 — sdd-story (operator follow-up decisions)

- **Parity requirement added by the operator** ("Verify the parity afterwards") → FR-9, AC-13/AC-14.
- **OQ-1 sign-off (C-16 CHANGE, Commandment-level override recorded here):** operator approved amending
  `platform.feature` `@AC-15 @feature-224` "Catalog starts empty after migration". Seeds land in every
  environment, production included.
- **OQ-2:** operator rule — "Keep the live version, if none, try to find the one with better
  fittings/results to decide which version to drop." None of the range-mean-reversion family is
  `live_enabled`. Comparison backtest in staging, identical inputs (AAPL, MSFT, NVDA, AMZN, GOOGL, JPM,
  XOM, KO; 2024-07-01..2026-06-30; `sizing_mode=portfolio`, `fill_model=next_bar_open`, $100k):

  | strategy | trades | total return | profit factor | Sharpe | max DD | backtest_id |
  |---|---|---|---|---|---|---|
  | `range_mean_reversion` (v1) | 1 | +0.09% | n/a (1 win) | 0.14 | 0.5% | `be9c7bae-8bdf-473a-a853-d90b52b03b56` |
  | `range_mean_reversion_v2` | 60 | +0.15% | 1.016 | 0.04 | 6.0% | `9f6d5467-cd92-4b9b-99e5-a7afed6f5779` |
  | `range_mean_reversion_v3` | 80 | -0.65% | 0.949 | -0.08 | 4.9% | `ede35765-2e1a-4a19-92c6-ca19db22fcd0` |

  Decision: keep **v2** (best return and profit factor on a usable sample), drop v3 (negative) and v1
  (one trade in two years — its entry almost never fires, so it is no evidence). The margin is thin and
  rests on one window and one megacap basket; this ranks the three, it does not validate v2. Consequence:
  `rolling_zscore_v2` + `kaufman_efficiency_ratio_v2` join the formula set (9), `zscore_close_20` +
  `kaufman_er_close_10` stay out. The 730-day span cap rejected the first attempt (2024-01-01 start).
  These three runs persisted backtest evidence rows in staging.
- **OQ-3:** operator — "Skip from templates BUT add the migrator to seed the fundamentals sources,
  otherwise is missing." → FR-8. Grounding: no ingest migration seeds it today; the row is created at
  runtime by analysis `fundsignal_loop._ensure_source_registered`. A non-system caller can never
  register the slug (`_register_conflict`, AC-36).

## Session 2026-11-12 — sdd-review product-spec

- First pass FAILED: criterion 9 (OQ-4..OQ-7 and two known traps unchecked) and criterion 10 (C-10(c),
  no governance for seeded shared rows). Fixed in the spec: FR-6 reworded (insert-if-absent; down deletes
  only untouched `system` rows; never the `fundamentals` source), FR-10 (identity + mutation semantics),
  FR-11 (composite pinned to the code module), AC-16..AC-21.
- Decided without asking the operator (defaults; reversible until the migrations ship): `created_by =
  'system'`, `template_id = tpl-<slug>`, seeded templates are admin-editable/retirable and never
  reverted by a later migration.
- Second pass: product spec approved. Status: draft → spec-ready. Tree: b2cade0 + working changes,
  0 commits behind origin/main-dev.
- Warnings: SEC User-Agent contact email seeded verbatim into every environment (operator decision).
- Overlap findings: none blocking. 334 `webhook-fanout-callback` owns ingest `015` (already on
  main-dev); 335 takes `016`. 318 `fix-migration-tooling-safety` (spec-ready) touches dirty-recovery
  replay — re-check before execute.
- Recommended design depth: full (DB migrations, 3 affected services, C-16 CHANGE of `@AC-15`).

## Session 2026-11-12 — sdd-design (in progress)

- Phase 0 Recon: wrote recon.md (indicators, analysis, ingest, migration tooling; 1 CHANGE / 1 EXTEND / 26 PRESERVE business rules).
- Phase 1 round 1 (full mode): register in debate.md — D-1..D-12 settled, R-1..R-3 locked, O-1/5/8/9/10/11/12/14 open. No Floor breach.
- Staging config read 2026-11-12: `analysis.fundsignal.source_slug = fundamentals`, `analysis.engine.fundamentals_blend_strategy_id = fundamentals_macd_blend`, `fundsignal.enabled = true`.
- Round-1 gate, operator answers (verbatim):
  - Parity proof → "Hash export + behaviour check": operator runs a read-only staging SELECT (md5 of formula source/parameters; slug, extractor_module, config_json of sources), output committed and compared by the checker before merge; after staging deploy each strategy template is instantiated and its backtest must match the original's numbers, as a gate before promotion to `main`.
  - C-10(c) protection → "Protect referenced formulas" (operator declined the unprotected waiver). This supersedes the story-phase default in FR-10 ("ordinary catalog content, any admin may UPDATE/RETIRE") and brings a servicer change into scope.
  - Blend id → free text: "fundamentals_macd_blend and referenced formulas are system special cases to preserve integrity. If a template references any formula, create a separate formula template. Duplication is acceptable in this case."
- Clarification round (operator, verbatim):
  - Formula layout → "Only the blend's formula is separate": the Fundamentals Composite gets its own template row, not linked to the system formula `d1ff5e6b-…`; all other strategy templates share the standalone formula templates.
  - Protection scope → "All seeded system templates": every `created_by='system'` template row (formula, strategy, source) is read-only through `ManageTemplate` (UPDATE and RETIRE refused); changes ship only by migration. **Supersedes FR-7/FR-10's "any admin may UPDATE or RETIRE" and AC-8/AC-10/AC-16/AC-17 as written at story time.** Brings a servicer guard in all three services into scope (the feature is no longer data-only).
  - Blend → "fundamentals_macd_blend is seeded as a system strategy, not a template, like its formulas, except when a template references them. In that case, create the formula and the template without linking them."
  - Follow-up after being told no system-owned strategies exist → "right, do not create system strategies/formulas. Assign it to the user created by the migrator (admin@localhost). AND create the templates for the other users."
  - Orchestrator's reading, to be confirmed at the approval gate: (1) the blend strategy itself is seeded as a real strategy owned by the migrator's seed admin (`SEED_USER_ID`), referencing the existing system formula; (2) the blend strategy template and the composite formula template are still seeded for everyone else; (3) no new `system`-owned strategy or formula row is created. Not yet decided by the operator: whether the seeded blend strategy starts active/live, and the template's default `strategy_id` given the reserved-id guard.
- **Operator constraint added 2026-11-12 (after the round-1 gate, verbatim):** "do not seed system-owned formulas/strategies. Formulas, Strategies, Watchlists, and Signal sources are strictly user-owned." Conflicts with FR-8 / D-4 (seeding `fundamentals` into `ingest.signal_sources` as `user_id='system'`); resolved by the operator the same day: "Seed as system anyway" — the `fundamentals` source stays an explicit, recorded exception because the producer already registers and feeds it under the system identity (D-4 stands). The constraint otherwise confirms D-15: no formula or strategy row is seeded as `system`; template rows (`created_by='system'`) are catalog entries, and every instance is user-owned. Open, low priority: the operator may prefer the seed admin as template author.
- Phase 1 round 2: register now D-1..D-29, R-1..R-6; O-15 (blend strategy owner), O-16, O-17 open; petition P-2 (REOPEN D-15) pending the operator. No Floor breach. Adversary confirmed the D-14 guard breaks no PRESERVE rule (existing template tests and durable scenarios all use admin-authored rows).
- Round-2 gate, operator answers (verbatim option labels): blend owner → "Seed for admin@localhost" (reopens D-15 → D-30; cross-schema lookup, inactive and not live, skip if the user is missing); blend naming → "Non-reserved id + suffixed name" (D-31); behaviour check → "Skip the behaviour check" (D-32 — parity rests on the staging export + CI tests; an instantiation defect would not be caught by a parity gate before production); design gate → "Run another round".
- Operator follow-up after the round-2 gate (answers to the five listed questions, then reconciled): blend owner resolved by the migration querying the user id (= D-30); blend strategy initial state → **"Active, not live"** (D-33, replaces "inactive" in D-30); template ids are global while strategy ids are per user, so `fundamentals_macd_blend_copy` stands (D-31); composite name suffixed (D-31); behaviour check → **"Skip it"** re-confirmed (D-32). The round-3 proposer was launched with "inactive"; its output is corrected to D-33 before the adversary pass.
- Phase 1 round 3: D-34..D-38 settled (blend-strategy migration form, no-op down, CI substitute for the behaviour check, recorded cross-schema exception + open risks, atomic landing unit); R-7, R-8 locked; O-9 and O-16 closed; petition P-3 (REOPEN D-33) dropped — the irreversibility of "active" was in the option text the operator chose. No open objections; no Floor breach. Staging blend definition carries `signal_eligible: true`, empty `signal_params` and no `denied_symbols` (list_strategies 2026-11-12), so no personal curation is seeded with it.

## Session 2026-11-12 — sdd-design

- Phase 0 Recon: wrote recon.md (services: indicators, analysis, ingest + migration tooling; key reuse patterns: `ON CONFLICT DO NOTHING` seeds with `$t$` dollar-quoting, `migration-assertions` files in the existing `migration-rerun` job).
- Phase 1 Grilling: 3 rounds (full). Chosen approach: hand-authored seed migrations + read-only guard on system templates (`read_only` proto flag, config-ui badge) + blend strategy for `admin@localhost` + parity from an operator-run staging export. Rejected: generator-produced SQL, admin-editable seeded templates, delete-if-untouched blend down, rewriting the durable rule in place (R-1..R-8).
- Constitution rules touched: C-07, C-08, C-09, C-10, C-12, C-13, C-14, C-15, C-16, C-17, C-18, P-06, F-01, F-06, F-07. Floor breaches: none.
- Approved by the operator at the round-3 gate ("Approve design"). Product spec revised (FR-7 superseded; FR-12..FR-15 added) and acceptance scenarios revised (AC-8/10/13/15/16/17 retired by comment; AC-22..AC-40 added) to match design.md.
- Status: spec-ready → design-approved.

## Session 2026-11-12 — sdd-spec

- Generated implementation-spec.md with 29 steps. Status: design-approved → implementation-ready.
- Tree: `ccr-4bdb931f-mr7ofl@4798326` (= `origin/main-dev@cee3bae` + 12 docs-only commits; 0 behind
  `origin/main-dev`). `origin/feature/seed-curated-templates` does not exist yet, so the tree-freshness
  target was `main-dev`; the checkout was **not** switched to `main-dev` because this feature directory
  exists only on the harness branch.
- Discovery was done inline (no `codebase-discovery` subagents were available in this session);
  `recon.md`'s map was re-verified line by line and extended to the design-phase scope it predates
  (guards, proto, UI, agent, harness).
- Key codebase findings:
  - Migration tips unchanged: indicators `007`, analysis `027`, ingest `015` → `008` / `028` + `029` /
    `016`. Only `origin/main-dev` and this branch are fetched locally, so the union-of-refs scan was not
    re-run; execute re-derives the numbers at merge.
  - `common.v1.TemplateMeta` uses fields 1–8 (`packages/proto/common/v1/common.proto:126-135`); no
    descriptor-parity guard covers it. `buf` and a Docker daemon are both absent on this host.
  - The ingest guard breaks three existing tests that run UPDATE/RETIRE on `make_servicer(db=MagicMock())`
    without patching `source_templates.get` (`tests/test_source_templates.py:196-209,254-263,266-277`) →
    Steps 8+9 are one atomic unit. Indicators and analysis fakes already implement `get`.
  - Every assertion file runs on the post-pass-3 state (`scripts/migration-rerun.py:1119-1120`), so each
    seed migration must delete its predecessor's "has seed rows" block in the same commit
    (`indicators-007.sql:45-47`, `analysis-026.sql:9-11`, `ingest-013.sql:67-69`).
  - The harness fixture already inserts `fundamentals` (`fixtures-pre-224.sql:19-22`) and identity 002
    seeds `admin@localhost`, so the insert / user-held / admin-absent states are built in-file inside
    `BEGIN … ROLLBACK` (admin absence by renaming the email, not deleting the user).
  - Agent `list_templates` is `MessageToDict` pass-through (`app/client.py:1484`): `readOnly` appears
    only when true with no client change; the agent work is the tool docstring, a test and the runbook.
  - `analysis/tests/test_strategy_templates_real_pg.py:27-30` fails once any other up-file mentions
    `strategy_templates`; it is fixed inside the analysis seed unit (D-11).
  - No spec exists for the `/config-ui/templates` page; Step 25 creates `e2e/config-ui/templates.spec.ts`.
- Decisions taken at spec time (none overrides a `C-*`/`F-*`; reviewer to confirm at
  `/sdd-review impl-spec`):
  - **D-38 realised as three per-service atomic units** (indicators 13–15, analysis 16–19, ingest
    20–22) instead of one unit: `step-constraints.md` §C caps a unit at 4 steps. Each unit carries its
    own predecessor-assertion edit and its own element of the `migration-rerun.py:1114` tuple, so
    `migration-rerun` is green after each; all three reach `main-dev` in the one integration PR.
  - Export split into Step 1 (query, executor) and Step 12 (operator's raw output). Query path:
    `scripts/testdata/seed-templates-staging-export.sql`.
  - Formula template id rule: lowercase, runs outside `[a-z0-9]` → `_`, trimmed, prefix `tpl-`
    (reproduces AC-23's `tpl-kaufman_efficiency_ratio`); composite id
    `tpl-fundamentals_value_quality_composite_template`.
  - Template `name`/`description`: formula = payload's own; strategy = staging `display_name` / `''`;
    source = `display_name` / `''`.
  - D-36(c)'s fake `GetFormula` is built from the seeded composite template payload (pinned to the code
    module by the indicators drift test), because the indicators code module cannot be imported inside
    the analysis test run.
  - AC-39 uses an expected-failure psql block (`SAVEPOINT`, `ON_ERROR_STOP off`, `LAST_ERROR_MESSAGE`,
    `\gset` + `\if`); no assertion file has done this before — first real execution is CI.
  - The checker takes `--kind` so each seed unit proves its own parity before committing (F-08).
  - The checker's allowlist is exactly D-21's. A dead feature-097 `signal_params` key still stored in a
    staging definition is therefore reported as a difference and needs an operator decision.
  - PLAT-18 filters added with the tests that need them: analysis ← indicators formula seed; scripts ←
    `services/*/migrations/*_seed_*`; agent ← `docs/runbooks/mcp-tools.md`.
  - Left unchanged and flagged: the config-ui empty-state copy "The catalog starts empty."
    (`ui/src/app/config-ui/templates/page.tsx:323-328`).

## Open Threads

- [ ] Operator export on staging is the first implementation step (seeds cannot be authored or parity-checked without it; supplies `extractor_module`).
- [ ] Record production/homelab `analysis.fundsignal.source_slug` and confirm no pre-existing `tpl-*` rows before merge.
- [ ] Seeded blend for `admin@localhost` cannot be deactivated via API; one set-live makes a second permanently-live blend — document in analysis CLAUDE.md (docs step).
- [ ] Unproven before production (no behaviour check): deployed saga on seeded rows, asyncpg JSONB read, numeric backtest equality — analysis all-14 handler test is the partial substitute.
- [ ] Re-check feature 318 overlap on `migration-rerun.py` at execute; re-derive migration NNN at merge.
- [ ] Formula `source`/`description` text is read from staging through the agent MCP `get_formula` at execute (the export carries those two fields as md5 only); without it Step 13's unit is blocked. Everything else is copied from the snapshot.
- [ ] Operator to confirm at `/sdd-review impl-spec`: the D-38 three-unit split, the formula id slug rule, template `name`/`description` choices.
- [ ] Assertion SQL (Steps 14, 18, 21) is parsed offline only; CI `migration-rerun` on the integration PR is its first execution — budget iterations.
- [ ] Follow-up candidate (not in scope): reword the config-ui templates empty state now that the catalog never starts empty.

## Session 2026-11-12 — sdd-review impl-spec (advisory)

- Result: 0 failures, 6 warnings (advisory — did not block). Overlap: clean. Floor risk: none.
- Fixed in the spec before execution: Step 2 `buf breaking` baseline → `main-dev` (the feature branch does not exist); Step 14 `\set seed_error :'LAST_ERROR_MESSAGE'` (unquoted form strips spaces, AC-39 match would never hit); Step 24 `check-duplication.py` run from the repo root.
- Unresolved ⚠ carried into execution:
  - Steps 4, 6, 24: marked red-green but the paired test step follows without `Lands with` (C-08 / P-06) — write the failing test first within the pair — [x] fixed in the spec (units 4+5, 6+7, 24+25 with explicit RED)
  - Step 3: wildcard `Files` paths for generated stubs (F-08 ambiguity) — [x] fixed in the spec (eight explicit `common/v1` paths)
  - Step 29: 7 files in one docs step — [x] fixed in the spec (split into Steps 29 and 30; total 30 steps)
- Overlap findings: none blocking; 318 `fix-migration-tooling-safety` (spec-ready) also edits `scripts/migration-rerun.py` — re-check before Steps 18 and 21.

## Session 2026-11-12 — sdd-review impl-spec (advisory), pass 2

- Operator instruction: "loop over the review impl-spec until all warnings are addressed, then start the execution".
- Result: 0 failures, 0 warnings, 3 notes. All prior warnings closed; every live @AC still covered; units symmetric, adjacent, ≤4, one surface each.
- Note closed in the spec: Step 18 `analysis-029.sql` resolves the admin id by inline subselect (keeps the offline parse valid). Remaining notes need no action (RED statements for Steps 8/10/26 live in their paired test steps; Steps 24–28 may run before the operator-gated Steps 13–23).
- Unresolved ⚠ carried into execution: none.

## Session 2026-11-12 — sdd-execute (sequential)

- Mode entry + per-feature confirmation: the operator's instruction "loop over the review impl-spec until all warnings are addressed, then start the execution", given after being told execution would run "the steps in order as one commit per step on this branch". No re-spec needed (spec written and reviewed against this tree the same day; 0 commits behind `origin/main-dev`).
- **Development branch deviation**: the session may push only to the harness branch `ccr-4bdb931f-mr7ofl`, so that branch is the integration branch instead of `feature/seed-curated-templates` (`feature.md` updated); the existing PR #1526 → `main-dev` is the integration PR.
- Tooling setup (steps 1–11, 24–30): uv ✓ 0.11.32 · python ✓ 3.13 · ruff ✓ · pnpm ✓ 9.15.9 · node v22 (table says 24) · psql client ✓ 16 (parse only, no server) · pglast ⬇ via `uv run --with` · buf ✗ and docker daemon down → Docker codegen to be attempted at Steps 2+3, host-native fallback next, else blocker.

### Step 1 — test: staging export query (parity reference, part 1) [done]
- Created the read-only export query; offline parse `['TransactionStmt', 'SelectStmt', 'TransactionStmt']`, 0 `credentials_ref`, 0 write keywords.
- Files modified: `scripts/testdata/seed-templates-staging-export.sql`
- Deviations: none
- **Operator request (Step 12)**: run the command in the file's first line against staging with `owner=<your user id>` and hand back the output file; also read production/homelab `analysis.fundsignal.source_slug` and check for pre-existing `tpl-*` rows.

### Steps 10+11 — parity checker and its tests [done] (run ahead of Steps 2–9 while the codegen image built; no dependency on them)
- `scripts/check-seed-template-parity.py` (stdlib only) and 30 tests. RED: collection error `FileNotFoundError … check-seed-template-parity.py` before the script existed (the unit lands together for that reason). GREEN: `30 passed`; `ruff check` and `ruff format --check` clean; full `scripts/` suite green.
- Beyond the spec's list the checker also reports a seed row with no staging counterpart and a source payload key outside the six template fields (both are stricter, neither widens the allowlist).
- Files modified: `scripts/check-seed-template-parity.py`, `scripts/tests/test_check_seed_template_parity.py`
- Deviations: executed out of numeric order (see Deviation Log).

### Steps 2+3 — `read_only = 9` on `common.v1.TemplateMeta` and regenerated stubs [done]
- Added the field; regenerated Go / Python / TS stubs in the Docker codegen image. `buf lint` and `buf breaking` (vs `main-dev`) passed inside the image; diff confined to the eight `common/v1` outputs; codegen stable on a second run; the Python stub's protobuf runtime-version line is unchanged.
- Files modified: `packages/proto/common/v1/common.proto`, the eight generated `common/v1` files.
- Deviations: codegen ran in Docker (Deviation Log). TDD: N/A (proto / proto-gen).

### Steps 4+5 — read-only guard and `read_only` flag (indicators) with tests [done]
- `ManageTemplate` refuses UPDATE/RETIRE of a `created_by='system'` row (`PERMISSION_DENIED "system template '<id>' is read-only"`); `_row_to_template` sets `read_only`. RED (tests first): `3 failed, 39 passed` — the two AC-26 cases and the read-only listing. GREEN: `580 passed`, coverage 86.90% (threshold 50), ruff clean. AC-27/AC-28 pinned existing behaviour (green from the start). `test_ac15_empty_catalog_lists_zero_templates` renamed.
- Files modified: `services/xstockstrat-indicators/app/handlers/servicer.py`, `services/xstockstrat-indicators/tests/test_formula_templates.py`
- Deviations: none

### Steps 6+7 — read-only guard and `read_only` flag (analysis) with tests [done]
- Guard placed right after `op = request.operation`, before `_validate_template_definition` (a refused UPDATE makes no indicators call); `_row_to_strategy_template` sets `read_only`. RED: `3 failed, 33 passed`. GREEN: `1654 passed`, coverage 91.46% (threshold 40), ruff clean.
- Files modified: `services/xstockstrat-analysis/app/handlers/servicer.py`, `services/xstockstrat-analysis/tests/test_strategy_templates.py`
- Deviations: none

### Steps 8+9 — read-only guard and `read_only` flag (ingest) with tests [done]
- Guard after the CREATE-only id check and the admin check; skipped for an empty id so the existing NOT_FOUND path is unchanged; `_template_to_proto` sets `read_only`. Three existing tests now patch `source_templates.get`. RED: `3 failed, 33 passed`. GREEN: `487 passed`, coverage 86.35% (threshold 40), ruff clean.
- Files modified: `services/xstockstrat-ingest/app/handlers/servicer.py`, `services/xstockstrat-ingest/tests/test_source_templates.py`
- Deviations: none

- Checkpoint after Steps 1–11 (operator, 2026-11-12): "Continue with UI and agent" — Steps 24–28 run ahead of the operator-gated Steps 12–23.

### Steps 26+27+28 — agent `list_templates` documents and reports `readOnly` [done]
- Docstring, runbook section and the agent CI path filter (`docs/runbooks/mcp-tools.md`) updated; `_stubs`/`_run` gained an optional `strategy_templates` override. RED: `1 failed, 11 passed` (description + runbook text assertions). The AC-30 pass-through case was green from the start — `MessageToDict` already emits `readOnly` when true (regression pin). GREEN: `752 passed`, coverage 87.96% (threshold 40), ruff clean, `check-context-map.py` OK.
- Files modified: `services/xstockstrat-agent/app/tools.py`, `services/xstockstrat-agent/tests/test_template_tools.py`, `docs/runbooks/mcp-tools.md`, `.github/workflows/ci.yml`
- Deviations: none
- Operator instruction 2026-11-12: "Keep going, do not stop in checkpoints" — checkpoint reports are recorded here without pausing; the run still stops at blockers and at the operator-gated Step 12.

### Steps 24+25 — config-ui "System" badge and e2e spec [done]
- The templates page renders `<Badge variant="secondary">System</Badge>` instead of the Edit/Retire menu when `meta.readOnly`; new fixture `STRATEGY_TEMPLATE_SYSTEM` (outside `TEMPLATES` and the mock handlers), new spec `e2e/config-ui/templates.spec.ts`, `/config-ui/templates` added to the warm-up routes, INVENTORY row updated. RED (spec first, old page): `1 failed` — `getByText('System')` not found in the system row. GREEN: `23 passed` across `config-ui/templates`, `insights/templates` and `config-ui/api-smoke`; `pnpm run lint` 0 errors, `tsc --noEmit` clean, `check-duplication.py` OK.
- Files modified: `services/xstockstrat-ui/src/app/config-ui/templates/page.tsx`, `services/xstockstrat-ui/e2e/config-ui/templates.spec.ts`, `services/xstockstrat-ui/e2e/fixtures/templates.ts`, `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`, `services/xstockstrat-ui/e2e/warmup.setup.ts`
- Deviations: e2e run mode (Deviation Log).

**Blocked at Step 12 (operator gate)**: Steps 13–23 need the staging export output; Steps 29–30 (docs) follow the seeds because they name the new migration files. 16 of 30 steps done.

### Step 12 pre-merge checks — partial (2026-11-12)
- Operator reported `analysis.fundsignal.source_slug` = `fundamentals_macd_blend` "in both cases" (production and homelab). Read through the homelab-staging agent the same day, the homelab values are `fundsignal.source_slug = fundamentals` and `engine.fundamentals_blend_strategy_id = fundamentals_macd_blend`, and its only source is the system `fundamentals` one — so the reported value matches the blend-id key, not the slug key. Homelab is therefore consistent with D-24 and D-34. **Production `fundsignal.source_slug` is still unconfirmed** (no production read access from this session); production `engine.fundamentals_blend_strategy_id` = `fundamentals_macd_blend` per the operator.
- Homelab staging `list_templates`: 0 formula, 0 strategy, 0 signal_source templates — no pre-existing `tpl-*` rows there. Production: not yet reported.
- Still outstanding for Step 12: the staging export output; production `fundsignal.source_slug`; production pre-existing `tpl-*` check.
- Operator (2026-11-12, verbatim): "my current user is not the default admin@localhost, but that's intentional. I want them set in the first run with the default user" — re-confirms D-30/D-34: the seeded blend strategy belongs to `admin@localhost`, not to the operator's own account. The export in Step 12 still reads the operator's account (`owner=<operator user id>`), because that is where the source instances live.
- Operator (2026-11-12): in every environment, production included, `fundsignal.source_slug = fundamentals` and `engine.fundamentals_blend_strategy_id = fundamentals_macd_blend`. The D-24 pre-merge slug check is closed: the hard-coded slug (D-4) and blend id (D-34) match all environments. Still outstanding for Step 12: the staging export output; the production pre-existing `tpl-*` check (the D-20 collision guard fails the migration loudly if one exists).
