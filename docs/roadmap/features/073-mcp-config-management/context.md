# Context: mcp-config-management

**Feature**: `docs/roadmap/features/073-mcp-config-management/feature.md`
**Product Spec**: `docs/roadmap/features/073-mcp-config-management/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/073-mcp-config-management/implementation-spec.md`

---

## Session 2026-07-28 — sdd-story

- Created feature.md (status: draft), product-spec.md, context.md from user story.
- Trigger: while setting up staging paper-trading alerts, hit the fundamentals-pipeline gap
  (features 059/062 disabled by config flags `marketdata.fmp.enabled` /
  `analysis.fundsignal.enabled`, and `secret.marketdata.fmp.api_key` unset) with no MCP tool, CLI
  script, or config-ui path to fix it — only a raw `SetConfig` gRPC call. User asked to add this
  gap to the feature backlog.
- Read `docs/runbooks/feature-workflow.md`, `docs/runbooks/reviewer-registry.md`,
  `docs/roadmap/ledger/fails.md`, `docs/roadmap/ledger/insights.md` per SDD boot sequence.
- Key ledger read applied: 2026-07-20 (`trigger-backfill-mcp-tool`, design) — a new MCP tool has
  multiple discovery/documentation surfaces (tools.py, agent CLAUDE.md, mcp-tools.md, runbooks
  index, and the task-oriented operational runbook — here `config-rollout.md`). Folded into FR-6.
- No directly-applicable `fails.md` entry found for this specific shape (new admin MCP tool over
  an existing RPC); the closest security-relevant registry entry is the `xstockstrat-agent` row's
  standing "no secret values in tool output" invariant, applied here as FR-4.
- Confirmed via direct inspection (this session, prior to /sdd-story) that `GetConfig`,
  `SetConfig`, `ListKeys` RPCs already exist (`packages/proto/config/v1/config.proto:17-27`) — no
  proto changes anticipated for this feature.
- Flagged as an explicit **known trap** in product-spec Out of Scope: `secret.*` config values
  have no real secret-store resolution today (`SetConfig` stores plaintext); this feature must not
  be designed/reviewed as if it adds secret encryption.

## Session 2026-07-28 (later) — user decisions on Open Questions

User answered the two draft Open Questions directly:
1. `get_config` must never return a value for `is_secret == true` keys, but `set_config` must
   still be allowed to write a new value to those keys. (This was already FR-1/FR-4's intent;
   restated/confirmed as a firm decision, not left open.)
2. `set_config` should allow touching **any** namespace/key (no denylist), but authorization must
   depend on the real calling user's role — explicitly rejecting the hardcoded admin
   `x-access-scope` pattern the other management tools use.

