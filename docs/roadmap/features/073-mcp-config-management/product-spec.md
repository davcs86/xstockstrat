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
values/metadata and write **non-secret** config values in
`xstockstrat-config`, so that I can roll out config changes — flag flips and threshold updates —
directly from an agent session, without needing a raw gRPC client. Credentials are explicitly **not**
in scope: they are delivered as `type: SECRET` environment variables (see FR-3).

## Functional Requirements

FR-1. A read-only `get_config` tool wraps `ConfigService.GetConfig` (one-shot fetch): given a
namespace (+ optional environment/trading_mode), return the current `ConfigSnapshot` values. Any
value where `is_secret == true` MUST be redacted in the tool's output — never echo an actual
secret value back to the caller.

> **Dependency, now satisfied.** This predicate was un-implementable when first written: nothing
> populated `ConfigValue.is_secret` on the read path, so `GetConfig` reported `is_secret == false`
> for every key and a literal implementation would have echoed secrets. Fixed by feature **075**
> (`fix-config-value-roundtrip`). Verify the field is populated; do not re-derive **this
> redaction** predicate from the `secret.*` key prefix — a flagged-but-unprefixed key must still be
> redacted. (This instruction is scoped to FR-1's *read* redaction. FR-3's *write* rejection
> deliberately checks the prefix **as well as** the flag — see FR-3.)
>
> **Metadata:** `get_config` uses the plain `_metadata()` helper (`x-mcp-secret` only) — **not**
> `_admin_metadata()`. Per invariant **AGENT-3**, sending admin scope on a read path is the wrong
> shape; `GetConfig` is ungated (FR-7) so no scope is needed.

FR-2. A read-only `list_config_keys` tool wraps `ConfigService.ListKeys`: given a namespace,
return each key's `ConfigKeyMeta` (key, description, default_value, is_secret, consuming_service,
environment, trading_mode, validation). `ListKeys` already returns metadata only (no value), so no
redaction logic is needed here beyond what the RPC already omits. Like `get_config`, it uses the
plain `_metadata()` helper, not `_admin_metadata()` (**AGENT-3**).

FR-3. A `set_config` tool wraps `ConfigService.SetConfig`: given namespace, key, a typed value
(string/int/float/bool/json — matching the `ConfigValue` oneof), environment, trading_mode,
`author`, and `reason`, applies the change. `author` and `reason` are **required** parameters (not
optional) so every agent-driven change is attributable in `config.config_audit`, consistent with
the existing rollout convention (`docs/runbooks/config-rollout.md` Step 2). **`set_config` MUST reject a secret key** (decided 2026-07-29 — superseding the 2026-07-28
"no denylist" decision). The predicate is deliberately **two-pronged**, because neither prong alone
is sufficient:

- **(a) the `is_secret` flag**, read from `list_config_keys` (`ConfigKeyMeta.is_secret`). This
  catches an existing key that is flagged but not prefixed. It became usable only with feature
  **077** — before that, `ListKeys` dropped the field on the wire and always reported `false`, so a
  flag-only guard would have been silently dead. **The lookup MUST use the same `environment` and
  `trading_mode` as the pending write.** `ListKeys` is scope-filtered
  (`WHERE namespace = $1 AND environment = $2 AND (trading_mode = $3 OR trading_mode = 'all')`), so a
  lookup issued with the default `dev`/`all` scope cannot see a key flagged only in
  `production`/`live` — and prong (b) does not backstop that case, since it fires on the name alone.
  Compounded by Known Constraint 1's `trading_mode` collapse, so design must confirm the scope
  actually threads through rather than assuming it does.
- **(b) the `secret.` key-name prefix**, checked *before* any RPC. This is the only prong that works
  for a **key that does not yet exist**: `set_config` creates keys (`INSERT … ON CONFLICT DO UPDATE`),
  `SetConfigRequest` carries no `is_secret` field, and the column defaults `FALSE` — so without a
  prefix check, `set_config(namespace='marketdata', key='secret.foo.bar', value=<credential>)` would
  create an unflagged row holding a plaintext credential streamed to every `WatchConfig` subscriber.
  The prefix is the platform's own convention for sensitive keys (**C-05**).

