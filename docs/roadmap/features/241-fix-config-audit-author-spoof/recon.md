# Recon: fix-config-audit-author-spoof

**Created**: 2026-10-20 (re-synthesized after the product-spec re-review added FR-1..FR-4, AC-4 and Q1-Q5)
**From**: product-spec.md (Track C bug, SEV-2; defect report `docs/reports/2026-10-19-config-audit-author-caller-spoofable-defect.md`)
**Affected services**: xstockstrat-config, xstockstrat-agent, xstockstrat-trading, xstockstrat-ui

---

## Objective

`SetConfig` authorizes on verified headers but attributes the write to the caller-supplied
`SetConfigRequest.author` first (`configServiceImpl.ts:410`), so any authorized caller can credit someone
else in `updated_by` / `config.config_audit.changed_by`. Operator decision (2026-10-20, context.md:89-91):
attribution comes only from the verified `x-user-id` (human) or the `callerID` of the `x-internal-caller`
grant that authorized the write (automated); `request.author` is ignored and proto field 4 becomes
`[deprecated = true]`; the agent stops sending free-text `author`; trading's `system:reconciliation-poller`
sentinel gives way to the `x-internal-caller` identity.

## Codebase Map

- **`xstockstrat-config`** (Node/TS)
  - Entry point: `services/xstockstrat-config/src/index.ts:47,51` (`new ConfigServiceImpl(pool)`, `addService`)
  - Handler: `setConfig`, `src/grpc/configServiceImpl.ts:371-523`
    - `callerUserId = userIdFrom(call.metadata)` `:376`, read before the gate.
    - Global branch `if (userIdParam === null)` `:378-393`: `rawValue` is `string_val`/`stringVal` only
      (`:379`); `internalCallerAuthorized` `:380-385` is block-scoped, invisible after `:393`; gate `:386`.
    - Per-user owner branch `:394-404`: rejects unless `callerUserId === userId`, so `x-user-id` is always
      non-empty past it.
    - `callerIdentity = first(md, HEADER_INTERNAL_CALLER) || null` `:405`: raw header, stored even when the
      grant did not authorize (out of scope).
    - **Defect** `:410-414`: `const author = call.request.author || userIdFrom(call.metadata)` →
      `MISSING_AUTHOR_ERROR`.
    - Order after the author check: `platform.trading_state` enum `INVALID_ARGUMENT` (`:418-428`) → scalar
      bounds `INVALID_ARGUMENT` (`:432-442`) → existence gate `NOT_FOUND` (`:444-472`) → INSERT `:501-513`
      (`author` = param `[6]` `updated_by`, `callerIdentity` = `[10]`; `ON CONFLICT … updated_by =
      EXCLUDED.updated_by` `:509`).
  - Authz helpers, `src/grpc/authz.ts`:
    - `HEADER_USER_ID` `:11`, `first` `:14`, `userIdFrom` `:27`, `HEADER_INTERNAL_CALLER` `:56`.
    - `MISSING_AUTHOR_ERROR` `:46-50`, message `'author required: set request.author or propagate x-user-id'`.
    - `INTERNAL_CALLER_ALLOWLIST` `:66-76`: one grant, `trading-reconciliation-poller` →
      `platform.trading_state` ∈ {`REDUCE_ONLY`, `HALTED`}.
    - `hasInternalCallerAuthority` `:82-97` returns `boolean`; matched id is `first(md, HEADER_INTERNAL_CALLER)`
      (`:88`). No `peerSan` on this grant, unlike `GetSecret` grants (`:111,124,162`).
  - Last migration: `030_marketdata_edgar_snapshot_keys.up.sql` (`services/xstockstrat-config/migrations/`).
    None needed.
  - Audit triggers: last defined by `migrations/017_config_secrets_and_scoping.up.sql:66-91` (no later
    redefinition: grep of `audit_config_change|audit_config_insert` hits 001/002/010/014/017 only).
    UPDATE trigger copies `NEW.updated_by` → `changed_by` only when `OLD.value_data IS DISTINCT FROM
    NEW.value_data` (`:69-74`); INSERT trigger always (`:81-91`). `caller_identity` from
    `014_config_caller_identity.up.sql:9,12`; `changed_by TEXT` `001_config_tables.up.sql:32`.
  - Config-read pattern: n/a (no config keys touched).
  - Proto: `SetConfigRequest` `packages/proto/config/v1/config.proto:122-138`; `string author = 4;` `:126`;
    no `reserved` in the file.
  - Tests: `tsc && node --test dist/__tests__/*.test.js`; c8 `--lines 40` (`package.json:12-13`). A proto
    edit needs `./scripts/buf-gen.sh` before `tsc` (generated client imported as
    `@xstockstrat/proto/config/v1/config`).