Before writing decision 2 into the spec, ran recon to check feasibility (a "depends on user role"
requirement is meaningless if nothing checks the role). Findings, all cited with file:line in
product-spec.md FR-5/FR-7:
- `xstockstrat-config`'s `SetConfig`/`GetConfig`/`ListKeys` perform **no authorization check at
  all** today (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:251-310`) — anyone
  reaching gRPC port 50060 can already call `SetConfig` unauthenticated.
- The agent's OAuth layer already validates the caller's JWT (`app/auth.py:28-46`
  `validate_bearer_jwt`) and receives `TokenClaims.roles`, but discards everything except a
  boolean audience check — constitution invariant **AGENT-4** documents that the agent forwards
  only `x-mcp-secret` + a hardcoded admin scope today, never real user identity.
- Platform's real role→scope mapping already exists and has a working reference implementation:
  `rolesToAccessScope` (`services/xstockstrat-ui/src/lib/auth.ts:65-76`) +
  `bffShared.ts:41-46` forwarding pattern. `ADMIN_SCOPE = 0x04`.
- **Verdict: two-service change**, not an agent-only fix. `xstockstrat-agent` must retain and
  forward the real per-request role/scope (new, narrow deviation from AGENT-4, scoped to
  `set_config` only — other management tools keep using the hardcoded `_admin_metadata()` helper
  unchanged). `xstockstrat-config` must gain a first-ever `ADMIN`-bit check on `SetConfig`.
- **Adjacent live security gap surfaced, out of this feature's default scope**: the UI's own
  `SetConfig` BFF route (`services/xstockstrat-ui/src/lib/configUiBff.ts:14-22`) only requires a
  valid session (`requireSession`), not admin scope — so today any authenticated UI user of any
  role can already write arbitrary config, including `platform.maintenance_mode`, through the
  browser. FR-7's new RPC-level gate will incidentally close this (same underlying RPC), but it's
  flagged as a pre-existing exposure independent of this feature, not silently rolled in — see
  product-spec.md Open Questions, and told to the user directly to consider via
  `docs/runbooks/bug-triage.md`.
- Updated `product-spec.md` (FR-3/FR-4/FR-5 rewritten, new FR-7, Affected Services expanded to
  include `xstockstrat-config`, Feature Workflow Notes now requires both service owners + a
  mandatory Security review, Acceptance Criteria 7-9 added, Open Questions updated) and
  `feature.md` (Reviewers table: added `xstockstrat-config` owner, Security marked required).

## Session 2026-07-29 — cross-feature reconciliation with 074

Feature **074** (`fix-config-write-authz`) was designed and implemented first in this session (see
that feature's `context.md`), which discharges this feature's FR-7. Rewrote FR-7 from "this feature
must add the ADMIN check" to "already implemented by 074 — verify, do NOT reimplement", closing the
one real collision the `/sdd-review` overlap scan found. Also updated, for the same reason:

- **Affected Services** — `xstockstrat-config` is no longer modified by this feature; it is now a
  pure consumer. This feature is agent-only again.
- **Feature Workflow Notes** — the config service owner's approval is no longer gated on this PR.
  The Security review stays **required**, but the reason changed: it is no longer "this adds the
  first authz check", it is "this is the first caller to forward a real per-user scope instead of
  the hardcoded admin tuple".
- **Open Question (reads)** — resolved. 074 settled it on the code rather than on this feature's
  assumption: every service boots over an **unauthenticated `WatchConfig`** whose first message is a
  full namespace snapshot — a superset of `GetConfig` — so gating reads is incoherent without
  gating `WatchConfig`, which would break platform startup. `get_config`/`list_config_keys`
  therefore inherit no new constraint.
- **Open Question (UI-side gap)** — resolved. The `configUiBff.ts` `requireSession`-only hole was
  split out as SEV-1 bug 074 and fixed there, exactly as this file said it should be (not silently
  bundled).

**New constraint 074 imposes on this feature:** `SetConfig` now also rejects `INVALID_ARGUMENT`
when a write carries neither an explicit `author` nor a propagated `x-user-id`. Because the agent
does not forward `x-user-id` (invariant **AGENT-4**), `set_config` MUST always send an explicit
`author`. FR-3 already makes `author` a required tool parameter, so this holds by construction — but
it is now load-bearing rather than a convention, and any future "make author optional" change would
break the tool.

Verified directly this session, ahead of the design phase:
- `services/xstockstrat-agent/app/tools.py` registers exactly **14** `@server.tool` functions, so
  FR-6's "fourteen → seventeen" count is accurate, and the "fourteen" string appears in
  `services/xstockstrat-agent/CLAUDE.md` and twice in `docs/runbooks/mcp-tools.md`.
- `app/auth.py` `validate_bearer_jwt` returns a bare `bool` and discards `claims.roles` entirely —
  FR-5 genuinely requires reshaping that function's return, not just reading an existing value.

## Session 2026-07-29 — /sdd-review product-spec: **FAIL** (4 blockers)

Status stays `draft` — the gate did not pass, so no lifecycle flip (per the skill's FAIL path).

The FR-7 "verify, don't reimplement" rewrite was checked statement-by-statement against this branch
and is **accurate**. FR-5's AGENT-4 deviation is coherently scoped. Tool count 14→17 verified. The
failures are elsewhere, and two of them are **live pre-existing defects in `xstockstrat-config`**
that I confirmed directly in the code this session:

### Blocker 1 — FR-1's secret redaction cannot fire (would ship a secret leak)

`ConfigValue` has an `is_secret` field (`packages/proto/config/v1/config.proto:56`, documented
"true = value is redacted"), but **nothing ever populates it on the read path**:
`buildConfigValue` (`configServiceImpl.ts:344-352`) returns only the oneof scalar, and
`toProtoSnapPayload` (`:47-55`) rebuilds each value as the scalar alone. So `GetConfig` and
`WatchConfig` return `is_secret == false` for **every** key, including
`secret.marketdata.fmp.api_key`. FR-1 keys redaction on exactly that field, so a literal
implementation would **echo the secret** — and AC-6's test would pass while leaking. `ListKeys` is
the only path that returns `is_secret` truthfully (`:312,324`), which is why `/config-ui` reads it
from there.

### Blocker 2 — `SetConfig`'s value round-trip is broken, so "config: no change required" is false

`setConfig` stores `JSON.stringify(value)` — the **whole `ConfigValue` message** — into `value_data`
(`configServiceImpl.ts:295`), while every read parses `value_data` as a **bare scalar**
(`:344-352`), and the seed migrations store bare scalars. So `set_config(key, "abc")` lands
`{"stringVal":"abc"}` and reads back as that literal string. Compounding it, `inferValueType`
(`:354-360`) tests snake_case (`v.string_val`) against a ts-proto **camelCase** request, so every
int/float/bool write is recorded as `value_type='string'`.

**This is not specific to 073** — it affects every `SetConfig` writer, including the config-ui
editor today. Seeded keys read correctly only because migrations wrote bare scalars; any key
*written through the RPC* is corrupted. Feature 074's authz test sends `{stringVal:'debug'}` and
asserts only the authz outcome, so it does not guard this.

### Blocker 3 — plaintext-secret governance conflict is framed away, not resolved

AC-4 requires writing a real FMP key into `config.config_values`. Four places state secrets are
**never** stored as plaintext and that `value_data` holds a `secret://` reference:
`services/xstockstrat-config/CLAUDE.md` (Critical Invariants + Config Governance),
`docs/patterns/config-governance.md:109`, `services/xstockstrat-marketdata/CLAUDE.md:67`,
`.gitleaks.toml:9`. The spec's "Known trap" says the resolver doesn't exist (true — marketdata
consumes the value literally) and instructs reviewers not to treat this as a secrets feature. That
frames the conflict away. It must be decided, and if plaintext wins, those four docs must be
amended **in the same feature**.

### Blocker 4 — the FR-B13 open question is transport-dependent and understated

Roles *are* available on the wire (`identity.proto:41-44` `TokenClaims.roles`); `validate_bearer_jwt`
receives them and discards all but the audience check (`app/auth.py:40-43`). But availability **at
the tool call** differs by transport:
- **Streamable HTTP** (`/`) — the POST carrying the tool call passes `_authorized(scope)`
  (`app/main.py:148-159`), so a per-request contextvar is safe under FR-B13.
- **Legacy HTTP+SSE** (`/messages`) — explicitly **not** auth-gated (`app/main.py:144-146`, comment
  at `:133`: "auth rides the established stream session"). There is no bearer token on the request
  that invokes the tool, so forwarding real roles there needs an SSE-session→claims map — exactly
  the in-memory store FR-B13 forbids.

So FR-5 is either transport-scoped or an FR-B13 breach. The spec must decide, and must name the
plumbing mechanism from the ASGI layer into a `@server.tool()` body (none exists today).

### Advisory findings also recorded

- `feature.md` still asserts `SetConfig` "currently has none"/"since none exists today"/"adds the
  first real authz gate" in three places — stale post-074, and it feeds the Reviewers snapshot that
  `/sdd-spec` freezes.
- Audit rows are written on **UPDATE only** (`migrations/001_config_tables.up.sql:40-42`), so a
  brand-new key's INSERT is unaudited — undercutting FR-3's attribution rationale and AC-8.
- FR-6: resolve "five/six"; `docs/runbooks/mcp-tools.md` has **two** count statements (`:3` and
  `:29`), and only **13** tool sections — `set_strategy_live` has none despite the header claiming
  fourteen. AC-5's "consistent" is unmeetable until that is addressed or explicitly excluded.
- FR-1/FR-2 don't state the read tools keep `_metadata()` (no admin scope) per AGENT-3.
- FR-5's "reuse `rolesToAccessScope`" crosses TS→Python; it is a **port**, and `ADMIN_SCOPE = 0x04`
  is canon (mirrored server-side at `services/xstockstrat-config/src/grpc/authz.ts`).
- `environment`/`trading_mode` tool params default to `dev`/`all`, so an operator omitting them
  silently writes a dev row; and `trading_mode` may be a no-op given the logged snake/camel collapse.

## Session 2026-07-29 — user decisions on the two review blockers

### Transport (blocker 4) — DECIDED: Streamable HTTP only, deny on SSE

`set_config` is available only over the Streamable HTTP transport, where the tool-call POST is
auth-gated (`app/main.py` `_authorized(scope)`) so the caller's claims are on the same request and a
per-request contextvar is safe. On the legacy HTTP+SSE `/messages` path it returns a clear
"unsupported transport" error. This honors FR-B13 (no in-memory store, `instance_count > 1` safe)
with no new state. FR-5's real-role forwarding is therefore scoped to Streamable HTTP.

### Secrets (blocker 3) — DECIDED: allow plaintext ONLY IF no existing secret mechanism exists.
### Verified answer: **a mechanism DOES exist — so plaintext in config is NOT approved.**

The user's condition was explicit, so it was checked exhaustively rather than assumed:

1. **No `secret://` resolver exists anywhere.** A repo-wide grep over `services/`, `packages/`,
   `scripts/` (excluding generated code) returns exactly one hit — a test fixture written by this
   session. Nothing resolves the reference format the docs describe.
2. **The consuming service reads the value literally.**
   `services/xstockstrat-marketdata/cmd/server/main.go:114` —
   `APIKey: cfgWatcher.GetString("secret.marketdata.fmp.api_key", "")` — passed straight into
   `fmp.NewClient`. A `secret://…` string would be sent to FMP as the API key.
3. **But the platform DOES have a working secret mechanism: DigitalOcean App Platform
   `type: SECRET` environment variables** (encrypted at rest by DO), read via `getEnv(...)`, with
   `${VAR}` from `.env` locally in docker-compose. There are **10** such vars in each of
   `.do/app.yaml` and `.do/app.dev.yaml`, covering **every** real credential on the platform:
   `ALPACA_API_KEY`, `ALPACA_API_SECRET`, `BROKER_ACCOUNTS_ENCRYPTION_KEY`, `JWT_SECRET`,
   `MCP_AGENT_SECRET`, `OTEL_EXPORTER_OTLP_HEADERS`.
   Example: `services/xstockstrat-marketdata/internal/config/config.go:41-42` reads the Alpaca
   credentials via `getEnv`, **not** via the config service.
4. **The FMP key is the sole exception.** It is the only credential routed through
   `xstockstrat-config`, and `secret.marketdata.fmp.api_key`
   (`migrations/007_marketdata_fmp.up.sql:30-35`) is the only `is_secret = TRUE` row in the entire
   config store. `FMP_API_KEY` appears in no app spec, no docker-compose block, and no `.env`
   example. Feature 059 departed from the established pattern; the "secret reference — resolved at
   deploy, never plaintext" comment in that migration describes a resolver that was never built.

**Conclusion:** the precondition for allowing plaintext fails. `set_config` must **not** write real
secret values into `config.config_values`, and the four governance docs stay as written — they are
accurate about the platform's actual secret mechanism, they were just never applied to the FMP key.

**Consequence for 073:** `set_config` rejects `is_secret` keys. The feature covers flag flips and
threshold updates (`marketdata.fmp.enabled`, `analysis.fundsignal.enabled`, `platform.*`,
`trading.approval.*`). `get_config`'s redaction (FR-1) still matters — `is_secret` rows exist and
must never be echoed — and is now implementable thanks to feature 075.

**Consequence for the original motivation (staging the FMP key):** it is solved by routing the key
through the same mechanism as every other credential, not by this feature — add `FMP_API_KEY` as a
`type: SECRET` env var in both app specs plus a docker-compose/.env entry, and have marketdata read
it via `getEnv` with the config key retained only as the enable/disable toggle. That is a small,
separate change to feature 059's wiring and should be its own bug/feature, not bundled into 073.

### Correction — the secrets decision, as actually given by the user

The prior entry recorded the verification correctly but framed the outcome as my inference. The
user's actual answer was explicit: **"no, use the same existing mechanism used for ibkr and alpaca
keys."**

So the decision is settled, not deduced:
- `set_config` **rejects `is_secret` keys**. No plaintext credential ever goes into
  `config.config_values` through an MCP tool.
- The four governance docs stay as written — they describe the platform's real mechanism.
- The FMP key moves to `FMP_API_KEY`, a `type: SECRET` env var, matching Alpaca (plain env var) and
  IBKR (env-var master key encrypting the stored blob). Implemented as **feature 076**
  (`fmp-key-to-secret-env`), which also removes the seeded config row via migration `009`.

073's remaining scope is therefore: `get_config` (with redaction — still worth keeping, and now
trustworthy thanks to 075), `list_config_keys`, and `set_config` for non-secret keys only
(flag flips such as `marketdata.fmp.enabled` / `analysis.fundsignal.enabled`, plus thresholds).
The staging gap that motivated 073 is closed by 076 for the credential half and by `set_config` for
the toggle half.

