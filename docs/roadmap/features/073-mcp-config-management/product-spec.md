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

FR-3. A `set_config` tool wraps `ConfigService.SetConfig`: given namespace, key, a typed value
(string/int/float/bool/json — matching the `ConfigValue` oneof), environment, trading_mode,
`author`, and `reason`, applies the change. `author` and `reason` are **required** parameters (not
optional) so every agent-driven change is attributable in `config.config_audit`, consistent with
the existing rollout convention (`docs/runbooks/config-rollout.md` Step 2). There is **no
namespace/key denylist** — any key, including `secret.*` ones, is writable through this tool
(decided 2026-07-28; see context.md), gated only by the caller's real authorization (FR-5/FR-7).
`set_config` being usable against `secret.*`-prefixed keys is the capability gap the feature exists
to close.

FR-4. `set_config`'s tool response MUST NOT echo back the value that was just written when the
target key `is_secret == true` — return only `{version, updated_at}` (matching
`SetConfigResponse`) plus a confirmation, never the submitted value. This mirrors the existing
`manage_signal_source` `credentials_ref` precedent (never echoed back) and the agent's own
review-focus invariant: "no secret values in tool output or the unauthenticated `GET /api/tools`
catalog" (`docs/runbooks/reviewer-registry.md` `xstockstrat-agent` row). Decided 2026-07-28: this
holds regardless of the FR-3 write path — a caller may set a new secret value but can never read
one back, from either `get_config` or `set_config`'s own response.