- **`xstockstrat-agent`** (Python)
  - Entry point: `services/xstockstrat-agent/app/main.py:26,79` (`register_tools(server)`).
  - `set_config` tool `app/tools.py:1641-1701`: `author: str` required `:1648`; docstring `:1663-1664`;
    forwarded `:1694`; checks role only (`_caller_access_scope` `:1683`), never `_caller_user_id`.
  - `_write_source_bearer` `app/tools.py:341-360`: `author=tool` `:353`, `access_scope` `:355`,
    `user_id=_caller_user_id(ctx, tool)` `:357` (fails fast on empty claims `user_id`); fresh
    `mcp_credential.<uuid>` key with `create_key=True` (`:346,356`). Callers: `instantiate_template`
    `:1222`, `manage_signal_source` `:1309`.
  - Client `app/client.py:2094-2151`: `author: str` `:2100`, `author=author` `:2142`, metadata
    `_metadata(("x-access-scope", …))` `:2149`; `x-user-id` comes only from the bound caller context,
    appended when non-empty (`:75-76`).
  - Identity binding: `CallerPropagationMiddleware` `app/tools.py:190-220`, `client.set_caller(claims.get("user_id") or "", …)`
    `:211-215`; helpers `_require_claims` `:116`, `_caller_access_scope` `:134`, `_caller_user_id` `:155-170`.
  - No migrations, no config keys, no `x-internal-caller` use.
- **`xstockstrat-trading`** (Go)
  - Entry point: `services/xstockstrat-trading/cmd/server/main.go:91` (`service.NewTradingService`).
  - `escalateSystemic` `internal/service/trading.go:2163-2193`, called from `:2154`:
    - only `SetConfigRequest` `:2168-2177`, callerID `"trading-reconciliation-poller"` `:2168`;
    - `Author: "system:reconciliation-poller"` `:2176`;
    - failure only logged (`slog.Warn` `:2180`), then `EmitAlert` (`:2183`).
  - Seam: `configSetConfigForwarder` `trading.go:43-45`, field `configSetter` `:99-101`, wired `:215`.
  - Header attach: `Watcher.SetConfig` `internal/config/config.go:255-264` — `metadata.NewOutgoingContext`
    with only `x-internal-caller` + `x-trace-id` (`:258-261`); no `x-user-id`, no `x-access-scope`.
  - Lint: `staticcheck` enabled `services/xstockstrat-trading/.golangci.yml:7`; CI `go-lint`
    golangci-lint v2.14.0, also triggered by proto changes (`.github/workflows/ci.yml:197-241,204,212`).
  - No migrations, no config keys.
- **`xstockstrat-ui`** (Next.js BFF)
  - Entry points: `src/app/config-ui/api/[...connect]/route.ts:1` → `configUiBff.ts`;
    `src/app/insights/api/[...connect]/route.ts:1` → `insightsBff.ts`.
  - config-ui `setConfig` `src/lib/configUiBff.ts:34-56`: `{ ...req, environment, author: claims.user_id }`
    `:53`; comment `:36-37` names the author stamp as the reason for the explicit body, but the env
    fill/reject `:41-51` also needs it.
  - insights per-user bearer `setConfig` `src/lib/insightsBff.ts:174-184`: `{ ...req, userId: claims.user_id, …, author: claims.user_id, … }`
    (`:177`, `:179`).
  - Verified id on the wire: `backendHeaders` `src/lib/bffShared.ts:38-44` (`[HEADER_USER_ID]: claims.user_id`);
    `requireSession` `:29-35` checks only that the JWT verifies (`src/lib/auth.ts:22-31` casts the payload; no
    non-empty `user_id` check).
  - Audit reader: `src/app/config-ui/api/audit/route.ts:60,74` (`changed_by` → `changedBy`), rendered as the
    "By" column `src/app/config-ui/audit/page.tsx:63`; no `system:*` special-casing.
  - No migrations, no config keys.

## Patterns to REUSE

- **Verified human identity** → `callerUserId` (`configServiceImpl.ts:376`, via `userIdFrom` `authz.ts:27`).
  No second header read; ESLint bans inline `'x-user-id'`/`'x-access-scope'` literals
  (`services/xstockstrat-config/.eslintrc.json:13-27`).
