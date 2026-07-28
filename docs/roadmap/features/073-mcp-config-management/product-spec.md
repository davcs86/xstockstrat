# Product Spec: mcp-config-management

**Created**: 2026-07-28

---

## Problem Statement

There is currently no MCP tool, CLI script, or web-UI path for an agent session to read or write
`xstockstrat-config` values. `/config-ui` explicitly blocks editing any `isSecret` key, and no
`manage-config.sh`-style script exists (unlike `scripts/manage-users.sh` for identity). The only
way to flip a feature flag or set a secret-prefixed value today is a raw `SetConfig` gRPC call
(e.g. via `grpcurl`) against `xstockstrat-config:50060`, following `docs/runbooks/config-rollout.md`
by hand. This gap was hit directly while trying to enable the fundamentals data pipeline
(features 059/062) in staging: there was no way to set `secret.marketdata.fmp.api_key` or flip
`marketdata.fmp.enabled` / `analysis.fundsignal.enabled` from the agent session driving the work.

## User Story

As a platform operator, I want MCP tools exposed by `xstockstrat-agent` that can read config
values/metadata and write config values (including `secret.*`-prefixed ones) in
`xstockstrat-config`, so that I can roll out config changes — flag flips, threshold updates, and
secret values — directly from an agent session, without needing a raw gRPC client.

## Functional Requirements

FR-1. A read-only `get_config` tool wraps `ConfigService.GetConfig` (one-shot fetch): given a
namespace (+ optional environment/trading_mode), return the current `ConfigSnapshot` values. Any
value where `is_secret == true` MUST be redacted in the tool's output — never echo an actual
secret value back to the caller.

FR-2. A read-only `list_config_keys` tool wraps `ConfigService.ListKeys`: given a namespace,
return each key's `ConfigKeyMeta` (key, description, default_value, is_secret, consuming_service,
environment, trading_mode, validation). `ListKeys` already returns metadata only (no value), so no
redaction logic is needed here beyond what the RPC already omits.

FR-3. An admin-scoped write `set_config` tool wraps `ConfigService.SetConfig`: given namespace,
key, a typed value (string/int/float/bool/json — matching the `ConfigValue` oneof), environment,
trading_mode, `author`, and `reason`, applies the change. `author` and `reason` are **required**
parameters (not optional) so every agent-driven change is attributable in `config.config_audit`,
consistent with the existing rollout convention (`docs/runbooks/config-rollout.md` Step 2).
`set_config` MUST be usable against `secret.*`-prefixed keys — this is the capability gap the
feature exists to close.

FR-4. `set_config`'s tool response MUST NOT echo back the value that was just written when the
target key `is_secret == true` — return only `{version, updated_at}` (matching
`SetConfigResponse`) plus a confirmation, never the submitted value. This mirrors the existing
`manage_signal_source` `credentials_ref` precedent (never echoed back) and the agent's own
review-focus invariant: "no secret values in tool output or the unauthenticated `GET /api/tools`
catalog" (`docs/runbooks/reviewer-registry.md` `xstockstrat-agent` row).

FR-5. `set_config` forwards the same hardcoded admin `x-access-scope` pattern already used by the
other management tools (`manage_strategy`, `manage_formula`, `manage_signal_source`,
`set_strategy_live`, `trigger_backfill`) per `services/xstockstrat-agent/CLAUDE.md` §
"Management-tool authorization" — no new authorization mechanism.

FR-6. All five/six MCP-tool discovery surfaces are updated in the same feature (per the ledger
pattern below): `app/tools.py` docstring + tool count/enumeration, `services/xstockstrat-agent/CLAUDE.md`
tool table (currently states "fourteen tools" — becomes seventeen), `docs/runbooks/mcp-tools.md`
(header count + per-tool section), `docs/runbooks/CLAUDE.md` index line, and
`docs/runbooks/config-rollout.md` (the task-oriented operational runbook these tools implement —
add the MCP-tool path alongside the existing gRPC/Connect-RPC procedure).

## Out of Scope

- The `RolloutConfig` Connect-RPC endpoint (atomic multi-key rollout) — not wrapped by this
  feature; `set_config` is single-key only, matching `SetConfig`.
