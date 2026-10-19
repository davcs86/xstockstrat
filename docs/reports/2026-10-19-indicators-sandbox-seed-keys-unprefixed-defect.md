# Defect: Indicators sandbox config seeds use bare keys and never apply

**Recorded**: 2026-10-19
**Severity**: SEV-2
**Impact type**: config-propagation
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-indicators, xstockstrat-config
**Config-only fix possible**: yes
**Source**: services/xstockstrat-indicators/docs/context-constitution-findings.md — Open questions "Inert indicators seeds"

## Observed
Config migrations 001 and 002 seed `sandbox.timeout_ms`, `sandbox.memory_bytes` and
`sandbox.allowed_imports` under namespace `indicators` without the namespace prefix. The watcher
reads the full-dotted `indicators.sandbox.*` keys, and the config service does no namespace
auto-prefixing (CONFIG-9). So the seeds never match, and production runs on code defaults (5000 ms,
128 MiB headroom) instead of the seeded production values (3000 ms, 64 MiB). No later migration
seeds the prefixed keys. The seed descriptions also still call the value a "memory cap", but since
feature 228 it is headroom above the measured `VmData` baseline.

## Expected
The production sandbox limits apply, via full-dotted `indicators.sandbox.*` rows.

## Reproduction
1. Read `002_config_environment.up.sql:61-62` (bare `sandbox.*` keys).
2. Compare with `watcher.py:134,138` (reads `indicators.sandbox.*`).
3. Grep the config migrations for `indicators.sandbox`: zero hits.

## Evidence
`services/xstockstrat-config/migrations/002_config_environment.up.sql:62`
> ('indicators','sandbox.memory_bytes',           'int',    '67108864', 'Formula memory cap bytes (64MB)',   '67108864','xstockstrat-indicators','production', 'all'),

`services/xstockstrat-indicators/app/config/watcher.py:134`
> return self.get_int("indicators.sandbox.timeout_ms", default=5000)

`services/xstockstrat-indicators/app/config/watcher.py:138`
> return self.get_int("indicators.sandbox.memory_bytes", default=128 * 1024 * 1024)

## Root cause hypothesis
The seeds were written assuming namespace-relative keys. F-01 forbids editing applied migrations, so
the fix is a SetConfig (`create_key`) of the full-dotted keys, or a corrective seed migration in a
new feature.

## Confidence
high