A key matching **either** prong is rejected with an error naming the key and pointing at the
`type: SECRET` env-var mechanism — never echoing a value. Credentials are
delivered as DigitalOcean App Platform `type: SECRET` environment variables — the mechanism used by
the Alpaca keys, `JWT_SECRET`, `MCP_AGENT_SECRET` and the IBKR broker-account encryption key — never
as config values, which are stored in plaintext and streamed to every `WatchConfig` subscriber.
Aside from that rejection there is no namespace/key denylist: any non-secret key in any namespace is
writable, gated only by the caller's real authorization (FR-5/FR-7). The FMP credential that
motivated this feature moved to `FMP_API_KEY` in feature **076**; `set_config` covers the
accompanying toggles (`marketdata.fmp.enabled`, `analysis.fundsignal.enabled`).

FR-4. `set_config`'s tool response MUST NOT echo back the value that was just written when the
target key `is_secret == true` — return only `{version, updated_at}` (matching
`SetConfigResponse`) plus a confirmation, never the submitted value. This mirrors the existing
`manage_signal_source` `credentials_ref` precedent (never echoed back) and the agent's own
review-focus invariant: "no secret values in tool output or the unauthenticated `GET /api/tools`
catalog" (`docs/runbooks/reviewer-registry.md` `xstockstrat-agent` row).

> **Superseded detail (2026-07-29).** An earlier draft said a caller "may set a new secret value but
> can never read one back". The write half is no longer true — FR-3 now *rejects* `is_secret` keys —
> so FR-4 reduces to: no tool response ever contains a secret value, and `set_config` returns only
> `{version, updated_at}`. Retained as a belt-and-braces guard: it must hold even if a future change
> re-permits secret writes.

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
re-deriving it.

**Port, not import (2026-07-29).** `rolesToAccessScope` is TypeScript in a *different service*, so
the agent must **port** the mapping into Python — a second copy of the bitmap is unavoidable and
intended. The canonical bit value is `ADMIN_SCOPE = 0x04`, mirrored server-side at
`services/xstockstrat-config/src/grpc/authz.ts` (feature 074) and in the Python servicers'
`_has_admin_scope`. Cite that lineage in the port so the DRY guard rail reads it as deliberate.

**Transport scope — DECIDED 2026-07-29: Streamable HTTP only.** Real-caller-role forwarding is
implementable only where the tool-call request itself is authenticated. That holds on the
Streamable HTTP transport (the POST carrying the tool call passes `_authorized(scope)` in
`app/main.py`), so the claims can live in a per-request `contextvar` — created and discarded within
one request, never shared, which satisfies **FR-B13**. It does **not** hold on the legacy HTTP+SSE
`/messages` path, which is explicitly not auth-gated ("auth rides the established stream session");
forwarding real roles there would require an SSE-session→claims map, i.e. exactly the in-memory
store FR-B13 forbids. Therefore `set_config` **returns an explicit "unsupported transport" error on
the legacy SSE path** rather than silently falling back to hardcoded admin scope. `get_config` and
`list_config_keys` are unaffected and work on both transports (they forward no scope at all).

This change must not alter behavior for the other, unrelated management tools still using
`_admin_metadata()`.

FR-7. **Already implemented by feature 074 (`fix-config-write-authz`) — verify, do NOT
reimplement.** When this was written, `xstockstrat-config`'s `SetConfig` had no authorization check
at all, so FR-5's real-role forwarding would have been meaningless. Feature 074 has since shipped
that gate: `SetConfig` rejects `PERMISSION_DENIED` ("admin scope required") unless the propagated
`x-access-scope` carries the ADMIN bit (`0x04`), implemented in
`services/xstockstrat-config/src/grpc/authz.ts` and called as the first statement of `setConfig`.
This feature's job is therefore only to **forward a real scope and assert the gate fires** (see
Acceptance Criteria 7-8) — it must not add a second check.

Two consequences of 074 that this feature must honor:
- **`GetConfig`/`ListKeys`/`WatchConfig` are deliberately open**, and 074 settled *why* on the code
  rather than on this feature's assumption: every service boots by subscribing to `WatchConfig`
  unauthenticated, and that stream's first message is a full namespace snapshot — a superset of
  `GetConfig`. Gating reads is therefore incoherent without gating `WatchConfig`, which would break
  platform startup. `get_config`/`list_config_keys` inherit no new constraint.
