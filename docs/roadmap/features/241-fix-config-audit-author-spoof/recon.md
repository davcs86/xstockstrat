# Recon: fix-config-audit-author-spoof

**Created**: 2026-10-20
**From**: product-spec.md (Track C bug, SEV-2; defect report `docs/reports/2026-10-19-config-audit-author-caller-spoofable-defect.md`)
**Affected services**: xstockstrat-config, xstockstrat-agent, xstockstrat-trading, xstockstrat-ui

---

## Objective

Today `SetConfig` decides who can write by checking the verified headers. It decides who gets credited by
reading the caller-supplied `SetConfigRequest.author` first, so any authorized caller can write someone
else's name into `updated_by` / `config.config_audit.changed_by`. The operator decision (2026-10-20,
context.md) is:
- attribution comes only from verified identity: the `x-user-id` header for humans, or the `callerID` of an
  `x-internal-caller` grant that actually authorized the write;
- `request.author` is ignored, and proto field 4 is marked `[deprecated = true]`;
- the agent stops sending a free-text author;
- trading's `system:reconciliation-poller` sentinel is replaced by the `x-internal-caller` identity.

## Codebase Map

- **`xstockstrat-config`** (Node/TS)
  - Entry point: `services/xstockstrat-config/src/index.ts:47,51` (`new ConfigServiceImpl(pool)`, `addService`)
  - Handler: `setConfig`, `services/xstockstrat-config/src/grpc/configServiceImpl.ts:371-523`
    - `callerUserId = userIdFrom(call.metadata)` at `:376`, read before the gate.
    - Global gate at `:378-393`. `internalCallerAuthorized` (`:380`) is block-scoped inside
      `if (userIdParam === null)`, so nothing after `:393` can see it.
    - Per-user owner branch at `:394-404`: it requires `callerUserId === userId`, so `x-user-id` is always
      present on this path.
    - `callerIdentity` at `:405` is the raw header and is stored even when unauthorized (out of scope).
    - **Defect** at `:410-414`: `const author = call.request.author || userIdFrom(call.metadata)`, then
      `MISSING_AUTHOR_ERROR`.
    - Validation order after the author check:
      1. `platform.trading_state` enum, `INVALID_ARGUMENT` (`:418-428`)
      2. scalar bounds, `INVALID_ARGUMENT` (`:432-442`)
      3. existence gate, `NOT_FOUND` (`:446-472`)
      4. INSERT with `author` at param index 6 (`updated_by`) and `callerIdentity` at index 10 (`:501-513`)
  - Authz helpers in `services/xstockstrat-config/src/grpc/authz.ts`:
    - `first` `:14`, `userIdFrom` `:27`, `HEADER_USER_ID` `:11`, `HEADER_INTERNAL_CALLER` `:56`
    - `MISSING_AUTHOR_ERROR` at `:46-50`: `'author required: set request.author or propagate x-user-id'`
    - `INTERNAL_CALLER_ALLOWLIST` at `:66-76`: one grant, `trading-reconciliation-poller` →
      `platform.trading_state` ∈ {REDUCE_ONLY, HALTED}
    - `hasInternalCallerAuthority` at `:82-97` returns a boolean only. The `callerID` it matched is
      `first(md, HEADER_INTERNAL_CALLER)` (`:88`).
  - Last migration: `030_marketdata_edgar_snapshot_keys.up.sql` (`services/xstockstrat-config/migrations/`).
    None is needed.
  - Audit triggers in `migrations/017_config_secrets_and_scoping.up.sql:66-91` copy `NEW.updated_by` →
    `changed_by` and `NEW.caller_identity` → `caller_identity`. The UPDATE trigger fires only when
    `OLD.value_data IS DISTINCT FROM NEW.value_data` (`:69`). The column comes from
    `014_config_caller_identity.up.sql:9,12`.
  - Proto: `SetConfigRequest` at `packages/proto/config/v1/config.proto:122-138`, with `string author = 4;`
    at `:126`.
  - Tests run with `tsc && node --test dist/__tests__/*.test.js`; c8 requires `--lines 40`
    (`services/xstockstrat-config/package.json:12-13`).
