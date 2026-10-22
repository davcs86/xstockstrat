# Product Spec: fix-sandbox-seed-keys

**Type**: bug
**GitHub Issue**: none. Defect report: `docs/reports/2026-10-19-indicators-sandbox-seed-keys-unprefixed-defect.md`
**Severity**: SEV-2
**Created**: 2026-10-20

---

## Problem Statement

**Observed.** Config migrations 001 (`services/xstockstrat-config/migrations/001_config_tables.up.sql:62-64`) and
002 (`002_config_environment.up.sql:61-63`) seed `sandbox.timeout_ms`, `sandbox.memory_bytes` and
`sandbox.allowed_imports` under namespace `indicators` without the namespace prefix. The watcher reads the
full-dotted keys (`services/xstockstrat-indicators/app/config/watcher.py:134`, `:138`, `:142-143`), and the
config service does no namespace auto-prefixing (CONFIG-9). The seeds never match, so production runs on code
defaults (5000 ms, 128 MiB headroom) instead of the seeded production values (3000 ms, 64 MiB). No later
migration seeds or heals the prefixed keys: migration 029's blanket heal is limited to
`platform/trading/portfolio/marketdata` (`029_heal_config_keys_full_dotted.up.sql:28`). The seed descriptions
still say "memory cap", but since feature 228 the value is headroom above the measured `VmData` baseline.

**Who is affected.** The platform operator: `/config-ui` lists bare `sandbox.*` rows (production 3000 ms / 64 MiB)
that indicators never reads, so editing them changes nothing. Formula authors (agent `test_formula`, `/insights`
Run → `ExecuteFormula`): they run under code defaults that differ from the production rows shown.

**Expected.** The sandbox limits apply through full-dotted `indicators.sandbox.*` rows in every environment,
with descriptions matching the headroom semantics. Row values (operator decision 2026-10-20): `timeout_ms` = 5000
and `memory_bytes` = 134217728 (128 MiB headroom, feature 228) in both `production` and `staging`, i.e. the values
production effectively runs today, so no effective behaviour change. `allowed_imports` keeps its seed value
`numpy,pandas,math,statistics`, which equals the code default (`watcher.py:142-144`).

## Reproduction Steps

1. Read `002_config_environment.up.sql:61-62` (bare `sandbox.*` keys).
2. Compare with `watcher.py:134,138` (reads `indicators.sandbox.*`).
3. Grep the config migrations for `indicators.sandbox`: zero hits.

## Root Cause Hypothesis

The seeds were written assuming namespace-relative keys. F-01 forbids editing applied migrations, so the fix is a
new corrective config migration (operator decision, 2026-10-20) rather than a manual `SetConfig create_key`.

## Functional Requirements

- **FR-1** A new config migration renames the bare `indicators` rows `sandbox.timeout_ms`, `sandbox.memory_bytes`
  and `sandbox.allowed_imports` to `indicators.sandbox.*` in `production` and `staging`. It keeps each row's
  `value_type` (`int`/`int`/`string`, CONFIG-10) and sets `timeout_ms` = 5000 and `memory_bytes` = 134217728 in both
  environments. `allowed_imports` stays `numpy,pandas,math,statistics`. It ships as an up+down pair, and 001/002 are
  not edited (F-01). → `@AC-1`
- **FR-2** The indicators watcher resolves the stored full-dotted rows for `sandbox_timeout_ms`,
  `sandbox_memory_bytes` and `sandbox_allowed_imports` instead of its code defaults. → `@AC-2`
- **FR-3** Each `indicators.sandbox.memory_bytes` row's description names headroom above the measured `VmData`
  baseline and contains neither "memory cap" nor a hard-coded "64MB". → `@AC-3`
- **FR-4** The heal is conflict-safe. A pre-existing full-dotted row in the same scope (for example an operator
  `SetConfig create_key`, the defect report's alternative remedy) does not abort the migration on
  `config_values_scope_uniq` (`017_config_secrets_and_scoping.up.sql:101-102`) and leaves no bare duplicate.
  Which value wins is decided at design. → `@AC-4`

## Affected Services

- xstockstrat-config (corrective seed/heal migration)
- xstockstrat-indicators (consumer; source already reads the full-dotted keys, `watcher.py:133-144`; code-side part of the fix per operator decision, scope set at design)

## Fix Scope

- [x] No proto changes anticipated
- [x] DB migration anticipated: config migration (next free NNN, 031 at triage time; still free on main-dev 2026-10-20, re-check at impl-spec review) healing `indicators` bare `sandbox.*` rows to full-dotted `indicators.sandbox.*` (both environments) and correcting the `memory_bytes` descriptions to headroom semantics; up+down pair (F-01: 001/002 not edited). Conflict-safe per FR-4: a plain `UPDATE … SET key = namespace || '.' || key` (029's shape) aborts on `config_values_scope_uniq` when a full-dotted row already exists. The winning value and what the down migration restores are decided at design. Raw-SQL writes fire no `pg_notify` (CONFIG-4), so running subscribers keep their snapshot until the config service reloads. That is harmless here because the row values equal the code defaults; confirm at design
- [x] Config key value change: stored production rows change (002 seeds 3000 ms / 67108864 → 5000 ms / 134217728, operator decision 2026-10-20); staging seeds (001) already hold 5000 / 134217728. Effective limits do not change: both equal the code defaults every environment runs on today (`watcher.py:134,138`)
- [x] Code fix per operator decision. Scope is set at design under C-18, because the indicators source already reads the full-dotted keys. Candidates: tests and the docs below. Any `SCALAR_BOUNDS_REGISTRY` entries would be new write-time validation; `indicators.*` has none today (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:100-146`). If design adopts them, it appends `@AC-5`+ (C-15) and follows CONFIG-11: a full-dotted registry key, and no `minValue: 0` on a `get_int` key (overlap with feature 244)
- [x] Doc fixes (C-10, same bare-key / "cap" defect): `services/xstockstrat-indicators/CLAUDE.md:12` ("memory cap" → headroom) and `docs/runbooks/config-rollout.md:180` (`snap.values.get('sandbox.timeout_ms')` → `indicators.sandbox.timeout_ms`). A repo grep finds no other bare `sandbox.*` consumer outside migrations 001/002

## Consumer Surface(s)

- agent MCP `test_formula` / formula execution: effective limits unchanged (row values equal code defaults); once rows resolve, hotfix PR #1263's override clamp ceiling is the row value (5000 ms / 128 MiB)
- `/config-ui` indicators namespace: keys show as `indicators.sandbox.*`; `memory_bytes` descriptions say headroom
- `/insights` formula authoring (Run → `ExecuteFormula`): effective limits unchanged, so the static Sandbox limits panel (`services/xstockstrat-ui/src/components/insights/formulaReference.ts:168-175`, "5 s" / "128 MiB") and `docs/runbooks/indicator-builder.md:154-155` stay accurate; xstockstrat-ui needs no change and is not an affected service

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- `indicators.sandbox.max_concurrent` (no seed exists; not part of this defect)
- The Python zero-trap in indicators `get_int` (feature 244)
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