- **`SetConfig` now also requires an attributable author** — `request.author` wins, the propagated
  `x-user-id` is the fallback, and a call with neither is rejected `INVALID_ARGUMENT`. Since the
  agent does not forward `x-user-id` (invariant **AGENT-4**), `set_config` MUST always send an
  explicit `author`. FR-3 already makes `author` a required tool parameter, so this is satisfied by
  construction — but it is now load-bearing, not merely a convention.

FR-6. **Six** discovery surfaces are updated, plus one new one. The ledger's "five"
(`docs/roadmap/ledger/insights.md`, 2026-07-20 `trigger_backfill`) and the registry's "six"
(`docs/runbooks/reviewer-registry.md`) differ because the registry counts `mcp-tools.md`'s two
count statements separately *and* includes the test file. Enumerated so nothing is dropped:

1. `services/xstockstrat-agent/app/tools.py` — module-docstring tool count + enumeration
2. `services/xstockstrat-agent/CLAUDE.md` — tool table and its count sentence
3. `docs/runbooks/mcp-tools.md` — **two** count statements (the header line *and* the
   `GET /api/tools` catalog paragraph — an earlier draft named only the header) plus a new per-tool
   section for each of the three tools
4. `docs/runbooks/CLAUDE.md` — index line
5. `services/xstockstrat-agent/tests/test_tools_endpoint.py` — the tool-name-set assertion. This is
   the sixth surface in the reviewer registry's count and it **will go red** when three tools are
   added, so it is a required edit, not merely a "test shape" to imitate.

Plus one surface the registry does not list, because it is new rather than a count:
`docs/runbooks/config-rollout.md` — the task-oriented operational runbook these tools implement; add
the MCP-tool path alongside the existing gRPC procedure.

Verified count: `app/tools.py` currently registers **14** tools, and "fourteen" appears in surfaces
1-4. Adding three makes **17**.

> **Pre-existing gap, explicitly NOT this feature's to close.** `docs/runbooks/mcp-tools.md`
> currently documents only **13** tools — `set_strategy_live` has no section despite the header
> claiming fourteen (already logged in `context-scrubber-findings.md`). This feature adds its own
> three sections and corrects the counts to 17, but does **not** backfill the missing
> `set_strategy_live` section. AC-5 is scoped accordingly: it asserts the three *new* tools are
> documented and the counts agree with `app/tools.py`, not that every pre-existing tool has a
> section.

## Out of Scope

- The `RolloutConfig` Connect-RPC endpoint (atomic multi-key rollout) — not wrapped by this
  feature; `set_config` is single-key only, matching `SetConfig`.
- Any change to `xstockstrat-config` itself — `GetConfig`/`SetConfig`/`ListKeys` already exist in
  `packages/proto/config/v1/config.proto`; this feature only adds MCP tool wrappers in
  `xstockstrat-agent`. No proto changes anticipated.
- Building a real secret store / resolving `secret://` references. **Resolved, not a trap any more
  (2026-07-29):** no `secret://` resolver exists anywhere in the codebase, and the platform's actual
  credential mechanism is the DigitalOcean App Platform `type: SECRET` env var (Alpaca, `JWT_SECRET`,
  `MCP_AGENT_SECRET`, and the IBKR broker-account encryption key all use it). The one credential that
  had been routed through config — the FMP key — moved to `FMP_API_KEY` in feature **076**, and its
  seeded row was dropped by migration `009`. So this feature neither exposes nor extends a plaintext
  secret path: `set_config` rejects `is_secret` keys outright (FR-3). Do not design or review it as a
  secrets feature.
- Editing `/config-ui` to unblock secret-field editing there — out of scope; MCP is the only new
  surface.
- Backfilling the missing `set_strategy_live` section in `docs/runbooks/mcp-tools.md` (see FR-6).
- Fixing the two pre-existing `xstockstrat-config` defects noted under Known Constraints below.

## Known Constraints (carried into design, not fixed here)

1. **`environment` / `trading_mode` default silently to `dev` / `all`.** The proto zero-values
   resolve that way server-side, so an operator who omits them writes a **dev** row and never
   touches production. `set_config`'s tool description MUST state this, and a production write MUST
   require an explicit `environment`. Additionally, `trading_mode` may be a **no-op**: the server
   reads `call.request.trading_mode` (snake_case) against a ts-proto camelCase request, a logged
   defect (`services/xstockstrat-config/docs/context-constitution-findings.md`) that collapses
   scoping to the `all` bucket. Do not promise per-mode scoping this feature cannot deliver.