## Session 2026-07-29 — /sdd-review pass 3: **PASS WITH WARNINGS** → `spec-ready`

Third pass. Passes 1 and 2 both FAILED; all four blockers across them are now resolved:

| Blocker | Resolution |
|---|---|
| FR-1's `is_secret` redaction predicate could never fire | Feature **075** — `buildConfigValue`/`toProtoSnapPayload` now carry `is_secret` |
| `SetConfig` value round-trip broken → "config: no change required" false | Feature **075** — bare scalars + camelCase-aware `inferValueType` |
| Plaintext-secret governance conflict | **User decision** — `set_config` rejects `is_secret` keys; credential moved to `FMP_API_KEY` (feature **076**) |
| FR-B13 / transport | **User decision** — Streamable HTTP only; explicit error on legacy SSE |
| *(pass 2, new)* `ListKeys` dropped all metadata on the wire | Feature **077** — this branch |
| *(pass 2, new)* `is_secret` predicate undefined for new keys | FR-3 now two-pronged: flag **and** `secret.` name prefix checked pre-RPC |

The reviewer confirmed 077's fix is real and that its test drives a genuine gRPC socket, so FR-3
prong (a) is now backed by real data rather than a field that was always `false`.

### Two warnings fixed in this session

1. **User Story still promised secret values.** Pass 2 reported this closed; it was not — I had
   edited the capability clause ("write **non-secret** config values") and left the benefit clause
   enumerating "flag flips, threshold updates, **and secret values**". Corrected. Recording the miss
   because it is the second time a partially-applied edit read as complete.
