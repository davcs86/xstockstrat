# Implementation Spec: fix-config-audit-author-spoof

**Status**: `pending`
**Created**: 2026-10-20
**Feature**: `docs/roadmap/features/241-fix-config-audit-author-spoof/feature.md`
**Total Steps**: 13
**Feature Branch**: `feature/fix-config-audit-author-spoof`

---

## Execution Summary

One PR, in design order (design.md § Chosen Approach): proto → config → trading → agent → ui → docs.
Steps 1-2 deprecate `SetConfigRequest.author` in place and regenerate stubs, which every code step compiles
against. Steps 3-4 are the fix itself. Config stops reading `request.author` and credits the propagated
`x-user-id`, or else the `callerID` of the `x-internal-caller` grant that authorized the write. A write with
neither is rejected `INVALID_ARGUMENT` before any query. Steps 5-10 are caller cleanup, inert once Step 3 lands
(recon.md:356-358): trading drops `Author`, the agent drops its `author` parameter and edge-fails on empty
claims, and the UI BFFs drop their stamps. Steps 11-13 file the peerSan follow-up defect and sweep the docs (C-10).

"Identity" here means **propagated, not authenticated** (design.md § Chosen Approach; P-03). The SetConfig
grant has no `peerSan` (`services/xstockstrat-config/src/grpc/authz.ts:66-76`). Step 11 files that residual.

**Consumer surfaces (C-14).**
- Agent MCP `set_config`, `manage_signal_source` and `instantiate_template` → Step 7.
- `/config-ui` → Step 9, the `configUiBff.ts` setConfig handler. The audit view
  (`services/xstockstrat-ui/src/app/config-ui/audit/page.tsx:63`, "By" column) renders `changed_by` verbatim.
  It needs no code change: it shows the propagated identity once Step 3 lands, and
  `trading-reconciliation-poller` for new poller rows.

**Scenario coverage (C-15).**

| Scenario | Covered by |
|---|---|
| `@AC-1` (both examples: global admin `admin-7`; per-user owner `user-42`, INSERT path) | Step 4 |
| `@AC-2` (internal-caller write credited to `trading-reconciliation-poller`) | Step 4 (config `params[6]` + `params[10]`); Step 6 (trading sends the callerID and no `author`) |
| `@AC-3` (both examples: `x-internal-caller` absent; present but not authorized for the key) | Step 4 |
| `@AC-4` (three tools: `set_config`, `manage_signal_source`, `instantiate_template`) | Step 8 |

**Design "Tests MUST" trace** (fails.md:2810, design.md § Chosen Approach item 7):
- AC-2 `params[6] === 'trading-reconciliation-poller'` pin → Step 4.
- Trading `fakeConfigSetter` callerID assertion → Step 6.
- Agent `:86` undeclared-argument probe, plus the `author`-not-in-kwargs line → Step 8.
- Agent removed-parameter RED → Step 8.
- `configUiBff` header test → Step 10.
- Code-only rejection tests gain `assert.match` on their own message → Step 4.

## Step Dependencies

- Steps 3-10 require Steps 1-2. Each consumer compiles against the regenerated stubs:
  - config `@xstockstrat/proto/config/v1/config`;
  - trading `configv1`;
  - agent `gen.config.v1`;
  - UI `@xstockstrat/proto/config/v1/config_pb`.
- Step 3 lands before Steps 5, 7 and 9. Config must already credit propagated identity, so every caller-side
  `author` removal is inert. This also matches the design.md rollout: config first.
- Paired tests:
  - Step 4 [test] covers Step 3 [service].
  - Step 6 covers Step 5.
  - Step 8 covers Step 7.
  - Step 10 covers Step 9.
- Step 6's AC-2 trading half and Step 4's AC-2 config half must both pass. That pair is the only guard on the
  kill-switch escalation (recon.md:196-197): if FR-2 regressed, `trading.go:2180` would only log.
- Step 11 is independent; land it in the same PR (design.md § Open Risks, P-03).
- Step 12 requires Steps 3 and 7: it documents final behaviour. Step 13 runs last and closes with the CLAUDE.md
  teardown (`/context-forge:context-constitution refresh` scoped to the touched context files, or the manual
  reconciliation recorded in the PR body).
- Overlap (Mode B scan, context.md 2026-10-20 sdd-review impl-spec): WARN, file-level only. No config key,
  proto field number or migration NNN collision.
  - `trading.go` vs 251: same function. 251 edits the `SourceService` literal at `:2188` in `escalateSystemic`
    (`:2163-2190`), Step 5 deletes `:2176`. Whichever merges second reconciles that function by hand.
  - `configServiceImpl.ts` vs 244 (`:115-117,120`, scalar-bounds registry): disjoint from `setConfig`
    (`:371-414`), rebase only. 243 is not confirmed in this file by its docs.
  - `tools.py` / `client.py` / `mcp-tools.md` vs 215 (`_opportunity_to_dict`, other tool docstrings) and 247
    (`client.py` `get_config`): disjoint functions, rebase only.
  - 240 is already on trunk and disjoint (`configServiceImpl.ts:145`, `config-governance.md:109`).
  - 249 touches only `ibkr.go:167-168` and `trading.proto:267`, so it does not overlap this feature.

  No FAIL-level overlap, so no `merge-order.md` row.

---

### Step 1 — proto: Deprecate `SetConfigRequest.author` in place

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/config/v1/config.proto` — modify

**Reviewers**:
- Proto Reviewer — field number uniqueness, no breaking change without a deprecation comment, `buf lint` and
  `buf breaking` pass.
- `xstockstrat-config` owner — config key naming, scoping, secret encryption + redaction, WatchConfig stability.
- `xstockstrat-agent` owner — MCP tool contract stability and `mcp-tools.md` parity.
- `xstockstrat-trading` owner — order execution correctness, broker API safety.
- `xstockstrat-ui` owner — config mutation safety, Connect-RPC call safety.

**Codebase Evidence**:
- `config.proto:122-138` defines `message SetConfigRequest`. `:126` is `string author = 4;`.
- Precedent at `:129`:
  `xstockstrat.common.v1.TradingMode trading_mode = 7 [deprecated = true];  // deprecated (feature 147): ignored`.
- No `reserved` in the file (recon.md:52-53). PROTO-2: deprecate in place, never remove or renumber
  (`packages/proto/docs/context-constitution.md:20`, recon.md:115-117).
- Adding an option is non-breaking (`docs/runbooks/proto-versioning.md:5-15`, product-spec § Fix Scope).
- PLAT-10: the `subdir=packages/proto` qualifier is mandatory. The SKILL.md example omits it; that is a known
  drift.

**TDD**: `N/A (proto — non-code-bearing)`

**Covers**: —

**Instructions**:
1. Replace `config.proto:126` with
   `string author = 4 [deprecated = true];  // deprecated (feature 241): ignored; attribution is the propagated x-user-id or authorized x-internal-caller`.
2. Keep the name and number. Add no `reserved`. Touch no other field.

**Verification**:
```bash
cd packages/proto && buf lint && \
  buf breaking --against "$(git rev-parse --show-toplevel)/.git#branch=feature/fix-config-audit-author-spoof,subdir=packages/proto"
```
Both commands must exit 0.

---

### Step 2 — proto-gen: Regenerate stubs

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/` — modify (generated)
- `packages/proto/gen/python/` — modify (generated)
- `packages/proto/gen/ts/` — modify (generated, incl. `dist/`)

**Reviewers**: inherited from Step 1:
- Proto Reviewer — field number uniqueness, deprecation comment, `buf lint` / `buf breaking`.
- `xstockstrat-config` owner.
- `xstockstrat-agent` owner.
- `xstockstrat-trading` owner.
- `xstockstrat-ui` owner.

**Codebase Evidence**:
- `scripts/buf-gen.sh` exists. Root `CLAUDE.md` § Generating Proto Stubs: it generates the TS, Python and Go
  stubs and compiles the TS package.
- The config service imports the generated client as `@xstockstrat/proto/config/v1/config`
  (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:15`), so its `tsc` needs the rebuilt package
  (recon.md:54-56).
- Fallback when Docker is unavailable: `docs/runbooks/codegen-toolchain-host-setup.md`.