2. **`json`-typed values do not round-trip.** `set_config` accepts the `ConfigValue` oneof's
   `json_val`, and the write path stores it, but `buildConfigValue` has no `'json'` case — the value
   reads back as `string_val` holding JSON text. Either restrict `set_config` to the four scalar
   types, or accept `json` knowing reads return a string. Decide in design; do not advertise a
   `json` type the read path cannot honor.
3. **`namespace` and `key` compose inconsistently in the existing data.**
   `001_config_tables.up.sql` seeds `namespace='platform', key='maintenance_mode'`, while
   `007_marketdata_fmp.up.sql` seeds `namespace='marketdata', key='marketdata.fmp.enabled'` — the
   key repeating the namespace. The tools take both as separate parameters, so design must pin which
   form the caller supplies, and the acceptance tests must use the form that actually matches each
   seeded row.
4. **New keys are not audited.** The `config.config_audit` trigger fires `BEFORE UPDATE` only
   (`migrations/001_config_tables.up.sql`), so a brand-new key's `INSERT` writes no audit row. FR-3's
   attribution rationale and AC-4 therefore hold for **pre-existing** keys; creating a new key via
   `set_config` is silently unaudited. The trigger *also* skips a value-unchanged rewrite
   (`IF OLD.value_data IS DISTINCT FROM NEW.value_data`), so a no-op write is likewise unaudited.
   Surface both in the tool description rather than implying every agent write is auditable.

## Affected Services

- `xstockstrat-agent` — new MCP tools (`get_config`, `list_config_keys`, `set_config`) calling the
  existing `ConfigService` RPCs via `app/client.py`; `set_config` additionally requires retaining
  the real caller's JWT-derived role/scope through `validate_bearer_jwt` and forwarding it, instead
  of the shared hardcoded-admin helper (FR-5).
- `xstockstrat-config` — **no change required.** Recon originally escalated this to a two-service
  feature. Three prerequisites have since shipped separately and this feature only consumes them:
  the `ADMIN`-scope gate on `SetConfig` (feature **074**), and `is_secret` propagation plus the
  `value_data` round-trip fix (feature **075**). Without 075 both FR-1's redaction and FR-3's typed
  writes were un-implementable.

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
- [x] Service owner approval from `xstockstrat-agent` (new tools) — non-breaking, no proto/schema
  change. `xstockstrat-config` is no longer modified by this feature (see FR-7), so its owner's
  approval is not gated on this PR.
- [ ] 2 service owners + platform lead (breaking proto change) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

