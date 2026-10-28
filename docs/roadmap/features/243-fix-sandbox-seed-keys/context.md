# Context Log: fix-sandbox-seed-keys

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-10-20 (/sdd-triage)

- Bug recorded as defect report `docs/reports/2026-10-19-indicators-sandbox-seed-keys-unprefixed-defect.md`
  (Issues disabled): indicators sandbox config seeds use bare keys and never apply.
- Severity: SEV-2. Environment: dev (main-dev) @ 1302e6d. Report marks config-only fix possible (yes) and impact
  type `config-propagation`, which would route Track B.
- **Operator decision (2026-10-20): fix in code plus a config migration, not a manual SetConfig.** This overrides
  the Track B (config-only `SetConfig create_key`) route; routed to SDD path (Track C) instead. Fix Scope DB
  migration line ticked accordingly.
- Created: status.md, feature.md, product-spec.md, acceptance.feature (AC-1 migration result, AC-2 watcher
  resolution, AC-3 description), context.md.
- Affected services (from report): xstockstrat-indicators, xstockstrat-config.
- Root cause hypothesis: 001/002 seeds namespace-relative keys; CONFIG-9 serves the raw `key` column, so
  `indicators.sandbox.*` getters never match.
- Confirmation evidence (report, confidence high, static; triage re-grep 2026-10-20): bare seeds at
  `001_config_tables.up.sql:62-64` and `002_config_environment.up.sql:61-63`; watcher reads full-dotted at
  `watcher.py:134,138,142-143`; zero `indicators.sandbox` hits in config migrations. Feature 228 context.md
  independently observed staging config showing bare `sandbox.*` keys at 128 MiB.
- Additional triage finding: migration 029 (feature 189) healed bare keys only for
  `platform/trading/portfolio/marketdata` (`029_heal_config_keys_full_dotted.up.sql:28`); its guarded
  `UPDATE … SET key = namespace || '.' || key` is the reuse candidate. Latest config migration is 030, so next is
  031 at triage time; recon must re-check for collisions with in-flight features.
- Design fork (must be decided, not defaulted): healing activates the 002 production seeds, a live production
  change (timeout 5000 → 3000 ms; memory 128 MiB → 64 MiB headroom). Feature 228's operator decision
  (2026-10-15) chose a 128 MiB default headroom over 64 MiB, so the production `memory_bytes` value needs an
  explicit operator call. AC-2 uses a fixture value (100663296) to test key resolution independent of that choice.