- **`xstockstrat-agent`** (Python)
  - Entry point: `services/xstockstrat-agent/app/main.py:26,79` (`register_tools(server)`)
  - `set_config` tool, `app/tools.py:1641-1701`:
    - `author: str` at `:1648`, required; docstring at `:1663`; forwarded at `:1694`.
    - It checks role only (`_caller_access_scope` at `:1683`) and never calls `_caller_user_id`.
  - `_write_source_bearer`, `app/tools.py:341-360`:
    - sends `author=tool` at `:353`, `user_id=_caller_user_id(ctx, tool)` at `:357`, and `create_key=True`
      with a fresh `mcp_credential.<uuid>` key (`:346,356`);
    - callers: `instantiate_template` (`:1222`) and `manage_signal_source` (`:1309`).
  - Client: `app/client.py:2094-2151`:
    - `author: str` at `:2100`, `author=author` at `:2142`;
    - metadata is `_metadata(("x-access-scope", …))` at `:2149`, and `x-user-id` comes from the per-request
      context (`client.py:59-80`, appended only when non-empty, `:75-76`).
  - Identity binding: `CallerPropagationMiddleware` at `app/tools.py:190-215` calls
    `client.set_caller(claims.get("user_id") or "", …)` (`:211-212`) from verified OAuth claims.
  - No migrations directory, no config keys.
- **`xstockstrat-trading`** (Go)
  - Entry point: `services/xstockstrat-trading/cmd/server/main.go:30,91` (`service.NewTradingService`)
  - `escalateSystemic`, `internal/service/trading.go:2163-2190`, called from `:2154`:
    - its only `SetConfigRequest` is at `:2168-2177`, with callerID `"trading-reconciliation-poller"`;
    - `Author: "system:reconciliation-poller"` at `:2176`.
  - Seam: `configSetConfigForwarder` at `trading.go:43-45`, field `:99-101`, wired at `:215`.
  - Header attach: `Watcher.SetConfig`, `internal/config/config.go:255-264`. It sends only
    `x-internal-caller` + `x-trace-id` (`:258-261`), with no `x-user-id` or `x-access-scope`.
  - Lint: `staticcheck` is enabled at `services/xstockstrat-trading/.golangci.yml:7`.
- **`xstockstrat-ui`** (Next.js BFF)
  - Entry points: `src/app/config-ui/api/[...connect]/route.ts:1` → `configUiBff.ts`;
    `src/app/insights/api/[...connect]/route.ts:1` → `insightsBff.ts`.
  - The config-ui `setConfig` (`src/lib/configUiBff.ts:34-56`) stamps
    `{ ...req, environment, author: claims.user_id }` (`:53`). The explicit-body comment at `:36-37` names
    the author stamp as the reason, but the env fill/reject at `:41-51` also needs the explicit body.
  - insights per-user bearer `setConfig` (`src/lib/insightsBff.ts:174-184`): `author: claims.user_id` at
    `:179`.
  - Verified id already rides the header: `backendHeaders`, `src/lib/bffShared.ts:38-43`
    (`[HEADER_USER_ID]: claims.user_id`).
  - Audit reader: `src/app/config-ui/api/audit/route.ts:59-63,74` (`changed_by` → `changedBy`), rendered as
    "By" (`src/app/config-ui/audit/page.tsx:63-64`). There is no `system:*` special-casing.
  - No migrations, no config keys.

## Patterns to REUSE

- **Verified human identity** → reuse `callerUserId` (`configServiceImpl.ts:376`, via `userIdFrom`
  `authz.ts:27`). Do not add a second header read. ESLint forbids inline `'x-user-id'` /
  `'x-access-scope'` literals outside `authz.ts` (`services/xstockstrat-config/.eslintrc.json:13-27`).
- **Verified automated identity** → reuse `hasInternalCallerAuthority` (`authz.ts:82-97`) and the
  existing `internalCallerAuthorized` result (`configServiceImpl.ts:380`). Hoist it out of the
  `if (userIdParam === null)` block. When it is true, the grant `callerID` is exactly
  `first(md, HEADER_INTERNAL_CALLER)` (`authz.ts:88`), the value already in `callerIdentity` (`:405`). No
  new id-returning helper is needed unless design prefers one. Digest: no variant exists today.
