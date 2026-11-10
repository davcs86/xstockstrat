# Implementation Spec: config-keys-alias-removal

**Status**: `pending`
**Created**: 2026-11-10
**Feature**: `docs/roadmap/features/306-config-keys-alias-removal/feature.md`
**Total Steps**: 13
**Feature Branch**: `feature/config-keys-alias-removal`

---

## Execution Summary

Step 1 records the @AC-7 earliest-start evidence and blocks every later step (FR-3: nothing is removed before a full staging release shows zero `SetConfig canonicalised internal-caller key` lines). The config server (Steps 2-3), the wiring gate (Steps 4-5) and the agent filter (Steps 6-7) are three independent service-plus-test atomic pairs. The row-deletion migration (Steps 8-10) is one atomic unit, because adding migration `047` changes the stored-set `inputs_sha256` and deletes rows the baseline and `scripts/config-wiring-stored.json` still name. Step 11 pins the migration sha and waits on an operator rehearsal. Steps 12-13 (docs, the signed C-16 scenario edits) land last so they describe shipped behavior.

Evidence base: `design.md` (3 rounds, approved 2026-11-10), `recon.md`, and a fresh re-verification of every `path:line` below on `Tree: feature/config-keys-alias-removal@17cc0ea ≡ origin/feature/config-keys-alias-removal` (merged with `origin/main-dev`).

**Consumer surfaces (C-14).** Agent: `get_config` returns the server's values unfiltered (Steps 6-7). UI: none, a decision, not an omission. `services/xstockstrat-ui/src` has no reader of `platform/log_level` (`grep -rn log_level services/xstockstrat-ui/src` finds only the string-composition example `src/lib/configFqn.test.ts:17`), config-ui renders `ListKeys` output so a deleted row simply disappears, and the five e2e specs use a mock row in `e2e/fixtures/configKeys.ts` that never reads the real DB. Trading: no code change (the poller already sends `Key: "trading_state"`, `internal/service/trading.go:2270-2277`; its tests already use it, `trading_reconciliation_test.go:786-787`, `internal/config/config_test.go:598-600`). The product spec's "trading test constants" change is **Not found** — there is nothing to change; only `CLAUDE.md:99` changes (Step 13).

**Scenario coverage (C-15).**

| Scenario | FR | Covered by |
|---|---|---|
| @AC-1 snapshots carry only the stored spelling | FR-1 | Step 3 |
| @AC-2 SetConfig updates exactly the stored row | FR-2 | Step 3 |
| @AC-3 the poller exception is gone | FR-3 | Step 3 |
| @AC-4 agent returns server values unfiltered | FR-4 | Step 7 |
| @AC-5 the gate has no form-mismatch kind | FR-5 | Step 5 |
| @AC-6 re-owned baseline entries settled | FR-6 | Steps 9, 10, 11, 12 |
| @AC-7 earliest-start evidence recorded | FR-3 | Step 1 |

Every `FR-N` in `product-spec.md` is covered by at least one scenario above.

**Recorded spec amendments (design.md § Constitution Rules Touched, C-15).** `design.md` says @AC-5/@AC-6/@AC-7 are "reworded as recorded spec amendments", but `acceptance.feature` on this branch still carries the original text. Two conflict with design.md's pinned outcomes and are amended in-step, scenario IDs unchanged: @AC-5's second Then ("an ordinary unseeded read") becomes "a `prefixed-read`" (Step 5; design.md pins `join 11` to exactly `['prefixed-read']`), and @AC-7 gains the positive-control and trading-image-ancestry evidence (Step 1). @AC-6 conflicts with nothing found, so it is not reworded.

## Step Dependencies

- Step 1 blocks Steps 2-13: @AC-7 requires the evidence to be in `context.md` "when the first implementation step starts".
- Steps 2 and 3 land together: removing `altSpelling` from `authz.ts` and the `SELECT … key IN ($2,$3)` probes breaks `tsc` (tests are in `tsconfig`; `dormantAlias.test.ts:9` imports `altSpelling`) and the existing alias tests (`.claude/skills/sdd-spec/reference/step-constraints.md` §C trigger: signature/export change in a package whose build compiles tests).
- Steps 4 and 5 land together: `config-wiring.test.mjs` `join 1`/`join 9` pin `form-mismatch` lines that Step 4 removes.
- Steps 6 and 7 land together: the old agent tests assert the filter Step 6 removes.
- Steps 8, 9 and 10 land together (one atomic unit, 3 steps, one surface: backend/tooling): the new migration changes `storedInputsSha256` and deletes rows the baseline and stored set still name; Step 9's pass 2e needs the migration to exist; Step 10's baseline removal is only valid once the rows are gone from the stored set.
- Step 11 is **operator-gated**: it requires Step 8 (final up-file bytes) and an operator-run rehearsal on DO dev (see Step 11). `/sdd-execute all` and `sequential` MUST halt here (AskUserQuestion) and ask first whether "production/staging counts" mean the two `environment` values inside the DO dev database (the 305 precedent); a batch runner never writes this section on its own. The integration PR stays **draft** until Step 11's sign-off section exists (design.md Unit B).
- Steps 12 and 13 require Steps 2-10 (they describe landed behavior). Step 12 requires the C-16 sign-off recorded in `context.md` (2026-11-10, davcs86, verbatim) — it is.
- Merge order: feature 305 (merged, `launched`) precedes 306. Config migration `047` is shared with feature 280 (`docs/roadmap/features/merge-order.md` row for 305 ↔ 306 ↔ 280): the first to merge takes `047`; a renumber is 3 file renames (up, down, nothing else is number-bound because discovery is by slug) plus a `config-wiring-stored.json` `inputs_sha256` regeneration, content and the Step 11 sha unchanged.
- Rollback asymmetry (design.md Open Risk): recorded in Step 13 (`config-rollout.md`).

---

### Step 1 — test: Record the @AC-7 earliest-start evidence and the poller-key check in context.md

**Status**: `done`
**Service**: `docs/roadmap/features/306-config-keys-alias-removal` (operator/Grafana evidence, no code)
**Files**:
- `docs/roadmap/features/306-config-keys-alias-removal/context.md` — modify (append the evidence session)
- `docs/roadmap/features/306-config-keys-alias-removal/acceptance.feature` — modify (@AC-7 wording amendment only)

**Reviewers**: Platform Lead — earliest-start evidence, gate close-out; Service owner `xstockstrat-trading` — the reconciliation poller must send `trading_state` before the exception is removed

**Codebase Evidence**:
- 304 and 305 are `launched`: `git show origin/main-dev:docs/roadmap/features/304-config-keys-relative-consumers/status.md` → `launched`; same for `305-config-dead-rows-prune`.
- The WARN is emitted only at `services/xstockstrat-config/src/grpc/configServiceImpl.ts:710` (`log.warn('SetConfig canonicalised internal-caller key', …)`), inside the `if (prefixed)` branch of `setConfig` (`:694-721`); it fires only when a poller escalates systemically, so a zero count alone is weak evidence (design.md Step 0).
- The poller already sends the relative key: `services/xstockstrat-trading/internal/service/trading.go:2270-2277` (`Namespace: "platform"`, `Key: "trading_state"`, caller `trading-reconciliation-poller`) → confirmed absent any `platform.trading_state` SetConfig literal (`grep -rn "platform\.trading_state" --include="*.go" services/xstockstrat-trading` finds only comments and log text).
- Loki selector precedent (feature 305, `scripts/config-heal/signoff.md` § Feature 305): `{deployment_environment="staging", service_name=~"…"}` with `service_name` the short name. The config service's `service_name` value and the retention over one release are **unconfirmed** (design.md Open Risk) — this step confirms them with `mcp__Grafana_Cloud__list_loki_label_values` before querying.

**TDD**: N/A (operator/Grafana evidence record, no code)

**Covers**: AC-7

**Instructions**:
1. Amend `acceptance.feature` @AC-7 Then to: "context.md records the query, the window, the zero count, a positive-control count above zero on the same selector and window, and the trading-image ancestry check". Scenario ID and tags unchanged.
2. Determine the window: first staging deploy carrying 304's trading image through the next staging release. Find the 304 trading merge sha with `git log --first-parent origin/main-dev -- services/xstockstrat-trading/internal/service/trading.go`.
3. Run, and record verbatim with the datasource, in `context.md`:
   a. LogQL zero-count: `sum(count_over_time({deployment_environment="staging", service_name="<confirmed config label>"} |= "SetConfig canonicalised internal-caller key" [<window>]))`, and the same query for `deployment_environment="production"` where the environment has an instance.
   b. Positive control on the same selector and window with a line the config service logs routinely (for example `|= "GetSecret served"`): the count must be greater than zero, otherwise the zero in (a) proves nothing.
   c. `git merge-base --is-ancestor <304 trading merge sha> <deployed trading sha>` exits 0 for each environment that has an instance (the deployed sha comes from the DO deployment status / image tag).
   d. Re-confirm `trading.go:2270-2277` still sends `trading_state` at the checkout in use.
