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
  - 244-fix-python-config-zero-trap also touches `services/xstockstrat-indicators/app/config/watcher.py`
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