- **No-identity rejection** → reuse `MISSING_AUTHOR_ERROR` (`authz.ts:46-50`, `status.INVALID_ARGUMENT`).
  Only its message (which names `request.author`) and its doc comment change. Keep it at the current
  position (`:410-414`), before the enum, bounds and existence checks.
- **Proto deprecation in place** → copy `trading_mode = 7 [deprecated = true];  // deprecated (feature 147): ignored`
  (`config.proto:129`) onto field 4 (`:126`). Same name, same number, no `reserved`.
- **Go SA1019 handling** → for a kept reference, use a scoped nolint with a reason:
  - write side: `services/xstockstrat-marketdata/internal/alpaca/client.go:142`
    (`//nolint:staticcheck // SA1019: …`);
  - assertion side: `services/xstockstrat-portfolio/internal/handler/portfolio_identity_test.go:29`.
  - Deleting the `Author:` line at `trading.go:2176` avoids the need. Ledger: insights.md:1200-1202,
    fails.md:1425.
- **Agent identity from claims, never a parameter** → feature 111 precedent:
  - `manage_formula` dropped `author`;
  - `tests/test_tools.py:1246` asserts the claims-derived author;
  - `:1261-1266` asserts that a caller-supplied `author=` raises `TypeError`.
  - Helper: `_caller_user_id` (`app/tools.py:155-165`), AGENT-3b (`services/xstockstrat-agent/docs/context-constitution.md:20`).
  - The header path already exists: AGENT-4 (`:21`), `tools.py:206-215`, `client.py:75-76`.
- **Agent request-builder parity** → extend the exclusion set at `tests/test_config_tools.py:304`
  (`- {"trading_mode"}`) to cover `author`.
- **Agent test fixtures (C-13)** → `tests/conftest.py:12-17` (`ADMIN` u-1, `TRADER` u-2, `VIEWER`, `_ctx`).
  Do not add inline claim dicts.
- **Config test harnesses** → both run an in-memory recording pool over a loopback gRPC server:
  - `src/__tests__/setConfigAuthz.test.ts:139-151` (`setConfig(md, overrides)`), with assertions on
    `insertQuery().params[6]`;
  - `src/__tests__/internalCallerSetConfig.test.ts:68-92` (base for AC-2: add a `[6]` assertion next to
    `[10]` at `:91`).
- **Trading callerID assertion** → `internal/config/config_test.go:211-244`
  (`TestWatcher_SetConfig_AttachesMetadata`, `:238`) already pins the header. If the
  `trading_reconciliation_test.go:789-790` Author assertion becomes a callerID assertion, the fake at
  `:746-756` needs to record `callerID`; today it drops it.
- **UI BFF identity** → `backendHeaders` (`bffShared.ts:38-43`) already sends the verified id. Unit
  harness: `src/lib/insightsBff.test.ts:9-47` (`vi.mock('@/lib/connectClients')` + `SignJWT` cookie +
  `dispatchConnect`), with the author assertion at `:59,69`. There is no `configUiBff.test.ts`.

## Existing Business Rules (preserve / extend)

These are folded from the scenario-recon digest. There are no CHANGE verdicts, because no durable suite
pins `author`, `updated_by`, `changed_by` or `config_audit`. A grep of
`services/xstockstrat-{config,agent,trading,ui}/acceptance/*.feature` found only "authoring",
"authorized" and "authoritative".