Given `set_config` can write any **non-secret** key in any namespace (including
`platform.maintenance_mode` and the `trading.approval.*` thresholds) and is the **first** caller on
the platform to forward a real per-user scope instead of the hardcoded admin tuple — a narrow,
deliberate deviation from invariant **AGENT-4** — the design phase MUST include a Security review
(reviewer-registry.md Security role: "no secrets in config service state, secret keys use `secret.*`
prefix, JWT claims minimal, API key scoping correct"). Not optional, and not weakened by the
`is_secret` rejection: the blast radius of a non-secret write still includes halting all trading.

## Paper/Live Safety

**Paper-safe and fully exercisable in dev + docker-compose.** The feature writes no orders and
touches no broker. Its risk is indirect: `set_config` can write `platform.maintenance_mode` and the
`trading.approval.*` thresholds, so a careless write halts trading or widens the approval gate —
which is why the ADMIN gate (FR-7) and the mandatory Security review exist. Two scoping caveats
carry real live-mode risk and MUST be stated in the tool description: an omitted `environment`
silently writes a **dev** row (so a production rollout that appears to succeed may have changed
nothing), and `trading_mode` may be a no-op (Known Constraint 1). Production writes therefore
require an explicit `environment=production`.

## Acceptance Criteria

1. `get_config(namespace, environment?, trading_mode?)` returns current values for a namespace;
   any `is_secret == true` entry has its value redacted in the tool output.
2. `list_config_keys(namespace, environment?, trading_mode?)` returns `ConfigKeyMeta` for every
   key in that namespace, matching `ListKeys`.
3. `set_config(namespace, key, value, environment?, trading_mode?, author, reason)` applies the
   change via `SetConfig` and returns `{version, updated_at}` — never the submitted value.
4. `set_config` **rejects** a key whose `is_secret` is true, with a message pointing the caller at
   the secret-env-var mechanism; and successfully sets a non-secret key (e.g.
   `marketdata.fmp.enabled`), whose write appears in `config.config_audit` with the supplied
   `author`/`reason`.
5. All discovery surfaces listed in FR-6 are updated and consistent (tool count, names) — same
   test shape as the feature-066 `trigger_backfill` precedent
   (`services/xstockstrat-agent/tests/test_tools_endpoint.py` name-set test).
6. No secret value appears in `GET /api/tools`, tool descriptions/schemas, or any tool response
   body for a call touching an `is_secret == true` key — via `get_config`, or in `set_config`'s
   rejection message (which names the key and the env-var mechanism, never a value).
7. `set_config`, called by a session whose real role lacks the `ADMIN` bit, is rejected
   (`PERMISSION_DENIED`) by `xstockstrat-config`'s new FR-7 check — proves the forwarded-real-scope
   path (FR-5) is actually enforced, not just threaded through and ignored.
8. `set_config`, called by a session whose real role has the `ADMIN` bit, can write any
   **non-secret** key in any namespace (including `platform.maintenance_mode`) — proving there is no
   namespace denylist beyond the `is_secret` rejection in AC-4.
9. The other MCP management tools (`manage_strategy`, `manage_formula`, `manage_signal_source`,
   `set_strategy_live`, `trigger_backfill`) are unaffected — still use `_admin_metadata()` — proving
   FR-5's deviation from AGENT-4 is scoped to `set_config` only.
10. `set_config` invoked over the legacy HTTP+SSE transport returns an explicit "unsupported
    transport" error and performs **no** write — proving FR-5's transport scoping is enforced rather
    than silently degrading to hardcoded admin scope. `get_config`/`list_config_keys` still work on
    that transport.
11. **All three** tools' descriptions state the `environment`/`trading_mode` defaults and that
    `trading_mode` may be a no-op (Known Constraint 1 — the collapse affects the **read** path too,
    so `get_config`/`list_config_keys` must carry the caveat as well, not just `set_config`).
    `set_config`'s description additionally states that creating a *new* key, and rewriting a key
    to its existing value, are both unaudited (Known Constraint 4).
12. AC-4's and AC-6's rejection paths are exercised against a **seeded or mocked** `is_secret=true`
    key. No such row exists in the live schema — migration `009` removed the last one and
    `set_config` cannot create one (FR-3 prong (b)) — so the test must supply its own fixture rather
    than assume production data.

## Open Questions

- [x] ~~Should `set_config` restrict which namespaces/keys an agent session can write~~ — resolved
  2026-07-28: no denylist; gated by the caller's real role instead (FR-3/FR-5/FR-7).
- [x] ~~Should `get_config`/`list_config_keys` require a narrower scope~~ — resolved by feature
  074: reads stay open **by construction**, not by preference (unauthenticated `WatchConfig` at
  startup makes gating `GetConfig` alone incoherent). See FR-7.
- [x] ~~Does retaining per-request JWT claims risk the stateless invariant **FR-B13**?~~ — resolved
  2026-07-29. It is transport-dependent, and the answer differs by path: on **Streamable HTTP** the
  tool-call POST is itself auth-gated, so a per-request `contextvar` is created and discarded inside
  one request and `instance_count > 1` stays safe; on the **legacy SSE** `/messages` path there is no
  bearer token on the tool call at all, so honoring FR-5 there would require an SSE-session→claims
  map — precisely what FR-B13 forbids. Resolution: `set_config` is **Streamable HTTP only** and
  errors on SSE (FR-5, AC-10). No in-memory store is introduced on either path.
- [x] ~~Live, pre-existing UI-side gap (`configUiBff.ts` `setConfig` used `requireSession` only)~~ —
  split out and fixed as feature **074** (`fix-config-write-authz`, SEV-1), which added
  `requireAdminScope` at the BFF *and* the ADMIN-bit gate at the RPC. Not bundled into this
  feature, as intended.
- [x] ~~Known trap: could this be mistaken for adding secret-store security?~~ — resolved
  2026-07-29 and now moot: `set_config` rejects `is_secret` keys, the FMP credential moved to a
  secret env var (feature 076), and no `is_secret` rows remain. This is a management interface for
  **non-secret** config only.