- Overlaps:
  - 244-fix-python-config-stored-zero also touches `services/xstockstrat-indicators/app/config/watcher.py`
    (`get_int` zero-trap); soft ordering, whichever lands second reconciles.
  - hotfix `fix-sandbox-overrides-unclamped` (PR #1263, `origin/hotfix/fix-sandbox-overrides-unclamped`) clamps
    `ExecuteFormula` overrides to the configured limits, so once production rows resolve the clamp ceiling tightens
    with them.
  - 228-fix-indicators-sandbox-matrix (launched) deferred "production seed correction, config migration 031" as a
    design decision (`228/recon.md:120,148`).
- Recommended design depth: full → `/sdd-design fix-sandbox-seed-keys` (rationale: SEV-2; DB (config) migration;
  2 affected services; production limit change needs a decided value).
- Development branch: feature/fix-sandbox-seed-keys

## Session 2026-10-20 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready. Criteria: PASS WITH WARNINGS (0 fails, 0 floor breaches).
  Overlap: WARN (no FAIL-level collision; no merge-order write).
- Warnings (spec-reviewer, 5):
  1. [C-15 / P-06] @AC-2 not red-first: watcher already reads full-dotted keys (`watcher.py:134,138`). Resolved:
     @AC-2 labelled a getter-contract guard (Gherkin description, `acceptance.feature:17-18`); red-first proof
     is @AC-1/@AC-3. Sourcing @AC-2 from the migrated seed cannot be red-first: operator values (5000 /
     134217728) equal the code defaults, so the default satisfies the Then. Fixture values kept.
  2. [P-03] production timeout set silently at 3000 in @AC-1. Resolved by operator decision: @AC-1 now asserts
     5000 / 134217728 in `production` and `staging` (`acceptance.feature:12-13`).
  3. Fix Scope "Config key value change" unticked. Resolved: ticked; stored production rows change, effective
     limits do not (`product-spec.md` Fix Scope).
  4. [C-14 / C-10] /insights missing from Consumer Surface(s). Resolved: added; `formulaReference.ts:168-175`
     and `indicator-builder.md:154-155` stay accurate (values unchanged), so xstockstrat-ui is not an affected
     service.
  5. Criterion 2: code fix scope open-ended; `SCALAR_BOUNDS_REGISTRY` entries would be new validation with no
     @AC. Deferred to design; Fix Scope now states: if adopted, append @AC-4+ (C-15) and follow CONFIG-11.
- Extra edits (clearly correct, low cost): @AC-3 gains `one row is returned for each of environments
  "production" and "staging"` (zero rows made it vacuously true pre-fix) and `no row's description contains
  "64MB"` (002 production description `002_config_environment.up.sql:62`); Expected states the decided values and
  that `allowed_imports` seed equals the code default.
- Reviewer notes for recon: unique index `config_values_scope_uniq` (`017_config_secrets_and_scoping.up.sql:101-102`)
  collides if a full-dotted row already exists → upsert, not plain rename; check per-user bare rows and missing
  001/002 rows; faithful down migration; reuse 029 `NOT LIKE` guard (`029_heal_config_keys_full_dotted.up.sql:24-28`);
  raw SQL `UPDATE` fires no `pg_notify` (CONFIG-4) → subscribers keep the old snapshot until config reload/restart.
  analysis/ingest copy-paste sandbox getters (analysis `watcher.py:150-160`, ingest `watcher.py:168-178`) read
  their own namespaces, unaffected.
- Overlap findings (feature-overlap, WARN):
  - migration NNN: 031 claimed here; 241-fix-config-audit-author-spoof may take 031 if its design adopts a config
    migration (`241/product-spec.md:49`). Second to merge renumbers to 032. 031 still free on origin/main-dev
    (a8e0f58d) 2026-10-20; re-check at impl-spec review.
  - `services/xstockstrat-indicators/app/config/watcher.py`: 244-fix-python-config-zero-trap edits `get_int`
    bodies (`:96,114,130`); sandbox getters call `get_int` (`:134,138`). Shared test home
    `tests/test_config_watcher.py`. Soft ordering; second lander reconciles.
  - `services/xstockstrat-config/src/grpc/configServiceImpl.ts` `SCALAR_BOUNDS_REGISTRY` (`:100-146`): conditional
    243 bounds rows vs conditional 244 `minValue: 1` revision (`:113-117`). Different hunk vs 241 attribution
    change (`:388,404-407,507`), low risk.
  - No duplicate config keys; no proto overlap. merge-order.md has no 241/243/244 entry; recommended: blocking
    241-after-243 (or renumber-second) only if 241 adopts a config migration; optional 243/244 soft-ordering row.
  - Hotfix PR #1263 (`origin/hotfix/fix-sandbox-overrides-unclamped`) not on trunk; clamp ceiling = row value
    once rows resolve.
- Operator decisions (relayed verbatim by the workflow orchestrator, 2026-10-20):
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Fix in code + a config migration (not a manual SetConfig / Track B).
  - Fixed full-dotted rows hold the values prod effectively runs today: indicators.sandbox.timeout_ms = 5000 and indicators.sandbox.memory_bytes = 134217728 (128 MiB headroom per feature 228) in both environments — no behaviour change; stale 'memory cap' descriptions become 'headroom'.
  - Interacts with open hotfix #1263 (override clamp): once rows resolve, the clamp ceiling is the row value.
- Next: `/sdd-design fix-sandbox-seed-keys` (full — operator: no quick designs).

## Session 2026-10-20 — sdd-review product-spec (re-review)

- Re-review result: criteria PASS WITH WARNINGS (0 fails, 0 floor breaches, 10 warnings); overlap WARN (no
  FAIL-level collision; no merge-order write). Status was already `spec-ready` (commit 637e5533). No transition
  occurred, so `status.md` and `feature.md` Status History are unchanged. Next Action stays
  `/sdd-design fix-sandbox-seed-keys` (full).
- The reviewers read the pre-637e5533 draft (main checkout). Warnings 2, part of 3, and the 3000/64 MiB parts of
  4 were already resolved by the operator values 5000/134217728.
- Warnings (spec-reviewer, 10) and resolution:
  1. [Crit 2+8] No numbered FRs; no `@FR-n` tags. Resolved: `## Functional Requirements` FR-1..FR-4 added;
     scenarios tagged @AC-1/@FR-1, @AC-2/@FR-2, @AC-3/@FR-3, @AC-4/@FR-4.
  2. [Crit 9, C-15/P-03] Unticked "Config key value change" and AC-1 at 3000. Already resolved by 637e5533:
     the box is ticked, and AC-1 asserts 5000/134217728, so no 3000-5000 ms timeout regression is possible.
  3. [Crit 8, P-06] AC-2 is not red-first. Already labelled a getter-contract guard. The reviewer's
     migrated-DB variant cannot be red-first, because the row values equal the code defaults. Added the
     `indicators.sandbox.allowed_imports` row (`get_str_present`, `watcher.py:140-144`) with fixture "numpy,math"
     resolving to `["numpy", "math"]` (new `resolved` column).
  4. [Crit 8, CONFIG-10] Resolved: AC-1 now asserts value_type int/int/string and the `allowed_imports` value in
     both environments. Staging/production values were already asserted. AC-3 already forbids "64MB".
  5. [Crit 7, C-07/F-01] Heal conflict-safety. Resolved: FR-4 plus new @AC-4. A pre-existing full-dotted row
     must not abort on `config_values_scope_uniq` (`017_config_secrets_and_scoping.up.sql:101-102`), and no bare
     duplicate may remain. The Fix Scope DB line names the 029 plain-UPDATE hazard. Open for design: which value
     wins, what the down migration restores, per-user bare rows, the 002 `default_value` column (3000/67108864),
     and the no-`pg_notify` reload (CONFIG-4; harmless because the values equal the defaults).
  6. [Crit 4, C-18] The indicators code scope is open-ended. Resolved: Affected Services and Fix Scope state that
     the source already reads the full-dotted keys (`watcher.py:133-144`), so code scope is set at design under
     C-18. Any `SCALAR_BOUNDS_REGISTRY` rows now append @AC-5+ (AC-4 is taken).
  7. [Crit 1] No persona. Resolved: "Who is affected" line added (operator in `/config-ui`; formula authors via
     `test_formula` and `/insights` Run).
  8. [C-10] Duplicated bare-key surface. Resolved: Fix Scope doc bullet adds `docs/runbooks/config-rollout.md:180`
     and `services/xstockstrat-indicators/CLAUDE.md:12`.
  9. [C-16, for design] design.md must record durable suites
     `services/xstockstrat-indicators/acceptance/indicators-sandbox-os-isolation.feature:46-50` (AC-6, config-read
     limits) and `fix-indicators-sandbox-matrix.feature:17-24` (64 MiB / 16 MiB headroom) as preserved/extended.
  10. Informational: crit 3/4/5/6/11, C-1..C-5 skipped (non-trading), no F-* breach; code claims verified.
- Overlap findings (feature-overlap, WARN):
  - `services/xstockstrat-indicators/app/config/watcher.py`: 244 rewrites the getter trap sites (`:96,114,130`)
    that the 243 readers call. Soft ordering, as already recorded.
  - `services/xstockstrat-config/src/grpc/configServiceImpl.ts` `SCALAR_BOUNDS_REGISTRY` (`:100`): conditional
    243 rows vs 240 (row `:145`), 244 (`:115-117`), and 241 (`:388`, disjoint hunk). Textual rebase only, and
    real only if design adopts bounds.
  - Migration 031: no claim on this tree. Verified 2026-10-20 with `git log --remotes -- services/xstockstrat-config/migrations/`:
    no 031+ config migration on any remote branch. 241's config migration remains an unnumbered design fork. If
    241 claims 031, the second to merge renumbers to 032.
  - Config keys / proto: no duplicates, no overlap.
  - `origin/feature/fix-sandbox-memory-cap`, verified 2026-10-20: a docs-only orphan triage, draft "229" (that NNN
    is held on main-dev by `229-fix-book-portfolio-page`), tip 6c0c36d0, not merged to main-dev. It covers a
    different defect (RLIMIT_DATA not enforced on the deployed runtime). It has no config migration and no key
    overlap. Its effective limits are unchanged by 243.
  - Hotfix PR #1263 (`origin/hotfix/fix-sandbox-overrides-unclamped`, 3340a7c6, not on main-dev), verified file
    set: `app/handlers/servicer.py`, `tests/test_execute_formula_override_clamp.py`, `docs/runbooks/hotfix-log.md`,
    and `services/xstockstrat-indicators/CLAUDE.md` Config Keys table (~:97-103). The CLAUDE.md file overlaps
    243's doc fix (rebase only). Behavioural: the clamp ceiling becomes the row value (5000 ms / 128 MiB), with
    no change in effect.
  - 247 (agent GetConfig deadline) and 250 (indicators telemetry): no code overlap. merge-order.md has no 241-251
    row, and none is recommended now.
- Operator decisions:
  - Standing authorization: designs run in FULL mode only (no quick designs for automated fixes); the orchestrator auto-approves the design gate once rounds >= 2, no unresolved Floor (F-*) breach remains, no blocking objection remains, and every CHANGE to an existing @AC business rule is covered by an operator decision below.
  - Fix in code + a config migration (not a manual SetConfig / Track B).
  - Fixed full-dotted rows hold the values prod effectively runs today: indicators.sandbox.timeout_ms = 5000 and indicators.sandbox.memory_bytes = 134217728 (128 MiB headroom per feature 228) in both environments — no behaviour change; stale 'memory cap' descriptions become 'headroom'.
  - Interacts with open hotfix #1263 (override clamp): once rows resolve, the clamp ceiling is the row value.
- Files modified: product-spec.md (persona, FR-1..FR-4, Affected Services, Fix Scope DB/code/doc bullets),
  acceptance.feature (@FR tags; AC-1 value_type + allowed_imports; AC-2 allowed_imports row; new @AC-4).
- Next: `/sdd-design fix-sandbox-seed-keys` (full — operator: no quick designs).

## Session 2026-10-20 — sdd-design

- **Phase 0 Recon:** wrote recon.md.
  - Services: xstockstrat-config, xstockstrat-indicators.
  - Consumer surfaces `/insights`, `/config-ui` and agent `test_formula` were reconned read-only. None changes.
  - Key reuse patterns:
    - the 029 guarded rename (`029_heal_config_keys_full_dotted.up.sql:24-28`);
    - the 030 insert with `ON CONFLICT` (`030_…up.sql:22-23,55`);
    - the `indicators-007.sql` assertion blocks run by `migration-rerun.sh:183-190`.
- **Phase 1 Grilling:** 2 rounds (full).
  - Termination: auto-approved by the orchestrator under the operator standing authorization (rounds >= 2, no
    Floor breach, no blocking objection, no uncovered CHANGE).
  - The round-1 blocking objection (the G1 audit had no owner) closed in r2. The r2 adversary verdict is SOUND.
- **Chosen approach:** one forward-only config migration, 031. Full design: design.md.
  - Up statements, in order:
    1. pre-state snapshot;
    2. twin-wins DELETE;
    3. one rename-plus-literal UPDATE, with values set only where `user_id IS NULL`;
    4. `ON CONFLICT DO NOTHING` insert;
    5. headroom description rewrite.
  - Writes are attributed with `updated_by = 'system:config-migration-031'`.
  - The down is `SELECT 1;` and keeps `config.config_values_premigration_031`.
  - No indicators source change: the getters already read full-dotted keys (`watcher.py:134,138,142`), and the
    request carries no `user_id` (`watcher.py:61-67`).
  - Tests:
    - `scripts/migration-assertions/config-031.sql`: AC-1/AC-3 read-back, and an AC-4/AC-5 BEGIN…ROLLBACK `\ir`
      replay;
    - an AC-2 parametrized getter test.
- **Rejected:**
  - fork 1b twin overwrite (a behaviour change);
  - the literal applied to per-user rows;
  - 029's post-rename literal UPDATE;
  - a manual prod gate with a freeze;
  - the 017 DROP+CREATE snapshot;
  - hand-written audit rows;
  - rename-only;
  - the `goto 30` fixture;
  - a symmetric down;
  - `SCALAR_BOUNDS_REGISTRY` bounds;
  - a class-level seed guard;
  - Track B SetConfig.
- **Constitution rules touched:** F-01, F-04, F-07, C-10, C-11, C-14, C-15, C-16, C-18, P-03, P-06, CONFIG-2,
  CONFIG-4, CONFIG-10, config invariant #6. Floor breaches: none.
- **Business rules (C-16):**
  - No CHANGE to any durable @AC.
  - Feature-243 @AC-1..@AC-5 are EXTEND (operator decision 2026-10-20).
  - The feature-173/176/182/184/209/224/228/147 rules are PRESERVE.
- **Design confirmations** (the binding reading for impl-spec):
  - (i) "Fix in code" means the committed migration plus tests, with no indicators source change.
  - (ii) The operator figures "5000 / 134217728 in both environments" mean "the values prod effectively runs
    today". If a production twin exists, twin-wins applies that reading literally.
  - (iii) `config-031.sql` is permanent coupling. A future migration that touches these rows or the
    `config_values` columns must update or retire it.
  - (iv) A later migration may drop `config_values_premigration_031` after operator review. No cleanup is
    scheduled (YAGNI).
- **Open Threads** (from design.md Open Risks; target step in brackets):
  - Production state is unknown until the post-promotion snapshot read. A non-default prod twin keeps its value.
    [G1 prod advisory read-back]
  - An operator-edited global bare prod row is overwritten to the literal. It is inert, attributed and
    snapshotted. [G1 prod read-back]
  - `config_values_premigration_031` is permanent, with no scheduled cleanup. [migration step]
  - main-dev `acceptance.feature` is stale: AC-1 says 3000, and AC-4/AC-5 are missing. Append @AC-5 on the
    feature branch, then run `/sdd-sync` before review or promotion. [/sdd-spec]
  - Feature 241 may change how `updated_by` reaches `changed_by`, and it rewrites `config-governance.md:93-103`.
    [impl-spec review; second to land rebases]
  - Feature 244 shares `tests/test_config_watcher.py`. [AC-2 test step; second to land rebases]
  - The 031 NNN can collide. [migration step; re-verify max NNN just before merge, `fails.md:2909-2912`]
  - `config-031.sql` replays a historical up-file against the HEAD schema forever. [assertion step]
  - Hotfix #1263 overlaps textually on the indicators `CLAUDE.md` and findings `:23`. Its clamp ceiling becomes
    the row value. [docs step]
  - No `pg_notify` is sent. This is safe only under twin-wins; fallback 1b needs a notify or restart.
    [G1 escalation]
  - Non-blocking r2 objections are adopted in the design but not yet confirmed by the proposer. Each must land in
    impl-spec as written: [/sdd-spec, /sdd-review impl-spec]
    - snapshot plus advisory prod read;
    - per-user rename-only;
    - step-4 attribution;
    - 029-shaped red;
    - Given-faithful fixture (i);
    - TEMP baseline;
    - 241 wording;
    - `value_encrypted` exclusion.
- **Ledger:** appended a `fails.md` migration entry: the 029 heal shape is not conflict-safe to reuse.
- **Status:** spec-ready → design-approved.

## Session 2026-10-20 — sdd-spec

- Generated implementation-spec.md with 5 steps. Status: design-approved → implementation-ready.
  1. test: `scripts/migration-assertions/config-031.sql`. Blocks AC-1 and AC-3 come first; the AC-4/AC-5
     `BEGIN…ROLLBACK` `\ir` replay comes last.
  2. migration: `031_heal_indicators_sandbox_keys_full_dotted.{up,down}.sql`.
  3. test: AC-2 parametrized getter-contract test in `tests/test_config_watcher.py`.
  4. docs: headroom wording, full-dotted key, findings row, sentinel row, teardown.
  5. config: G1 staging gate before the main-dev merge, plus the production advisory read-back.
- Appended `@AC-5 @FR-4 @regression` to acceptance.feature (append-only, C-15), as design.md § 4 specifies.
  Coverage: AC-1/3/4/5 → Step 1 (implemented by Step 2); AC-2 → Step 3.
- Key codebase findings:
  - Last config migration is still `030_marketdata_edgar_snapshot_keys` on `origin/main-dev`. No `031*`/`032*` on
    any remote. Feature 241 is implementation-ready with no migration (`241/design.md:43`), so 031 is uncontested.
    Re-verify at Step 5.
  - The migration-rerun harness runs on every `pull_request` (`ci.yml:3-4`), and config migrates with `up` at
    pass 0 (`migration-rerun.sh:78`). So the red→green for Steps 1-2 is CI-proven on the step PR. The executor
    never starts a DB. RED a is `AC-1:` with 031 absent. RED b is a `config_values_scope_uniq` violation from a
    draft 031 without the twin-wins DELETE.
  - No assertion file uses `\ir` yet (**Not found**). psql resolves `\ir` relative to the including file.
  - The "Inert indicators seeds" findings row lives in `services/xstockstrat-indicators/docs/context-constitution-findings.md:23`,
    not in the repo-level findings file. The defect sidecar stays `triaged` (`ref: feature:243-…`); it counts as
    resolved at launch, so no edit is needed.
- Spec-time refinement, within design.md § 1 attribution: every attributed write also sets `caller_identity = NULL`.
  The BEFORE UPDATE trigger copies `NEW.caller_identity` into `config_audit` (`017:71-74`), and the column is meant
  only for internal-caller SetConfig writes (`014:5-9`). Without the reset, a stale value would mis-attribute the
  migration's audit rows. The sentinel row's wording in `config-governance.md` names both fields, so it holds under
  241's rewrite of `:95-103`.
- Snapshot column list (excludes `value_encrypted`): `id, namespace, key, value_type, value_data, is_secret,
  description, default_value, consuming_service, updated_by, update_reason, created_at, updated_at, environment,
  caller_identity, user_id`.
- Design r2 objections, each landed as written:
  - snapshot plus advisory prod read: Step 2.0 and Step 5.3;
  - per-user rename-only: Step 2.2;
  - step-4 attribution: Step 2.4;
  - 029-shaped red: Step 2 TDD;
  - Given-faithful fixture (i): Step 1.4;
  - TEMP baseline: Step 1.4;
  - 241 wording: Step 4.5;
  - `value_encrypted` exclusion: Step 2.0.
- Open threads carried: 244 and hotfix #1263 rebase-only overlaps. Main-dev `acceptance.feature` drift (AC-1 3000,
  no AC-4/AC-5) needs `/sdd-sync` before review or promotion.
