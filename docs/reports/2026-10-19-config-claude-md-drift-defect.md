# Defect: Config CLAUDE.md has a stale notify diagram, banner and write-gate text

**Recorded**: 2026-10-19
**Severity**: SEV-3
**Impact type**: doc-drift
**Environment**: dev (main-dev) @ 1302e6d
**Affected service(s)**: xstockstrat-config
**Config-only fix possible**: no
**Source**: `services/xstockstrat-config/docs/context-constitution-findings.md` § Documentation that lies rows 2 (partial, diagram missed) and 3 (banner and §Webhooks)

## Observed
- The WatchConfig Flow diagram shows the notify payload as `{namespace, key, environment, trading_mode}`. The code emits `{namespace, key, environment, user_id}`; feature 147 removed `trading_mode`.
- The Constitution banner still advertises fixed items: "pg_notify env+mode requirement", "camelCase/snake_case trading-mode scoping collapse" (fixed by feature 078) and "audit-on-UPDATE-only" (fixed by feature 091).
- §Webhooks says SetConfig "requires the ADMIN scope bit". The gate depends on scope: admin for global writes, owner-only for per-user writes, plus the internal-caller allowlist (Invariants #5 and #7).

## Expected
The diagram matches the emitted payload, the banner lists only open defects, and §Webhooks defers to Invariants #5 and #7.

## Reproduction
1. Read `services/xstockstrat-config/CLAUDE.md:85` and compare it with `src/grpc/configServiceImpl.ts:510`.
2. Read `CLAUDE.md:4` and compare it with the findings file's RESOLVED rows.
3. Read `CLAUDE.md:97` and compare it with `configServiceImpl.ts:388` (the per-user owner branch).

## Evidence
`services/xstockstrat-config/CLAUDE.md:85`
> `        └── pg_notify('config_changed', {namespace, key, environment, trading_mode})`

`services/xstockstrat-config/src/grpc/configServiceImpl.ts:510`
> `        JSON.stringify({ namespace, key, environment: env, user_id: userId || null }),`

`services/xstockstrat-config/CLAUDE.md:97`
> `_No webhooks. Mutate config via the `SetConfig` gRPC RPC on port 50060 — which requires the ADMIN scope bit and an attributable author (see Critical Invariants #5)._`

## Root cause hypothesis
The 2026-08-02 doc refresh fixed the prose but not the ASCII diagram literal or the banner, and §Webhooks predates the scope-dependent gate in PR #994.

## Confidence
high