2. **FR-3 prong (a) did not pin its lookup scope.** `ListKeys` is filtered by
   `environment`/`trading_mode`, so a lookup at the default `dev`/`all` scope cannot see a key
   flagged only in `production`/`live`, and prong (b) does not backstop it (it matches on name).
   FR-3 now requires the prong-(a) lookup to use the *same* scope as the pending write, and flags
   that Known Constraint 1's `trading_mode` collapse may prevent that threading through — design
   must confirm rather than assume.

### Remaining advisory (not blocking, carried to design)

- FR-6 appears after FR-7 in document order; its header says "Six surfaces" over a five-item list
  reconciled in prose (`mcp-tools.md` counted twice). Cosmetic.
- FR-5's `app/auth.py:28-46` citation is one line short of the function's actual extent.

## Session 2026-07-29 — /sdd-design: `spec-ready` → `design-approved`

Phase 0 recon written (see recon.md, incl. the premise correction). Phase 1 ran one adversarial
round (`quick`) producing 14 objections. No Floor breach. The three that changed the design:

1. **The transport gate as I proposed it was wrong, not just weak.** I would have checked
   "`ctx.request_context.request` is a Starlette `Request` carrying an acceptable Authorization
   header". Both transports build a `Request` (`sse.py:203`, `streamable_http.py:380`) and a
   spec-conformant client attaches the header to `POST /messages` too — so `set_config` would have
   **succeeded over SSE**, and AC-10 would have passed only because the test omitted the header.
   Replaced with the adversary's alternative: `_authorized` stores claims on the ASGI scope, and
   `/messages` returns before `_authorized` ever runs — so the gate is correct *by construction*.