4. Append a `## Session <ISO> — sdd-execute step 1` entry to `context.md` with the results. If (a) is non-zero, (b) is zero, or (c) fails, **stop and ask the operator** (P-03); do not start Step 2.

**Verification**:
```
grep -n "SetConfig canonicalised internal-caller key" docs/roadmap/features/306-config-keys-alias-removal/context.md   # the query is recorded
grep -n -i "positive control" docs/roadmap/features/306-config-keys-alias-removal/context.md                          # control recorded with a count > 0
grep -n "is-ancestor" docs/roadmap/features/306-config-keys-alias-removal/context.md                                  # ancestry recorded, exit 0
```

---

### Step 2 — service: Remove the alias, the write-time spelling tolerance and the poller exception from the config server

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify
- `services/xstockstrat-config/src/grpc/authz.ts` — modify

**Reviewers**: Service owner `xstockstrat-config` — config key naming, environment/global-per-user scoping, WatchConfig stream stability

**Codebase Evidence** (all verified at `17cc0ea`):
- `configServiceImpl.ts:10,12,15` import `altSpelling`, `canonical`, `hasInternalCallerAuthority`.
- `:204-205` `MARKER_ACTIVE_SQL`, interpolated at `:452` (`reloadAll`), `:472` (`reloadNamespace`), `:497` (`resolveOverlayValues`); `:221-229` `withLegacyAliases` (calls `altSpelling` `:225`); `markerActive` plumbing at `:493`, `:506`, `:509`, `:979-980`, `:987`.
- `:365` `await this.serial(() => (this.connectedOnce ? this.resyncAll() : this.reloadAll()))` is the **reconnect path (feature 258)** and `resyncAll` is defined at `:409-418`; the **marker branch** of `onNotification` is `:432-437` (`'marker' in parsed` → `this.serial(() => this.resyncAll())`). Only the marker branch goes; `resyncAll` stays (295 @AC-21/@AC-26, PRESERVE).
- Poller exception `:694-721` (comment `:696-697`, condition `:698-706`, rewrite `:707-709`, WARN `:710-716`, reject `:717-719`).
- `canonical` call sites: `:183` (`lookupScalarBounds`), `:189` (`prefixedKeyRejection`), `:703`, `:707` (exception, removed), `:751` (denial-log guard), `:786` (`trading_state` enum guard).
- Probes `:815` (`altSpelling`), `:819-823` exact probe `key IN ($2,$3)` with params `[namespace, key, alt, env, userIdParam]`, `:827-834` per-user global probe `key IN ($2,$3)` with `[namespace, key, alt, env]`; ambiguity branch `:841-857` (message `:854`); `writeKey` `:859`, used `:909` (INSERT params) and `:912` (`pg_notify` payload).
- `authz.ts:84-93` `INTERNAL_CALLER_ALLOWLIST` (grant `key: 'platform.trading_state'` `:90`, comment `:88-89`); `:96-99` `canonical`; `:102-105` `altSpelling`; `:111-126` `hasInternalCallerAuthority` (`:123` `canonical(grant.namespace, grant.key) === canonical(namespace, key)`).
- Eight test fakes route on the literal text `SELECT key, is_secret FROM config.config_values` (`configServiceImpl.test.ts:557`, `configValueRoundtrip.test.ts:89`, `internalCallerSetConfig.test.ts:39`, `scopeResolution.test.ts:30`, `secretsAndScope.test.ts:43`, `setConfigAuthz.test.ts:104`, `setConfigScalarBounds.test.ts:45`, `tradingStateValidation.test.ts:42`) and read `params?.[1]` as the key → the select list and `params[1]` position must not change.

**Lands with**: `Step 3`

**TDD**: red-green required

**Covers**: —

**Instructions** (follow design.md Unit A exactly):
1. `configServiceImpl.ts`: delete `MARKER_ACTIVE_SQL` (`:203-205`) and drop `${MARKER_ACTIVE_SQL}` plus the preceding comma from the three SELECTs (`:452`, `:472`, `:497`); delete `withLegacyAliases` (`:221-229`); in `resolveOverlayValues` remove `markerActive` (`:493`, `:506`), set `const values = base` (replace `:509`); in `buildGlobalSnapshot` remove `markerActive` (`:979-980`, `:987`) and use `values` where `emitted` was used for `contentVersion` (`:983`). `contentVersion` itself (`:210-219`) is unchanged.
2. `onNotification`: delete only the marker branch `:432-437`; a `{"marker": …}` payload then falls to the existing no-namespace guard at `:439`. Keep `resyncAll` (`:409`) and its reconnect call (`:365`).
3. `setConfig`: collapse `:694-721` to `if (prefixed) { callback({ code: 3, message: prefixed }); return; }`. `prefixedKeyRejection` (`:187-193`) stays and keeps rejecting a double-prefixed key (it uses `canonical`; 296 @AC-1 EXTEND: no row is written).
4. Replace the remaining `canonical` uses: `:183` → `` `${namespace}.${key}` ``; `:751` → `call.request?.key === 'trading_state'`; `:786` → `key === 'trading_state'`. Update the `:785` comment to say the guard matches the relative key only.
5. Probes (keep `SELECT key, is_secret FROM config.config_values`, change only the WHERE): exact `WHERE namespace = $1 AND key = $2 AND environment = $3 AND COALESCE(user_id,'') = COALESCE($4,'')` with `[namespace, key, env, userIdParam]`; per-user global probe `WHERE namespace = $1 AND key = $2 AND environment = $3 AND user_id IS NULL` with `[namespace, key, env]`. Delete `const alt` (`:815`), the `ambiguous` computation and `FAILED_PRECONDITION` branch (`:843-857`) and `writeKey` (`:858-859`); `:909` and `:912` use `key`. `exactRow`/`globalRow` and the existence/`isSecret` logic after them are unchanged.
6. `authz.ts`: delete `altSpelling` (`:101-105`); change the grant to `key: 'trading_state'` and replace the `:88-89` comment with a one-line constraint ("exact key match; keep in step with SetConfig's trading_state enum guard"); `:123` becomes `grant.key === key`; remove the `canonical`-based match. Keep `canonical` exported **only** for `prefixedKeyRejection` and `lookupScalarBounds`.
7. Remove the now-unused `altSpelling` import (`:10`). Keep `canonical` and `hasInternalCallerAuthority` imports.
8. Header propagation: no new outbound gRPC call — N/A.

**Verification**:
```
cd services/xstockstrat-config && pnpm run lint
grep -rn -E "withLegacyAliases|MARKER_ACTIVE_SQL|altSpelling|marker_active|markerActive|relative_keys_v1" services/xstockstrat-config/src/grpc   # empty
grep -rn -E "canonicalised internal-caller|FAILED_PRECONDITION|key IN \(" services/xstockstrat-config/src/grpc                                  # empty
```
(The unit's behavioral verification is Step 3's.)

---