- Any change to `xstockstrat-config` itself — `GetConfig`/`SetConfig`/`ListKeys` already exist in
  `packages/proto/config/v1/config.proto`; this feature only adds MCP tool wrappers in
  `xstockstrat-agent`. No proto changes anticipated.
- Building a real secret store / resolving `secret://` references. **Known trap**: `secret.*`
  config values have no actual secret-store resolution today — `SetConfig` stores the submitted
  string as plaintext in `config.config_values`, same as every other config value; only the
  `is_secret` flag differs (gates `/config-ui` editing and, per FR-1/FR-4, this feature's own
  tool output). This feature exposes that existing (already-plaintext) mechanism through MCP — it
  does not make secret storage more secure than it is today. Do not design or review this feature
  as if it adds secret encryption/vaulting.
- Editing `/config-ui` to unblock secret-field editing there — out of scope; MCP is the only new
  surface.

## Affected Services

- `xstockstrat-agent` — new MCP tools (`get_config`, `list_config_keys`, `set_config`) calling the
  existing `ConfigService` RPCs via `app/client.py`.
- `xstockstrat-config` — consumed read-only via its existing RPCs; no service changes expected
  unless implementation-spec discovers otherwise.

## Proto Contract Changes

- [x] No proto changes required — `GetConfig`, `SetConfig`, `ListKeys` already exist in
  `packages/proto/config/v1/config.proto:17-27`.

## Config Key Changes

- [x] No new config keys — this feature is a management interface for existing keys, not a new
  key itself.

## Database Changes

- [x] No schema changes — `SetConfig` already writes `config.config_values` +
  `config.config_audit`.

## Feature Workflow Notes

Branch to create: `feature/mcp-config-management` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking, no proto/schema change — new agent-service tools
  only)
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

Given `set_config` can write `secret.*` keys and elevates blast radius (any config key, any
namespace, from an agent session), the design phase should explicitly weigh a Security review
even though the reviewer-registry matrix would otherwise route this as a plain `service` step —
see Open Questions.

## Acceptance Criteria

1. `get_config(namespace, environment?, trading_mode?)` returns current values for a namespace;
   any `is_secret == true` entry has its value redacted in the tool output.
2. `list_config_keys(namespace, environment?, trading_mode?)` returns `ConfigKeyMeta` for every
   key in that namespace, matching `ListKeys`.
3. `set_config(namespace, key, value, environment?, trading_mode?, author, reason)` applies the
   change via `SetConfig` and returns `{version, updated_at}` — never the value, when the target
   key is secret.
4. `set_config` successfully sets a `secret.*`-prefixed key's value (verified against the
   `marketdata.fmp.api_key` gap that motivated this feature) and the write appears in
   `config.config_audit` with the supplied `author`/`reason`.
5. All discovery surfaces listed in FR-6 are updated and consistent (tool count, names) — same
   test shape as the feature-066 `trigger_backfill` precedent
   (`services/xstockstrat-agent/tests/test_tools_endpoint.py` name-set test).
6. No secret value appears in `GET /api/tools`, tool descriptions/schemas, or any tool response
   body for a call touching an `is_secret == true` key.

## Open Questions

- [ ] Should `set_config` restrict *which* namespaces/keys an agent session can write (e.g. deny
  `platform.maintenance_mode` from this tool, forcing that emergency path to stay a deliberate
  manual action per `docs/runbooks/config-rollout.md` § Emergency Maintenance Mode), or is the
  existing hardcoded-admin-scope pattern (same trust level as the other management tools)
  sufficient? Needs a design-phase decision, not an implementation default.
- [ ] Should `get_config`/`list_config_keys` require any scope narrower than the existing
  read-only tools (e.g. `screen_symbols`, `get_backfill_status`), given they can reveal which
  namespaces/keys exist (metadata only, not secret values) across the whole platform?
- [ ] **Known trap** (see Out of Scope): confirm during design that no reviewer or later feature
  mistakes this for adding real secret-store security — it is a management-interface feature over
  an existing plaintext-config mechanism, not a secrets-hardening feature.
