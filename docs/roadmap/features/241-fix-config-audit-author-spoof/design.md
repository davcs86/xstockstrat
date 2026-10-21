# Design: fix-config-audit-author-spoof

**Created**: 2026-10-20
**Rounds**: 2 (full; termination: approved — auto-approved under operator standing authorization 2026-10-20)
**Approved by**: orchestrator under operator standing authorization @ 2026-10-20 (context.md, Operator decisions; gate: rounds ≥ 2, no Floor breach, no blocking objection, no uncovered @AC CHANGE)
**Grounded in**: recon.md

---

## Chosen Approach

Single PR, ordered proto → config → trading → agent → ui → docs. Attribution moves from the request body to
propagated headers: `x-user-id` for humans, the allowlist-checked `x-internal-caller` grant id for automated
writers. `SetConfigRequest.author` is ignored and deprecated in place.

**Meaning of "identity" here: propagated, not authenticated.** `x-user-id` and `x-internal-caller` are
platform-propagated headers; the SetConfig grant carries no `peerSan` binding (recon.md:42-43, :277-279). This
fix removes free-text attribution from the request body. It does not authenticate direct gRPC or mTLS-peer
callers. FR-2, AC-1, AC-2, the `MISSING_AUTHOR_ERROR` message and config CLAUDE.md invariants #5/#7 must use
"propagated identity" wording (P-03). The peerSan gap is filed as a follow-up defect (Open Risks).

1. **Proto.** `packages/proto/config/v1/config.proto:126` becomes `string author = 4 [deprecated = true];`,
   copying the `trading_mode = 7` precedent at `:129` (recon.md:115-117). Name and number are kept, with no
   `reserved` (recon.md:52-53, :211-215). Run `buf lint`, `buf breaking` and `./scripts/buf-gen.sh` (C-09).
   Approval: Proto Reviewer + `packages/proto` owner.

2. **Config — `setConfig` (`configServiceImpl.ts:371-523`, recon.md:23-36).**
   - Hoist `rawValue` and
     `const internalCallerAuthorized = userIdParam === null && hasInternalCallerAuthority(md, ns, key, rawValue)`
     above the scope branch. Today it is block-scoped at `:380-385` (recon.md:25-26, :103-109). The `:386`
     gate keeps its behaviour.
   - Replace `:410` with `const author = callerUserId || (internalCallerAuthorized ? (callerIdentity ?? '') : '')`.
     `call.request.author` is no longer read. Raw `callerIdentity` (`:405`) is credited only when the grant
     matched; the grant `callerID` equals `first(md, HEADER_INTERNAL_CALLER)` (`authz.ts:88,92`; recon.md:29-30,
     :105-108).
   - **Q1 closed: `x-user-id` wins.** `caller_identity` (`:405`) still stores the raw header on both tables
     (recon.md:49-50). So a human sending a forged poller header gets `changed_by=<human>` and
     `caller_identity=trading-reconciliation-poller`. No current caller sends both headers (recon.md:249-252).
   - `MISSING_AUTHOR_ERROR` (`authz.ts:46-50`) keeps its name, code 3 (`INVALID_ARGUMENT`), and its position
     before the enum, bounds and existence checks (recon.md:33-36, :110-114; fails.md:2780-2782). The message
     becomes `"propagated identity required: send x-user-id or an authorized x-internal-caller"`. Its doc
     comment (`:46`) is updated too. No test pins the old message (recon.md:112).
   - No migration: the `017:66-91` triggers already copy `updated_by` into `changed_by` (recon.md:46-50, :216).

3. **Trading.**
   - **Q3 closed: delete the field.** Delete `Author: "system:reconciliation-poller"` at
     `internal/service/trading.go:2176` (recon.md:73-76). Deleting avoids SA1019 and adds no nolint
     (recon.md:118-122).
   - `fakeConfigSetter` (`trading_reconciliation_test.go:746-756`) records `callerID`. The `:789-790`
     assertion becomes `callerID == "trading-reconciliation-poller"` (recon.md:123-126).
   - Run `golangci-lint` in the PR (recon.md:261-263; fails.md:1425-1427).