- **Verified automated identity** → the existing `internalCallerAuthorized` result
  (`configServiceImpl.ts:380-385`, `hasInternalCallerAuthority` `authz.ts:82-97`), hoisted out of the
  `if (userIdParam === null)` block. When true, the grant `callerID` equals `first(md, HEADER_INTERNAL_CALLER)`
  (`authz.ts:88`, matched on equality `:92`). Never credit raw `callerIdentity` (`:405`): AC-3 example 2
  (admin scope + `x-internal-caller: trading-reconciliation-poller` on `notify.push.min_severity`) passes the
  gate on admin scope with `internalCallerAuthorized` false and must still be rejected. No id-returning
  variant exists; a new helper is optional, not required (C-18).
- **No-identity rejection** → `MISSING_AUTHOR_ERROR` (`authz.ts:46-50`, `status.INVALID_ARGUMENT`) at its
  current position (`:410-414`), ahead of enum/bounds/existence. Only the message (names `request.author`) and
  its doc comment (`:46`) change; no test pins the message (`setConfigAuthz.test.ts:197` asserts code only).
  Ledger rule: a header-identity handler rejects a missing identity with code 3, never falls back to the body
  (fails.md:2780-2782); self-scoped callers come from `x-user-id`, not request fields (insights.md:1826-1828).
- **Proto deprecate-in-place** → copy `trading_mode = 7 [deprecated = true];  // deprecated (feature 147): ignored`
  (`config.proto:129`) onto `author = 4` (`:126`). Same name/number, no `reserved` (PROTO-2,
  `packages/proto/docs/context-constitution.md:20`).
- **Go SA1019** → deleting `trading.go:2176` needs nothing. If a reference is kept: scoped nolint with reason,
  write side `services/xstockstrat-marketdata/internal/alpaca/client.go:142` /
  `services/xstockstrat-portfolio/internal/service/portfolio_service.go:1958`; test side (set a deprecated
  field to prove it is ignored) `services/xstockstrat-portfolio/internal/handler/portfolio_identity_test.go:29`.
  Trading has no `nolint:staticcheck` today. Ledger: insights.md:1200-1202, fails.md:1425-1427.
- **Trading callerID assertion** → `fakeConfigSetter` (`trading_reconciliation_test.go:746-756`) records only
  `req` (`:753`) and drops `callerID`; extend it to record `callerID` if `:789-790` becomes a callerID
  assertion. Transport header already pinned by `TestWatcher_SetConfig_AttachesMetadata`
  (`internal/config/config_test.go:211-244`), whose request has no `Author`.
- **Agent identity from claims, never a parameter** → feature-111 `manage_formula`: no `author` param, derives
  `"author": user_id` (`tools.py:1113`); `test_rejects_caller_supplied_author_and_user_id` expects `TypeError`
  on `author=` (`tests/test_tools.py:1260-1273`). Fail-fast helper `_caller_user_id` (`tools.py:155-170`,
  AGENT-3b `services/xstockstrat-agent/docs/context-constitution.md:20`). Header path already exists: AGENT-4
  (`:21`), `tools.py:211-215`, `client.py:75-76`.
- **Agent removed-parameter assertion** → `test_config_tools_expose_no_environment_parameter`
  (`tests/test_config_tools.py:329-338`, `"environment" not in props`).
- **Agent request-builder parity** → extend the exclusion `- {"trading_mode"}` at `tests/test_config_tools.py:304`
  (`ListFields()` set at `:303` drops an unset `author`).
- **Agent outbound capture for AC-4** → stub capture in `TestSetConfigRequestParity`
  (`tests/test_config_tools.py:261-305`, `ConfigServiceStub` patched, `_capture(req, metadata=None)`); caller
  binding `bound_caller` (`tests/test_template_tools.py:38-43`), `_run` (`:79`), `_single_user_header` (`:96`).
  Direct `.fn` calls bypass the middleware, so a bound caller is required for the `x-user-id` assertion.
- **Agent fixtures (C-13)** → `tests/conftest.py:12-17` (`ADMIN` `user_id "u-1"`, roles admin; `_ctx`). AC-4's
  `u-1`/admin is exactly `ADMIN`; no inline claim dicts.