2. **The claims plumbing I proposed would have broken `tests/test_auth.py` and the 401 path.**
   Delegating `validate_bearer_jwt` to `client.validate_token` moves stub construction into
   `app.client`, so the patches at `test_auth.py:25,28,40,43` intercept nothing; and
   `client.validate_token` raises where `app/auth.py:44-49` never does, turning an expired token
   into a 500 that bypasses the `WWW-Authenticate` discovery response. The scope approach avoids
   both and needs no second Identity round-trip.
3. **`value_type` is a no-op for existing keys.** `ON CONFLICT … DO UPDATE SET` does not update
   `value_type`, so the caller's choice is honored only when creating a key. Must be in the
   docstring or it becomes an "I set int and got a string back" bug report.

Also folded in: fail-closed on the `ListKeys` pre-check; `ListKeys` over `GetConfig` (the latter
serves a `pg_notify`-refreshed cache and can report a stale flag); `x-user-id` dropped as dead
metadata since `request.author` wins server-side; `value_type` as a `Literal` so the enum reaches
the public `inputSchema`; and the C-10 surface list extended to invariant **AGENT-3** and the agent
`CLAUDE.md` management-tool-authorization paragraph, which the FR-6 list had missed.

## Session 2026-07-29 — /sdd-execute: implemented