- Next: `/sdd-review fix-sandbox-seed-keys impl-spec`.

## Session 2026-10-21 — sdd-review impl-spec

- MODE B (advisory). Criteria verdict: PASS WITH WARNINGS (0 FAIL, 9 WARN). Overlap: WARN (rebase-only, no
  FAIL collision). Status unchanged: implementation-ready.
- Addressed in implementation-spec.md (each claim re-verified on this branch):
  - 030 citations: `030_…up.sql:84-85,117` → `:22-23,55` (file is 55 lines; also `017:121`), Steps 1-2.
  - Step 5 ledger cite `fails.md:642-644` re-worded to what it says (flagged manual AC never run before
    promotion), backing the operator gate; `design.md:165` for the rejected freeze. No "freeze" in fails.md.
  - Step 2 ledger cite → `fails.md:2953-2957`.
  - Step 5: operator runs the staging G1 query and the prod read-back and pastes output into context.md
    (`operator-db-access.md:58`); that paste is the pass condition.
  - Step 1 Verification: coverage threshold N/A (SQL harness; gate = `migration-rerun`).
  - C-14 consumer-surface note mirrored under `## Step Dependencies`.
  - Step 2 nested statements renamed S0-S4; "step-2 literals"/"step-4 text"/"statement 1" → S2/S4/S1;
    Step 5.3 "step-2 pass shape" → "instruction 2's pass shape".
  - Step 1 fixture (ii): added a per-user bare `sandbox.memory_bytes` for `u-243` beside its twin, asserting
    one row (twin, 100663296) remains; exercises S1's non-NULL `COALESCE(user_id,'')` match.