**TDD**: `N/A (proto-gen — generated output)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root.
2. Commit only the regenerated `packages/proto/gen/**` in this step. Never hand-edit `gen/`, and never
   Read or Grep it (root `CLAUDE.md` § Key File Paths).

**Verification**:
```bash
./scripts/buf-gen.sh && git status --short packages/proto/gen | head && \
  (cd services/xstockstrat-trading && GOWORK=off go build ./...) && \
  (cd services/xstockstrat-config && pnpm run build)
```
- The gen diff must be non-empty.
- A second `./scripts/buf-gen.sh` must leave `git diff packages/proto/gen` empty. That is the `proto-freshness`
  gate.

---

### Step 3 — service: config `SetConfig` attributes only propagated identity

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify
- `services/xstockstrat-config/src/grpc/authz.ts` — modify

**Reviewers**:
- `xstockstrat-config` owner — config key naming, environment / global-per-user scoping, secret encryption +
  redaction, WatchConfig stream stability.
- Security — auth scope and audit attribution: derived from propagated headers, never request-body free text.

**Codebase Evidence**:
- `configServiceImpl.ts:371` `async setConfig(call: any, callback: any) {`.
  - `:374` `const userId = requestUserId(call.request); // '' = global`; `:375` `userIdParam`.
  - `:376` `const callerUserId = userIdFrom(call.metadata);`.
- Global branch `:378` `if (userIdParam === null) {`.
  - `:379` `const rawValue = call.request?.value?.string_val ?? call.request?.value?.stringVal ?? '';`.
  - `:380-385` `const internalCallerAuthorized = hasInternalCallerAuthority(call.metadata, call.request?.namespace, call.request?.key, rawValue);`,
    block-scoped and so invisible after `:393`.
  - Gate `:386` `if (!hasAdminAccessScope(call.metadata) && !internalCallerAuthorized) {`.
- Per-user branch `:394` `} else if (!callerUserId || callerUserId !== userId) {` → `PER_USER_SCOPE_ERROR`.
  `x-user-id` is therefore always non-empty past it (recon.md:27-28).
- `:405` `const callerIdentity = first(call.metadata, HEADER_INTERNAL_CALLER) || null;`.
- **Defect** at `:410-414`:
  ```ts
  const author = call.request.author || userIdFrom(call.metadata);
  if (!author) {
    callback(MISSING_AUTHOR_ERROR);
    return;
  }
  ```
  - It runs ahead of the enum check (`:418-428`), the scalar bounds (`:432-442`) and the existence gate
    (`:444-472`).
  - INSERT params at `:513`: `author` is `[6]` (`updated_by`), `callerIdentity` is `[10]`.
- `authz.ts:46-50`, current text:
  ```ts
  /** Denial when a write carries no attributable author — neither request.author nor x-user-id. */
  export const MISSING_AUTHOR_ERROR = {
    code: status.INVALID_ARGUMENT,
    message: 'author required: set request.author or propagate x-user-id',
  };
  ```
- `authz.ts:82-97` `hasInternalCallerAuthority` returns `boolean`. It matches
  `const callerID = first(md, HEADER_INTERNAL_CALLER)` (`:88`) by equality (`grant.callerID === callerID`,
  `:92`), so when it returns true the grant id equals `callerIdentity` (`:405`).
- Reuse targets (recon.md § Patterns to REUSE):
  - the existing `callerUserId` (no second header read; the ESLint bans inline header literals,
    `.eslintrc.json:13-27`);
  - the hoisted boolean, not an id-returning helper (design.md § Rejected Alternatives);
  - `MISSING_AUTHOR_ERROR`, keeping its name and position (fails.md:2780-2782).
- The audit triggers copy `NEW.updated_by` into `changed_by`
  (`migrations/017_config_secrets_and_scoping.up.sql:66-91`). No migration is needed. The last migration is
  `030_marketdata_edgar_snapshot_keys.up.sql`.
- Header propagation: no new outbound call, so the C-03 table does not apply.
- Residual (P-03): the SetConfig grant has no `peerSan` (`authz.ts:66-76`), so any peer reaching `:50060`
  that forges the granted `x-internal-caller` value is credited as `changed_by`. Filed by Step 11 as
  `docs/reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.md`.

**TDD**: `red-green required` (Step 4 is the paired test)

**Covers**: —

**Instructions**:
1. In `setConfig`, insert two declarations directly above `if (userIdParam === null) {` (`:378`), the
   `rawValue` read moved from `:379` and the hoisted grant check:
   ```ts
   const rawValue = call.request?.value?.string_val ?? call.request?.value?.stringVal ?? '';
   const internalCallerAuthorized =
     userIdParam === null &&
     hasInternalCallerAuthority(call.metadata, call.request?.namespace, call.request?.key, rawValue);
   ```
   - Delete the block-scoped copies at `:379-385`.
   - The `:386` gate expression stays byte-identical, so the authz behaviour is unchanged.
2. Replace `:410` with
   `const author = callerUserId || (internalCallerAuthorized ? (callerIdentity ?? '') : '');`.
   - `call.request.author` is no longer read anywhere.
   - `x-user-id` wins when both headers are present (Q1). Raw `callerIdentity` is credited only when the grant
     matched.
   - Keep `:411-414` (`if (!author) { callback(MISSING_AUTHOR_ERROR); return; }`) where it is, ahead of the
     enum, bounds and existence checks.
3. Leave `:405` `callerIdentity` and its persistence to `[10]` unchanged. Raw-header persistence is out of scope
   (product-spec § Out of Scope).
4. In `authz.ts:46-50`:
   - doc comment →
     `/** Denial when a write carries no propagated identity — no x-user-id and no authorized x-internal-caller; the deprecated body author field is ignored. */`
     (the wording avoids the literal `request.author` so the Verification grep stays strict).
   - message → `'propagated identity required: send x-user-id or an authorized x-internal-caller'`
   - Name and `status.INVALID_ARGUMENT` stay unchanged.

**Verification**:
```bash
grep -n "request\.author\|request?\.author" services/xstockstrat-config/src/grpc/configServiceImpl.ts services/xstockstrat-config/src/grpc/authz.ts
# expect: no hits
grep -n "const internalCallerAuthorized\|const author = callerUserId" services/xstockstrat-config/src/grpc/configServiceImpl.ts
# expect: one hit each, both before the MISSING_AUTHOR_ERROR callback
cd services/xstockstrat-config && pnpm run build && pnpm run lint
```

---

### Step 4 — test: config attribution, rejection and fixture identity (AC-1, AC-2, AC-3)

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/setConfigAuthz.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/internalCallerSetConfig.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/setConfigScalarBounds.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/tradingStateValidation.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/secretsAndScope.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/perUserSecrets.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/configValueRoundtrip.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/scopeResolution.test.ts` — modify

**Reviewers**:
- `xstockstrat-config` owner — config key naming, scoping, secret encryption + redaction, WatchConfig stream
  stability.

**Codebase Evidence**:
- Harness (`setConfigAuthz.test.ts:76-128`): a loopback gRPC server plus a recording pool.
  - Pool flags `keyExists` (`:83`) and `globalKeyExists` (`:87`).
  - `insertQuery()` (`:90-92`).
  - Imports from `../grpc/authz` (`:25-31`): `ADMIN_SCOPE`, `HEADER_ACCESS_SCOPE`, `HEADER_USER_ID`,
    `hasAdminAccessScope`, `userIdFrom`.
- `setConfig(md, overrides)` helper `:139-151`, default `author: 'tester'` (`:144`). Cases that pin the old
  behaviour:
  - `:170-181`: scope `'7'`, no `x-user-id`, asserts `params[6] === 'tester'`.
  - `:183-191`: the `author: ''` fallback to `u-42`.
  - `:193-199`: no author and no `x-user-id` → `INVALID_ARGUMENT`, `queries.length === 0`.
  - `:202-233`: NOT_FOUND, `createKey` and registered-update cases, scope `'7'`, no `x-user-id`.
- `internalCallerSetConfig.test.ts`:
  - helper `:67-79`, default `author: 'system:reconciliation-poller'` (`:73`);
  - REDUCE_ONLY case `:82-92`, which asserts only `params[10]` (`:91`);
  - ordinary admin case `:130-143` (`author: 'tester'`, scope `'7'`, no `x-user-id`);
  - imports only `HEADER_ACCESS_SCOPE` (`:14`).
- Fixtures with admin scope and no `x-user-id` (recon.md:232-240):
  - `setConfigScalarBounds.test.ts:72-78` (helper, `:74` scope `'7'`);
  - `tradingStateValidation.test.ts:71-83` (helper, `:79` scope `'7'`) and `:123-138` (`:133`);
  - `secretsAndScope.test.ts:159-164`;
  - `perUserSecrets.test.ts:237-243` (`metadata: md({ [HEADER_ACCESS_SCOPE]: '4' })`, `:242`);
  - `configValueRoundtrip.test.ts:113-123`;
  - `scopeResolution.test.ts:85-100` (`:87` `md.set(HEADER_ACCESS_SCOPE, '4')`).
- `perUserSecrets.test.ts:118-125` already sends `x-user-id` only, so it needs no change.
- Code-only rejection cases that would pass vacuously on the new code 3 (recon.md:200-207, design.md § Open
  Risks):
  - `setConfigScalarBounds.test.ts:104-110` (−1);
  - `setConfigScalarBounds.test.ts:112-118` (`'abc'`);
  - `setConfigScalarBounds.test.ts:304-312` (`intVal 56`, found by this spec; not in the recon list);
  - `tradingStateValidation.test.ts:115-121` (empty string).

  Their messages come from `configServiceImpl.ts:424` and `:438`. The bounds come from `:101`
  (`'analysis.scoring.signal_decay_half_life_hours': { minValue: 0, maxValue: 8760 }`) and `:133`
  (`'agent.opportunities.read_timeout_seconds': { minValue: 30, maxValue: 55 }`).
- AC data:
  - `notify.push.min_severity` is seeded by `migrations/021_notify_push_min_severity.up.sql`;
  - `platform.trading_state` is in the allowlist at `authz.ts:66-76`;
  - INSERT param order is set at `configServiceImpl.ts:513`.
- No real-DB harness exists (recon.md:225-228). `changed_by` is shown through `params[6]` plus a SQL review of
  `017:66-91`: the UPDATE trigger copies `NEW.updated_by` on a value change (`:69-74`), and the INSERT trigger
  always copies it (`:81-91`). This is the F-05 bar (fails.md:732-734).
- C-13: every literal (`admin-7`, `user-42`, `someone-else@example.com`, `trading-reconciliation-poller`) is a
  scenario value from `acceptance.feature`, inline in its own test file. No `src/__tests__/fixtures/` home
  exists, and no literal gains a second consumer *file* that would force one. The verdict is compliant inline.

**TDD**: `red-green required`. Against the pre-Step-3 tree:
- AC-1 and AC-2 fail because `params[6]` is `'someone-else@example.com'`.
- AC-3 fails because the write succeeds (`err === null`, INSERT run).
- The new `assert.match` on `/propagated identity required/` fails on the old message.

**Covers**: `AC-1, AC-2, AC-3`

**Instructions**:
1. **`setConfigAuthz.test.ts`**
   - a. Add `HEADER_INTERNAL_CALLER` to the `../grpc/authz` import (`:25-31`).
   - b. Change the helper default (`:144`) to `author: 'someone-else@example.com'`. Every success case then
     also proves that the body author is ignored.
   - c. `:170-181`: metadata becomes `{ [HEADER_ACCESS_SCOPE]: '7', [HEADER_USER_ID]: 'admin-7' }`, and the
     assertion becomes `insert!.params?.[6] === 'admin-7'`.
   - d. Replace `:183-191` with **`@AC-1` example 1**.
     - Request `{ namespace: 'notify', key: 'notify.push.min_severity', value: { intVal: 3 } }`, metadata
       `{ [HEADER_ACCESS_SCOPE]: '4', [HEADER_USER_ID]: 'admin-7' }`, `keyExists = true` (prior row exists).
     - Assert `err === null`, `params[6] === 'admin-7'`, and
       `!insert.params.includes('someone-else@example.com')`.
     - Add a one-line review note: the `017:66-91` triggers copy `updated_by` into `changed_by`.
   - e. Add **`@AC-1` example 2**, the per-user INSERT path.
     - `keyExists = false`, `globalKeyExists = true`.
     - Metadata `{ [HEADER_ACCESS_SCOPE]: '1', [HEADER_USER_ID]: 'user-42' }`, overrides
       `{ namespace: 'notify', key: 'notify.push.min_severity', value: { intVal: 3 }, userId: 'user-42' }`.
     - Assert `err === null`, `params[6] === 'user-42'` and `params[9] === 'user-42'`.
   - f. Replace `:193-199` with **`@AC-3`**, both examples. Each sends a non-empty body `author` (the helper
     default), with `{ namespace: 'notify', key: 'notify.push.min_severity', value: { intVal: 3 } }`.
     - Example 1: metadata `{ [HEADER_ACCESS_SCOPE]: '4' }`.
     - Example 2: metadata `{ [HEADER_ACCESS_SCOPE]: '4', [HEADER_INTERNAL_CALLER]: 'trading-reconciliation-poller' }`.
     - Assert `err.code === grpc.status.INVALID_ARGUMENT`,
       `assert.match(err.details ?? err.message, /propagated identity required/)` and `queries.length === 0`
       (no existence SELECT, no INSERT, no notify).
   - g. `:202-233` (the three existence-gate cases): add `[HEADER_USER_ID]: 'admin-7'` to each metadata.
     Assertions stay unchanged.
2. **`internalCallerSetConfig.test.ts`**
   - a. Remove `author` from the helper default (`:73`).
   - b. **`@AC-2`** in the REDUCE_ONLY case (`:82-92`):
     - pass the override `{ author: 'someone-else@example.com' }`;
     - keep `params[10] === 'trading-reconciliation-poller'`;
     - add the **mandatory pin** `assert.equal(insert!.params?.[6], 'trading-reconciliation-poller')`
       (design.md § Open Risks: the cross-file equality has no other guard; fails.md:2810).
   - c. `:130-143`: add `HEADER_USER_ID` to the `:14` import, use metadata
     `{ [HEADER_ACCESS_SCOPE]: '7', [HEADER_USER_ID]: 'admin-7' }`, and drop `author: 'tester'`.
3. **Fixture identity.** Each helper or call below keeps its `author` (now inert) and adds
   `[HEADER_USER_ID]: 'tester'` to its admin-scope metadata. Import `HEADER_USER_ID` alongside the existing
   `HEADER_ACCESS_SCOPE` import in each file.
   - `setConfigScalarBounds.test.ts:74`
   - `tradingStateValidation.test.ts:79` and `:133`
   - `secretsAndScope.test.ts:160`
   - `perUserSecrets.test.ts:242` (`HEADER_USER_ID` is already imported, `:16`)
   - `configValueRoundtrip.test.ts:115` (`md.set`)
   - `scopeResolution.test.ts:87` (`md.set`)
4. **No vacuous passes.** Add `assert.match(err.details ?? err.message, …)` to:
   - `setConfigScalarBounds.test.ts:104-110` with `/\[0, 8760\]/`;
   - `setConfigScalarBounds.test.ts:112-118` with `/\[0, 8760\]/`;
   - `setConfigScalarBounds.test.ts:304-312` with `/\[30, 55\]/`;
   - `tradingStateValidation.test.ts:115-121` with `/must be one of ACTIVE, REDUCE_ONLY, HALTED/`.

   Every "nothing written" assertion stays.
5. Fix the stale comment at `configValueRoundtrip.test.ts:125`. It must list the 11-param order from
   `configServiceImpl.ts:513`.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run test:coverage && pnpm run lint
# c8 --lines 40 must pass (package.json:13); all suites green.
grep -n "propagated identity required" src/__tests__/setConfigAuthz.test.ts      # AC-3 present
grep -n "params?.\[6\], 'trading-reconciliation-poller'" src/__tests__/internalCallerSetConfig.test.ts  # AC-2 pin
grep -n "__tests__/fixtures" src/__tests__/*.test.ts   # C-13: expect no hits (no home created)
```

---

### Step 5 — service: trading reconciliation poller stops sending `Author`

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**:
- `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only
  dev invariant, position limit enforcement.

**Codebase Evidence**:
- `trading.go:2163` `func (s *TradingService) escalateSystemic(ctx context.Context, systemicCount, totalAccounts int) {`.
- `:2168` `s.configSetter.SetConfig(ctx, "trading-reconciliation-poller", &configv1.SetConfigRequest{`.
- `:2176` `Author:      "system:reconciliation-poller",`.
- `:2180` failures are only `slog.Warn`-logged.
- Transport (`internal/config/config.go:257-263`): `Watcher.SetConfig` attaches only
  `"x-internal-caller", callerID` and `"x-trace-id"`. Config Step 3 credits that grant id.
- No other Go `SetConfigRequest` sets `Author`: `grep -rn "Author:" services/xstockstrat-trading --include=*.go`
  returns only `trading.go:2176`.
- Lint: `staticcheck` is enabled (`.golangci.yml:7`). After Step 1, any kept `Author` reference would raise
  SA1019 (fails.md:1425-1427). Deleting the line needs no nolint (design.md Q3).
- Trading-domain constraints (step-constraints.md §A): broker coverage, trading-mode gate, order type and fill
  state are all unaffected. This step changes only the config-escalation request literal; no order path is
  touched.

**TDD**: `red-green required` (Step 6 is the paired test)

**Covers**: —

**Instructions**:
1. Delete `trading.go:2176` (`Author:      "system:reconciliation-poller",`). Leave every other field, the
   callerID argument at `:2168` and the alert at `:2183` unchanged.
2. Run `gofmt` on the struct literal; the field alignment may shift.

**Verification**:
```bash
grep -n "Author" services/xstockstrat-trading/internal/service/trading.go   # expect: no hits
cd services/xstockstrat-trading && GOWORK=off go build ./... && GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 6 — test: trading escalation sends the grant callerID and no author (AC-2 trading half)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/testdata/caller_ids.go` — create
- `services/xstockstrat-trading/internal/service/trading_reconciliation_test.go` — modify
- `services/xstockstrat-trading/internal/config/config_test.go` — modify

**Reviewers**:
- `xstockstrat-trading` owner — order execution correctness, broker API safety, fill detection, paper-only
  dev invariant, position limit enforcement.

**Codebase Evidence**:
- `trading_reconciliation_test.go:746-749` `type fakeConfigSetter struct { mu sync.Mutex; calls []*configv1.SetConfigRequest }`.
  `:751-756` `SetConfig(ctx, callerID string, req …)` appends only `req` (`:753`) and drops `callerID`.
- `TestReconcileTick_SystemicThresholdCrossed_EscalatesToReduceOnly` (`:758`) asserts at `:789-790`:
  ```go
  if req.Author != "system:reconciliation-poller" {
  ```
- `TestReconcileTick_BelowThreshold_NoEscalation` reuses the fake (`:805-811`).
- `TestWatcher_SetConfig_AttachesMetadata` (`internal/config/config_test.go:211`) already pins the transport
  header (recon.md:123-126). It and the test after it already use the literal `"trading-reconciliation-poller"`
  as a test value at `config_test.go:232`, `:238`, `:239` and `:255` (`package config`, internal test).
- The production value is `trading.go:2168` `s.configSetter.SetConfig(ctx, "trading-reconciliation-poller", ...)`.
- C-13 Go home `services/xstockstrat-trading/internal/testdata/` exists (`package testdata`; `order_rows.go`,
  `offline_history.go`, feature 240). Precedent consumer in this package: `trading_offline_test.go:27` imports
  `"github.com/xstockstrat/trading/internal/testdata"`. `testdata` imports only `time`, protobuf and the
  `commonv1`/`tradingv1` gen packages, so importing it from `internal/config` tests creates no cycle.
- Reading `req.Author` after Step 1 would trip SA1019. The proto-reflection read below names no deprecated Go
  symbol, so the test needs no nolint (recon.md:118-122: trading has no `nolint:staticcheck` today).

**TDD**: `red-green required`. Against the pre-Step-5 tree, the `author`-unset assertion fails because
`Author` is `"system:reconciliation-poller"`. The callerID assertion is the mandatory design pin and passes on
both trees.

**Covers**: `AC-2` (trading half: the escalation reaches config as `x-internal-caller: trading-reconciliation-poller` with no free-text author)

**Instructions**:
1. Add `callerIDs []string` to `fakeConfigSetter`. In `SetConfig`, append `callerID` next to `req` under the
   same lock.
2. Replace `:789-791` with two assertions:
   - **Mandatory pin.** `setter.callerIDs[0] != "trading-reconciliation-poller"` → `t.Errorf(...)`.
   - **RED.** `fd := req.ProtoReflect().Descriptor().Fields().ByName("author")`, and
     `if req.ProtoReflect().Has(fd) { t.Errorf("SetConfig must not send the deprecated author field") }`.
3. C-13 (second consumer file → centralize; re-decided 2026-10-28, see Deviation Log):
   - Create `internal/testdata/caller_ids.go` (`package testdata`) declaring
     `const ReconciliationPollerCallerID = "trading-reconciliation-poller"`, with a ≤2-line comment that it must
     equal the config `INTERNAL_CALLER_ALLOWLIST` grant the poller authenticates as.
   - Use `testdata.ReconciliationPollerCallerID` in the new Step 6 assertion (import
     `"github.com/xstockstrat/trading/internal/testdata"` in `trading_reconciliation_test.go`).
   - Replace the four literals at `config_test.go:232`, `:238`, `:239`, `:255` with the constant (add the same
     import). No production code changes: `trading.go:2168` keeps its literal.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/ -run 'TestReconcileTick_' -count=1 -race && \
  COVERPKGS=$(GOWORK=off go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && \
  GOWORK=off go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && \
  GOWORK=off go tool cover -func=coverage.out | grep "^total:" && \
  GOWORK=off golangci-lint run --modules-download-mode=mod
grep -rn "trading-reconciliation-poller" services/xstockstrat-trading --include="*.go"   # expect: trading.go:2168 and internal/testdata/caller_ids.go only
```
- The new logic is in `internal/service/`, which is excluded from CI coverage measurement. No threshold applies
  to it; confirm only that the total stays ≥ 40%.
- golangci-lint must report no SA1019.

---

### Step 7 — service: agent sends no free-text `author` (set_config, manage_signal_source, instantiate_template)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify
- `services/xstockstrat-agent/app/client.py` — modify

**Reviewers**:
- `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and
  `docs/runbooks/mcp-tools.md` parity; admin `x-access-scope` forwarded only by the management tools; no secret
  values in tool output.

**Codebase Evidence**:
- `set_config` tool:
  - `tools.py:1651` `async def set_config(`, with param `:1657` `author: str,`;
  - docstring `:1672` `author: who is making the change — required, and recorded in config.config_audit.`
    and `:1673` `reason: why — required, and recorded alongside author.`;
  - `:1692` `access_scope = _caller_access_scope(ctx, "set_config")`;
  - forward `:1703` `author=author,`.
- `_write_source_bearer`:
  - `tools.py:341` `async def _write_source_bearer(ctx: Context, tool: str, slug: str, bearer_token: str) -> str:`;
  - `:353` `author=tool,`;
  - `:354` `reason=f"bearer for signal source {slug}",`;
  - `:357` `user_id=_caller_user_id(ctx, tool),`.
  - Callers: `instantiate_template` (`:1230`) and `manage_signal_source` (`:1317`).
- `client.py:2095` `async def set_config(`, with param `:2101` `author: str,` and the request field `:2143`
  `author=author,`. Metadata `:2150` `_metadata(("x-access-scope", str(access_scope)))`. `x-user-id` comes from
  the bound caller (`_metadata`, `client.py:59`, appended when non-empty at `:76-77`).
- Edge binding: `CallerPropagationMiddleware` (`tools.py:190-220`) calls `client.set_caller(...)`
  (`:211-215`; AGENT-4).
- Fail-fast helper: `_caller_user_id` (`tools.py:155-170`) raises `RuntimeError` on empty claims `user_id`
  (AGENT-3b).
- Precedent: feature 111 `manage_formula` has no `author` param and derives `"author": user_id`
  (`tools.py:1121`).
- Q2 (design.md): the pinned mcp 2.3.0 (`services/xstockstrat-agent/uv.lock`, feature branch and main-dev)
  `ArgModelBase` (`mcp/server/mcpserver/utilities/func_metadata.py`) has only
  `ConfigDict(arbitrary_types_allowed=True)` and no `extra` setting, so an undeclared transport argument is
  dropped silently. Removal is safe.
- Header propagation: no new outbound call. `client.set_config` keeps `_metadata(...)`.

**TDD**: `red-green required` (Step 8 is the paired test)

**Covers**: —

**Instructions**:
1. **`client.py` `set_config`.**
   - Remove the `author: str` parameter (`:2101`) and `author=author,` (`:2143`).
   - Add one docstring line: attribution is the caller's `x-user-id`, never a body field (feature 241).
2. **`tools.py` `set_config`.**
   - a. Remove the `author: str` parameter (`:1657`) and the forward at `:1703`.
   - b. Docstring:
     - delete the `:1672` `author:` line;
     - reword `:1673` to `reason: why — required, recorded in config.config_audit; the change is attributed to your verified user id.`
   - c. Directly after `:1692`, add a fail-fast call with a comment of at most 2 lines (C-18, Q5):
     ```python
     # Fail fast at the edge: config attributes the write to x-user-id and rejects an empty one.
     _caller_user_id(ctx, "set_config")
     ```
     The return value is discarded on purpose: `x-user-id` rides the middleware binding
     (`tools.py:211-215`). Config stays authoritative.
3. **`tools.py` `_write_source_bearer`.**
   - Delete `author=tool,` (`:353`).
   - Change `:354` to `reason=f"{tool}: bearer for signal source {slug}",`. That keeps the tool provenance that
     `changed_by` no longer carries (design.md item 4).
4. Do not touch the `:1674-1676` per-user-secret docstring drift. It is adjacent and out of scope (design.md §
   Open Risks); Step 13 records it.

**Verification**:
```bash
grep -n "author" services/xstockstrat-agent/app/client.py | grep -n "def set_config\|author=author\|author: str"   # expect: no hits
grep -n "author=tool\|author=author" services/xstockstrat-agent/app/tools.py                                      # expect: no hits
cd services/xstockstrat-agent && uv run ruff check . && uv run ruff format --check .
```

---

### Step 8 — test: agent outbound SetConfig carries no author, the parameter is gone, the probe holds (AC-4)

**Status**: `done`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/conftest.py` — modify
- `services/xstockstrat-agent/tests/test_config_tools.py` — modify
- `services/xstockstrat-agent/tests/test_template_tools.py` — modify
- `services/xstockstrat-agent/tests/test_streamable_http_auth.py` — modify

**Reviewers**:
- `xstockstrat-agent` owner — MCP tool contract stability (name, parameters, return shape) and
  `docs/runbooks/mcp-tools.md` parity.

**Codebase Evidence**:
- Break-list in `test_config_tools.py`:
  - `author="me"` on direct `.fn` calls at `:110`, `:133`, `:152`, `:171`, `:237`, `:255`;
  - `author="a"` on `client.set_config` at `:297`;
  - parity exclusion at `:304`:
    `expected = set(config_pb2.SetConfigRequest.DESCRIPTOR.fields_by_name) - {"trading_mode"}`.
- `TestSetConfigRequestParity` (`:261-305`) patches the stub-level capture as
  `patch("app.client.mtls")` + `patch.object(config_pb2_grpc, "ConfigServiceStub", return_value=stub)` with
  `async def _capture(req, metadata=None)` (`:270-283`).
- Removed-parameter pattern: `test_config_tools_expose_no_environment_parameter` (`:332-338`) uses
  `server._tool_manager.get_tool(tool).parameters["properties"]`.
- Fixtures:
  - `tests/conftest.py:12`
    `ADMIN = {"user_id": "u-1", "email": "a@b.c", "roles": ["admin"], "aud": "http://x"}`;
  - `_ctx(claims)` (`:17`) is the AC-4 Given;
  - `client.set_caller(user_id, access_scope, trace_id)` / `client.reset_caller(token)` (`client.py:41,49`);
  - the existing caller fixture `bound_caller` (`test_template_tools.py:37-43`) binds `TRADER`, not `ADMIN`.
- `test_template_tools.py` helpers:
  - `_stubs()` (`:46-75`) patches the three template stubs, and ingest `InstantiateTemplate` returns
    `ingest_pb2.SignalSource(...)`;
  - `_channel_cm()` (`:30-34`).
- Probe `tests/test_streamable_http_auth.py`:
  - test `test_set_config_receives_the_real_callers_scope_over_the_real_transport` (`:37`) patches
    `client.set_config` (`mock_set`, `:44`);
  - it sends `"author": "a@b.c"` over the real transport (`:86`);
  - it asserts `isError is False` (`:95`) and `access_scope == 15` (`:101`).
- C-13: `bound_admin` gains a second consumer file (`test_config_tools.py` and `test_template_tools.py`), so it
  lands in the canonical home `tests/conftest.py`. Every other literal is a scenario one-off.

**TDD**: `red-green required`. Against the pre-Step-7 tree:
- the removed-parameter test fails (`"author" in props`);
- the AC-4 `set_config` case raises `TypeError` (missing required `author`);
- the AC-4 `manage_signal_source` and `instantiate_template` cases fail because `req.author` is the tool name;
- the probe's new kwargs assertion fails (`author` is forwarded).

**Covers**: `AC-4`

**Instructions**:
1. **`tests/conftest.py`.** Add a fixture `bound_admin`. It binds the caller with a local import inside the
   fixture body, because the gen path is set up later in the file:
   - `from app import client` and `from app.scopes import roles_to_access_scope`;
   - `token = client.set_caller(ADMIN["user_id"], roles_to_access_scope(ADMIN["roles"]), "trace-241")`;
   - `yield`, then `client.reset_caller(token)` in a `finally`.
2. **`test_config_tools.py`**
   - a. Delete `author="me"` at `:110`, `:133`, `:152`, `:171`, `:237`, `:255` and `author="a"` at `:297`.
   - b. `:304`: change the exclusion to `- {"trading_mode", "author"}` (an unset `author` drops out of
     `ListFields()`).
   - c. **Removed-parameter RED.** Add `test_set_config_exposes_no_author_parameter` next to `:332`, using the
     same `parameters["properties"]` pattern: `assert "author" not in props`.
   - d. **`@AC-4`.** Add class `TestSetConfigCarriesNoAuthor` with two `@pytest.mark.asyncio` cases. Both use
     `bound_admin`, the `_capture` stub pattern from `:270-283` (it records `req` and `metadata`), and
     `patch("app.client.mtls")` with `secure_channel.return_value` set to an `__aenter__`/`__aexit__`
     `MagicMock`.
     - `set_config`: `_tool_fn(server, "set_config")(ctx=_ctx(ADMIN), namespace="notify", key="notify.push.min_severity", value_type="int", value="3", reason="r")`.
     - `manage_signal_source`: `patch.object(client, "manage_signal_source", AsyncMock(return_value={"slug": "acme", "has_credentials": True}))`,
       then `_tool_fn(server, "manage_signal_source")(_ctx(ADMIN), operation="register", slug="acme", source_type="mcp_client", bearer_token="sk-live-abc")`.
     - Each case asserts `captured["req"].author == ""` and
       `[v for k, v in captured["metadata"] if k == "x-user-id"] == [ADMIN["user_id"]]`.
3. **`test_template_tools.py` — `@AC-4` `instantiate_template` case.**
   - Add `test_instantiate_template_set_config_carries_no_author(bound_admin)` and import `ADMIN` from
     `tests.conftest`.
   - Reuse `_stubs()` and `_channel_cm()`. Mirror `_run`'s transport patch explicitly
     (`test_template_tools.py:84-85`): `with patch("app.client.mtls") as mtls:` and
     `mtls.secure_channel.return_value = _channel_cm()`, then start the `_stubs()` patches. The real
     `client.set_config` dials through it. Add a `patch.object(config_pb2_grpc, "ConfigServiceStub", ...)`
     capture stub, and call
     `_tool_fn("instantiate_template")(ctx=_ctx(ADMIN), kind="signal_source", template_id="t-mcp", slug="my-mcp", bearer_token="sk-live-xyz")`
     directly. Do not go through `_run`, because `_run` forces `_ctx(TRADER)` (`:79-82`).
   - Assert `req.author == ""` and `x-user-id == [ADMIN["user_id"]]`.
4. **`test_streamable_http_auth.py`.** Keep the `"author": "a@b.c"` argument at `:86` on purpose. It is the
   undeclared-argument probe, an explicit exception to the fails.md:1329 sweep (design.md item 4).
   - Keep `:95` `isError is False`.
   - After `:101`, add `assert "author" not in mock_set.await_args.kwargs`.

**Verification**:
```bash
cd services/xstockstrat-agent && uv run pytest tests/test_config_tools.py tests/test_template_tools.py tests/test_streamable_http_auth.py -q && \
  uv run pytest --cov=app --cov-fail-under=40 && uv run ruff check . && uv run ruff format --check .
grep -n "def bound_admin\|from tests.conftest\|conftest" tests/test_config_tools.py tests/test_template_tools.py tests/conftest.py   # C-13: one fixture home
grep -n '"author": "a@b.c"' tests/test_streamable_http_auth.py   # probe kept: 1 hit
```
- `test_set_config_receives_the_real_callers_scope_over_the_real_transport` must pass with `isError is False`
  against the frozen mcp 2.3.0 lock. That pass is the behavioural confirmation of Q2 (design.md § Open Risks).

---

### Step 9 — service: UI BFFs drop the `author` stamp (/config-ui, /insights)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/configUiBff.ts` — modify
- `services/xstockstrat-ui/src/lib/insightsBff.ts` — modify

**Reviewers**:
- `xstockstrat-ui` owner — config mutation safety, Connect-RPC call safety, environment scope correctness, no
  secret values rendered in UI.

**Codebase Evidence**:
- `configUiBff.ts:34` `async setConfig(req, ctx) {`.
  - The comment at `:36-37` reads "Keeps an explicit body rather than forwardAdmin because the author is
    injected from the session below."
  - The environment fill/reject at `:41-51` also needs the explicit body (recon.md:86-88).
  - `:52-55`:
    ```ts
    return configClient.setConfig(
      { ...req, environment, author: claims.user_id },
      { headers: backendHeaders(claims, ctx) },
    );
    ```
- `insightsBff.ts:160` `router.service(ConfigService, {` and `:165` `async setConfig(req, ctx) {`.
  The body at `:174-184` is
  `{ ...req, userId: claims.user_id, environment: nativeConfigEnvironment(), author: claims.user_id, createKey: true, value: { ...req.value, isSecret: true } }`,
  with the author stamp at `:179`.
- Identity on the wire: `backendHeaders` (`bffShared.ts:38-44`) → `[HEADER_USER_ID]: claims.user_id`.
- The UI-3 "author stamp" exception (`services/xstockstrat-ui/docs/context-constitution.md:23`) is updated in
  Step 13.
- Rejected alternative: stamping `author: ''`, which would keep a reference to the deprecated field (design.md
  § Rejected Alternatives).

**TDD**: `red-green required` (Step 10 is the paired test)

**Covers**: —

**Instructions**:
1. `configUiBff.ts:53`: change the body to `{ ...req, environment }`. Rewrite `:36-37` to say why the explicit
   body exists: the environment fill/reject below. At most 2 lines.
2. `insightsBff.ts:179`: delete `author: claims.user_id,`.
3. Identity reaches config only through `backendHeaders`, which is unchanged.

**Verification**:
```bash
grep -n "author" services/xstockstrat-ui/src/lib/configUiBff.ts services/xstockstrat-ui/src/lib/insightsBff.ts | grep -v "authoring"   # expect: no hits
cd services/xstockstrat-ui && pnpm run lint
```

---

### Step 10 — test: UI BFF setConfig sends the session identity as `x-user-id` and no author

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/configUiBff.test.ts` — create
- `services/xstockstrat-ui/src/lib/insightsBff.test.ts` — modify

**Reviewers**:
- `xstockstrat-ui` owner — config mutation safety, Connect-RPC call safety, environment scope correctness.

**Codebase Evidence**:
- `insightsBff.test.ts` harness:
  - `vi.mock('@/lib/connectClients', ...)` (`:9-18`) and `dispatchConnect` import (`:20`);
  - `SignJWT` cookie in `beforeAll` (`:26-33`);
  - `post(method, body)` (`:39-48`, `dispatchConnect(` at `:40`) and `SET_CONFIG` (`:49`);
  - the fixture `author: 'user-mallory'` (`:59`) and the assertion `expect(sent.author).toBe(SESSION_USER)` (`:69`);
  - the header-assertion pattern `opts.headers.get(HEADER_USER_ID)` (`:91-92`), with `HEADER_USER_ID` imported
    from `@/lib/headers` (`:4`).
- `configUiBff.ts` imports `configClient`, `ingestClient`, `analysisClient`, `identityClient` and
  `indicatorsClient` from `@/lib/connectClients` (`:8-14`). It exports `dispatchConnect` under `/config-ui/api`
  (`:101`) and requires admin (`requireAdminScope`, `bffShared.ts:47-50`; `hasAdminScope`, `auth.ts:95`).
- No `configUiBff` unit test exists (`ls src/lib/*.test.ts`). Coverage excludes `src/lib/*Bff.ts`
  (`vitest.config.ts:28`). The e2e mock ignores identity (recon.md:270-271).
- Existing e2e SetConfig flows are unaffected (no Playwright step). The mock `setConfig`
  (`e2e/mock-backend.ts:1393-1409`) reads only `key`, `value`, `namespace`, `userId`, `createKey` and
  `isSecret`, never `author`. No `e2e/config-ui/*.spec.ts` or `e2e/insights/signal-sources.spec.ts`
  asserts `author` (grep `\.author\|author:` over them: no hits).
- C-12: the canonical test-JWT home is `e2e/helpers/auth.ts`, which exports `signTestJwt(roles, user?)` (`:29`)
  and `TEST_JWT_SECRET` (`:20`). Its only value-level dependencies are `jose` and `../fixtures/users`
  (`TEST_USER_ID`, `e2e/fixtures/users.ts:9`). `import { type Page }` is erased under `isolatedModules`
  (`tsconfig.json:12`). `indicatorChart.test.ts:2` is the vitest precedent for an `e2e/` import.
- Rejected alternative: keeping the `:59` `'user-mallory'` passthrough assertion (design.md § Rejected
  Alternatives).

**TDD**: `red-green required`. Against the pre-Step-9 tree, both `expect(sent.author).toBe('')` assertions fail
(the BFF stamps `claims.user_id`). The `x-user-id` header assertions are the mandatory design pins and pass on
both trees.

**Covers**: — (no `@AC-*` scenario targets the UI; this is the design-mandated C-14 guard for `/config-ui` human attribution)

**Instructions**:
1. **`insightsBff.test.ts`**
   - Delete the `author: 'user-mallory',` fixture line (`:59`).
   - Replace `:69` with:
     - `expect(sent.author).toBe('')` (RED);
     - `expect((setConfig.mock.calls[0][1] as { headers: Headers }).headers.get(HEADER_USER_ID)).toBe(SESSION_USER)`
       (mandatory pin).
2. **Create `configUiBff.test.ts`**, mirroring the `insightsBff.test.ts:1-49` structure:
   - `vi.mock('@/lib/connectClients', () => ({ configClient: { setConfig }, ingestClient: {}, analysisClient: {}, identityClient: {}, indicatorsClient: {} }))`.
   - `const { dispatchConnect } = await import('@/lib/configUiBff')` (the test file does not exist yet; this
     step creates it).
   - In `beforeAll`, set `process.env.JWT_SECRET = TEST_JWT_SECRET` and
     `cookie = \`access_token=${await signTestJwt(['admin'])}\``. Both helpers are imported from
     `../../e2e/helpers/auth` (C-12).
   - Post to `/config-ui/api/xstockstrat.config.v1.ConfigService/SetConfig` with
     `{ namespace: 'notify', key: 'notify.push.min_severity', value: { intVal: 3 } }`. The environment is
     omitted, which takes the native fill.
   - Assert:
     - `res.status === 200`;
     - `expect(setConfig.mock.calls[0][0].author).toBe('')`;
     - `headers.get(HEADER_USER_ID) === TEST_USER_ID` (from `../../e2e/fixtures/users`).
   - Fallback, recorded as a Deviation Log entry: if the `e2e/helpers/auth` import fails to resolve under vitest,
     inline the `insightsBff.test.ts:26-33` `SignJWT` pattern instead, as a scenario one-off.
3. No new domain fixture is introduced, so `INVENTORY.md` is unchanged.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run test:coverage && pnpm run lint
grep -n "helpers/auth\|e2e/fixtures" src/lib/configUiBff.test.ts   # C-12: canonical auth/fixture imports
```
`vitest run --coverage` must pass the `src/lib/**` 40% thresholds (`vitest.config.ts:29-33`).

---

### Step 11 — docs: file the SetConfig internal-caller peerSan follow-up defect

**Status**: `pending`
**Service**: `docs/reports/`
**Files**:
- `docs/reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.md` — create
- `docs/reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.status` — create

**Reviewers**: none

**Codebase Evidence**:
- `authz.ts:66-76`: the `INTERNAL_CALLER_ALLOWLIST` grant `trading-reconciliation-poller` has no `peerSan`.
  The `GetSecret` grants bind one (`authz.ts:111,124,162`; recon.md:277-279).
- After Step 3, an authorized `x-internal-caller` header is credited as `changed_by`. Anything that reaches
  `:50060` can forge it.
- Candidate fix: bind the grant to the mTLS peer SAN `xstockstrat-trading` via `peerDnsSans`
  (`authz.ts:131-162`). It was rejected for this feature because it changes the feature-102 gate (C-16 CHANGE;
  design.md § Rejected Alternatives).
- Format: `.claude/skills/sdd-qa/reference/defect-filing.md` (the template headings are grep-parsed by
  `/sdd-triage`; the `.status` sidecar's first line is `open`).
- insights.md:3587 (feature 210): enumerate the forgeable-header gates before claiming identity-bound authz.

**TDD**: `N/A (docs — non-code-bearing)`

**Covers**: —

**Instructions**:
1. Write the report with the defect-filing template headings. Fields:
   - **Recorded** 2026-10-20;
   - **Severity** SEV-2;
   - **Environment** dev (main-dev);
   - **Affected service(s)** xstockstrat-config, xstockstrat-trading;
   - **Config-only fix possible**: no.
2. Content, citing `authz.ts:66-76` and `:131-162`:
   - **Observed:** the SetConfig internal-caller grant trusts the `x-internal-caller` header with no peer SAN.
     Since feature 241 that value is also the audit `changed_by`.
   - **Expected:** the grant requires the mTLS peer SAN `xstockstrat-trading`.
3. Write the `.status` sidecar with the single line `open`.

**Verification**:
```bash
ls docs/reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.md docs/reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.status
head -1 docs/reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.status   # open
grep -n "^## Observed\|^## Expected\|^## Reproduction\|^## Evidence\|^## Root cause hypothesis\|^## Confidence" docs/reports/2026-10-20-config-setconfig-internal-caller-no-peersan-defect.md   # 6 hits
```

---

### Step 12 — docs: platform patterns and runbooks (config-governance, header-propagation, config-rollout, mcp-tools)

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/patterns/config-governance.md` — modify
- `docs/patterns/header-propagation.md` — modify
- `docs/runbooks/config-rollout.md` — modify
- `docs/runbooks/mcp-tools.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `config-governance.md:93` is `## Author-sentinel conventions`.
  - The `:95-98` prose says automated writers use a `system:<process>` `SetConfigRequest.author`.
  - Row `:102` `system` / indicators. Its body author is already ignored:
    `services/xstockstrat-indicators/app/handlers/servicer.py:398` reads "The author is the x-user-id header
    only; the deprecated body author is ignored."
  - Row `:103` `system:reconciliation-poller`.
- `header-propagation.md:34-46` `### Documented exception: indicators formula author-ownership`.
  - `:38-44` claims "an explicit `request.author` **wins** … `xstockstrat-config`'s `SetConfig` follows the
    same precedence (feature 074)".
  - The indicators half is already stale (`servicer.py:398`). The config half is fixed by Step 3.
- `config-rollout.md`:
  - `:76-80`, the rule text ("either an explicit `author` field … or a propagated `x-user-id`");
  - `:93` bare `key="approval.require_above_notional"`, `:95` `author="platform-team"`, `:100`
    `("x-user-id", "platform-team")`;
  - `:117-119`, the MCP example with `author="platform-team"`;
  - `:122-124`, which claims `environment`/`trading_mode` parameters and "refuses `is_secret` keys", both
    contradicted by `tools.py:1651-1660` and AGENT CLAUDE.md;
  - `:139-141`, the STALE Connect block;
  - `:150-163`, the `RolloutConfig` endpoint. `config.proto:20-35` declares only `WatchConfig`, `GetConfig`,
    `SetConfig`, `ListKeys` and `GetSecret`;
  - `:211-217` (rollback: bare key `:213`, `author` `:215`);
  - `:226-232` (emergency: bare `key="maintenance_mode"` `:228`, `author` `:230`).
- Migration `029_heal_config_keys_full_dotted.up.sql:24-28` renamed bare keys in the `platform` and `trading`
  namespaces to full-dotted form. As written, the procedures above fail `NOT_FOUND` at the existence gate
  (`configServiceImpl.ts:466-471`).
- `mcp-tools.md:1097` `### \`set_config\``.
  - `:1108` is the `| \`author\` | string | yes | Recorded in \`config.config_audit\` |` row.
  - `:1109` is "Recorded alongside `author`".
  - `:1152` "row (author + value, `old_value` NULL)".
  - `:1156` `INVALID_ARGUMENT` → missing author.
- Parity rule: platform `@AC-32 @feature-224` (`docs/sdd/business-rules/platform.feature:300`). `plugins/` has
  no `set_config` reference (recon.md:185).

**TDD**: `N/A (docs — non-code-bearing)`

**Covers**: —

**Instructions**:
1. **`config-governance.md` § Author-sentinel conventions.** Rewrite `:95-103`.
   - An automated config write is identified by `caller_identity IS NOT NULL`.
   - Its `changed_by` is the `callerID` of the `INTERNAL_CALLER_ALLOWLIST` grant that authorized it
     (`services/xstockstrat-config/src/grpc/authz.ts`). A human write's `changed_by` is the propagated
     `x-user-id`.
   - `SetConfigRequest.author` is deprecated and ignored (feature 241).
   - Replace the `:103` row with a `trading-reconciliation-poller` row (`changed_by` = `caller_identity`).
     Note that historical audit rows keep `system:reconciliation-poller`, and that the `/config-ui` audit "By"
     column shows both spellings (design.md § Open Risks).
   - Fix the `:102` `system` row: it is an indicators `Formula.author` ownership sentinel, not a SetConfig
     author. It is set from the formula module's `AUTHOR` constant, not the request body
     (`servicer.py:398`). If this rewrite cannot be grounded in one read, leave the row and list it in the PR
     body as teardown drift.
2. **`header-propagation.md:34-46`.** Rewrite the paragraph:
   - Both indicators `RegisterFormula` and config `SetConfig` take identity from headers only. The body
     `author` is ignored.
   - A missing identity is rejected.
   - It is a presence guarantee, not authenticity: propagated, not authenticated.
   - Keep the indicators author-ownership exception heading.
3. **`config-rollout.md`**
   - `:76-80`: the rule becomes "requires a propagated `x-user-id` (or an authorized internal caller);
     `author` is ignored".
   - In the `:88-102`, `:211-217` and `:226-232` snippets:
     - drop `author=`;
     - use `metadata=(("x-access-scope", "4"), ("x-user-id", "<operator-id>"))`;
     - use full-dotted keys (`trading.approval.require_above_notional` at `:93`/`:213`,
       `platform.maintenance_mode` at `:228`).
   - `:100`: `"platform-team"` → `<operator-id>`.
   - `:117-119`: drop `author=` from the MCP example.
   - `:122-124`, grounded in `tools.py:1651-1660`: say there are no `environment`/`trading_mode` parameters,
     and that `is_secret` keys are writable.
   - `:139-141` STALE block: drop `"author"`.
   - `:150-163`: mark `RolloutConfig` as **not an RPC**. Cite `config.proto:20-35` and point to sequential
     `SetConfig` calls.
4. **`mcp-tools.md` § `set_config`**
   - Delete the `:1108` `author` row.
   - `:1109` `reason` → "Recorded in `config.config_audit` (`update_reason`); the change is attributed to your
     verified user id (`x-user-id`), never a parameter (feature 241)".
   - `:1152` "(author + value" → "(caller identity + value".
   - `:1156`: `INVALID_ARGUMENT` → "propagated identity required" (claims carry no `user_id`; the tool also
     fails fast at the edge).

**Verification**:
```bash
grep -n "author=" docs/runbooks/config-rollout.md                                  # expect: no hits
grep -n "| \`author\`\|alongside \`author\`\|missing author" docs/runbooks/mcp-tools.md   # expect: no hits
grep -n "system:reconciliation-poller" docs/patterns/config-governance.md           # only the historical-rows note
grep -n "request.author\` \*\*wins\*\*" docs/patterns/header-propagation.md          # expect: no hits
```

---

### Step 13 — docs: service context files + teardown

**Status**: `pending`
**Service**: `services/*/CLAUDE.md`, `services/*/docs/`
**Files**:
- `services/xstockstrat-config/CLAUDE.md` — modify
- `services/xstockstrat-config/docs/context-constitution.md` — modify
- `services/xstockstrat-config/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-agent/CLAUDE.md` — modify
- `services/xstockstrat-agent/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-ui/docs/context-constitution.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-config/CLAUDE.md`:
  - `:40` (invariant #5): "Either branch also rejects `INVALID_ARGUMENT` when a write has neither an explicit
    `author` nor a propagated `x-user-id`."
  - `:42-56` (invariant #7): `:55` "instead of grepping free-text `author`/`reason`".
  - `:84` "— one row with author + value, old_value NULL".
  - `:97` (Webhooks): "requires the ADMIN scope bit and an attributable author".
- `services/xstockstrat-config/docs/context-constitution.md:34`: "rather than free-text `author`/`reason`". Its
  cites are stale: "consumption ~L374-380, `callerIdentity` ~L399", against the actual `:376-386` / `:405`
  (recon.md:300-301).
- `services/xstockstrat-config/docs/context-constitution-findings.md:47` is the
  `2026-10-19-config-audit-author-caller-spoofable-defect` row under "Filed as defect reports". Per `:40-41`,
  the row stays until its report is resolved.
- `services/xstockstrat-agent/CLAUDE.md:76` is the `set_config` tool-table row.
- `services/xstockstrat-agent/docs/context-constitution-findings.md:42` is the open question "`set_config`
  takes a caller-supplied `author` … status: **open**".
- `services/xstockstrat-ui/docs/context-constitution.md:23` is UI-3. Its "author stamp
  (`configUiBff.ts` `author: claims.user_id`, ~L53)" exception is removed by Step 9.
- Teardown rule: root `CLAUDE.md` § Teardown, plus `.agents/context-forge.json` `scrubberExtraTargets`
  (`README.md`, `docs/patterns/ui-ux-governance.md`; neither is touched here).

**TDD**: `N/A (docs — non-code-bearing)`

**Covers**: —

**Instructions**:
1. **Config `CLAUDE.md`**
   - `:40`: "rejects `INVALID_ARGUMENT` when a write has no propagated identity — no `x-user-id` and no
     authorized `x-internal-caller`; `request.author` is ignored (feature 241). Identity is propagated, not
     authenticated."
   - `:55`: say `changed_by` is the grant `callerID`, and drop "free-text `author`".
   - `:84`: "one row with the caller identity + value".
   - `:97`: "requires the ADMIN scope bit (or an authorized internal caller) and a propagated identity".
2. **Config constitution `:34`.** Re-anchor the cites to `configServiceImpl.ts#setConfig` (the hoisted
   `internalCallerAuthorized` and `const author = callerUserId || …`). Add that the grant id is also the
   `changed_by`.
3. **Config findings `:47`.** Leave the row: the report becomes `resolved` only after merge (`:40-41`). Add
   `→ fix: feature 241` to the title cell.
4. **Agent `CLAUDE.md:76`.** Append "no `author` parameter — the write is attributed to the caller's
   `x-user-id` (feature 241)".
5. **Agent findings `:42`.** Status → **resolved (feature 241)**: removed; attribution comes from verified
   claims via `x-user-id`.
6. **UI constitution UI-3 `:23`.**
   - Remove the "author stamp" exception and its `configUiBff.ts` cite (from both the rule cell and the
     evidence cell).
   - Rewrite the generic `{ ...req, userId/author }` phrase to `{ ...req, userId }`. The insights
     `userId: claims.user_id` injection (`insightsBff.ts:174-184`) survives; no author injection does.
   - The surviving explicit bodies are the cross-user filters plus the config-ui `environment` fill.
7. **Teardown.**
   - Run `/context-forge:context-constitution refresh` scoped to every context file touched in Steps 12-13, and
     fix the grounded drift it reports.
   - If the plugin is unavailable, re-read each touched file against the code by hand, and record both the
     unavailability and the reconciliation in the PR body.
   - Record as drift, not fixed:
     - `services/xstockstrat-agent/app/tools.py:1674-1676` (the per-user-secret docstring that contradicts
       feature 224, `services/xstockstrat-agent/docs/context-constitution-findings.md:20`);
     - the `config-governance.md:102` row, if Step 12 left it.

**Verification**:
```bash
grep -n "explicit \`author\`\|attributable author\|one row with author" services/xstockstrat-config/CLAUDE.md   # expect: no hits
grep -n "author stamp\|userId/author" services/xstockstrat-ui/docs/context-constitution.md                     # expect: no hits
grep -n "takes a caller-supplied \`author\`" services/xstockstrat-agent/docs/context-constitution-findings.md   # line shows resolved
```
The PR body must carry the teardown record.

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._

- **2026-10-28 — re-spec (sdd-execute sequential, pre-execution).** Steps 6, 7, 8, 10, 12, 13 re-grounded
  against the merged `origin/main-dev` tree. Line drift only in 7, 10, 12, 13; Step 8's mcp pin is 2.3.0 (Q2
  conclusion unchanged). Step 6 C-13 verdict re-decided: `internal/testdata/` now exists (feature 240) and the
  `"trading-reconciliation-poller"` literal already lives in `internal/config/config_test.go`, so Step 6 would
  make it a second consumer file — it is centralized as `testdata.ReconciliationPollerCallerID`, and Step 6's
  Files gain `internal/testdata/caller_ids.go` (create) and `internal/config/config_test.go` (modify).
- **2026-10-28 — Step 1 verification (CI-equivalent fallback).** The spec's `buf breaking --against
  "$(git rev-parse --show-toplevel)/.git#branch=feature/fix-config-audit-author-spoof,subdir=packages/proto"`
  cannot resolve here: no local `feature/fix-config-audit-author-spoof` branch (detached checkout at `origin/…`)
  and the worktree's `.git` is a file. Ran `buf breaking --against <dir>` on a `git archive` export of
  `origin/feature/fix-config-audit-author-spoof:packages/proto` instead — same baseline and module config.
  `buf lint` exit 0, `buf breaking` exit 0 (buf 1.72.0). **Disposition**: CI-equivalent fallback.
- **2026-10-28 — Step 2 codegen (CI-equivalent fallback).** Ran `./scripts/buf-gen.sh` host-natively rather than
  via the Docker `Dockerfile.codegen` image, with the CI `proto-freshness` pins: buf 1.72.0, protoc-gen-go v1.36.11,
  protoc-gen-go-grpc 1.6.2, protoc-gen-connect-go 1.19.2, grpcio-tools 1.80.0 (scratch venv), TS plugins from the
  committed lockfile (`pnpm install --frozen-lockfile`). The preinstalled `protoc-gen-go` was built with go1.24.7
  and rewrote an unrelated doc comment in `gen/go/analysis/v1/analysis.pb.go`; it was rebuilt with go1.27.0 (the
  CI Go) and the regen re-run, after which the gen diff is config-only (7 files). A second run left the diff
  byte-identical (proto-freshness). **Disposition**: CI-equivalent fallback.
- **2026-10-28 — Step 3 TDD red/green (process note, no spec change).** The paired test is Step 4, so RED→GREEN
  was captured with an uncommitted scratch test in the `internalCallerSetConfig.test.ts` loopback harness (AC-1,
  AC-2, AC-3 ×2): 4/4 failed pre-change (`params[6]` was `'someone-else@example.com'`; AC-3 writes succeeded),
  4/4 passed post-change; the scratch file was deleted. Between Step 3 and Step 4 the config `pnpm test` suite is
  red (75/180, every failure the new `propagated identity required` rejection on admin-scope fixtures with no
  `x-user-id`) — exactly the fixtures Step 4 Instruction 3 updates. **Disposition**: accepted; Step 4 restores green.
- **2026-10-28 — Step 5 verification (red window + toolchain fallback).** RED→GREEN used an uncommitted scratch
  test calling `escalateSystemic` with `fakeConfigSetter` and asserting `author` unset via proto reflection: it
  failed before the change, passed after it, and was then deleted. Two failures remain until Step 6, both from the
  `req.Author` pin at `trading_reconciliation_test.go:789-790`, which is Step 6's rewrite target:
  - the full `golangci-lint run` reports 2 SA1019 there (the field has been deprecated since Steps 1-2);
  - `go test` fails on that pin (`author = ""`).
  `golangci-lint --tests=false` reports 0 issues. The provisioned golangci-lint v2.14.0 was built with go1.26 and
  refuses this go1.27 module, so the same version was rebuilt with go1.27.0 in a scratch GOBIN.
  **Disposition**: accepted; Step 6 restores green.
- **2026-10-28 — Step 6 verification (TDD red source + toolchain fallback).** Step 5 was already committed, so the
  RED for the `author`-unset assertion was captured by temporarily re-inserting `Author:
  "system:reconciliation-poller"` into `escalateSystemic` (the pre-Step-5 shape) in an uncommitted scratch edit:
  `trading_reconciliation_test.go:797: SetConfig must not send the deprecated author field`. The edit was then
  reverted, and the test passed against the committed tree. golangci-lint v2.14.0 ran from the same go1.27.0
  rebuild as Step 5 (`run`, with tests): 0 issues, so the two Step 5 SA1019s are cleared. Step 5's red window
  is closed. **Disposition**: accepted.
- **2026-10-28 — Step 7 verification (red window + docstring wrap).** RED→GREEN used an uncommitted scratch test
  (removed-parameter, AC-4 `set_config` and `manage_signal_source` capture): 3/3 failed before the change
  (`author` in props; `TypeError` on the missing `author`; `req.author == 'manage_signal_source'`), 3/3 passed
  after it; the scratch file was deleted. The Instruction 2b `reason:` docstring text is unchanged but wrapped
  onto two lines (ruff E501, 100 cols). Until Step 8, 7 tests in `tests/test_config_tools.py` fail with
  `unexpected keyword argument 'author'` — exactly Step 8's break-list (`:110,133,152,171,237,255,297`).
  **Disposition**: accepted; Step 8 restores green.
- **2026-10-28 — Step 8 TDD red source (process note, no spec change).** Step 7 was already committed, so RED was
  captured by temporarily restoring the pre-Step-7 `app/client.py` and `app/tools.py` (from `0b1a737d`) in an
  uncommitted scratch edit. The four new Step 8 assertions failed exactly as the step's **TDD** predicts:
  `author` in props; `TypeError` missing `author`; `req.author == 'manage_signal_source'` /
  `'instantiate_template'`; `author` in `mock_set.await_args.kwargs`. The edit was reverted. GREEN: 521 passed,
  coverage 81.29%. Step 7's 7-test red window is closed. **Disposition**: accepted.
- **2026-10-28 — Step 9 verification (red window).** RED→GREEN used an uncommitted scratch vitest file
  (`configUiBff` and `insightsBff` SetConfig, `author === ''` plus the `x-user-id` pin): 2/2 failed before the
  change (`expected 'test-user-001' to be ''`), 2/2 passed after it; the scratch file was deleted. Until Step 10,
  `insightsBff.test.ts` "forces isSecret, createKey, …" fails at `:69` (`expected 'user-mallory' to be
  'user-alice'`): with the stamp gone, the `:59` fixture `author` passes through `...req`. That is exactly
  Step 10's break-list (delete `:59`, replace `:69`). **Disposition**: accepted; Step 10 restores green.