4. **Agent (consumer surfaces `set_config`, `manage_signal_source`, `instantiate_template`; C-14).**
   - **Q2 closed: remove the parameter, no fallback.** Remove `author` from:
     - `set_config` (`tools.py:1648`, docstring `:1663-1664`, forward `:1694`);
     - `client.set_config` (`client.py:2100,2142`);
     - `_write_source_bearer` (`tools.py:353`).

     (recon.md:59-67.) The precedent is feature 111 `manage_formula` (recon.md:127-131).
   - `_write_source_bearer`'s `reason` (`:354`) becomes `f"{tool}: bearer for signal source {slug}"`, which keeps
     the tool provenance that `changed_by` no longer carries.
   - **Q2 evidence (source read of pinned mcp 2.2.0; `uv.lock:597-598`).** The wheel was downloaded to the
     orchestrator scratchpad and its `METADATA` reads `Version: 2.2.0`.
     - `mcp/server/mcpserver/utilities/func_metadata.py:112`:
       `ArgModelBase.model_config = ConfigDict(arbitrary_types_allowed=True)`, with no `extra`, so pydantic's
       default `ignore` applies.
     - `model_dump_one_level` iterates `model_fields` only (`:105`).
     - `jsonschema` appears only in `mcp/client/session.py` (tool-result validation). There is no server-side
       inputSchema validation.

     So an undeclared `author` sent over the transport is dropped silently. This supersedes recon.md:253-260
     (2.0.0 evidence) and :327 (2.2.0 not found).
   - **Undeclared-argument probe (kept on purpose).** `tests/test_streamable_http_auth.py:86` stays as the
     undeclared-argument probe. It is an explicit exception to the fails.md:1329 "fix every instance" sweep.
     - Expected result, fixed now: `isError is False` (`:95`), plus a new line
       `assert "author" not in mock_set.await_args.kwargs`.
     - CI `python-test` runs it against the frozen 2.2.0 lock. That run is the behavioural confirmation
       (recon.md:244-248).
   - **Q5 closed: edge fail-fast.** `set_config` calls `_caller_user_id(ctx, "set_config")` (`tools.py:155-170`),
     as `_write_source_bearer` does at `:357` (recon.md:272-274).
     - The return value is discarded because `x-user-id` comes from the middleware (`tools.py:211-215`).
     - A ≤2-line comment marks it a deliberate fail-fast (C-18).
     - Config stays authoritative.
   - **Tests.**
     - Add `"author"` to the parity exclusion (`tests/test_config_tools.py:304`; recon.md:134-135).
     - Add a named RED: the removed-parameter assertion `"author" not in props` (`:329-338` pattern;
       recon.md:132-133).
     - AC-4 uses stub capture + `bound_caller` with the `ADMIN` fixture (recon.md:136-141).
     - Update the `.fn(author=…)` break-list at `test_config_tools.py:110,133,152,171,237,255,297`
       (recon.md:244-246).

5. **UI (consumer surface `/config-ui` audit view; C-14).**
   - **Q4 closed: drop the stamps.** Delete `author: claims.user_id` at `configUiBff.ts:53` and
     `insightsBff.ts:179` (recon.md:86-90).
   - Reword the `configUiBff.ts:36-37` comment: the explicit body exists for the environment fill/reject at
     `:41-51` (recon.md:86-88).
   - Identity reaches config only through `backendHeaders` (`bffShared.ts:38-44`; recon.md:91-93).
   - `insightsBff.test.ts`: delete the `author: 'user-mallory'` fixture at `:59`. Replace `:69` with
     `(setConfig.mock.calls[0][1] as { headers: Headers }).headers.get(HEADER_USER_ID) === SESSION_USER`
     (the `:91-92` pattern).
   - New small `configUiBff` vitest asserting the same header on `setConfig`, reusing the
     `insightsBff.test.ts:9-47` harness. No `configUiBff` unit test exists, and the e2e mock ignores identity
     (recon.md:270-271).
   - The audit "By" column (`audit/page.tsx:63`) shows `trading-reconciliation-poller` for new poller rows
     (recon.md:94-95, :198).