FR-5. Unlike the other MCP management tools (`manage_strategy`, `manage_formula`,
`manage_signal_source`, `set_strategy_live`, `trigger_backfill`), which forward a hardcoded admin
`x-access-scope` tuple (`_admin_metadata()`, `services/xstockstrat-agent/app/client.py:30-32`, per
constitution invariant **AGENT-3**) regardless of who is actually calling, `set_config` MUST
authorize by the **real calling user's role** — decided 2026-07-28, explicitly rejecting the
hardcoded-admin pattern for this tool. Concretely: the agent already validates the caller's JWT via
`validate_bearer_jwt` (`app/auth.py:28-46`) and receives `TokenClaims.roles` from Identity's
`ValidateToken`, but today discards everything except a boolean audience check — per constitution
invariant **AGENT-4**, the agent forwards only `x-mcp-secret` (+ hardcoded admin scope) and
explicitly does *not* forward per-user identity today. This feature requires a narrow, tool-scoped
deviation from AGENT-4: retain the real `roles`/derived `x-access-scope` for the current request
and forward that (not `_admin_metadata()`'s hardcoded tuple) on the outbound `SetConfig` call. The
reference implementation for role→scope derivation already exists platform-side:
`rolesToAccessScope` (`services/xstockstrat-ui/src/lib/auth.ts:65-76`) and its BFF forwarding
pattern (`services/xstockstrat-ui/src/lib/bffShared.ts:41-46`) — reuse that mapping rather than
re-deriving it. This change must not alter behavior for the other, unrelated management tools
still using `_admin_metadata()`.

FR-7. **New, surfaced by recon (not originally scoped):** `xstockstrat-config`'s `SetConfig` RPC
performs **no authorization check today** — `services/xstockstrat-config/src/grpc/configServiceImpl.ts:251-310`
reads no metadata/headers at all, so anyone reaching gRPC port 50060 can already call it
unauthenticated. FR-5's real-role forwarding is meaningless unless something on the receiving end
checks it, so this feature must add a role check to `SetConfig`: reject unless the forwarded
`x-access-scope` carries the `ADMIN` bit (`0x04`), the platform's existing bitmask convention
(`docs/patterns/header-propagation.md:24-26`) — "any role" per FR-5/FR-3 means "any role the
platform's own scope model grants config-write to," not "unconditionally." `GetConfig`/`ListKeys`
may remain open to any authenticated caller (matching their current unauthenticated state and the
other read-only MCP tools) — confirm this explicitly in design rather than defaulting it.

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
  existing `ConfigService` RPCs via `app/client.py`; `set_config` additionally requires retaining
  the real caller's JWT-derived role/scope through `validate_bearer_jwt` and forwarding it, instead
  of the shared hardcoded-admin helper (FR-5).
- `xstockstrat-config` — **service change, not read-only** (escalated by recon 2026-07-28): add an
  `ADMIN`-scope authorization check to `SetConfig`, which has none today (FR-7).

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
- [x] Service owner approval from **both** affected services — `xstockstrat-agent` (new tools) and
  `xstockstrat-config` (new authorization check on `SetConfig`, FR-7) — non-breaking, no
  proto/schema change
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

Given `set_config` can write `secret.*` keys, allows any namespace/key with no denylist, and this
feature adds the *first* authorization check `xstockstrat-config` has ever had on `SetConfig`, the
design phase MUST include a Security review (reviewer-registry.md Security role: "no secrets in
config service state, secret keys use `secret.*` prefix, JWT claims minimal, API key scoping
correct") — not optional here, unlike the original draft's "weigh a Security review" framing.

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
   body for a call touching an `is_secret == true` key, whether via `get_config` or as the response
   to a `set_config` write.
7. `set_config`, called by a session whose real role lacks the `ADMIN` bit, is rejected
   (`PERMISSION_DENIED`) by `xstockstrat-config`'s new FR-7 check — proves the forwarded-real-scope
   path (FR-5) is actually enforced, not just threaded through and ignored.
8. `set_config`, called by a session whose real role has the `ADMIN` bit, can write to any
   namespace/key with no denylist (including `platform.maintenance_mode` and `secret.*` keys) —
   proves FR-3's "no restriction, gated only by real authorization" decision.
9. The other MCP management tools (`manage_strategy`, `manage_formula`, `manage_signal_source`,
   `set_strategy_live`, `trigger_backfill`) are unaffected — still use `_admin_metadata()` — proving
   FR-5's deviation from AGENT-4 is scoped to `set_config` only.

## Open Questions

- [x] ~~Should `set_config` restrict which namespaces/keys an agent session can write~~ — resolved
  2026-07-28: no denylist; gated by the caller's real role instead (FR-3/FR-5/FR-7).
- [ ] Should `get_config`/`list_config_keys` require any scope narrower than the existing
  read-only tools (e.g. `screen_symbols`, `get_backfill_status`), given they can reveal which
  namespaces/keys exist (metadata only, not secret values) across the whole platform? Recon found
  `GetConfig`/`ListKeys` are also currently unauthenticated at the RPC level — still open whether
  to leave them that way (FR-7) or gate them too.
- [ ] **New, from recon 2026-07-28**: does retaining per-request JWT claims in `app/auth.py`
  `validate_bearer_jwt` (currently a pure boolean check) risk the agent's stateless/no-in-memory-store
  invariant (**FR-B13**, `services/xstockstrat-agent/CLAUDE.md` § OAuth, `instance_count > 1` must
  stay safe)? Recon suggests no — claims would be scoped to the single request, never persisted
  across requests/connections — but design phase must confirm before implementing FR-5.
- [ ] **Live, pre-existing gap found during recon — NOT this feature's to fix by default**:
  `services/xstockstrat-ui/src/lib/configUiBff.ts:14-22`'s `setConfig` handler calls the same
  unauthenticated `SetConfig` RPC via `requireSession` only (no `requireAdminScope`) — meaning
  today, **any authenticated UI user of any role can already write arbitrary config, including
  flipping `platform.maintenance_mode`**, with zero backend check. FR-7 (adding the ADMIN-scope
  gate to `SetConfig` itself) will incidentally close this too, since the UI's BFF calls the same
  RPC — but this is a live security exposure independent of whether feature 073 ever ships. Flag to
  the user for `docs/runbooks/bug-triage.md` consideration separately; do not silently bundle the
  UI-side fix into this feature's scope without an explicit decision.
- [ ] **Known trap** (see Out of Scope): confirm during design that no reviewer or later feature
  mistakes this for adding real secret-store security — it is a management-interface feature over
  an existing plaintext-config mechanism, not a secrets-hardening feature.