### What shipped

- `app/auth.py` — `validate_bearer_claims(token) -> dict | None`, **alongside** the untouched
  `validate_bearer_jwt`. Kept separate deliberately: that function's tests patch `app.auth`'s stub,
  and its never-raises contract is what keeps an expired token a 401 with the `WWW-Authenticate`
  discovery pointer rather than a 500.
- `app/main.py` — `_authorized` now resolves claims and publishes them on the request's ASGI scope
  under `MCP_CLAIMS_SCOPE_KEY`. Nothing is stored beyond the request (FR-B13 intact).
- `app/scopes.py` — `roles_to_access_scope`, a port of the UI's `rolesToAccessScope`, with the two
  "admin" numbers (15 here, 7 in `_admin_metadata()`) explained so neither looks like a bug.
- `app/client.py` — `get_config` / `list_config_keys` / `set_config` wrappers. `set_config`
  forwards `("x-access-scope", <caller's scope>)` instead of `_admin_metadata()`'s hardcoded tuple.
- `app/tools.py` — the three tools; `set_config` takes `ctx: Context`, rejects `secret.`-prefixed
  keys before any RPC, requires claims, checks the `is_secret` flag at the write's own scope
  (failing closed), then forwards the derived scope.
- Docs: tool counts on all four surfaces, three new `mcp-tools.md` sections, the MCP path in
  `config-rollout.md`, and **both prose surfaces the FR-6 list had missed** — invariant AGENT-3 and
  the agent `CLAUDE.md` § Management-tool authorization paragraph, each of which asserted something
  this feature falsifies.

### Verification

| Gate | Result |
|---|---|
| `uv run pytest` | **124/124** |
| `uv run ruff check app/ tests/` | clean |
| `scripts/check-context-map.sh` | OK |
| coverage | 67% total (threshold 40); `scopes.py` 100%, `tools.py` 84% |
| SDK wiring | `set_config.context_kwarg == 'ctx'` asserted — proves `find_context_parameter` ran |
| tool count | 17 registered, matching every doc surface |

### Deviations

1. **`tests/test_oauth.py` needed updating** — two transport-acceptance cases patched
   `app.auth.validate_bearer_jwt`, which `_authorized` no longer calls. This is precisely the
   breakage the adversary predicted for `test_auth.py`; I avoided it there and hit it next door.
   Repointed at `validate_bearer_claims`; they still test what they tested.
2. **`app/scopes.py` also owns `MCP_CLAIMS_SCOPE_KEY`** rather than `main.py`, so `tools.py` and
   `main.py` share the seam without importing each other.

### Open risks carried from design.md

- Prong (a)'s blind spot: a key flagged `is_secret` only in a *different* scope is invisible to the
  lookup; the name prefix backstops only prefixed keys. Narrowed by feature 078, not eliminated.
- TOCTOU between the `ListKeys` check and the `SetConfig` write — accepted, one-RPC window.
- **No test drives a real MCP transport.** The suite asserts `context_kwarg == 'ctx'` (so the SDK
  injection is proven) and mocks the ctx thereafter. The claim that Streamable HTTP actually
  delivers a request whose scope carries `mcp_claims` is verified by reading the SDK, not by
  executing it — the residual gap, stated rather than papered over. The dev smoke test closes it.

## Session 2026-07-29 (CI: feature status automation)

- Promotion PR #812 merged to main
- Feature promoted and committed: 0eae638104744992c61c8a1ac4bd8cbaac10862b
- Status updated: `code-completed` → `launched`
- Launched date: 2026-07-29
