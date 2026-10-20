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

**Expected.** The sandbox limits apply through full-dotted `indicators.sandbox.*` rows in every environment,
with descriptions matching the headroom semantics.

## Reproduction Steps

1. Read `002_config_environment.up.sql:61-62` (bare `sandbox.*` keys).
2. Compare with `watcher.py:134,138` (reads `indicators.sandbox.*`).
3. Grep the config migrations for `indicators.sandbox`: zero hits.

## Root Cause Hypothesis

The seeds were written assuming namespace-relative keys. F-01 forbids editing applied migrations, so the fix is a
new corrective config migration (operator decision, 2026-10-20) rather than a manual `SetConfig create_key`.

## Affected Services

- xstockstrat-config (corrective seed/heal migration)
- xstockstrat-indicators (consumer; code-side part of the fix per operator decision)

## Fix Scope

- [x] No proto changes anticipated
- [x] DB migration anticipated: config migration (next free NNN, 031 at triage time) healing `indicators` bare `sandbox.*` rows to full-dotted `indicators.sandbox.*` (both environments) and correcting the `memory_bytes` description to headroom semantics; up+down pair (F-01: 001/002 not edited)
- [ ] Config key value change: activating the 002 production seeds changes live production limits (5000 → 3000 ms; 128 MiB → 64 MiB headroom). The production `memory_bytes` value is a design decision (feature 228 operator chose a 128 MiB default over 64 MiB)
- [x] Code fix per operator decision (scope set at design: e.g. indicators docs/CLAUDE.md seed facts, config bounds for the healed keys, tests)

## Consumer Surface(s)

- agent MCP `test_formula` / formula execution: production sandbox timeout and memory headroom change once the rows resolve
- `/config-ui` indicators namespace: keys show as `indicators.sandbox.*`

## Acceptance Criteria

See `acceptance.feature` — the regression scenario(s) that must fail on the buggy behavior and pass
after the fix (Constitution **C-15**). Plus: existing tests pass; affected service(s) smoke-tested on
dev.

## Out of Scope

- `indicators.sandbox.max_concurrent` (no seed exists; not part of this defect)
- The Python zero-trap in indicators `get_int` (feature 244)
- Refactoring unrelated to the bug
- Performance improvements unrelated to the fix
