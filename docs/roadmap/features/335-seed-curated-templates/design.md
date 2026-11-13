# Design: seed-curated-templates

**Created**: 2026-11-12
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-11-12
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

Four parts. Decision IDs refer to `debate.md`.

**1. Seed migrations (hand-authored SQL, no generator — D-1, D-2).** Files are named by slug and
numbered at merge (trunk tips 007 / 027 / 015, recon § Dependencies):

| Service | File | Writes |
|---|---|---|
| indicators | `008_seed_formula_templates` | 9 rows in `indicators.formula_templates` |
| analysis | `028_seed_strategy_templates` | 14 rows in `analysis.strategy_templates` |
| analysis | `029_seed_fundamentals_blend_strategy` | the blend strategy for `admin@localhost` in `analysis.strategies` |
| ingest | `016_seed_source_templates` | 4 rows in `ingest.source_templates` + the system `fundamentals` row in `ingest.signal_sources` |

- Template up-files: one `INSERT … VALUES … ON CONFLICT (template_id) DO NOTHING`, text columns
  dollar-quoted `$t$`, `created_by='system'`, `template_id='tpl-<slug>'`, payload in the exact form
  `ManageTemplate` stores per service (recon § Codebase Map: indicators camelCase with strict
  `ParseDict`, `servicer.py:708,852`; analysis snake_case with rules as JSON strings,
  `servicer.py:3663-3674`; ingest the 6-key subset, `servicer.py:169`). Followed by one collision
  guard that raises when a seeded id is held by a non-system row (D-20). No `-- requires-env` header
  and no explicit `COMMIT`, so `render-migrations.sh:23-31` copies them verbatim and assertion files
  can include them.
- Template down-files: delete only seeded ids still at `version = 1`, not retired, `created_by =
  'system'`; analysis down runs before indicators down (D-3).
- Blend strategy (D-30, D-33, D-34): one statement inserting `fundamentals_macd_blend` for the user
  found by `SELECT … FROM identity.users WHERE email='admin@localhost'`, **active and not live**,
  `ON CONFLICT (user_id, strategy_id) DO NOTHING`; nothing is inserted when that user is missing. The
  definition is the staging blend in REGISTER's stored form and references only the existing system
  formula `d1ff5e6b-…`. Down is a no-op (D-35). This is the only migration-time cross-schema read in
  the repo, recorded as an exception (D-37).
- Blend template for other users (D-31, D-28): default `strategy_id` `fundamentals_macd_blend_copy`;
  its formula component points at a separate composite formula template named "Fundamentals
  Value+Quality Composite (template)", whose payload is pinned to the code module
  (`fundamentals_value_quality.py:65,67,76,90`) and never references the system formula.
- System `fundamentals` source (D-4, D-16 exception, D-24): inserted under an advisory lock only when
  no holder of the slug exists, with the producer's own values (`fundsignal_loop.py:619-625`). The
  ingest down never touches `signal_sources`.
- No formula or strategy row is seeded as `system` (D-16).

**2. Read-only system templates (D-14, D-17, D-18).** `ManageTemplate` in indicators, analysis and
ingest loads the row before UPDATE/RETIRE and aborts `PERMISSION_DENIED "system template '<id>' is
read-only"` when `created_by` is the system sentinel. `common.v1.TemplateMeta` gains `bool read_only =
9`, set server-side. Consumer surfaces (C-14): the config-ui templates page shows a `System` badge
instead of Edit/Retire; agent `list_templates` returns `readOnly` when true and
`docs/runbooks/mcp-tools.md` documents it; `/insights/templates` and the strat-lab skill need no
change. Future catalog changes ship as version-guarded migrations, never `DELETE` (D-19).

**3. Proof (D-5, D-7, D-8, D-21, D-23, D-26, D-36).**
- *Operator export* — a committed read-only SQL is run by the operator on staging; its raw output is
  the committed snapshot. `scripts/check-seed-template-parity.py` compares seed text by md5 and JSON
  structurally against it, derives and checks the formula-id→template-id map, asserts
  `user_id`/`origin`/`warnings`/`active`/`live_enabled` are absent from strategy payloads, and lists
  the two intentional blend differences. One pytest cross-checks the seeded id set across every
  artifact that repeats it.
- *Validity* — per-service tests (inline seed parser each) run every payload through the RPC path's
  validators; the analysis test also drives the real `InstantiateTemplate` handler for all 14
  templates as a non-admin and validates the blend-strategy literal as REGISTER would.
- *Real PostgreSQL* — `scripts/migration-assertions/{indicators-008,analysis-028,analysis-029,
  ingest-016}.sql` build their own states inside `BEGIN … ROLLBACK`, include the migration and assert
  (replay, down, slug absent / user-held / existing system row, admin present / already owning /
  absent). The three "has seed rows" blocks in the 007/026/013 assertion files are deleted.
  `migration-rerun.py:1114` moves to the new final versions; `REPLAYS` is unchanged (D-6, D-29).
- There is no post-deploy behaviour check (D-32).

**4. Existing checks adjusted (D-10, D-11).** `test_strategy_templates_real_pg.py:30` keeps its
single-file guard but keys on `CREATE|ALTER TABLE`; `test_formula_templates.py:296` is renamed; CI path
filters gain the cross-tree inputs; seed files are located by slug glob.

**Landing (D-38, D-27).** The four migrations, their tests/assertions and the version bump land as one
atomic unit. Seeds are applied PRE_DEPLOY minutes before the guarded images start; accepted.

## Rejected Alternatives

