# Debate Register: seed-curated-templates

**State**: in-debate
**Mode**: full
**Rounds run**: 1 (round numbers continue across runs; the mode's 2–5 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-12 | /sdd-design | 12 | 3 | 5 | 14 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | Seed SQL is hand-authored; the committed `.up.sql` is the source of truth; no committed generator. Files: indicators `*_seed_formula_templates`, analysis `*_seed_strategy_templates`, ingest `*_seed_source_templates` (NNN = 008 / 028 / 016, re-derived at merge). | `scripts/render-migrations.sh:23-31` (header-less files copied verbatim) | settled |
| D-2 | 1 | Row grammar: one `INSERT … VALUES … ON CONFLICT (template_id) DO NOTHING` per up file; text columns dollar-quoted `$t$`; payload in the exact form `ManageTemplate` CREATE stores (indicators camelCase; analysis snake_case, rules as JSON strings; ingest 6-key subset); `created_by='system'`; no `-- requires-env` header and never an explicit `COMMIT`. | `services/xstockstrat-config/migrations/008_analysis_fundsignal_keys.up.sql:10-48`; `services/xstockstrat-ingest/migrations/013_signal_ownership_templates.up.sql:35-52`; `services/xstockstrat-indicators/app/handlers/servicer.py:708`; `services/xstockstrat-analysis/app/handlers/servicer.py:3663-3674`; `services/xstockstrat-ingest/app/handlers/servicer.py:169` | settled |
| D-3 | 1 | Template down: `DELETE … WHERE template_id IN (<seeded ids>) AND version = 1 AND retired_at IS NULL AND created_by = 'system'`. Down headers state the order "analysis down before indicators down". | product-spec FR-6 | settled |
| D-4 | 1 | System `fundamentals` source: one `DO $$` block — `pg_advisory_xact_lock(hashtext('fundamentals'))`, then insert `('system','fundamentals','Fundamentals Signal Producer','derived','app.extractors.noop',NULL,NULL,TRUE,1.0)` only when **no holder of the slug exists**. The ingest down never touches `signal_sources`. | `services/xstockstrat-ingest/app/handlers/servicer.py:1427-1437,1570`; `services/xstockstrat-analysis/app/engine/fundsignal_loop.py:619-625,631-634` | settled |
| D-5 | 1 | Real-PostgreSQL proof lives in the existing `migration-rerun` job as `scripts/migration-assertions/{indicators,analysis,ingest}-<NNN>.sql`; each file `BEGIN`s, builds its own precondition state, `\ir`-includes the migration, asserts, `ROLLBACK`s. `ingest` builds three states: slug absent, slug user-held, system row with weight 0.4. | `scripts/migration-rerun.py:397-398,579-593`; `scripts/migration-assertions/fixtures-pre-224.sql:18-22` | settled |
| D-6 | 1 | `scripts/migration-rerun.py:1114` final versions bump 15→16 / 27→28; `REPLAYS` is **not** extended (pass 3 already runs each new down and re-applies each up). | `scripts/migration-rerun.py:1102-1114` | settled |
| D-7 | 1 | The "has seed rows" blocks in `indicators-007.sql:45-47`, `analysis-026.sql:9-10`, `ingest-013.sql:67-68` are deleted; the new assertion files assert the exact seeded id set with `created_by='system'` instead. | `scripts/migration-rerun.py:1119-1120` | settled |
| D-8 | 1 | Per-service validity tests push every seeded payload through the validators the RPC path uses: indicators strict `ParseDict` + `_validate_register_payload` + one sandbox run per source; analysis the real `_validate_template_definition` against formula templates parsed from the indicators seed; ingest `validate_config_json` + `_TEMPLATE_PAYLOAD_FIELDS` subset. | `services/xstockstrat-indicators/app/handlers/servicer.py:823,852`; `services/xstockstrat-analysis/app/handlers/servicer.py:3589-3627`; `services/xstockstrat-ingest/app/repositories/signal_sources.py:235-285` | settled |
| D-9 | 1 | Parity checker `scripts/check-seed-template-parity.py` (+ pytest) compares seeds to a committed snapshot `scripts/testdata/seed-templates-staging-2026-11-12.json`. Strategy payloads must **not** contain `user_id`, `origin`, `warnings`, `active`, `live_enabled` (asserted absent). The uuid→`tpl-*` map is **derived and checked**, not trusted: slug(name of the snapshot formula with that id) must equal the mapped id; every custom-formula uuid in the 14 strategies is mapped; duplicate formula names fail. | `services/xstockstrat-agent/app/client.py:1118`; `packages/proto/analysis/v1/analysis.proto:343-393` | settled |
| D-10 | 1 | Seed files are located by slug glob, never by NNN, in every test and script; CI path filters gain the cross-tree inputs (seed globs + checker for the three services; `services/*/migrations/*_seed_*` for `scripts`). | `.github/workflows/ci.yml:55-59,68-69`; `scripts/migration-rerun.py:521-534` | settled |
| D-11 | 1 | `test_strategy_templates_real_pg.py:30` keeps `== [026]` but selects files matching `(CREATE\|ALTER)\s+TABLE[^;]*analysis\.strategy_templates`; `tests/test_formula_templates.py:296` is renamed (its AC-15 trace is dropped). | `services/xstockstrat-analysis/tests/test_strategy_templates_real_pg.py:14-33` | settled |
| D-12 | 1 | FR-11 drift guard: an indicators test compares the composite seed row with `SOURCE` / `PARAMETERS` / `OUTPUTS` / `FUNDAMENTAL_INPUTS`. The composite's parity reference is the code module (staging's row *is* the boot-upserted system formula). | `services/xstockstrat-indicators/app/formulas/fundamentals_value_quality.py:26,65,67,76,90`; `app/services/seed_formulas.py:21` | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Committed generator + data file + CI "SQL == generator output" | F-01 freezes the output once applied, so the generator is a permanently pinned liability; parity becomes circular (the generator's transform is the allowlist). | locked |
| R-2 | 1 | Add the three seed files to `REPLAYS` in `migration-rerun.py` | Redundant (C-18): pass 3 already downs and re-ups them (`scripts/migration-rerun.py:1102-1113`), and the assertion files replay after mutation. | locked |
| R-3 | 1 | Prove the seeds with new `local_pg` real-PG tests in each service | Only analysis has the fixture; the `migration-rerun` job already covers all three schemas on real PostgreSQL. | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | Snapshot is an LLM transcription of MCP output; SQL and snapshot can share one error, the post-deploy re-capture is a second transcription, and `extractor_module` is not readable through MCP at all (P-03 / C-15 on AC-13). | yes | open |
| O-2 | 1 | Strategy parity allowlist omitted `user_id`/`origin`/`warnings` → would leak the operator's user id into every environment's catalog. | yes | closed @ round 1 (D-9) |
| O-3 | 1 | `formula_template_ids` map was hand-written and unchecked, so the FR-3 rewrite check proved nothing. | yes | closed @ round 1 (D-9) |
| O-4 | 1 | CI fixture already holds `fundamentals`, so the FR-8 insert branch and the @AC-36 user-held case never run. | yes | closed @ round 1 (D-5) |
| O-5 | 1 | Cross-tree tests escape the CI path filters and hard-code NNN. Sub-question still open: shared `scripts/` parser imported by service tests vs a ~15-line inline parser per service (grammar is frozen by F-01, so duplication cannot drift). | no | open |
| O-6 | 1 | `REPLAYS` addition redundant (C-18). | no | closed @ round 1 (D-6, R-2) |
| O-7 | 1 | The proposed `real_pg:30` fix weakened a schema guard. | no | closed @ round 1 (D-11) |
| O-8 | 1 | C-10(c): seeded formula templates are a shared resource the strategy templates depend on; FR-10 leaves them unprotected without explicit operator sign-off. Retiring one formula template makes its dependent strategy templates uninstantiable. | yes (needs sign-off) | open |
| O-9 | 1 | Blend id decided silently: non-admin default-id instantiate of `tpl-fundamentals_macd_blend` → `FAILED_PRECONDITION`; an admin taking the default id gets the protected blend (cannot be deactivated once live, @AC-4/@AC-6 @feature-186); a copy under another id is not governed by the fundamentals universe. No AC pins it. | yes (needs decision) | open |
| O-10 | 1 | Slug `fundamentals` is fixed in SQL but `analysis.fundsignal.source_slug` is configurable and the producer is off by default; an environment with another slug gets a dead, reserved system source. Staging verified `fundamentals` (get_config 2026-11-12); production/homelab not verified. | no | open |
| O-11 | 1 | Amending `platform.feature` in a docs step is hand-authoring (`docs/sdd/business-rules/CLAUDE.md:51-52`); "9/14/4" is not durable since admins may retire. | no | open |
| O-12 | 1 | `ON CONFLICT DO NOTHING` skips silently if an environment already has an admin row under a `tpl-*` id; only staging was checked empty. | no | open |
| O-13 | 1 | Down ordering across services undocumented. | no | closed @ round 1 (D-3) |
| O-14 | 1 | The 27 ids live in ≥7 artifacts; only up↔down is cross-checked (`fails.md:393`). | no | open |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