- **Open Threads** (still open, for the /sdd-execute checkpoint):
  - Cross-branch refs unverifiable from this checkout: hotfix #1263, 241 impl-spec Step 12 and `241/design.md:43`
    (241 adopts no migration), 244. Soft ordering + rebase rule stand; if 241 claims 031, second to merge
    renumbers and adds a `merge-order.md` row. Re-verify at Step 5.1.
  - Trunk drift: the root checkout (`ccr-f537be2d-6mwmqf`) and main-dev hold only the 2026-10-20 triage state of
    243 (status draft, AC-1 3000, no AC-4/AC-5). All progress through implementation-ready is on
    `feature/fix-sandbox-seed-keys`; run `/sdd-sync` before promotion.

## Session 2026-10-28 — re-spec (sdd-execute sequential, sdd-batch-execute)

- Branch setup: detached at `origin/feature/fix-sandbox-seed-keys`, `git merge -X ours origin/main-dev` (30465a2f).
- Re-spec of Steps 1-5 against the current codebase (implementation-spec.md only; step bodies):
  - Step 1: `ci.yml` job `migration-rerun` `:633` → `:643`, `/repo` mount `:668` → `:678`. `migration-rerun.sh`
    pass 3 is `:111-181` (was cited `:173-181`, the tail of its recovery check); pass 2 at `:91` now cited.
    main-dev added pass 4 (`:192+`), which runs after the assertion loop (`:183-190`) and touches only
    marketdata, so it does not affect `config-031.sql`. The header text changes from "after all passes" to "after passes 0-3".
  - Step 2: the ledger cite for "029 rename is not conflict-safe" moves from `fails.md:2953-2957` (now the 242
    entry) to `fails.md:2969-2975` (`:2972`). 031 is still free: origin/main-dev ends at `030_marketdata_edgar_snapshot_keys`.
  - Steps 3-5: re-verified, no mismatch. Hotfix #1263 has landed on main-dev (`_clamp_override`). It does not touch
    `tests/test_config_watcher.py`. Feature 241 has not landed, so `config-governance.md:95-103` is unchanged.