- **Config test harnesses** → loopback gRPC + recording pool:
  `src/__tests__/setConfigAuthz.test.ts:139-151` (`setConfig(md, overrides)`, `insertQuery().params[6]`);
  `src/__tests__/internalCallerSetConfig.test.ts:67-80` (AC-2 base: add `params[6]` next to `params[10]` `:91`).
- **UI BFF identity** → `backendHeaders` (`bffShared.ts:38-44`). Unit harness `src/lib/insightsBff.test.ts`
  (`vi.mock('@/lib/connectClients')` `:9`, `SignJWT` cookie `:28`, `dispatchConnect` `:40`), author assertion
  `:59,69`. Header constants `src/lib/headers.ts:5-6`; UI ESLint bans inline header literals
  (`services/xstockstrat-ui/.eslintrc.json:6-24`).

## Existing Business Rules (preserve / extend)

Folded from the scenario-recon digest. No CHANGE verdict: no suite in
`services/xstockstrat-{config,agent,trading,ui}/acceptance/*.feature` pins `author`, `updated_by`,
`changed_by`, `config_audit` or `caller_identity`. Every affected service has a suite; none skipped.

**xstockstrat-config**
- **PRESERVE** `@AC-1 @FR-1 @FR-4 @feature-147` "A secret written via SetConfig is persisted encrypted, not plaintext" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature:10`) — ciphertext + `[redacted]` unchanged; only the attribution source moves.
- **PRESERVE** `@AC-1b @FR-1 @FR-4 @feature-147` "is_secret is row-authoritative on write, never trusted from the request" (same file `:20`) — the identity check must leave `is_secret` read from the row; same never-trust-the-request principle as this fix.
- **PRESERVE** `@AC-4 @FR-2 @feature-184` "An out-of-bounds tuning write is rejected at the write edge" (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature:37`) — rejected for the bounds reason, nothing written.
- **PRESERVE** `@AC-5 @FR-2 @feature-184` "An in-bounds tuning write is accepted without create_key" (same file `:45`) — a verified-identity write still succeeds.
- **PRESERVE** `@AC-8 @FR-2 @feature-184` "A bounded key whose lower edge is a legitimate value accepts that value" (same file `:52`).
- **PRESERVE** `@AC-5 @FR-4 @feature-182` "A registered materializer key is settable via SetConfig without create_key" (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature:11`).
- **PRESERVE** `@AC-7 @FR-6 @feature-182` "An in-bounds tuning write is accepted" (same file `:18`).
- **PRESERVE** `@AC-8 @FR-6 @feature-182` "An out-of-bounds tuning write is rejected at the write edge" (same file `:24`) — must stay rejected for the bounds reason, not FR-3.
- **PRESERVE** `@AC-9 @FR-2 @feature-182` "The bounds are write-path only and change no read path" (same file `:31`).
- **PRESERVE** `@AC-7 @FR-5 @feature-161` "the decay half-life is settable at the boundary without create_key" (`services/xstockstrat-config/acceptance/surface-signal-weight-decay-config.feature:8`) — agent-tool wording; `set_config` path still succeeds after its `author` contract changes.
- **PRESERVE** `@AC-11 @FR-8 @feature-161` "an out-of-range decay half-life write is rejected server-side without persisting" (same file `:21`).
- **PRESERVE** `@AC-12 @FR-8 @feature-161` "a negative or non-numeric decay half-life write is rejected server-side" (same file `:28`).

**xstockstrat-agent**
- **PRESERVE** `@AC-25 @FR-12 @feature-224` "Agent tools expose templates and drop public arguments" (`services/xstockstrat-agent/acceptance/private-by-default-templates.feature:7`) — `instantiate_template` stays in the catalog while its bearer write drops `author`.
- **PRESERVE** `@AC-1 @FR-1 @feature-214` "The xstockstrat-agent MCP advertises no db_ tool" (`services/xstockstrat-agent/acceptance/remove-agent-postgres-mcp.feature:9`) — re-grep addition; a parameter removal changes no tool count (`tests/test_tools_endpoint.py:14`, `_TOOL_COUNT = 45`).

**xstockstrat-ui**
- **PRESERVE** `@AC-12 @FR-7 @feature-219` "Save refreshes the row value without reload" (`services/xstockstrat-ui/acceptance/config-ui-usability.feature:73`) — holds whichever Q4 option; the session `x-user-id` must still reach config.

**xstockstrat-trading**
- Suites `fix-trading-config-key-mismatch`, `fix-reconciliation-false-halt`, `resume-halted-account`: no `@AC-*` asserts the `escalateSystemic` SetConfig or its `Author`. None relevant.

**Platform (`docs/sdd/business-rules/platform.feature`)**
- **EXTEND** `@AC-9 @FR-5 @regression @feature-196` "request-only dead fields stay server-ignored" (`:337-341`) — `SetConfigRequest.author` joins the named dead fields; identity resolved from headers. Adds a case, alters nothing. Launch: `scenario-promoter` decides whether to add `author` to its Given or promote AC-1..AC-4 separately.
- **PRESERVE** `@AC-5 @FR-4 @regression @feature-196` "deprecating a response field never changes the proto schema" (`:324`) — applies by analogy to request field 4: no removal/renumber/`reserved`, `buf breaking` clean.
- **PRESERVE** `@AC-35 @FR-14 @feature-224 @feature-225` "Two users with the same mcp_client slug use their own credentials" (`:306`) — the bearer written by `_write_source_bearer` / `insightsBff.ts:179` keeps value, per-user scope and redaction; only `updated_by` changes.
- **PRESERVE** `@AC-5 @FR-5 @feature-210` "Header-propagation semantics are unchanged beneath mTLS" (`:238`) — attribution consumes `x-user-id`; propagation unchanged.
- **PRESERVE** `@AC-32 @FR-12 @feature-224` "Agent docs and strat-lab skill stay in parity with the tool contract" (`:300`) — the `docs/runbooks/mcp-tools.md` § `set_config` edit keeps parity. `plugins/` has no `set_config` reference.

**Precedent (not an affected service, not classified)**
- Header-wins-over-body: `services/xstockstrat-indicators/acceptance/private-by-default-templates.feature:29-30`
  `@AC-4 @FR-2 @feature-224` "Body author cannot impersonate another user or the system".
- Both headers together: platform `@AC-6 @FR-3 @FR-1 @feature-224` (`:258`) is analysis → indicators, not a
  config write; binds nothing for Q1.

**C-16 blind spots** (no durable guard today; this feature's AC-1..AC-4 become the first)
- The feature-102 internal-caller SetConfig gate and `caller_identity` persistence (config CLAUDE.md
  invariant #7, `services/xstockstrat-config/CLAUDE.md:42-56`).
- The trading `escalateSystemic` write (`trading.go:2168-2177`): if FR-3 lands and FR-2 is wrong, the
  kill-switch escalation fails `INVALID_ARGUMENT` and only logs (`:2180`). AC-2 is the sole guard; promote it.
- The `/config-ui` audit view display change (`system:reconciliation-poller` → `trading-reconciliation-poller`).

**Fixture hazard on the PRESERVE write-edge rules.** They say "an admin" and name no `x-user-id`. Backing
tests send admin scope + `author` with no `x-user-id` (`setConfigScalarBounds.test.ts:73-74`,
`tradingStateValidation.test.ts:76-79,129-133`). After FR-3 an accept case fails loudly, but a rejection
case that pins only `err.code` passes vacuously on the FR-3 `INVALID_ARGUMENT`:
`setConfigScalarBounds.test.ts:103-109,111-117` (`@AC-12 @feature-161`) and
`tradingStateValidation.test.ts:115-121`. Those that also `assert.match` the bounds/enum message
(`setConfigScalarBounds.test.ts:100,145,178,…`; `tradingStateValidation.test.ts:111`) fail loudly. Add a
verified `x-user-id` to every such fixture; keep the "nothing written" assertions.

## Dependencies

- **Proto/RPC.** `SetConfigRequest.author` field 4 (`config.proto:126`) → `[deprecated = true]`. Other fields:
  `namespace=1`, `key=2`, `value=3`, `reason=5`, `environment=6`, `trading_mode=7` (already deprecated),
  `create_key=8`, `user_id=9`. `buf lint` + `buf breaking` + `./scripts/buf-gen.sh` (C-09). Approval: Proto
  Reviewer + `packages/proto` owner (product-spec § Fix Scope); breaking route n/a. Advisory only for
  consumers (fails.md:1335-1337) — enforcement is the server ignoring the field.
- **Migration.** None. Config's last is `030`; next free would be `031` (pre-reserved by 243; moot).
- **Config keys.** None.
- **Inter-service edges.** Unchanged: agent → config `SetConfig` gRPC 50060 (`client.py:2135-2150`); ui BFF →
  config (`configUiBff.ts:52`, `insightsBff.ts:174`); trading → config via `x-internal-caller`
  (`config.go:257-263`).
- **New env vars / ports.** None.

## Risks / Not-found

- **No real-DB config harness.** All SetConfig tests use the recording-pool stub, so the audit triggers never
  run in tests. AC-1..AC-3 "Then config_audit.changed_by" can be shown only as INSERT params `[6]`/`[10]` plus
  a SQL review of `017:66-91` (trigger copies `NEW.updated_by`). Precedent: F-05 SQL-review bar
  (fails.md:732-734).
- **Secret re-writes skip the UPDATE trigger.** A secret UPDATE keeps `value_data = '[redacted]'`, so `017:69`
  does not fire and only `config_values.updated_by` changes. `_write_source_bearer` always INSERTs a fresh key
  (`tools.py:346,356`), so its INSERT trigger (`017:81-91`) carries the new attribution.
- **Config test break-list** (admin scope, no `x-user-id`, relying on `author`; all `src/__tests__/`):
  - `setConfigAuthz.test.ts:170-181` (asserts `params[6] === 'tester'`, scope `'7'`) and `:202-233`
    (NOT_FOUND / `createKey` / registered-update cases, scope `'7'`; would hit `INVALID_ARGUMENT` before the
    existence gate).
  - `internalCallerSetConfig.test.ts:130-143` (ordinary admin write, `author: 'tester'`); its default
    `author: 'system:reconciliation-poller'` (`:73`) becomes inert; `:82-92` gains a `params[6]` assertion.
  - `secretsAndScope.test.ts:160,171`; `perUserSecrets.test.ts:240-242`; `setConfigScalarBounds.test.ts:73-74`;
    `tradingStateValidation.test.ts:76-79,129-133`; `configValueRoundtrip.test.ts:115-118`;
    `scopeResolution.test.ts:87-94`.
  - Rewrite: `setConfigAuthz.test.ts:183-191` (fallback case → AC-1 canonical) and `:193-199` (→ AC-3, add a
    non-empty `author` variant). Compatible already: `perUserSecrets.test.ts:118-125` (`x-user-id` only).
  - Stale comment, not load-bearing: `configValueRoundtrip.test.ts:125` params order.
- **Agent test break-list.** `tests/test_config_tools.py:110,133,152,171,237,255` (`author="me"` on direct
  `set_config` `.fn` calls → `TypeError` if the param is removed); `:297` (`author="a"` on
  `client.set_config`) and `:304` exclusion set — not in the product-spec list. `tests/test_streamable_http_auth.py:86`
  sends `"author"` over the real transport and patches `client.set_config` with an `AsyncMock`, so it keeps
  passing (asserts only scope, `:101`). No agent test asserts the `author` `_write_source_bearer` sends.
- **Q1 identity precedence (open for design).** No SetConfig caller sends both headers: trading sends only
  `x-internal-caller` (`config.go:258-261`); agent and UI send no `x-internal-caller`. The internal-caller grant
  is evaluated only in the global branch (`configServiceImpl.ts:378-393`); the per-user branch always has
  `x-user-id`. The operator decision lists `x-user-id` first.
- **Q2 `mcp` undeclared-argument behaviour (partly verified).** In the installed venv
  (`services/xstockstrat-agent/.venv`, dist-info `mcp-2.0.0`): `ArgModelBase.model_config =
  ConfigDict(arbitrary_types_allowed=True)` (`mcp/server/mcpserver/utilities/func_metadata.py:63`), no
  `extra="forbid"`; `pre_parse_json` skips unknown keys (`:168`); tool models built with
  `__base__=ArgModelBase` (`:271`); `model_dump_one_level` iterates `model_fields` (`:56`). So an extra
  `author` over the transport is dropped silently. `uv.lock:597` pins `mcp` 2.2.0, which is not installed or
  cached here — residual risk (digest 2 attributed the reading to 2.2.0; the dist-info says 2.0.0). A direct
  `.fn(author=…)` call raises `TypeError` (`tests/test_tools.py:1262-1265`).
- **Q3 trading `Author`.** SA1019 on `trading.go:2176` and `trading_reconciliation_test.go:789-790` is inferred
  (staticcheck not run; generated Go stubs not read). Run `golangci-lint` in the PR that marks the field
  (fails.md:1425-1427). No other Go `SetConfigRequest{` sets `Author` (`config_test.go` requests carry none).
- **Q4 UI stamps — `...req` spread.** Both BFF bodies spread the browser request (`configUiBff.ts:53`,
  `insightsBff.ts:176`). Dropping `author: claims.user_id` forwards any browser-supplied `author` verbatim
  (inert at config post-fix, but still on the wire). `insightsBff.test.ts:59` sends `author: 'user-mallory'`,
  so after a plain drop `sent.author` would be `'user-mallory'`, not empty — the `:69` rewrite must match the
  option chosen (keep stamp / blank to `''` / drop). The `:36-37` comment and UI-3
  (`services/xstockstrat-ui/docs/context-constitution.md:23`, "author stamp" exception) follow the choice.
  No `configUiBff` unit test exists; coverage excludes `src/lib/*Bff.ts` (`vitest.config.ts:28`); e2e mock
  `setConfig` ignores `author` (`e2e/mock-backend.ts:1393-1410`).
- **Q5 agent fail-fast.** `set_config` checks role only (`tools.py:1683`). Claims without `user_id` → `_metadata`
  omits `x-user-id` (`client.py:75-76`) → config FR-3 `INVALID_ARGUMENT` instead of today's free-text credit.
  `_caller_user_id` (`tools.py:155-170`) would fail at the edge; `_write_source_bearer` already does (`:357`).
- **UI empty `user_id`.** `verifyAccessToken` (`src/lib/auth.ts:22-31`) does not reject an empty `user_id`;
  such a session would now surface FR-3 `INVALID_ARGUMENT` through the BFF. Not observed in practice.
- **The grant id rides a forgeable header.** `x-internal-caller` has no `peerSan` binding on the SetConfig grant
  (`authz.ts:58-76` vs `GetSecret` `:111,124,162`); insights.md:3587 flags it. The authz gate is out of scope,
  so the fix credits only the allowlist-checked `callerID`, never the raw header (AC-3 example 2).
- **Raw `caller_identity` persistence** (`configServiceImpl.ts:405`) stays as is; out of scope.
- **Every `author` sender** (fails.md:1329-1331, fix every instance): agent `tools.py:353,1694`,
  `client.py:2142`; trading `trading.go:2176`; ui `configUiBff.ts:53`, `insightsBff.ts:179`, test
  `insightsBff.test.ts:59,69`. Indicators `author=` hits are `Formula.author`, unrelated.
  `scripts/integration-test.sh:507-519` targets removed `:8060` and is wired into no workflow (grep of
  `.github/workflows` empty); it sends `x-user-id: integration-test` (`:134`).
- **Other ledger traps.** fails.md:2257-2270 (grep every consumer when a value's source changes — here the
  `changed_by` string for the poller); fails.md:666-669 (TS reads camelCase `call.request.*`; `author` is one
  lowercase word, no ambiguity); fails.md:2177-2182 (verify field homes — `is_secret` is on `ConfigValue`);
  fails.md:2860-2862 (after any design-gate steer, reconcile product-spec / acceptance / `feature.md` in the
  same session); fails.md:76-78 / C-10(c) (retire the sentinel row in governance, not just code).
- **Doc drift (teardown targets).**
  - `services/xstockstrat-config/CLAUDE.md:40` (invariant #5 `:36-40`, `author`-or-`x-user-id`), `:52-56` (invariant #7 `:42-56`,
    free-text `author`), `:97` (Webhooks, "attributable author").
  - `docs/patterns/config-governance.md:93-103` (§ Author-sentinel conventions; `:95-98` prose and `:103`
    `system:reconciliation-poller` row; `:102` indicators `system` row unaffected).
  - `docs/runbooks/mcp-tools.md:1096-1156` (`:1107` `author` row, `:1108` "Recorded alongside `author`",
    `:1155` "missing author").
  - `docs/runbooks/config-rollout.md:117-119` (`author="platform-team"` example); `:122-124` already stale
    (`environment`/`trading_mode`, "refuses `is_secret` keys") — adjacent, recorded only.
  - `services/xstockstrat-config/docs/context-constitution.md:34` (also stale line cites ~L374-380/~L399 vs
    actual `:376-385`/`:405`); `services/xstockstrat-config/docs/context-constitution-findings.md:47` (defect
    row to flip).
  - `services/xstockstrat-agent/docs/context-constitution-findings.md:42` (open question to close);
    `services/xstockstrat-agent/CLAUDE.md:76` (only if the param is removed).
  - `services/xstockstrat-ui/docs/context-constitution.md:23` (UI-3); `configUiBff.ts:36-37` (comment).
- **Adjacent out-of-scope drift.** `tools.py:1665-1667` docstring says per-user secret writes are rejected,
  contradicting feature 224 (`services/xstockstrat-agent/docs/context-constitution-findings.md:20`); sits next
  to the `:1663` line that will be edited. Recorded only.

### Not found

- An id-returning variant of `hasInternalCallerAuthority` (`authz.ts:82` returns `boolean`), or any server-side
  use of the authorized `callerID` as an attribution value.
- Any test asserting `updated_by`/`changed_by` for an internal-caller write (only `params[10]`,
  `internalCallerSetConfig.test.ts:91`), or any test sending both `x-user-id` and an authorized
  `x-internal-caller`.
- A real-DB (testcontainers) config harness.
- A test pinning `MISSING_AUTHOR_ERROR.message`.
- A deprecation lint rule in config or UI ESLint/tsconfig (grep `deprecat`: none).
- `reserved` in `config.proto`.
- A trading test asserting the `callerID` passed to `configSetter.SetConfig` (fake discards it), or any trading
  `nolint:staticcheck`.
- Any agent test asserting `author` on an outbound `SetConfigRequest`; any agent `x-internal-caller` use.
- Any durable `@AC-*` on `author`/`changed_by`/`updated_by`/`config_audit`/`caller_identity`.
- Any ledger entry on `request.author`, `changed_by` or `MISSING_AUTHOR`; any `system:reconciliation-poller`
  hit in fails.md.
- `mcp` 2.2.0 source (locked version) — not installed or cached; Q2 evidence is from 2.0.0.
- Whether staticcheck actually flags `trading.go:2176`, and whether protobuf-es / protoc-gen-go emit
  deprecation markers for field 4 — generated stubs not read (repo rule), linters not run.
- Whether the agent and config suites are green on this branch — not run in recon.

## Recommended Scope

Advisory step boundaries for the grilling and /sdd-spec.

1. **proto.** `[deprecated = true]` on `SetConfigRequest.author` (`config.proto:126`), following `:129`.
   `buf lint`, `buf breaking`, `./scripts/buf-gen.sh` (C-09).
2. **config service + test.** RED first: AC-1 (both examples, assert `params[6]`), AC-2 (`params[6]` and
   `[10]`), AC-3 (both examples, non-empty `author`, `queries.length === 0`). Then: hoist
   `internalCallerAuthorized`; `author = callerUserId || (authorized ? grant id : '')` subject to Q1; drop
   `call.request.author`; reword `MISSING_AUTHOR_ERROR`, keep it ahead of enum/bounds/existence; add
   `x-user-id` to the break-list fixtures (incl. the vacuous-pass rejection cases). `pnpm test`, c8 ≥40%.
3. **trading.** Q3: drop `Author` at `trading.go:2176` (or scoped nolint); change
   `trading_reconciliation_test.go:789-790` to a callerID assertion (fake records `callerID`).
   `GOWORK=off go test ./internal/service/ ./internal/config/` and `golangci-lint run`.
4. **agent.** Q2/Q5: remove or ignore `author` in `set_config` (`tools.py:1648,1663-1664,1694`),
   `_write_source_bearer` (`:353`), `client.set_config` (`client.py:2100,2142`). AC-4 test via stub capture +
   `bound_caller` for all three tools. Update `test_config_tools.py:110,133,152,171,237,255,297,304`; add a
   no-`author`-param assertion (`:329-338` pattern) if removed. `uv run pytest --cov=app --cov-fail-under=40`.
   Update `mcp-tools.md` § `set_config` (`@AC-32 @feature-224` parity).
5. **ui.** Q4: keep, blank or drop the stamps (`configUiBff.ts:53`, `insightsBff.ts:179`; C-10); align
   `:36-37` and `insightsBff.test.ts:69` with the `...req` behaviour.
6. **docs.** Config CLAUDE.md invariants #5/#7 + Webhooks, `config-governance.md:93-103`, config/agent/UI
   constitution + findings rows, `config-rollout.md:117-119`; teardown context refresh.

**Rollout order.** Config first is safe: every real caller already supplies verified identity (agent
`x-user-id` via middleware, UI `backendHeaders`, trading authorized grant). Caller-side `author` removals are
inert cleanup. The only behaviour change is an agent or UI session whose claims carry no `user_id`.