### Step 3 — test: Config server tests for the removed alias, tolerance and exception

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/dormantAlias.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/setConfigSpelling.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/internalCallerSetConfig.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/internalCallerAuthz.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/setConfigAuthz.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/contentVersion.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/changeFeedLiveness.test.ts` — modify
- `services/xstockstrat-config/src/__tests__/perUserSecrets.test.ts` — modify

**Reviewers**: Service owner `xstockstrat-config` — config key naming, scoping, WatchConfig stream stability

**Codebase Evidence**:
- `dormantAlias.test.ts`: header `:1-2`, `import { altSpelling }` `:9`, `MARKER_PROBE` `:19`, `makePool(marker: 'no-table'|'no-row'|'row', …)` `:27,:40-68`, alias assertions `:103-136` (`@AC-2` with marker `:103-118`, `@AC-3` `:122-128`, `@AC-4` `:130-136`), marker-writer test `:138-156` ("exactly one migration writes the relative_keys_v1 marker row", asserts `contract-of 040`). The marker-writer test **stays** (fails.md 2026-11-10 trap: a new `config_markers` writer must not break it; 306's marker is `alias_removal_rows_306`, so the regex `VALUES ( 'relative_keys_v1'` still sees exactly one writer).
- `setConfigSpelling.test.ts`: fake `selectRows` `:36-65` handles `key IN (…)` (`:45-48`); `@AC-1` cases `:155-200` (kept: prefixed key refused before any DB call `:155-165`, relative write `:167-187`, `create_key` prefixed `:189-200`); `@AC-5` poller canonicalised + WARN `:204-225`, direction `:227-237`, exception-scope loop `:239-250`; `@AC-25` grant `:252-264`; `@AC-34` ambiguity `:320-354`; `@AC-35` `:356-370`.
- `internalCallerSetConfig.test.ts`: default request key `'platform.trading_state'` `:71`; WARN assertion `:102-105`; other cases already send `key: 'trading_state'` (`:134,:144`); `log_level` at `:190` is an arbitrary admin-write key against a fake pool (no DB) — unchanged.
- `internalCallerAuthz.test.ts`: prefixed `'platform.trading_state'` at `:28,:40,:52,:61,:79`; relative case `:82-92`.
- **Not named in design.md, found in discovery:** `setConfigAuthz.test.ts:179` (`@AC-54` / feature 294) sends the prefixed `key: 'platform.trading_state'` and expects `PERMISSION_DENIED` plus an ERROR denial log carrying `targetState` — after FR-3 a prefixed key is `INVALID_ARGUMENT` before authz, so the request key must become `trading_state` (the C-16 read-note for 294 @AC-54, Step 12). Its fake pool distinguishes the global probe by `user_id IS NULL` (`:104-111`), which the new global probe keeps.
- `contentVersion.test.ts:47` and `changeFeedLiveness.test.ts:66` spread `{ marker_active: false }` when the SQL mentions `config_markers`; `contentVersion.test.ts` has `EchoListener.change(payload)` (`:19-30`) and `rig.reloadAlls()` (counter at `reloadAlls++` in the `WHERE user_id IS NULL` branch), the harness to drive a notification.
- `perUserSecrets.test.ts:56-100` `makeStorePool`: its `SELECT is_secret FROM`/`SELECT value_encrypted FROM` branch (`:73-81`) does not match setConfig's `SELECT key, is_secret` probes, which fall through to `{ rows: [] }`.
- Existing guard for Step 2 instr. 4 (`lookupScalarBounds` without `canonical`): `setConfigScalarBounds.test.ts:311-320` already asserts a former prefixed form of a bounded key is refused `INVALID_ARGUMENT` before any query (`queries.length === 0`); it must stay green, no edit.
- Test-data (C-13): these are inline per-file pool fakes (the existing convention in this service; `src/__tests__/fixtures/` exists but holds no pool fake). No literal gains a second consumer in this step → inline is compliant; nothing is centralised.

**Lands with**: `Step 2`

**TDD**: red-green required

**Covers**: AC-1, AC-2, AC-3

**Instructions** (write the assertions first; they fail against the Step 2 baseline):
1. `dormantAlias.test.ts` (@AC-1): rewrite the stale header comment (`:1-2`, it describes the alias) to state the stored-keys-only guarantee, remove `MARKER_PROBE` (`:19`) once the fake no longer branches on it, drop the `altSpelling` import and the `'no-table' | 'no-row' | 'row'` states. Keep one pool fake whose rows are the stored rows. Cases: (a) namespace `indicators` storing `sandbox.timeout_ms` = 15000 with the fake still *able* to return `marker_active: true` → the SNAPSHOT keys equal the stored keys exactly and there is no `indicators.sandbox.timeout_ms`; (b) `getConfig` (via `impl.getConfig`, `configServiceImpl.ts:615`) returns the same single key; (c) every captured SELECT contains neither `config_markers` nor `marker_active`; (d) after `SetConfig`, the next `watchConfig` write is a DELTA whose `changedKeys` is `['sandbox.timeout_ms']` only. Keep the "exactly one migration writes the `relative_keys_v1` marker row" test unchanged. Delete the `@AC-2`-with-marker, `@AC-3` and `@AC-4` alias tests.
2. `contentVersion.test.ts` (@AC-1, "no snapshot re-sync is triggered by the marker row"): add a case that calls `rig.listeners[0].change({ marker: 'relative_keys_v1' })`, flushes, and asserts `rig.reloadAlls()` is unchanged and the subscriber's `call.writes.length` is unchanged. Remove the `marker`/`copy` spread (`:47-48`) so rows are returned as-is. `changeFeedLiveness.test.ts`: remove the same spread (`:66,:72,:76`); its reconnect/resync case (`@AC-21`, `:113`) must pass unchanged (PRESERVE).
3. `setConfigSpelling.test.ts` (@AC-2, @AC-3): update the fake's doc comment (`:41`) to describe `key = $n` only; in `selectRows` drop the `key IN` branch (`:45-48`) and make any config_values SELECT whose key is not `key = $n` throw (so the old `IN ($2,$3)` probe is RED). Replace `@AC-5` (`:204-225`) with: the poller sending `platform.trading_state` = `REDUCE_ONLY` returns `INVALID_ARGUMENT`, `inserts().length === 0`, and no log line matches `/canonicalis/i` (assert on the pattern, never the literal log string, so the Verification grep below stays empty); and the same poller sending `trading_state` succeeds with `inserts()[0].params[1] === 'trading_state'` and `find('platform','trading_state')[0].value_data === 'REDUCE_ONLY'`. Keep `:227-237` (ACTIVE still `PERMISSION_DENIED`, @AC-3 Then 3) but send the relative key. Replace the `:239-250` loop by prefixed-key `INVALID_ARGUMENT` cases (prefixed + `create_key`, prefixed per-user, another namespace) — all rejected, nothing written. Add @AC-2: store `analysis`/`backtest.max_range_days` = 365; admin `SetConfig` of that key = 730 updates the row; `SetConfig` of `analysis.backtest.max_range_days` is `INVALID_ARGUMENT` and `find('analysis','analysis.backtest.max_range_days')` is empty. Add the EXTEND of 296 @AC-1: a double-prefixed key (`marketdata.marketdata.x`) is rejected and writes no row. Delete `@AC-34` (`:320-354`) and the file-header ambiguity text (`:1-5`). Keep `@AC-25` (`:252-264`), the bounds cases and `@AC-35`.
4. `internalCallerSetConfig.test.ts`: change the default request key (`:71`) to `trading_state`; delete the WARN assertion (`:102-105`) and the stale comment at `:123`-area; add one case that the prefixed `platform.trading_state` from the poller returns `INVALID_ARGUMENT` and writes nothing. `internalCallerAuthz.test.ts`: every `'platform.trading_state'` argument becomes `'trading_state'`; add a case that the prefixed spelling is **denied** (`false`) — exact equality.
5. `setConfigAuthz.test.ts:179`: change `key` to `'trading_state'`; the assertions (PERMISSION_DENIED, one ERROR denial log, `targetState`) stay. This is the 294 @AC-54 CHANGE signed 2026-11-10.
6. `perUserSecrets.test.ts` `makeStorePool` (`:56-100`): add an explicit branch for `SELECT key, is_secret FROM config.config_values` answering the exact probe from the store by `(ns=p[0], key=p[1], env=p[2], uid=p[3] || null)` and the global probe (`sql.includes('user_id IS NULL')`, params `[ns,key,env]`) by `(ns,key,env,null)`; any other `config_values` SELECT reaching the fake throws `unrecognised SELECT`. Existing assertions must still hold.
7. The eight fakes that route on `SELECT key, is_secret` need no edit (select list and `params[1]` are unchanged); confirm by running the full suite.

**Verification**:
```
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
grep -rn -E "withLegacyAliases|MARKER_ACTIVE_SQL|altSpelling|markerActive" services/xstockstrat-config/src      # empty (tests included)
grep -rn "marker_active" services/xstockstrat-config/src/grpc                                                  # empty (production only; dormantAlias.test.ts keeps the token to drive the old column)
grep -rn "canonicalised internal-caller key" services/xstockstrat-config/src                                                   # empty (production and tests: no test spells the literal)
```
Red proof (execute): before Step 2's edits, the new `@AC-1`/`@AC-2`/`@AC-3` assertions fail (snapshot still carries the alias key; prefixed poller write still succeeds; the `IN` probe trips the throwing fake).

---

### Step 4 — service: Remove alt, partnerOf and the form-mismatch kind from the wiring gate

**Status**: `done`
**Service**: `scripts/` (config-wiring gate)
**Files**:
- `scripts/check-config-wiring.mjs` — modify

**Reviewers**: Platform Lead — gate close-out; Service owner `xstockstrat-config` — baseline owner, join semantics

**Codebase Evidence** (verified at `17cc0ea`):
- `BASELINE_KINDS` `:169` lists `'form-mismatch'`; `validateState` `:176-203` rejects kinds outside it (`:190`).
- `join()` `:579-659`: `alt`/`partnerOf` `:606-607`; seed loop `:610-622` (relative-seed hoist `:611-614`, `partnerOf` `:616`, seeded-unread `:617`, `form-mismatch` push `:618-620`); `secretIds` `:623` and `excluded` `:624-625`; `both` `:638`, `catalogIds`/`flaggedIds` `:639-640`, lookup `:642`.
- `findingLine` `:661-666` has the `form-mismatch` branch (`:662`); `namesOf` `:696` includes `f.readKey`.
- `canonical` `:671` **stays** (`declaredFromMigration` `:689`, `membership()` `:736-738`, `deadRowVerdict`); `membership()` `:724-740` (owner regex `/^feature (305|306)\b/`) is untouched (dormant after Step 10, CLAUDE.md rule 3).
- `real tree`: `grep -c form-mismatch scripts/config-wiring.json` → 0 and `--final` exits 0, so no current baseline entry depends on the kind.

**Lands with**: `Step 5`

**TDD**: red-green required

**Covers**: —

**Instructions** (design.md Unit C):
1. Replace `alt`/`partnerOf` (`:606-607`) with a pair next to `nk` usage: `const rel = (ns, key) => (key.startsWith(`${ns}.`) ? key.slice(ns.length + 1) : key)` and `const relId = (ns, key) => nk(ns, rel(ns, key))`.
2. Seed loop: keep the relative-seed hoist (`:611-614`). After `if (byKey.has(nk(s.namespace, s.key))) continue`, add `if (relSeed && byKey.has(nk(s.namespace, `${s.namespace}.${s.key}`))) continue` (a relative seed read only by its prefixed spelling is reported by the `prefixed-read` loop below, never as `seeded-unread`/`read-unseeded`), then push `seeded-unread`. Delete the `form-mismatch` push and the `cover(…readKey…)` call (`:616-621`).
3. `secretIds` = `new Set([...secrets.values()].map((r) => relId(r.namespace, r.key)))`; `excluded(ns, key)` tests `secretIds.has(relId(ns, key))`; the prefix-catalog branch (`c.match === 'prefix' ? key.startsWith(c.key) : c.is_secret && c.key === key`) keeps comparing the **raw** key.
4. `catalogIds`/`flaggedIds` use `relId(c.namespace, c.key)` (single id, replacing `both`); the lookups become `seeded.get(id) ?? seeded.get(relId(e.namespace, e.key))`, `catalogIds.has(relId(e.namespace, e.key))`, `flaggedIds.has(relId(e.namespace, e.key))` — both sides normalised (a prefixed reader of a relative catalog row stays covered).
5. Remove `'form-mismatch'` from `BASELINE_KINDS` (`:169`), delete the `findingLine` branch (`:662`; the remaining chain starts at `ROW_KINDS.has(f.kind)`), and `namesOf` → `[canonical(f.namespace, f.key), f.key]` (no `readKey`). The final file must not contain the tokens `form-mismatch`, `partnerOf`, or `alt(` (including comments).
6. Not changed: `membership()`, `DOC_BANNED` (`:866`), `canonical`, `ROW_KINDS` (`:530`).

**Verification**:
```
node --test scripts/config-wiring.test.mjs
node scripts/check-config-wiring.mjs --final     # exit 0 on the real tree (committed baseline still equals the tree)
node scripts/check-config-wiring.mjs --doc-check # exit 0
! grep -n -E "form-mismatch|partnerOf|alt\(" scripts/check-config-wiring.mjs
```

---

### Step 5 — test: Gate tests without form-mismatch, plus join 11

**Status**: `done`
**Service**: `scripts/` (config-wiring gate tests)
**Files**:
- `scripts/config-wiring.test.mjs` — modify
- `docs/roadmap/features/306-config-keys-alias-removal/acceptance.feature` — modify (@AC-5 wording amendment only)

**Reviewers**: Platform Lead — gate close-out; Service owner `xstockstrat-config` — baseline owner

**Codebase Evidence**:
- `join 1` `:158-165` pins two lines incl. `…ingest/ingest.signals.window_hours->signals.window_hours:form-mismatch`; `join 9 @AC-6 @AC-8` `:232-243` pins four lines incl. `…ledger/ledger.export.enabled->export.enabled:form-mismatch` and the negative at `:242`; `join 9 @AC-7` `:245-253` and `:268-276` build `baselineOf(…, ['form-mismatch', 'ledger.export.enabled'])` (`:247`, `:270`); `join 9 @AC-24` `:255-266` has a `form-mismatch` alternative in its negative regex (`:265`); `join 10` `:287-309` (negative regex `:307`); `baseline 2` `:592-604` kind list `:598`.
- `cw.join` is exported (`check-config-wiring.mjs:579`); `cw.validateState` is used directly at `:252`. There is **no** existing pure `cw.join(...)` test — `join 11` is the first; build the minimal `{stored: Map, secrets: Map}` from the shape `loadStored` returns (`check-config-wiring.mjs:232-`) and a `reads` object `{ reads: [...], dynamic: [] }`.
- Fixtures: `scripts/config-wiring-fixtures/join/{mismatch,prefixed-read,…}` carry no `form-mismatch` text (repo-wide grep) — expectations change, fixtures do not.
- Test-data (C-13): fixtures live under `scripts/config-wiring-fixtures/`, no new shared literal.
- Known consequence (Step 4): after `alt` is removed, `seeded.get(relId(...))` only matches a stored row that is itself relative, so a prefixed-stored row read relative loses its type/default/metadata checks; it still reports `seeded-unread` plus `read-unseeded`, so it is not silent (fixture-only: the 045 CHECK forbids prefixed stored keys). Recorded in `context.md`.

**Lands with**: `Step 4`

**TDD**: red-green required

**Covers**: AC-5

**Instructions**:
1. Amend `acceptance.feature` @AC-5: replace "the finding is reported as an ordinary unseeded read and not as \"form-mismatch\"" with "the finding is reported as a \"prefixed-read\" (the relative stored key read by its prefixed spelling) and not as \"form-mismatch\"". Scenario ID and tags unchanged.
2. `join 1` (rename: "a prefixed seed read relative is seeded-unread plus read-unseeded; a relative seed read prefixed is a prefixed-read"): expect exit 1 and exactly three sorted lines — `…/001_seed.up.sql:ingest/ingest.signals.window_hours:seeded-unread`, `services/xstockstrat-ingest/app/mcp_loop.py:ingest.mcp_client.request_timeout_seconds:prefixed-read`, and `<reader file of signals.window_hours>:signals.window_hours:read-unseeded` (take the reader path from `scripts/config-wiring-fixtures/join/mismatch`).
3. `join 9 @AC-6 @AC-8`: replace the `form-mismatch` line with `${SEEDS}/001_seed.up.sql:ledger/ledger.export.enabled:seeded-unread`, add `services/xstockstrat-ledger/src/reader_c.ts:export.enabled:read-unseeded`, keep the two `prefixed-read` lines and `REPORTED: ${PR_B}:ledger.export.prod_only:read-unseeded:staging`, keep the `:242` negative. `join 9 @AC-24`: drop the `form-mismatch` alternative from the negative regex (`:265`); keep the rest.
4. `join 9 @AC-7` (`:245-253`, `:268-276`): remove the `['form-mismatch', 'ledger.export.enabled']` entries (`:247`, `:270`); both tests still exit 2 on the `prefixed-read` entry.
5. `baseline 2`: remove `'form-mismatch'` from the kind list (`:598`). The `join 10` negative regex at `:307` may keep its `|form-mismatch` alternative (harmless, left alone) or drop it for tidiness.
6. New tests: (a) pure `join 11 @AC-5`: relative seed `ledger/export.enabled` + a reader of `ledger.export.enabled` → findings kinds are exactly `['prefixed-read']`; (b) `validateState rejects a form-mismatch baseline entry`: `assert.throws(() => cw.validateState({ findings: [{ namespace: 'ledger', key: 'x', kind: 'form-mismatch', owner: 'feature 304' }] }), /kind must be one of/)`; (c) source assertion: `fs.readFileSync(SCRIPT)` has no `form-mismatch`, `partnerOf` or `alt(`.
6a. Design note "@AC-22 scoped to `export.max_window_days`": no test in `scripts/config-wiring.test.mjs` carries `@AC-22` (grep confirmed), so no edit is required for it; the platform.feature 296 @AC-22 guarantee ("exactly one prefixed-read and no read-unseeded" for `export.max_window_days`) is pinned by the `join 9 @AC-6` assertions of instruction 3, whose `export.max_window_days` negative (`:242`) is kept.
7. Not changed here: `gate 7` (`:561-579`), the `SWEEP_277` constant (`:607-619`, "copied from context.md; never recompute"), `baseline 3` and `dead 3` (Step 10).

**Verification**:
```
node --test scripts/config-wiring.test.mjs
node scripts/check-config-wiring.mjs --final && node scripts/check-config-wiring.mjs --doc-check
```
Red proof (execute): against the pre-Step-4 script, `join 1`, `join 9`, `join 11`, the `validateState` test and the source assertion fail.

---

### Step 6 — service: Remove the alias filter from the agent's get_config

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/app/tools.py` — modify

**Reviewers**: Service owner `xstockstrat-agent` — MCP tool contract stability and `docs/runbooks/mcp-tools.md` parity

**Codebase Evidence**:
- Filter at `app/tools.py:1833-1838` (comment `:1833-1834`, `values = result.get("values", {})`, `prefix = f"{namespace}."`, the `for k in [k for k in values if k.startswith(prefix) and k[len(prefix):] in values]: del values[k]` loop); the secret redaction `:1829-1832` ("Redact on the is_secret flag, not on the key name") **stays**; `return result` follows at `:1839`.
- Docstring `:1805-…` already says "Keys are returned as stored (namespace-relative)" — no alias text to remove there. `docs/runbooks/mcp-tools.md:1181-1183` and `:1221` already say the same; `grep -n -i alias docs/runbooks/mcp-tools.md` finds only the unrelated `MCP_TRANSPORT=sse` deprecated alias (`:27`). FR-4's "mcp-tools.md parity" is therefore **already satisfied — no edit** (confirmed absent; not listed in Files per F-08).
- Consumer surface (C-14): this is the Agent surface.

**Lands with**: `Step 7`

**TDD**: red-green required

**Covers**: —

**Instructions**:
1. Delete the alias-filter block (`:1833-1838`: the two comment lines, `values`, `prefix`, and the `for … del` loop), leaving the redaction loop and `return result`.
2. Do not change the docstring (it already describes stored-key results) or the `list_config_keys` tool.
3. Header propagation: no new outbound gRPC call — N/A.

**Verification**:
```
cd services/xstockstrat-agent && ruff check . && ruff format --check .
! grep -n -E "prefixed alias spelling|lone prefixed entry" services/xstockstrat-agent/app/tools.py   # the filter and its comment are gone
```

---

### Step 7 — test: Agent get_config returns the server's values unfiltered

**Status**: `pending`
**Service**: `xstockstrat-agent`
**Files**:
- `services/xstockstrat-agent/tests/test_config_tools.py` — modify

**Reviewers**: Service owner `xstockstrat-agent` — MCP tool contract stability

**Codebase Evidence**:
- `tests/test_config_tools.py:535-550` `test_get_config_drops_the_alias_when_the_relative_twin_is_present` (asserts `list(result["values"]) == ["backfill.batch_size"]` from a backend carrying both spellings) and `:552-567` `test_get_config_keeps_a_lone_prefixed_entry`; helpers `_tool_fn(server, "get_config")` and `_make_server()`, `patch.object(client, "get_config", AsyncMock(...))` as used at `:540-549`.
- Test data (C-13): the backend dicts are single-use inline literals in this file; the new case reuses the same shape, one consumer each → inline is compliant; `tests/conftest.py` is not touched.
- The agent has no `--cov-fail-under` in `services/xstockstrat-agent/pyproject.toml` (only `testpaths = ["tests"]`, `:32`), so there is no coverage threshold to enforce.

**Lands with**: `Step 6`

**TDD**: red-green required

**Covers**: AC-4

**Instructions**:
1. Replace the two tests (`:535-567`) with one `test_get_config_returns_the_servers_values_unfiltered` (@AC-4): the backend returns namespace `marketdata` with `values = {"fmp.enabled": {"value": True, "value_type": "bool", "is_secret": False}}`; the result's `values` equals exactly that mapping.
2. Add `test_get_config_does_not_drop_a_prefixed_looking_key`: a backend `values` holding both `backfill.batch_size` and `marketdata.backfill.batch_size` returns both unchanged (the tool no longer second-guesses the server).
3. Keep every existing redaction test (the `is_secret` → `"[redacted]"` path) untouched.

**Verification**:
```
cd services/xstockstrat-agent && ruff check . && ruff format --check . && python3 -m pytest tests/test_config_tools.py -q
```
Red proof (execute): against the pre-Step-6 tool the second test fails (the prefixed twin is deleted).

---

### Step 8 — migration: Delete the three operator-decided rows (047_config_alias_removal_rows)

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/047_config_alias_removal_rows.up.sql` — create
- `services/xstockstrat-config/migrations/047_config_alias_removal_rows.down.sql` — create

**Reviewers**: DBA — migration NNN numbering, up+down pair, run-order; Service owner `xstockstrat-config` — scoping, audit trail

**Codebase Evidence**:
- Last config migration: `046_config_dead_rows_prune.{up,down}.sql` (`ls services/xstockstrat-config/migrations | tail`); next free number is **047** at `17cc0ea` (shared with feature 280; the first to merge takes it — the slug is the stable name, so docs/tests name it by slug only, C-07).
- Shape to copy: `046_config_dead_rows_prune.up.sql:5-61` (CTEs `latch`, `signed`, `d` DELETE…RETURNING, `snap` into `config.config_values_premigration_296`, `aud` into `config.config_audit`, `rep` into `config.config_keys_report_296`, `mk` into `config.config_markers`, `nt` pg_notify, final `SELECT`); down `046…down.sql:4-24` (marker DELETE…RETURNING `set_at`, restore from the snapshot joined on the report rows of that run, `ON CONFLICT … DO NOTHING`, notify).
- `config.config_keys_report_296` has no CHECK on `action` (`044_config_keys_relative.up.sql:14-22`), so new action names are legal. `config-044.sql:145` counts `unmatched-signed-tuple` globally → 306 must **not** use that action.
- Committed data selects **5** rows: `scripts/config-wiring-stored.json` holds `platform/log_level` (staging `001`, production `002`), `trading/risk.daily_loss_limit` (staging, production), `ledger/stream.notify_enabled` (staging only). Upper bound 6 by `CHECK (environment IN ('staging','production'))` (`017:41`) and the unique index (`017:101-102`).
- Down isolation: 305's down joins only `r.action = 'dead-row-deleted'` (`046…down.sql:15`), so a 306 down filtered on `alias-removal-row-deleted` and its own marker cannot resurrect 305's rows, nor 305's down 306's.

**Lands with**: `Step 9, Step 10`

**TDD**: N/A (migration; proven by CI `migration-rerun` on the draft integration PR — F-05, Step 9)

**Covers**: —

**Instructions**:
1. `…up.sql`: header comments as 046 (feature 306; "never edited after the sha is pinned (F-01)"; "No lock, no data-dependent RAISE"; deletes the three operator-decided global non-secret rows in every environment). One statement, a data-modifying CTE:
   - `latch` = `NOT EXISTS (SELECT 1 FROM config.config_markers WHERE name = 'alias_removal_rows_306')`.
   - `target` = the three pairs as a `(VALUES …) AS alias_removal_306(namespace, key)` table expression, wrapped between the comment lines `-- alias_removal_306:begin` and `-- alias_removal_306:end` (so `migration-rerun.sh` can extract it as it does `dead_rows_305:begin/end`): `('platform','log_level')`, `('trading','risk.daily_loss_limit')`, `('ledger','stream.notify_enabled')`.
   - `d` deletes `v.user_id IS NULL AND NOT v.is_secret` rows matching a target pair **in every environment** (predicate delete, no sha — operator decision 2026-11-10), `RETURNING` the same column list as 046.
   - `snap`, `aud` as 046; the audit rows use `changed_by = 'system:config-migration-feature-306'`, `reason = 'feature 306: delete alias-removal row'`, `new_value NULL`.
   - `rep`: one `now(), 'alias-removal-row-deleted', …` row per deleted row, plus `'alias-removal-out-of-scope'` rows for target rows that are per-user (`user_id IS NOT NULL`) or secret, **gated on `latch.open`** so a latched replay writes nothing.
   - `mk` inserts `('alias_removal_rows_306', now(), 'system:config-migration-feature-306')` when `latch.open`; `nt` notifies each distinct `(namespace, environment)` of `d` with `pg_notify('config_changed', json_build_object('namespace', …, 'environment', …)::text)`; the final `SELECT (SELECT count(*) FROM d) AS deleted, (SELECT count(*) FROM nt) AS notified;`.
2. `…down.sql`: header as 046's down. CTE `mk` = `DELETE FROM config.config_markers WHERE name = 'alias_removal_rows_306' RETURNING set_at`; `ins` re-inserts from `config.config_values_premigration_296` joined to `config.config_keys_report_296 r ON r.run_at = mk.set_at AND r.action = 'alias-removal-row-deleted'` on `(namespace, key, environment)` with `s.user_id IS NULL AND s.snapshot_at >= r.run_at AND s.value_data IS NOT NULL`, `DISTINCT ON (namespace, key, environment) … ORDER BY … s.snapshot_at ASC`, `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`, `updated_by = 'system:config-migration-feature-306'`, `update_reason = 'feature 306: down restores an alias-removal row'`; then notify each restored `(namespace, environment)`.
3. Neither file issues `BEGIN`/`COMMIT`/`ROLLBACK` (golang-migrate wraps the file) and neither embeds a migration number in the actor (number-free, like 046).
4. No config key is added or retyped (Config Key Changes: none), so there is no seed/reader pairing; the three rows leave the gate's seed side in Step 10.

**Verification** (offline — no database, per `spec-template.md` § Migration step verification):
```
ls services/xstockstrat-config/migrations/047_config_alias_removal_rows.up.sql services/xstockstrat-config/migrations/047_config_alias_removal_rows.down.sql
! grep -n -i -E "^\s*(BEGIN|COMMIT|ROLLBACK)\s*;" services/xstockstrat-config/migrations/047_config_alias_removal_rows.*.sql
! grep -n -E "config-migration-[0-9]" services/xstockstrat-config/migrations/047_config_alias_removal_rows.*.sql
```
Then read both files and confirm the down inverts every effect of the up (rows, marker, notify) and filters on its own marker and action. Real apply/rollback is proven by CI `migration-rerun` (Step 9).

---

### Step 9 — test: migration-rerun pass 2e and the slug-named assertion file

**Status**: `pending`
**Service**: `xstockstrat-config`
**Files**:
- `scripts/migration-rerun.sh` — modify
- `scripts/migration-assertions/config-alias-removal-rows.sql` — create
- `scripts/migration-assertions/config-046.sql` — modify

**Reviewers**: Service owner `xstockstrat-config` — migration harness; DBA — migration proof

**Codebase Evidence**:
- Slug-glob discovery for 305: `scripts/migration-rerun.sh:79-95` (`for f in "$cfg_dir"/[0-9]*_config_dead_rows_prune.up.sql`, exactly-one check, `d_base`, `D_DOWN`, `d_actor`, `d_block` extracted with `sed -n '/dead_rows_305:begin/,/dead_rows_305:end/p' | sed '1d;$d'`); `cfg_top` `:96-102` auto-adapts to the new top version; fingerprint `d_fp` and the latched-replay no-op check `:466-482`; pass 2d `:484-557` (a: down `:506-513`; b: rolled-back unmatched sub-test `:515-541`; c: re-up `:543-557`); pass 3 header `:559`.
- Final assertion sweep: `scripts/migration-rerun.sh:657-669` runs every `$assertions/*.sql` once, skipping `fixtures-*` and numeric `config-N` files below R; a **slug-named** file (`config-alias-removal-rows.sql`, not digit-led after `config-`) therefore runs exactly once and is not caught by `config-[0-9]*` (`:661`, `config_pre_assertions` `:192-198`).
- `config-046.sql:68-80` is the AC-10 "kept key" block (existence half `:71-75`, audit-never half `:76-79`): it asserts `ledger/stream.notify_enabled` (staging) still exists and fails after 306 deletes it, because the final sweep runs it against the post-047 state.
- Marker consumers that stay valid: `migration-rerun.sh:302` (marker count of `relative_keys_v1` = 0 after a raised R) and `:671-677` (the `{"marker":"relative_keys_v1"}` NOTIFY comes from applied migration `044…up.sql:252`, not server code).
- Assertion style to copy: `scripts/migration-assertions/config-046.sql:1-54` (each count scoped to the current marker's `set_at`, `DO $$ … RAISE EXCEPTION '…'`).

**Lands with**: `Step 8, Step 10`

**TDD**: N/A (CI-only harness; proven on the draft PR) — the assertions are authored to fail on a tree without the migration

**Covers**: AC-6

**Instructions**:
1. `migration-rerun.sh`: after the 305 block (`:79-95`) add slug-glob discovery of exactly one `[0-9]*_config_alias_removal_rows.up.sql` (`a_base`, `A_DOWN`, `a_actor='system:config-migration-feature-306'`, `a_block` extracted between `alias_removal_306:begin/end`); same exactly-one failure check as the `d_count` test at `:87-90`. After the 305 replay check (`:466-482`) add the 306 latched-replay no-op check (render the 306 up with `render-migrations.sh` as at `:475-478`, apply with `psql -1`, require `d_fp` unchanged).
2. Add **pass 2e** after pass 2d (before `echo "==> pass 3`), modelled on `:484-557` and psql-applying the files directly (never `migrate goto`): record the report-row count for the current marker run (`alias-removal-row-deleted` with `run_at = set_at`) as `a_deleted` and the hash of every row outside the target pairs (copy pass 2d's `d_rest` shape, `:495-499`, joined on `(namespace, key)` and `user_id IS NULL`); (a) down: `a_deleted` rows come back, the marker clears, the restore is audited as `$a_actor` with `reason = 'feature 306: down restores an alias-removal row'`, rows outside the targets unchanged, and 305's rows are **not** restored; (b) in a `BEGIN … ROLLBACK` block insert a per-user `platform/log_level` row, `\i` the up, assert the global rows are deleted, the per-user row is still present and exactly one `alias-removal-out-of-scope` row exists for it (`run_at = now()`), and that no `unmatched-signed-tuple` row was written; afterwards rows and marker are as before; (c) re-up: new marker `set_at` later than the first, `a_deleted` `alias-removal-row-deleted` rows, the same number of snapshot rows (`snapshot_at >= set_at`) and `new_value IS NULL` audit rows, rows outside the targets unchanged. Add the counts' dependency on the fresh schema only through `a_deleted` — do not hard-code 5 in the shell.
3. `scripts/migration-assertions/config-alias-removal-rows.sql`: scoped to `v_set := (SELECT set_at FROM config.config_markers WHERE name = 'alias_removal_rows_306')`: (i) the marker is set by `system:config-migration-feature-306`; (ii) no live global non-secret `config.config_values` row for the three pairs (the `ListKeys` proof, as `config-046.sql` AC-1 does); (iii) report rows `alias-removal-row-deleted` in the run = snapshot rows = delete audit rows (`new_value IS NULL`, `old_value` kept), with `1 ≤ n ≤ 6` (the unique-index bound) — no literal count: the fresh-schema number (5 today) depends on `fixtures-pre-041.sql` and is only `RAISE NOTICE`d; (iv) no `unmatched-signed-tuple` row with `reason LIKE 'feature 306:%'`; (v) `alias-removal-out-of-scope` rows are reported, not asserted (`RAISE NOTICE`, like `config-046.sql:82-92`); (vi) 305's end state is intact (its marker `dead_rows_305` still present).
4. `config-046.sql:68-80`: drop the existence half (`IF NOT EXISTS (… 'stream.notify_enabled' … 'staging') THEN RAISE EXCEPTION 'AC-10: …kept'`), keep the audit-never half (the 305 migration never audited that key), and reword the `:68` comment to "AC-10: feature 305 never audits ledger/stream.notify_enabled".

**Verification** (execute host may lack Postgres; the proof is CI `migration-rerun` on the draft PR — F-05, design.md Unit B):
```
bash -n scripts/migration-rerun.sh
ls scripts/migration-assertions/config-alias-removal-rows.sql
! ls scripts/migration-assertions | grep -E "^config-0*47"          # slug-named, not number-named (no collision with 280 after a renumber)
```
CI gate (on the draft integration PR, not at step commit): `migration-rerun` green.

---

### Step 10 — test: Remove the baseline entries, regenerate the stored set, update the gate's real-tree tests

**Status**: `pending`
**Service**: `scripts/` (config-wiring baseline and stored set)
**Files**:
- `scripts/config-wiring.json` — modify
- `scripts/config-wiring-stored.json` — modify
- `scripts/config-wiring.test.mjs` — modify

**Reviewers**: Service owner `xstockstrat-config` — baseline owner, stored-set freshness

**Codebase Evidence**:
- `scripts/config-wiring.json:5-23` holds exactly three `feature 306` `seeded-unread` entries (`ledger/stream.notify_enabled`, `platform/log_level`, `trading/risk.daily_loss_limit`); the fourth entry (`trading/broker.paper`, owner `defect 2026-11-06-trading-broker-paper-env-derived-default-unseedable`, `:24-29`) is **not** 306's and stays.
- `scripts/config-wiring-stored.json` keys: `rows` (393) and `inputs_sha256`; the 5 rows to remove are `ledger/stream.notify_enabled` (staging), `platform/log_level` (production, staging), `trading/risk.daily_loss_limit` (production, staging). It is a pure function of the migrations; `JSON.stringify(JSON.parse(text), null, 4) + '\n'` reproduces the committed bytes exactly (verified at `17cc0ea`), so an offline edit is byte-exact. `inputs_sha256` is `storedInputsSha256(root)` (`check-config-wiring.mjs:225-230`) = sha256 over every file under `services/xstockstrat-config/migrations` plus `scripts/config-wiring-stored.sh`, so adding Step 8's files changes it. 305 precedent: the stored set carries no `analysis/opportunity.sparkline_bars` / `marketdata/alpaca.paper` row.
- CI proof: `.github/workflows/ci.yml:1058-1090` job `config-wiring-stored` regenerates the stored set on a scratch DB and fails on `git diff --exit-code scripts/config-wiring-stored.json`; its dry-run step (`config-heal-dryrun.sh --fresh`, migrates only to 41, `scripts/config-heal-dryrun.sh:84,163`) is unaffected.
- Tests: `baseline 3` `:621-625` filters out `seeded-unread` entries owned by `feature (305|306)` before comparing with `SWEEP_277` (`:607-619`); `dead 3` `:946-956` asserts `kept.length === 1` and `kept[0].owner === 'feature 306'` for `ledger/stream.notify_enabled`; `gate 7` `:561-579` (fixture-based, covers the `membership()` regex) and `baseline 1` `:585-588` (`--final` on the real tree exits 0).

**Lands with**: `Step 8, Step 9`

**TDD**: red-green required (the updated `dead 3` fails while the entries and rows are still present)

**Covers**: AC-6

**Instructions**:
1. `config-wiring.json`: delete the three `feature 306` entries (`:5-22`); keep the `trading/broker.paper` entry and everything else byte-identical.
2. `config-wiring-stored.json`: remove the 5 rows above, then set `inputs_sha256` to `storedInputsSha256('.')`. Preferred when `DATABASE_URL` points at a scratch Postgres: `bash scripts/config-wiring-stored.sh` (writes both). Offline equivalent (byte-exact, verified): a node one-off that parses the file, filters the rows, writes `JSON.stringify(obj, null, 4) + '\n'` with the new hash from `import('./scripts/check-config-wiring.mjs')`. The CI `config-wiring-stored` job is the final proof.
3. `config-wiring.test.mjs`: retitle `baseline 3` (its title still says "only its dead keys stay, as feature-305/306 seeded-unread") when dropping its exemption; `dead 3` → rewrite as "the three 306 entries and rows are gone": `seeded('ledger','stream.notify_enabled')`, `seeded('platform','log_level')`, `seeded('trading','risk.daily_loss_limit')` each `length === 0`, the 305 assertions (`:949-950`) kept, and `cli(REPO, '--final')` exits 0. `baseline 3` → drop the `!(seeded-unread && /^feature (305|306)$/)` exemption (compare against all baseline findings). Leave `gate 7`, `SWEEP_277` and `baseline 1` unchanged.
4. Not changed: `check-config-wiring.mjs` `membership()` (returns `[]` early with no 305/306 entries; the regex stays, fixture-tested by `gate 7`).

**Verification**:
```
node --test scripts/config-wiring.test.mjs
node scripts/check-config-wiring.mjs --final && node scripts/check-config-wiring.mjs --doc-check
node -e "const m=require('fs').readFileSync('scripts/config-wiring.json','utf8'); if(/feature 306/.test(m)) process.exit(1)"
```
CI gates (draft integration PR): `config-wiring-stored` and `migration-rerun` green.

---

### Step 11 — test: Pin the migration sha and record the operator rehearsal

**Status**: `pending` — OPERATOR-GATED (halt for the rehearsal counts; do not run unattended)
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/aliasRemovalRowsMigration.test.ts` — create
- `scripts/config-heal/signoff.md` — modify (append the 306 section after 305's)

**Reviewers**: Service owner `xstockstrat-config` — migration immutability (F-01); DBA — rehearsal evidence

**Codebase Evidence**:
- Pattern: `services/xstockstrat-config/src/__tests__/deadRowsMigration.test.ts:1-60` (`SIGNOFF_HEADING`, `SUFFIX = '_config_dead_rows_prune'`, `recordedSha()` parsing `^- Migration file sha256: \`…\``, tests: sha match, no `BEGIN/COMMIT/ROLLBACK`, not `contract-of`, number-free actor via `findOne(SUFFIX, ext)` from `./migrationSql`).
- `scripts/config-heal/signoff.md` headings (`grep -n "^# "`): 295 (`:1`), 296 (`:38`), 305 (`:68`); the 305 section's bullets include `Migration file sha256`, a rehearsal bullet and `operator: davcs86 — date: …`; 305's rehearsal scope was **DO dev only** (operator, 2026-11-10: DO production and both homelab databases have no running instance), and its "production" rows are `environment='production'` rows inside the DO dev and CI databases.
- Open question for the operator (P-03, do not guess): design.md calls for "production and staging rehearsal counts"; per the 305 precedent these are the two `environment` values on DO dev, not a production host. Confirm that reading before writing the section.

**TDD**: red-green required (the test fails until the 306 sign-off section exists)

**Covers**: AC-6

**Instructions**:
1. **Precondition (operator-run, not scriptable):** Step 8's up file is final; the operator rehearses it on DO dev following `docs/runbooks/operator-db-access.md` (`BEGIN`, `\i` of the exact up file, `ROLLBACK`, run twice) and supplies: rows deleted per environment (staging, production), the out-of-scope count, and the date. If these are not available, **block and ask**; do not invent counts.
2. Append `# Feature 306 — alias-removal row deletion` to `scripts/config-heal/signoff.md` **after** 305's section with bullets: `- Migration file sha256: \`<sha256 of the up file>\`` (compute with `shasum -a 256`), `- Rehearsal counts (DO dev, rolled back): staging deleted <n>, production deleted <n>, out-of-scope <n>`, the rehearsal procedure, and `- operator: davcs86 — date: <date>`.
3. `aliasRemovalRowsMigration.test.ts`, `SIGNOFF_HEADING = '# Feature 306 — alias-removal row deletion'`, `SUFFIX = '_config_alias_removal_rows'`: the up file's sha256 equals the recorded sha; neither file issues a transaction statement; the up is not `contract-of`; the actor is number-free; the recorded `staging` and `production` deleted counts are integers with `0 <= n <= 3` (one row per key per environment, three keys); the up file contains the three `(namespace, key)` pairs between `alias_removal_306:begin/end`.

**Verification**:
```
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage && pnpm exec c8 check-coverage --lines 40
node --test scripts/config-wiring.test.mjs
```
After this step the draft integration PR may be marked ready for review.

---

### Step 12 — docs: Apply the signed C-16 scenario edits and read-notes

**Status**: `pending`
**Service**: `docs/sdd/business-rules` and the per-service `acceptance/` suites
**Files**:
- `services/xstockstrat-ledger/acceptance/fix-config-keys-drift.feature` — modify (real edit, 295 @AC-15)
- `services/xstockstrat-ledger/acceptance/config-keys-relative-consumers.feature` — modify (real edit, 304 @AC-12)
- `services/xstockstrat-config/acceptance/fix-config-keys-drift.feature` — modify (amend existing read-notes, 295 @AC-34 and the `#`-comment block at the top)
- `services/xstockstrat-config/acceptance/fix-config-keys-contract.feature` — modify (new read-note header, 296 @AC-3/@AC-4/@AC-5)
- `services/xstockstrat-config/acceptance/config-dead-rows-prune.feature` — modify (new read-note, 305 @AC-1 scoped CHANGE)
- `services/xstockstrat-config/acceptance/fix-config-audit-author-spoof.feature` — modify (dated comment under the provenance header, 241 @AC-2)
- `services/xstockstrat-config/acceptance/signal-map-instrumentation.feature` — modify (dated comment under the provenance header, 294 @AC-54)
- `docs/sdd/business-rules/platform.feature` — modify (read-notes: 278 @AC-1, 278 @AC-7, 296 @AC-24 Then 1, 295 @AC-19, 295 @AC-25)

**Reviewers**: none

**Codebase Evidence**:
- Signed 2026-11-10 by davcs86 (`context.md` § "sdd-design: C-16 batch sign-off", verbatim): REAL EDITS for 295 @AC-15 and 304 @AC-12; DATED READ-NOTES (scenario text untouched) for 296 @AC-3/@AC-4/@AC-5, 295 @AC-34 (+ amend the line-11/13 notes), 241 @AC-2, 294 @AC-54, 295 @AC-25, `platform.feature` 278 @AC-1, 278 @AC-7, 296 @AC-24 Then 1, 295 @AC-19, and 305 @AC-1 scoped CHANGE. Those files carry "do not edit" headers; the notes are a hand edit the operator authorised.
- Anchors at `17cc0ea`: ledger `fix-config-keys-drift.feature:8-14` (@AC-15: Given "ledger"/"stream.notify_enabled" has no reader in any spelling; Then "… still exists"); `config-keys-relative-consumers.feature:7-17` (@AC-12: bound-test comment (c) `:11-12`, last Then `:17`); config `fix-config-keys-drift.feature:11,13` (the existing notes for 295 @AC-1/@AC-25 "canonicalised with a WARN" and @AC-34 "probe stays as dead code until feature 306"); `fix-config-keys-contract.feature:17,25,31` (@AC-3/@AC-4/@AC-5); `config-dead-rows-prune.feature:8` (@AC-1: "it is in the signed allowlist … ledger/stream.notify_enabled kept"); `fix-config-audit-author-spoof.feature:25-31` (241 @AC-2 quotes `platform.trading_state`); `signal-map-instrumentation.feature:30-35` (294 @AC-54); `platform.feature:797-802` (278 @AC-1 "form-mismatch", `:802`), `:842` (278 @AC-7 "18 form mismatches"), `:1440` (295 @AC-19 "owned by features 305 and 306"), `:1570-1571` (the existing 296 read-note), `:1601` (296 @AC-24 Then 1 "form-mismatch").

**TDD**: N/A (documentation of durable rules)

**Covers**: AC-6 (the clause "context.md records the C-16 sign-off for the edited scenarios of 295 @AC-15 and 304 @AC-12", checked by grep below)

**Instructions**:
1. **Real edits.** 295 @AC-15 (ledger): delete the Given line about "no reader in any spelling" and the first Then ("… still exists"); keep the read-key and read-coverage Thens; retitle the scenario to "Ledger records the runtime reads of its config keys" (the only wording choice beyond the signed text, because the old title says a dead row is kept). 304 @AC-12 (ledger): delete the last Then ("… stream.notify_enabled … is still kept") and the bound-test (c) comment lines that tie it to the baseline entry; tags and the remaining Thens unchanged.
2. **Read-notes** (comment lines only, scenario text untouched), each beginning `# 2026-11-10 (feature 306, operator-signed C-16, davcs86):`, stating: 296 @AC-3/@AC-4/@AC-5 — the alias, the write-time spelling tolerance and the poller canonicalisation are removed (a prefixed key is `INVALID_ARGUMENT`; the poller sends `trading_state`); 295 @AC-34 — superseded, the probe and ambiguity branch are removed (amend the existing `:11,:13` notes, replacing "stays as dead code until feature 306"); 241 @AC-2 — the quoted `platform.trading_state` is the display FQN, the request key is `trading_state`; 294 @AC-54 — a real CHANGE, the request key is `trading_state` (and the denial test now sends it); 295 @AC-25 — the grant matches the exact key `trading_state`; 305 @AC-1 — scoped CHANGE: feature 306 deletes `ledger/stream.notify_enabled`, `platform/log_level` and `trading/risk.daily_loss_limit` by key, without read-evidence or sha, by operator decision; `platform.feature` 278 @AC-1 and 296 @AC-24 Then 1 — the `form-mismatch` kind is removed (a prefixed seed read relative is `seeded-unread` plus `read-unseeded`), 278 @AC-7 — the "18 form mismatches" Given reads as "the 277-sweep entries", 295 @AC-19 — the 305/306-owned entries are closed (extend the existing `:1440` and `:1570-1571` notes to name 278 @AC-7 `:842` and 296 @AC-24 Then 1 `:1601`).
3. Do not touch PRESERVE scenarios (design.md § Business Rules Touched): 295 @AC-2/@AC-21/@AC-26/@AC-35, 296 @AC-6/@AC-8/@AC-10/@AC-22–@AC-24, 304 @AC-1/@AC-2/@AC-7/@AC-9–@AC-11/@AC-13/@AC-14, 305 @AC-2–@AC-6.

**Verification**:
```
! grep -n -E "still exists|still kept" services/xstockstrat-ledger/acceptance/fix-config-keys-drift.feature services/xstockstrat-ledger/acceptance/config-keys-relative-consumers.feature   # the kept-row assertions are gone
grep -n "feature 306, operator-signed C-16" services/xstockstrat-config/acceptance/*.feature docs/sdd/business-rules/platform.feature
grep -n "C-16 batch sign-off" docs/roadmap/features/306-config-keys-alias-removal/context.md
grep -n -i "delete all three rows" docs/roadmap/features/306-config-keys-alias-removal/context.md   # the operator's delete decision (AC-6)
node scripts/check-config-wiring.mjs --doc-check
```

---

### Step 13 — docs: Contract documents, findings, runbook and merge-order

**Status**: `pending`
**Service**: `docs/`
**Files**:
- `docs/patterns/config-governance.md` — modify
- `docs/context-constitution.md` — modify
- `services/xstockstrat-config/docs/context-constitution.md` — modify
- `services/xstockstrat-config/CLAUDE.md` — modify
- `services/xstockstrat-trading/CLAUDE.md` — modify
- `services/xstockstrat-ledger/CLAUDE.md` — modify
- `docs/context-constitution-findings.md` — modify
- `services/xstockstrat-config/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-trading/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-ledger/docs/context-constitution-findings.md` — modify
- `docs/runbooks/config-rollout.md` — modify
- `docs/roadmap/features/merge-order.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `docs/patterns/config-governance.md:42` (`platform.log_level` row), `:77` (`form-mismatch` row in the finding-kind table), `:158-162` (feature 305 entry: "`ledger` / `stream.notify_enabled` is kept … owned by feature 306").
- `docs/context-constitution.md:52` PLAT-14 ("its alias", "a prefixed seed read relative stays a `form-mismatch`"); `services/xstockstrat-config/docs/context-constitution.md:25` CONFIG-8 (an `until feature 306` clause) and `:26` CONFIG-9 ("shipped the dormant alias … activated the alias … `withLegacyAliases`, marker `relative_keys_v1` … canonicalised with a WARN until feature 306 … owned by features 305 and 306"). `--doc-check` requires the CONFIG-9 row (`| **CONFIG-9** |`) and the whole `config-governance.md` to keep the sentences "the stored key is namespace-relative", "every read key is seeded", "the fqn is display-only" (`check-config-wiring.mjs:858-866`, `DOC_RULE_SENTENCES`), and bans `/via the alias until/i`, `/cutover in feature 296/i` etc. in the root `CLAUDE.md`, `config-rollout.md` and every `services/*/CLAUDE.md`.
- `services/xstockstrat-config/CLAUDE.md` invariant 7 (the poller grant is described as writing `platform.trading_state`; the grant key is now the exact relative key `trading_state`); `services/xstockstrat-trading/CLAUDE.md:99` (`risk.daily_loss_limit` row "Documented, not yet implemented"); `services/xstockstrat-ledger/CLAUDE.md:81` (`stream.notify_enabled` row "Documented, not yet enforced").
- Findings: `docs/context-constitution-findings.md:49` (19 inert rows, mentions the `form-mismatch` baseline); `services/xstockstrat-config/docs/context-constitution-findings.md:25` (`lookupScalarBounds` probing both spellings — now only `${namespace}.${key}`); `services/xstockstrat-trading/docs/context-constitution-findings.md:43,57` (`trading.risk.daily_loss_limit` finding); `services/xstockstrat-ledger/docs/context-constitution-findings.md:30` (`ledger.stream.notify_enabled` among 3 documented keys).
- `docs/runbooks/config-rollout.md:222-223` ("the alias also lists the prefixed spelling until feature 306") and `:277-279` (rollback-to-295 wording about the alias); `docs/roadmap/features/merge-order.md` rows 31 (306 ↔ 304/296) and 125 (305 ↔ 306 ↔ 280).
- `docs/runbooks/mcp-tools.md` needs no edit (confirmed in Step 6).

**TDD**: N/A (documentation)

**Covers**: —

**Instructions**:
1. `config-governance.md`: delete the `platform.log_level` row (`:42`) and the `form-mismatch` kind row (`:77`); in the feature 305 entry replace the "kept (a documented future key …)" sentence (`:160-162`) with a pointer to feature 306, and add a **feature 306** entry to the Per-Feature Registered Keys log in the 305 style: three keys deleted by migration `config_alias_removal_rows` (names the three pairs, predicate delete, snapshot + audit, reversible down, rehearsal in `scripts/config-heal/signoff.md`), no new keys, approval owner + config team.
2. PLAT-14, CONFIG-8 and CONFIG-9 (CONFIG-8 at `services/xstockstrat-config/docs/context-constitution.md:25` also carries an `until feature 306` clause): remove "alias", "dormant alias", `withLegacyAliases`, "canonicalised with a WARN until feature 306" and the "stays a `form-mismatch`" clause; state the final contract (one served spelling; a prefixed key is `INVALID_ARGUMENT` for every caller, including the reconciliation poller; the gate has no `form-mismatch` kind; the 305/306 remainder is closed). Preserve the three rule sentences in the CONFIG-9 row and keep the C-05 row of `docs/sdd/constitution.md` untouched (it has no alias text).
3. `services/xstockstrat-config/CLAUDE.md` invariant 7: the poller grant is `{callerID: trading-reconciliation-poller, namespace: platform, key: trading_state}`, matched by exact equality, `REDUCE_ONLY`/`HALTED` only. Trading `CLAUDE.md:99` and ledger `CLAUDE.md:81`: delete the two rows (the rows are deleted by migration `config_alias_removal_rows`; the "no code reads this key" note moves to the findings files).
4. Findings files: mark the 306-closed items resolved/removed (the trading `daily_loss_limit` finding becomes "key and row deleted by feature 306; intended halt not implemented"; the ledger `stream.notify_enabled` item likewise; the config `lookupScalarBounds` note now reflects single-spelling probing; the root `:49` entry drops the `form-mismatch` baseline wording).
5. `config-rollout.md`: reword `:222-223` to drop the alias clause ("lists the key (namespace-relative)"); update the rollback-to-295 paragraph (`:277-279`) to say the alias no longer exists after feature 306; add a **rollback asymmetry** note (design.md Open Risk): consumer images older than 304 against the 306 config server read prefixed keys as code defaults and a pre-304 poller gets `INVALID_ARGUMENT` (logged at WARN only, `trading.go:2279`, while the CRITICAL alert still says REDUCE_ONLY was applied); rolling the config image back to pre-306 is safe; running the migration down without reverting code leaves the gate red; re-check Step 1's trading-image ancestry before any consumer rollback.
6. `merge-order.md`: in the 306 row (31) and the 305 ↔ 306 ↔ 280 row (125) name `src/__tests__/dormantAlias.test.ts` as a shared test file and record that the `047` owner is whichever of 306/280 merges first (306's files are slug-named; a renumber is 3 renames plus a stored-set regeneration).
7. Keep `node scripts/check-config-wiring.mjs --doc-check` green.

**Verification**:
```
node scripts/check-config-wiring.mjs --doc-check
node --test scripts/config-wiring.test.mjs
! grep -rn -i -E "withLegacyAliases|dormant alias|via the alias|until feature 306" docs/patterns/config-governance.md docs/context-constitution.md services/xstockstrat-config/docs/context-constitution.md services/xstockstrat-config/CLAUDE.md services/xstockstrat-trading/CLAUDE.md docs/runbooks/config-rollout.md
grep -n "dormantAlias" docs/roadmap/features/merge-order.md
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