6. **Docs (C-10).**
   - `docs/patterns/header-propagation.md:38-46`: rewrite the whole paragraph to "header-only identity in both
     services; presence, not authenticity". Indicators already ignores the body author
     (`services/xstockstrat-indicators/app/handlers/servicer.py:391`).
   - `docs/runbooks/config-rollout.md`:
     - `:77-81`: rule text.
     - `:95`, `:119`, `:141` (STALE block), `:210-217`, `:225-232`: drop `author=` and add
       `metadata=(("x-access-scope","4"),("x-user-id","<operator-id>"))`.
     - Same edit: fix the bare keys to full-dotted form, `trading.approval.require_above_notional` (`:93`, `:213`)
       and `platform.maintenance_mode` (`:228`). Migration `029_heal_config_keys_full_dotted.up.sql:24-28`
       renamed them, so as written these procedures fail NOT_FOUND at the existence gate
       (`configServiceImpl.ts:466-471`).
     - `:100`: replace `"platform-team"` with `<operator-id>`.
   - `docs/patterns/config-governance.md:93-103` § Author-sentinel conventions: **rewrite** it. An automated
     write is identified by `caller_identity IS NOT NULL`, and its `changed_by` is the `callerID` of an
     `INTERNAL_CALLER_ALLOWLIST` grant (`authz.ts:66-76`).
     - Replace the `:103` row with a `trading-reconciliation-poller` row.
     - Note that historical rows keep `system:reconciliation-poller` (fails.md:75-78).
     - The `:102` indicators `system` row is stale (body author is already ignored). Fix it if trivially
       grounded, otherwise list it as teardown drift.
   - `services/xstockstrat-config/CLAUDE.md`:
     - `:40` (invariant #5) and `:97`: header-only wording.
     - Invariant #7 (`:42-56`): "propagated, not authenticated" wording.
     - Check the `:84` "one row with author + value" line (recon.md:292-293).
   - Also update the remaining recon teardown targets (recon.md:296-305):
     - `docs/runbooks/mcp-tools.md:1096-1156`;
     - config constitution `:34` and findings `:47`;
     - agent findings `:42` and agent CLAUDE.md `:76`;
     - UI constitution UI-3 `:23`.
   - Feature artifacts: change "verified identity" to "propagated identity" in `acceptance.feature:3,6` and
     product-spec FR-2/AC-1/AC-2 (`:22-30`), at spec time (C-15).

7. **Tests (config).**
   - Add `x-user-id` to every break-list fixture (recon.md:232-243).
   - The code-only rejection tests (`setConfigScalarBounds.test.ts:103-117`, `tradingStateValidation.test.ts:115-121`)
     also `assert.match` their own message, so they cannot pass vacuously on code 3 (recon.md:200-207).
   - `setConfigAuthz.test.ts:183-191` becomes AC-1. `:193-199` becomes AC-3, with a non-empty body `author` and
     `queries.length === 0` (recon.md:241-242).
   - **Mandatory named pins** (fails.md:2810):
     - AC-2 `params[6] === 'trading-reconciliation-poller'` (`internalCallerSetConfig.test.ts:67-92`;
       recon.md:142-144);
     - the trading `fakeConfigSetter` callerID assertion;
     - the agent `:86` probe with its author-not-in-kwargs line;
     - the `configUiBff` header test;
     - the agent removed-parameter RED.

**Rollout.** Config first is safe. Every real caller already sends propagated identity, and the caller-side
`author` removals are inert cleanup (recon.md:356-358).

## Rejected Alternatives

- **Credit the grant id over `x-user-id` when both headers are present (other answer to Q1).** Rejected: it hides
  the human who sent a forged poller header. With `x-user-id` winning, `changed_by` names the human and
  `caller_identity` still records the header (`017:73,87-88`).
- **Bind the grant credit to the mTLS peer SAN `xstockstrat-trading` via `peerDnsSans`
  (`authz.ts:131-162`).** It would close the forged-poller attribution. Rejected for this feature because:
  - it changes the feature-102 authz gate, which is out of scope;
  - it would be a C-16 CHANGE;
  - it needs mTLS peer context in the harness.

  It becomes the named follow-up defect instead.
- **Keep the agent `author` parameter but ignore it.** Rejected: it advertises a parameter that does nothing,
  against the feature-111 precedent (`tests/test_tools.py:1260-1273`). Removal is safe because mcp 2.2.0 drops
  undeclared arguments.
- **Gate re-entry or a keep-and-ignore fallback in case mcp uses `extra=forbid`.** Moot: the pinned 2.2.0 source has
  no `extra`, and there is no server-side input-schema validation.
- **Settle the mcp question by printing `ArgModelBase.model_config` only.** Rejected: that reads configuration,
  not behaviour. It is superseded by the source read plus the kept CI probe.
- **Stamp `author: ''` in the BFFs instead of deleting the line.** Rejected: it keeps a reference to a deprecated
  field that config already ignores.
- **Keep the `:59` `'user-mallory'` fixture and assert that it passes inertly through `...req`.** Rejected: that
  tests a BFF passthrough that no longer means anything. Config's AC-1 tests are the guard.
- **Make `hasInternalCallerAuthority` return the grant id.** Rejected: it changes 7 boolean assertions for no gain
  in behaviour. The boolean plus the mandatory AC-2 `params[6]` pin is enough (C-18).
- **A mutable `let internalCallerAuthorized` set inside the global branch.** Superseded by a single hoisted
  `const` guarded by `userIdParam === null`.
- **Keep `trading.go:2176` under `nolint:staticcheck`.** Rejected: deleting the line avoids SA1019, and trading
  would otherwise get its first nolint.
- **Retire `config-governance.md:103` without a replacement.** Rejected: it would leave the new automated
  `changed_by` value class undocumented (fails.md:75-78).
- **Add metadata to the config-rollout emergency and rollback snippets but keep their bare keys.** Rejected: a
  broken procedure would look fixed. Migration 029 renamed the keys, so the existence gate returns NOT_FOUND.
- **A DB migration to derive `changed_by`.** Not needed: the `017:66-91` triggers already copy `updated_by`.
- **Move the `MISSING_AUTHOR` rejection after the enum, bounds and existence checks.** Rejected per
  fails.md:2780-2782.

## Open Risks

- [ ] **Trusted-header residual (P-03).**
  - `x-user-id` is self-asserted by any direct gRPC or mTLS-peer caller.
  - The SetConfig grant has no `peerSan` (`authz.ts:66-76`), so anything that reaches `:50060` can forge the
    poller identity.
  - The fix closes free-text attribution in the request body only.
  - Address at /sdd-spec: file a named defect report under `docs/reports/` (candidate fix: a `peerDnsSans(call)`
    binding to `xstockstrat-trading`; fails.md:2827). Apply "propagated, not authenticated" wording across
    FR-2/AC-1/AC-2, the error message and config CLAUDE.md #5/#7.
- [ ] **mcp 2.2.0 undeclared-argument handling was confirmed by reading the source, not by running it.** If a
  layer the read missed rejected the argument, the kept `:86` probe would fail loudly in CI `python-test`.
  Address at the agent step: the probe is a named step with the fixed expected result.
- [ ] **Cross-file equality.** `authz.ts:88,92` `first(md, HEADER_INTERNAL_CALLER)` must equal
  `configServiceImpl.ts:405` `callerIdentity`. The only guard is the mandatory AC-2 `params[6]` pin. Address at
  the config step: the pin must not be dropped (fails.md:2810).
- [ ] **Vacuous-pass rejection tests.** The code-only rejection tests could pass on the new code-3 rejection.
  Address at the config step: each must also `assert.match` its own message.
- [ ] **No real-DB harness.** AC-1..AC-3 `changed_by` is shown via INSERT params `[6]`/`[10]` plus a SQL review of
  `017:66-91` (the F-05 bar; recon.md:225-228). Address at the config step, as a review note.
- [ ] **`/config-ui` audit "By" spelling.** New poller rows read `trading-reconciliation-poller`, while historical
  rows keep `system:reconciliation-poller`. Address at the docs step: note it in the rewritten config-governance §.
- [ ] **Browser can still send `author`.** It can reach the wire via `insightsBff.ts:176` `...req`. It is inert at
  config after the fix, and config's AC-1 tests are the guard. Accepted.
- [ ] **Deprecation markers vs linters.** It is unverified whether the protobuf-es or protoc-gen-go deprecation
  markers trip a linter (recon.md:328-329). Address at the trading and ui steps: run golangci-lint and the UI/TS
  lint in the PR.
- [ ] **Adjacent drift left unfixed**, each listed for the teardown pass:
  - `config-rollout.md:122-124` and `:150-163` (a `RolloutConfig` payload; that RPC does not exist in
    `config.proto`);
  - `tools.py:1665-1667` (the per-user-secret docstring; recon.md:306-308);
  - possibly the `config-governance.md:102` indicators row.

  Address at the docs step and teardown.

## Constitution Rules Touched

- `C-01` — honored by: the UI assertions use `Headers.get` (`bffShared.ts:37-43` returns `Headers`), and the
  code-only rejection tests also match their messages.
- `C-09` — honored by: deprecate-in-place, non-breaking. `buf lint`, `buf breaking` and `buf-gen.sh` freshness
  are required, with Proto Reviewer + `packages/proto` owner approval.
- `C-10` — honored by the full doc sweep in § Chosen Approach item 6, with adjacent drift listed explicitly.
  The spec must carry every target.
- `C-11` — honored by: Q1-Q5 closed with evidence, and the mcp fork resolved from the pinned source.
- `C-14` — honored by: the consumer surfaces are named (agent `set_config`/`manage_signal_source`/`instantiate_template`,
  `/config-ui` audit), and the `configUiBff` header test guards human attribution on `/config-ui`.
- `C-15` — honored by: the "verified identity" → "propagated identity" wording in `acceptance.feature:3,6` and
  the product-spec at spec time. The Q closures are copied to the product-spec in this session.
- `C-16` — honored by: platform `@AC-9 @feature-196` is EXTENDed, which the operator decision covers.
  `@AC-3`/`@AC-5 @feature-196` are PRESERVEd. No durable config rule references `author`.
- `C-18` — honored by: the boolean helper and a single hoisted `const` are kept, the `MISSING_AUTHOR_ERROR` name
  is reused, there is no new abstraction, and the fail-fast comment is ≤2 lines.
- `P-02` — honored by: the orchestrator synthesis is the sole carrier into the gate.
- `P-03` — honored by: the trusted-header meaning, the absent `peerSan` and the deliberately kept `:86` probe are
  recorded, and the residual is filed as a follow-up defect at spec time.
- `F-09` — honored by: mcp 2.2.0 behaviour is settled at design time, and the probe's expected result is fixed.
  No fork is left for execution.
- Floor breaches: none.

## Business Rules Touched (C-16)

- EXTEND `@AC-9 @FR-5 @regression @feature-196` "request-only dead fields stay server-ignored"
  (`docs/sdd/business-rules/platform.feature:337-341`). New case: `SetConfigRequest.author` joins the
  server-ignored deprecated set, and identity is resolved from headers. Covered by the operator decision of
  2026-10-20 (context.md, Operator decisions: "request.author is ignored and the proto field is marked
  [deprecated = true]").
- PRESERVE `@AC-3 @feature-196` "deprecated enum values stay defined" (`platform.feature:331`). Not regressed:
  no enum is touched.
- PRESERVE `@AC-5 @FR-4 @regression @feature-196` "deprecating a response field never changes the proto schema"
  (`platform.feature:324`). Not regressed: field 4 is deprecated in place, number kept, no `reserved`, and
  `buf breaking` is clean.
- PRESERVE the config write-edge rules (`@AC-4/@AC-5/@AC-8 @feature-184`, `@AC-5/@AC-7/@AC-8/@AC-9 @feature-182`,
  `@AC-7/@AC-11/@AC-12 @feature-161`, `@AC-1/@AC-1b @feature-147`; recon.md:157-168). Not regressed: each backing
  fixture gains `x-user-id`, and the rejection tests also assert their own message.
- PRESERVE agent `@AC-25 @feature-224` and `@AC-1 @feature-214`, UI `@AC-12 @feature-219`, and platform
  `@AC-35`/`@AC-32 @feature-224` and `@AC-5 @feature-210` (recon.md:171-185). Not regressed: only the attribution
  source moves, and `mcp-tools.md` parity is updated.
- CHANGE: none.