- `R-1` Committed generator + data file + "SQL == generator output" check — F-01 freezes the output, and parity becomes circular.
- `R-2` Adding the seed files to `REPLAYS` — redundant; pass 3 already downs and re-ups them.
- `R-3` New `local_pg` real-PG tests per service — only analysis has the fixture; `migration-rerun` covers all schemas.
- `R-4` Leaving seeded templates admin-editable (C-10(c) waiver) — operator declined; retiring a shared formula template breaks dependent strategy templates.
- `R-5` Shared `scripts/` parser imported by service tests — cross-tree dependency for a grammar F-01 freezes.
- `R-6` Rewriting `platform.feature` `@AC-15 @feature-224` in place — promoted scenarios are never rewritten; supersede by comment (feature 302 precedent).
- `R-7` Blend-strategy down that deletes a row that looks untouched — cannot prove the migration wrote it (`fails.md:3834-3841`).
- `R-8` Reading `config.config_values` in the migration for the blend id — one row per environment in the same database; a second cross-schema read.

## Open Risks

- [ ] The seeded blend for `admin@localhost` can never be deactivated through the API (operator chose "active" with that stated); one `SetStrategyLive(true)` by that account creates a second permanently-live blend, recoverable only by SQL or the global kill-switch `engine.fundamentals_blend_enabled` — documented in the analysis CLAUDE.md note (docs step).
- [ ] Unproven before production (behaviour check dropped by the operator): the deployed indicators saga on seeded rows, the asyncpg JSONB read of seeded payloads, numeric backtest equality with the staging originals — partially offset by the all-14 handler test (analysis test step).
- [ ] The seed SQL is hand-authored; the checker's parsing of the dollar-quoted literals is the trust boundary — covered by a good/bad parser test incl. a trailing-newline case (checker step).
- [ ] The operator export is a prerequisite: seeds cannot be authored (notably `extractor_module`) or parity-checked until it is committed — first implementation step.
- [ ] Production/homelab `analysis.fundsignal.source_slug` and pre-existing `tpl-*` rows are unverified; the collision guard fails the migration loudly if an id is taken — recorded before merge (operator step).
- [ ] Migration-time coupling of analysis to `identity.users(email, user_id)` — caught by `migration-rerun` on a rename; documented (docs step).
- [ ] While the operator and `admin@localhost` both hold the blend id it is "ambiguous" for the boot recompute (harmless) — noted in the analysis CLAUDE.md (docs step).
- [ ] The SEC User-Agent contact email is seeded verbatim into every environment (operator decision).
- [ ] Feature 318 `fix-migration-tooling-safety` overlaps `migration-rerun.py` and dirty-recovery replay — re-check at execute.

## Constitution Rules Touched

- `C-07` — honored by: `NNN_description.{up,down}.sql`, NNN re-derived from the union of origin refs at merge.
- `C-08` / `P-06` — honored by: each guard and each migration has a paired test step; guard tests are written RED first.
- `C-09` — honored by: `read_only = 9` is additive; `buf lint`, `buf breaking`, `buf-gen.sh` in the proto step.
- `C-10` — honored by: (c) RPC guard + read-only UI + the sentinel convention recorded in `docs/context-constitution.md`; every `TemplateMeta` consumer listed and closed (D-18).
- `C-12` / `C-13` — honored by: e2e extends `e2e/fixtures/templates.ts`; Python fakes stay inline until a second consumer.
- `C-14` — honored by: config-ui templates page and agent `list_templates` named and changed; the seeded blend is reachable through `admin@localhost`'s existing strategies list.
- `C-15` — honored by: retired scenarios replaced by comments, new scenarios AC-22+, each traced to a test or assertion.
- `C-16` — honored by: one CHANGE with operator sign-off, by supersession (D-25); see below.
- `C-17` — honored by: the badge reuses the existing `Badge` primitive.
- `C-18` — honored by: no generator, no shared parser module, no REPLAYS change, no new real-PG infrastructure.
- `F-01` — honored: no applied `.up.sql` is edited; the "No seed rows (AC-15)" comments in 007/026/013 stay.
- `F-06` — honored: no new pool or connection.
- `F-07` — honored: the hard-coded slug and blend id are migration data, not runtime config reads.

## Business Rules Touched (C-16)

- CHANGE `@AC-15 @FR-7 @feature-224` "Catalog starts empty after migration" (`docs/sdd/business-rules/platform.feature:270`) — superseded by a new `@feature-335` scenario at launch, with a comment marking the old one; signed off by user @ 2026-11-12 (context.md).
- EXTEND `@AC-1 @feature-156` "The producer runs its first cycle promptly on a fresh deploy" — the source now exists from migration; the producer's registration stays a tolerated `ALREADY_EXISTS`.
- EXTEND `@AC-1`/`@AC-2`/`@AC-3 @regression @feature-269` and `@AC-13`/`@AC-14`/`@AC-31 @feature-224` — UPDATE/RETIRE semantics now apply to non-system templates only; system rows are refused.
- PRESERVE `@AC-36`, `@AC-26 @feature-224` (`platform.feature:319,297`) — no second holder of a user-held `fundamentals` slug; seeded row is `system`/`derived`.
- PRESERVE `@AC-4`/`@AC-6`/`@AC-8 @feature-186` — blend protections unchanged; they are the reason the seeded blend cannot be deactivated.
- PRESERVE `@AC-18`, `@AC-19`, `@AC-20`, `@AC-34 @feature-224` — saga deep-copy, id suffixing, `ALREADY_EXISTS`.
- PRESERVE `@AC-6 @feature-224`, `@AC-23 @feature-224`, `@AC-6 @feature-201`, `@AC-27`/`@AC-33`/`@AC-7`/`@AC-8 @feature-224`, `@AC-39 @feature-294`, `@AC-25`/`@AC-32`/`@AC-24 @feature-224`, `@AC-4 @feature-241` — untouched (recon § Existing Business Rules).
