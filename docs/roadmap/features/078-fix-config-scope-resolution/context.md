# Context: fix-config-scope-resolution  (archived 2026-08-19)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-19 — /sdd-archiver

**What**: `ConfigService` silently collapsed every scoped request to `('dev','all')` on all four RPCs (`WatchConfig`/`GetConfig`/`SetConfig`/`ListKeys`) because its `resolveEnv`/`resolveMode` helpers decoded the wire in a shape ts-proto never produces. Production config rows (seeded by migration `007`) were unreachable, every service booted on dev config even in production, and `SetConfig(production)` wrote dev rows while reporting success. The fix taught both helpers to accept the string constant and the legacy numeric form, plus a `requestMode(req)` helper reading `tradingMode ?? trading_mode`. Shipped as PR #806, but operationally a config change disguised as a bug fix.

**Why (irrecoverable rationale)**: The bug survived because the failure is self-consistent — reads and writes both funneled to the same `dev` bucket, so any round-trip through the service looked correct (you read back what you wrote). Only a caller inspecting a stored `environment` column or comparing two scopes could see it, and nothing did. Third identical instance in one session (075, 077, 078): same root cause (`stringEnums=true` + camelCase decoding vs. a handler expecting numeric/snake_case), same reason for surviving.

**Rejected alternatives**:
- Tighten the helpers to string-only / delete `ENV_MAP`+`MODE_MAP` — rejected because the existing unit tests hand-build requests as `{ environment: 1, trading_mode: 1 }`, and string-only would break them for no behavioral gain. The numeric branch is kept deliberately.
- Move the scope selector (`environment`/`trading_mode`) into config values — explicitly forbidden. User confirmed the architecture: scope stays env vars (`APPLICATION_ENV`/`TRADING_MODE`) while config values are partitioned per environment. Recorded so a future reader doesn't "simplify" by inverting the model.

**Scars & gotchas**: The unit-test fixture trap — tests that hand-build the request in the handler's expected shape (numeric, snake_case) pass against the bug and keep passing forever; only a probe over a real `grpc.Server` connection exposed the fault (recurred across 075/077/078). Prediction ≠ proof: the defect was predicted by feature-073's design-adversary from `stringEnums=true`, but was verified by execution — a real `ListKeys` call with `ENVIRONMENT_PRODUCTION`/`TRADING_MODE_LIVE` that bound SQL params `["marketdata","dev","all"]`. Deploy-time operational scar (AC-6 still open): production has been served dev config for the entire life of the bug; after this fix each service starts reading its actual `production` rows, so anywhere the two scopes drifted, behavior changes at deploy.

**Permanent deviations**: No design.md existed (bug fast-track). The one intentional divergence from a clean fix: the numeric decode branch was retained rather than removed, purely to keep the pre-existing hand-built tests valid.

**Cross-feature signal**: ts-proto wire-shape decoding faults are a defect class on this platform, not isolated bugs — features 075, 077, 078 share the identical root cause and survival mechanism. Any Node handler reading a decoded proto field by numeric value or snake_case name is suspect. The `trading_mode` half of this one was already partially logged in the config service findings doc; the `environment` half and the read-path collapse were not.

**Deferred follow-ons**: Folded into feature 073 — since every service knows its own scope from env vars, 073's MCP config tools must default `environment`/`trading_mode` to the agent's `APPLICATION_ENV`/`TRADING_MODE`, not let proto zero-values decide. AC-6 operational check remains outstanding at archive time — the pre-deploy `dev` vs `production` config diff is a runbook action.

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-19 `fix-config-scope-resolution` entries.

**Runtime-invariant recommendations (→ /context-constitution)**: PLAT-* candidate — "ts-proto (`stringEnums=true`) delivers enum fields as their string constant and all fields under camelCase names; any Node handler that reads them numerically or in snake_case silently gets a default" (proven three times: 075/077/078). CONFIG-* candidate — "the config scope selector (`environment`/`trading_mode`) is an env-var-derived request parameter, never a config value; config values are partitioned per scope. Do not move scope into config."

**Pruned artifacts**: product-spec.md — last present at 1d97c6c.