**xstockstrat-config**
- **PRESERVE** `@AC-1 @FR-1 @FR-4 @feature-147` "A secret written via SetConfig is persisted encrypted, not plaintext" (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`): an admin secret write must still succeed and encrypt once attribution moves to `x-user-id`.
- **PRESERVE** `@AC-1b @FR-1 @FR-4 @feature-147` "is_secret is row-authoritative on write, never trusted from the request" (same file): the secret write path stays intact. It is the same "never trust the request field" principle this fix applies to `author`.
- **PRESERVE** `@AC-4 @FR-2 @feature-184` "An out-of-bounds tuning write is rejected at the write edge" (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature`): an identified caller's out-of-bounds write still fails on bounds (`INVALID_ARGUMENT`) and nothing is written.
- **PRESERVE** `@AC-5 @FR-2 @feature-184` "An in-bounds tuning write is accepted without create_key" (same file): the admin write still succeeds.
- **PRESERVE** `@AC-8 @FR-2 @feature-184` "A bounded key whose lower edge is a legitimate value accepts that value" (same file): the admin write still succeeds.
- **PRESERVE** `@AC-5 @FR-4 @feature-182` "A registered materializer key is settable via SetConfig without create_key" (`services/xstockstrat-config/acceptance/readiness-materializer-config-keys.feature`): the admin write still succeeds.
- **PRESERVE** `@AC-7 @FR-6 @feature-182` "An in-bounds tuning write is accepted" (same file): the admin write still succeeds.
- **PRESERVE** `@AC-8 @FR-6 @feature-182` "An out-of-bounds tuning write is rejected at the write edge" (same file): the new identity check must not mask or reorder the bounds rejection.
- **PRESERVE** `@AC-9 @FR-2 @feature-182` "The bounds are write-path only and change no read path" (same file): the admin bool write is still accepted, and reads are unchanged.
- **PRESERVE** `@AC-7 @FR-5 @feature-161` "the decay half-life is settable at the boundary without create_key" (`services/xstockstrat-config/acceptance/surface-signal-weight-decay-config.feature`): a write through MCP `set_config` still succeeds after its `author` contract changes.
- **PRESERVE** `@AC-11 @FR-8 @feature-161` "an out-of-range decay half-life write is rejected server-side without persisting" (same file): the rejection through `set_config` is unchanged.
- **PRESERVE** `@AC-12 @FR-8 @feature-161` "a negative or non-numeric decay half-life write is rejected server-side" (same file): the rejection through `set_config` is unchanged.

**xstockstrat-agent**
- **PRESERVE** `@AC-1 @FR-1 @feature-214` "The xstockstrat-agent MCP advertises no db_ tool" (`services/xstockstrat-agent/acceptance/remove-agent-postgres-mcp.feature`): the tool count stays 45. Removing a parameter is allowed; adding or removing a tool is not.
- **PRESERVE** `@AC-25 @FR-12 @feature-224` "Agent tools expose templates and drop public arguments" (`services/xstockstrat-agent/acceptance/private-by-default-templates.feature`): `instantiate_template` stays in the catalog while its bearer-write attribution changes.

**xstockstrat-ui**
- **PRESERVE** `@AC-12 @FR-7 @feature-219` "Save refreshes the row value without reload" (`services/xstockstrat-ui/acceptance/config-ui-usability.feature`): the config-ui Save (`configUiBff.ts:52-55`) still succeeds and refreshes if the BFF `author` send is dropped.

**xstockstrat-trading**
- Suites exist (`resume-halted-account`, `fix-reconciliation-false-halt`, `fix-trading-config-key-mismatch`), but no `@AC-*` pins the `escalateSystemic` SetConfig or its `Author`. None is relevant.

**Platform (`docs/sdd/business-rules/platform.feature`)**
- **PRESERVE** `@AC-35 @FR-14 @feature-224 @feature-225` "Two users with the same mcp_client slug use their own credentials" (`:306-307`): the owner bearer written by `_write_source_bearer` and `insightsBff.ts:179` still lands in the owner's per-user scope and stays redacted. Only its `updated_by` changes.
- **EXTEND** `@AC-9 @FR-5 @regression @feature-196` "request-only dead fields stay server-ignored" (`:337-341`): `SetConfigRequest.author` joins the server-ignored dead request fields, and attribution comes from headers (`x-user-id` or an authorized `x-internal-caller`). No existing rule pins `author` as authoritative, so this is EXTEND, not CHANGE.
- **PRESERVE** `@AC-5 @FR-4 @regression @feature-196` "deprecating a response field never changes the proto schema" (`:324-329`): it applies by analogy to request field 4. Deprecate in place: no removal, no `reserved`, `buf breaking` clean.
- **PRESERVE** `@AC-5 @FR-5 @feature-210` "Header-propagation semantics are unchanged beneath mTLS" (`:238-239`): attribution now depends on propagated `x-user-id`, so trio semantics must not change.
- **PRESERVE** `@AC-32 @FR-12 @feature-224` "Agent docs and strat-lab skill stay in parity with the tool contract" (`:300-301`): the `docs/runbooks/mcp-tools.md` § `set_config` edit keeps parity with the tool signature.

**C-16 blind spots** (no durable guard exists today; this feature's AC-1..AC-3 become the first ones)
- The feature-102 internal-caller SetConfig gate and `caller_identity` persistence (config CLAUDE.md
  invariant #7).
- Invariant #5's "neither `author` nor `x-user-id` → `INVALID_ARGUMENT`" rule, which AC-3 changes. This is a
  doc invariant, not an `@AC`.
- The trading `escalateSystemic` write (`trading.go:2168-2177`) and the `/config-ui` audit view.

**Harness caveat**
- The admin-write PRESERVE rules above say "an admin caller" without naming `x-user-id`.
- Any step fixture that sends scope plus `author` without `x-user-id` will now get `INVALID_ARGUMENT`.
- Fixing that fixture is a test change, not a change to the guarantee. The @feature-161 `set_config` paths
  get `x-user-id` from `CallerPropagationMiddleware`.

## Dependencies

- **Proto/RPC.** `SetConfigRequest.author` (field 4, `config.proto:126`) → `[deprecated = true]`. The other
  fields are 1-3 and 5-9. Regenerate with `./scripts/buf-gen.sh` (C-09).
  - Approval: Proto Reviewer + `packages/proto` owner (product-spec § Fix Scope).
  - Generated Go gains a deprecation marker, which SA1019 reads. The UI ESLint has no deprecation rule
    (`services/xstockstrat-ui/.eslintrc.json:2`).
- **Migration.** None. Config's last migration is `030`. The next free number would be `031`, which feature
  243 may claim; moot here.
- **Config keys.** None.
- **Inter-service edges.** Unchanged:
  - agent → config `SetConfig` (gRPC 50060, `client.py:2135-2150`)
  - ui BFF → config (`configUiBff.ts:52`, `insightsBff.ts:174`)
  - trading → config via `x-internal-caller` (`config.go:257-263`)
- **New env vars / ports.** None.

## Risks / Not-found

- **No real-DB config harness.** No config test exercises the audit triggers, so the AC "Then
  config_audit.changed_by" steps can only be shown through INSERT param `[6]` plus a SQL review of
  `017:66-91` (trigger copies `NEW.updated_by`). This matches the F-05 review precedent (fails.md:732-734).
- **Secret re-writes skip the UPDATE trigger.** On a secret UPDATE, `value_data` stays `[redacted]`
  (`configServiceImpl.ts:494`), so the UPDATE trigger (`017:69`) does not fire and only
  `config_values.updated_by` changes. `_write_source_bearer` always INSERTs a fresh key (`tools.py:346,356`),
  so the INSERT trigger (`017:81-91`) does carry the new attribution.
- **Test cases that will break.** Admin scope with no `x-user-id`, relying on `author` (all `src/__tests__/`):
  - `setConfigAuthz.test.ts`:
    - `:170-181` asserts `params[6] === 'tester'`, scope `'7'`;
    - `:202-232` NOT_FOUND / create_key cases with scope `'7'`, which would now fail with `INVALID_ARGUMENT`
      before the existence gate.
  - `internalCallerSetConfig.test.ts:130-143`
  - `secretsAndScope.test.ts:160,171`
  - `setConfigScalarBounds.test.ts:73-74`
  - `tradingStateValidation.test.ts:76-79,129-133`
  - `configValueRoundtrip.test.ts:114-118`
  - `scopeResolution.test.ts:86-94`
  - `perUserSecrets.test.ts:240-242`

  Rewrite or extend: `setConfigAuthz.test.ts:183-191` (fallback case → AC-1), `:193-199` (→ AC-3). Already
  compatible: `perUserSecrets.test.ts:118-125` (sends `x-user-id` only).
- **SA1019 in trading (inferred; staticcheck not run).** It will flag the struct-literal key at
  `trading.go:2176` and the selector at `trading_reconciliation_test.go:789-790`. Ledger fails.md:1425 says to
  run `golangci-lint` in the PR that marks the field. No other Go `SetConfigRequest{` sets `Author`:
  `config_test.go:232,255` do not.
- **Every sender of `author`.** Grepped across services and scripts, per fails.md:1329-1331 (fix every
  instance, not just the reported one):
  - agent `tools.py:1694,353`, `client.py:2142`
  - trading `trading.go:2176`
  - ui `configUiBff.ts:53`, `insightsBff.ts:179`, test `insightsBff.test.ts:59,69`
  - `scripts/integration-test.sh:131-135`, which sends `x-user-id: integration-test` with no `author`. It is
    unaffected, and it is unwired and stale (`:511-515`).
- **Agent behavior shift.** `set_config` checks role only (`tools.py:1683`). A claims set without `user_id`
  makes `client._metadata` omit `x-user-id` (`client.py:75-76`), so after the fix config returns
  `INVALID_ARGUMENT` instead of crediting free text. `_caller_user_id` (`tools.py:155`) would fail fast at the
  edge. That is a design call.
- **MCP SDK and undeclared arguments (unverified for the locked version).** This decides whether removing the
  tool parameter breaks remote clients that still send `author`:
  - In the installed venv (`mcp` 2.0.0), `ArgModelBase` (`.venv/.../mcp/server/mcpserver/utilities/func_metadata.py:47-63`)
    sets no `extra="forbid"` and validates via `model_validate` (`:72-80`). Under the pydantic default
    (`ignore`) an extra `author` would be dropped silently.
  - `services/xstockstrat-agent/uv.lock:597-598` pins `mcp` 2.2.0, which I did not read.
  - A direct Python call does raise `TypeError` (`tests/test_tools.py:1263`).
  - `tests/test_streamable_http_auth.py:86` sends `"author"` end-to-end and asserts only scope (`:101`).
- **Identity precedence fork (open for design).** No current SetConfig caller sends both headers:
  - trading sends only `x-internal-caller` (`config.go:258-261`);
  - a grep of `services/xstockstrat-ui/src` and `services/xstockstrat-agent/app` finds no `x-internal-caller`;
  - the internal-caller grant is evaluated only in the global branch (`configServiceImpl.ts:378-393`), and
    the per-user branch always has `x-user-id`;
  - the only precedent for sending both is platform `@AC-6 @FR-3 @FR-1 @feature-224` (analysis → indicators).
    It is not a config write and binds nothing.
- **The grant id is a forgeable header.** Attribution to the grant id rests on `x-internal-caller`, a header a
  caller can forge. The SetConfig grant has no `peerSan` binding (`authz.ts:58-76`), unlike the GetSecret
  grant (`authz.ts:110-111,124,162`). Ledger insights.md:3587 flags `x-internal-caller` as forgeable. The
  authz gate is out of scope (product-spec § Out of Scope), so the fix credits only the allowlist-checked
  callerID, never the raw header (AC-3 example 2).
- **Raw `caller_identity` persistence** (`configServiceImpl.ts:405`) stays as is; out of scope.
- **Remaining fails.md entries that apply:**
  - `:1336-1337`: a proto deprecation is advisory, so the real enforcement is the server ignoring `author`.
  - `:2860`: after any design-gate steer, reconcile product-spec / acceptance / feature.md Type in the same
    session.
  - `:76-78` / C-10(c): the sentinel convention row has to be retired in governance, not just in code.
- **Doc drift (teardown target).**
  - `services/xstockstrat-config/CLAUDE.md:40` (invariant #5), `:55` (invariant #7, free-text `author`),
    `:97` (Webhooks, "attributable author")
  - `docs/patterns/config-governance.md:93-103` (§ Author-sentinel conventions; retire the `:103` row; the
    `:102` `system` indicators row is unaffected)
  - `docs/runbooks/mcp-tools.md:1096-1156` (`:1107` param row, `:1151`, `:1155` "missing author")
  - `services/xstockstrat-agent/CLAUDE.md:76` (only if the parameter is removed)
  - `services/xstockstrat-agent/docs/context-constitution-findings.md:42` (open question to close)
  - `services/xstockstrat-config/docs/context-constitution.md:34`
  - `services/xstockstrat-config/docs/context-constitution-findings.md:47` (defect row to flip)
  - `services/xstockstrat-ui/docs/context-constitution.md:23` (UI-3 cites the `configUiBff.ts` author stamp,
    ~L53)
  - `configUiBff.ts:36-37` (comment rationale)
- **Adjacent out-of-scope drift.** The docstring at `tools.py:1666-1667` says a per-user secret write is
  rejected, which contradicts feature 224 (`services/xstockstrat-agent/CLAUDE.md:76`). It sits next to the
  `:1663` line that will be edited. Recorded only; not in scope.
- **Not found:**
  - an id-returning variant of `hasInternalCallerAuthority`;
  - any agent test that asserts the `author` sent by `_write_source_bearer` (`tests/test_tools.py:169-176`
    and `tests/test_template_tools.py:154-158,199-201` check `user_id` / `is_secret` / `create_key` only);
  - any ledger entry on `changed_by`, `request.author` or `MISSING_AUTHOR`;
  - any `system:reconciliation-poller` hit in fails.md;
  - a test or lint command in the trading `CLAUDE.md`. Use root-`CLAUDE.md` `GOWORK=off`.

## Recommended Scope

These step boundaries are advisory, as input to the grilling and to /sdd-spec.

1. **proto.** `[deprecated = true]` on `SetConfigRequest.author` (`config.proto:126`), following `:129`.
   Run `buf lint`, `buf breaking` and `./scripts/buf-gen.sh` (C-09).
2. **config, service + test.** RED first: AC-1 (both examples), AC-2 (assert `[6]` and `[10]`), AC-3 (both
   examples). Then:
   - derive `author` from `callerUserId` or the authorized grant id (hoisting `internalCallerAuthorized`);
   - drop `call.request.author`;
   - reword `MISSING_AUTHOR_ERROR` and keep it ahead of the enum, bounds and existence checks;
   - add `x-user-id` to the existing test cases listed under Risks;
   - run `pnpm test` / c8 ≥40%.
3. **trading.** Drop `Author` at `trading.go:2176` (or add a nolint). Change `trading_reconciliation_test.go:789-790`
   to assert the callerID, which needs the fake at `:746-756` to record it. Run `GOWORK=off go test ./...`
   and `golangci-lint run`.
4. **agent.** Remove or ignore `author` in the `set_config` tool (`tools.py:1648,1663,1694`), in
   `_write_source_bearer` (`:353`) and in `client.set_config` (`client.py:2100,2142`). Update the
   `test_config_tools.py:304` exclusion and the `author="me"` callers (`:110,133,152,171,237,255`), plus
   `test_streamable_http_auth.py:86`. Decide whether to add a `_caller_user_id` fast-fail. Update
   `mcp-tools.md` § `set_config` (`@AC-32 @feature-224` parity).
5. **ui.** Drop the inert `author` stamps (`configUiBff.ts:53`, `insightsBff.ts:179`; C-10), fix the
   comment at `:36-37`, and change `insightsBff.test.ts:69` to assert that `author` is absent or that the
   header carries the id.
6. **docs.** Update the config CLAUDE.md invariants (#5, #7, Webhooks), `config-governance.md:93-103`, the
   agent findings `:42` and the config findings `:47`, then run the teardown context refresh.

**Rollout order.** Shipping config first is safe. Every current real caller already supplies verified
identity:
- agent: `x-user-id` through the middleware;
- UI: `backendHeaders`;
- trading: the authorized grant.

The caller-side `author` removals are inert cleanup. The one behavior change is for an agent session whose
claims have no `user_id`.
