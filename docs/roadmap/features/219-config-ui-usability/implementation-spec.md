# Implementation Spec: config-ui-usability

**Status**: `in-progress`
**Created**: 2026-10-02
**Feature**: `docs/roadmap/features/219-config-ui-usability/feature.md`
**Total Steps**: 13
**Feature Branch**: `ccr-8a11e328-8tlo4j` (the harness-assigned development branch, declared as
this feature's Development Branch). Execution runs in `/sdd-execute sequential` mode: one commit per
step on this branch, no per-step PRs, and PR #1207 → `main-dev` as the single integration PR (F-03).

---

## Execution Summary

The backend contract lands first. Step 1 adds `ConfigKeyMeta.updated_at = 10`, Step 2 regenerates
the stubs, and Steps 3–4 make `ListKeys` select and map it from the resolved `DISTINCT ON` row.
Everything in the UI depends on the regenerated `ConfigKeyMeta` type. Step 5 then lays the e2e test
data: protobuf-es-generated stub bodies, plus one shared row with a static `updatedAt`.

The UI follows in three service→test pairs, so each red-before-green gate is scoped:

- **Steps 6–7 (FR-1/FR-2).** The shared namespace module, the server `ConfigNamespaceView` and the
  client `NamespaceSelect`, on both routes.
- **Steps 8–9 (FR-2 / C-10).** The breadcrumb plain-span branch, the audit crumb relabel, and
  Settings › Config highlighting on namespace pages.
- **Steps 10–12 (FR-3/5/6/7).** The `NamespaceEditor` refactor (module-scope cells + `EditContext`
  focus fix, description under the key, Updated column), then its focus specs and its row specs.

Step 13 reconciles the context docs whose cites or coverage rows this feature changes (the
CLAUDE.md teardown rule).

**Consumer surface (C-14).** The UI segment `/config-ui` consumes `updatedAt` in Steps 10 and 12.
The Agent MCP `list_config_keys` tool is **unchanged by decision**: product spec § Out of Scope, and
it maps fields explicitly at `services/xstockstrat-agent/app/client.py:1947-1974`. That is a scoping
decision, not an omission.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-1` landing shows platform table + Namespace combobox, no grid | Step 7 |
| `@AC-2` Select navigates, preserves `env` + `user` | Step 7 |
| `@AC-3` deep link pre-selects namespace | Step 7 |
| `@AC-4` description clamped under key with title, no Description header (375px) | Step 12 |
| `@AC-5` empty description renders no element | Step 12 |
| `@AC-6` per-user row's `updated_at` in user scope | Step 4 |
| `@AC-7` secret row: `[redacted]` + `updated_at` | Step 4 |
| `@AC-8` last-updated cell with ISO title | Step 12 |
| `@AC-9` no `updatedAt` → `—` | Step 12 |
| `@AC-10` typing a reason keeps focus in reason | Step 11 |
| `@AC-11` typing a value keeps focus + same DOM node | Step 11 |
| `@AC-12` save refreshes value + last-updated without reload | Step 12 |
| `@AC-13` global row's `updated_at` in global scope | Step 4 |
| `@AC-14` namespace page header + non-link breadcrumb | Step 9 |

## Step Dependencies

- Step 2 requires Step 1: stubs are regenerated from the edited `.proto`.
- Step 3 requires Step 2: `listKeys` returns `updatedAt`, which the ts-proto `ConfigKeyMeta`
  encoder only writes once the field exists (`useDate` default → JS `Date`).
- Step 4 [test] covers Step 3 [service] (C-08). Its RED run is taken against the post-Step-2 /
  pre-Step-3 tree.
- Step 5 requires Step 2: the shared fixture row's `updatedAt` and the
  `ListKeysResponseSchema`/`SetConfigResponseSchema` stub helpers type-check only against the
  regenerated `config_pb`.
- Step 6 requires Step 5 only for the spec in Step 7 (AC-3 uses the stub helper).
- Step 7 [test] covers Step 6 [service].
- Step 8 requires Step 6: `navGroups.tsx` imports `KNOWN_NAMESPACES` from the module Step 6 creates.
- Step 9 [test] covers Step 8 [service].
- Step 10 requires Steps 2 and 6: it uses the generated `ConfigKeyMeta` row type, and is rendered
  by `ConfigNamespaceView`. It also touches `NamespaceEditor.tsx`, which Step 8 already edited (the
  breadcrumb items), so it runs after Step 8.
- Steps 11 and 12 [test] cover Step 10 [service]. Step 12 also needs Step 5's fixtures.
- Step 13 [docs] runs last: it reconciles line cites against the final tree.
- **Feature 217** (`implementation-ready`) also regenerates `packages/proto/gen`. Whichever PR
  merges second re-runs `./scripts/buf-gen.sh` on the merged tree before merging (design.md § Open
  Risks).

---

### Step 1 — proto: add `ConfigKeyMeta.updated_at = 10`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/config/v1/config.proto` — modify

**Reviewers**:
- Proto Reviewer — field number uniqueness per message, no breaking changes, `buf lint` +
  `buf breaking` pass.
- `packages/proto` owner — field number uniqueness, backward compatibility.
- `xstockstrat-config` owner — environment / global-per-user scoping, secret redaction.
- `xstockstrat-ui` owner — environment scope correctness, no secret values rendered.

**Codebase Evidence**:
- `grep -n "message ConfigKeyMeta\|current_value = 9" packages/proto/config/v1/config.proto` → `:154`,
  `:167`. Fields 1–9 are used, so 10 is the next free number. Every field after `:157` carries a
  preceding `//` comment (`:156-158`, `:165-166`).
- `import "google/protobuf/timestamp.proto";` is at `:7`. Existing Timestamp fields to mirror:
  `ConfigSnapshot.updated_at = 3` (`:52`) and `SetConfigResponse.updated_at = 2` (`:140`).
- `.github/workflows/ci.yml:106-126`: CI runs `buf lint packages/proto/` and
  `buf breaking . --against "../../.git#branch=origin/<base>,subdir=packages/proto"` from
  `packages/proto`.

**TDD**: `N/A (proto — non-code-bearing; behavior is proven by Step 4)`

**Covers**: —

**Instructions**:
1. In `message ConfigKeyMeta`, after `string current_value = 9;` (`:167`), add:
   ```proto
   // updated_at of the resolved row (the caller's per-user override when one exists, else global).
   google.protobuf.Timestamp updated_at = 10;
   ```
2. Change nothing else. The Timestamp import already exists.

**Verification**:
```bash
cd packages/proto && buf lint && \
  buf breaking . --against "../../.git#branch=feature/config-ui-usability,subdir=packages/proto"
```
`feature/config-ui-usability` does not exist in this harness session (context.md). Use CI's PR
baseline instead and record the substitution in the Deviation Log:
`buf breaking . --against "../../.git#branch=origin/main-dev,subdir=packages/proto"`.
Pass condition: both commands exit 0. The additive field is non-breaking.

---

### Step 2 — proto-gen: regenerate stubs for `config/v1`

**Status**: `done`
**Service**: `packages/proto`
**Files**:
- `packages/proto/gen/go/config/v1/config.pb.go` — modify
- `packages/proto/gen/python/config/v1/config_pb2.py` — modify
- `packages/proto/gen/ts/config/v1/config.ts` — modify
- `packages/proto/gen/ts/config/v1/config_pb.ts` — modify
- `packages/proto/gen/ts/dist/config/v1/config.js` — modify
- `packages/proto/gen/ts/dist/config/v1/config.d.ts` — modify
- `packages/proto/gen/ts/dist/config/v1/config_pb.js` — modify
- `packages/proto/gen/ts/dist/config/v1/config_pb.d.ts` — modify
- (any other tracked `packages/proto/gen/**/config/v1/` file whose regenerated content changes,
  e.g. `config_grpc.pb.go` — enumerate it in the commit; anything outside `config/v1` is reverted)

**Reviewers**: inherited from Step 1. Proto Reviewer, `packages/proto` owner,
`xstockstrat-config` owner, `xstockstrat-ui` owner.

**Codebase Evidence**:
- `ls scripts/buf-gen.sh` exists. Root CLAUDE.md § Generating Proto Stubs: it generates TS, Python
  and Go stubs and compiles the TS package.
- `ls packages/proto/gen/ts/config/v1/` lists `config.ts` (ts-proto, used by
  `xstockstrat-config`), `config_pb.ts` (protobuf-es, used by `xstockstrat-ui`) and
  `config_connect.ts`.
- `packages/proto/buf.gen.yaml:23-31`: ts-proto opts `useOptionals=messages`, `stringEnums=true`.
  `useDate` is unset, so Timestamp maps to `Date | undefined`.
- Ledger `fails.md` 2026-09-24 and `insights.md` (feature 154): on the host-native codegen path,
  unrelated stubs drift (tab↔space comments, re-emitted `google/protobuf/*` doc comments). Scope
  the commit to the intended subtree.

**TDD**: `N/A (proto-gen — generated code)`

**Covers**: —

**Instructions**:
1. Run `./scripts/buf-gen.sh` from the repo root.
   - If Docker is unavailable, follow `docs/runbooks/codegen-toolchain-host-setup.md` (pinned
     `Dockerfile.codegen` versions).
2. `git diff --stat packages/proto/gen/` must be limited to `config/v1` artifacts. Revert any
   drift elsewhere with `git checkout -- <path>`.
3. Commit the `.proto` source (Step 1) and the regenerated stubs together (proto-versioning
   runbook).

**Verification**:
```bash
./scripts/buf-gen.sh && git diff --stat packages/proto/gen/ | grep -v "config/v1" ; \
  git diff --stat packages/proto/gen/ts/config/v1/config_pb.ts packages/proto/gen/ts/config/v1/config.ts
```
Pass conditions:
- The first pipeline prints only the summary line, so no non-`config/v1` files changed.
- Both generated TS source files show a non-empty diff.
- Generated files are inspected only to confirm the field landed (CLAUDE.md: never read them for
  design).

---

### Step 3 — service: `ListKeys` selects and maps `updated_at`

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-config` owner — environment (`production`/`staging`) /
global-per-user scoping, secret encryption + redaction.

**Codebase Evidence**:
- `listKeys` is at `configServiceImpl.ts:511-556`.
  - The SELECT at `:517-521` is
    `SELECT DISTINCT ON (key) key, description, default_value, value_data, is_secret, consuming_service, environment FROM config.config_values WHERE namespace = $1 AND environment = $2 AND (user_id IS NULL OR user_id = $3) ORDER BY key, (user_id = $3) DESC NULLS LAST`.
  - The row mapping is at `:524-551`. The secret redaction is at `:536`:
    `currentValue: secret ? REDACTED : (r.value_data ?? '')`.
- Timestamp precedent: `updatedAt: new Date()` at `:176`, `:199` and `:505`. The ts-proto encoder
  takes a JS `Date`.
- Schema: `config_values.updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` (recon.md, migration
  `001_config_tables.up.sql:19`). Last migration is `030`; no migration is needed (F-01).

**TDD**: `red-green required` (RED = Step 4 against the pre-Step-3 tree)

**Covers**: —

**Instructions**:
1. Add `updated_at` to the SELECT column list at `:517-518`:
   `key, description, default_value, value_data, is_secret, consuming_service, environment, updated_at`.
   - Keep it inside the same `DISTINCT ON (key)` select, so the timestamp is the resolved row's
     (per-user wins via the unchanged `ORDER BY`).
   - Do not touch the WHERE or ORDER BY.
2. In the returned object (`:529-549`), add `updatedAt: r.updated_at ?? undefined,`. This leaves
   the field unset when the column is absent or null, never `new Date(undefined)`.
3. Leave the redaction branch at `:536` and the validation block unchanged.
   - PRESERVE `@AC-3 @feature-147`.
   - PRESERVE `@AC-8 @feature-161` (the key set is unchanged).

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && grep -n "updated_at\|updatedAt: r.updated_at" src/grpc/configServiceImpl.ts
```
Pass conditions: lint passes, and `grep` shows the column in the listKeys SELECT and the mapping
line. Behavior is proven by Step 4.

---

### Step 4 — test: `ListKeys` `updatedAt` over a real gRPC connection

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/listKeysUpdatedAt.test.ts` — create

**Reviewers**: `xstockstrat-config` owner — environment / global-per-user scoping, secret redaction
at the ListKeys edge.

**Codebase Evidence**:
- grpc-js round-trip harness: `src/__tests__/listKeysWire.test.ts:24-73`. It uses
  `new grpc.Server()` + `createConfigServiceDefinition()` + `new ConfigServiceImpl(pool)`,
  `bindAsync('127.0.0.1:0')`, and a client from
  `await import('@xstockstrat/proto/config/v1/config')`.
- SQL-capture pool pattern: `src/__tests__/listKeysCurrentValue.test.ts:41-50`
  (`query: async (sql) => { if (sql.includes('FROM config.config_values') && sql.includes('SELECT')) lastListKeysSql = sql; … }`).
- Per-user preference is already guarded by `listKeysDedup.test.ts:62-71`
  (`ORDER BY key, (user_id = $3) DESC`).
- Commands: `package.json:12-14`. `test` is `tsc && node --test dist/__tests__/*.test.js`, and
  `test:coverage` runs c8 with `--lines 40`.

**TDD**: `red-green required`. RED: every `updatedAt` assertion fails before Step 3, because the
field is never set and decodes as `undefined`, and the SQL lacks `updated_at`.

**Covers**: `AC-6, AC-7, AC-13`

**Instructions**:
Create `listKeysUpdatedAt.test.ts` on the `listKeysWire` harness. Its pool `query(sql, params)`
captures the listKeys SQL and **emulates the `DISTINCT ON` resolution by `$3`**: it returns the
per-user row when `params[2] === 'u-123'`, else the global row. Test cases:

1. **The SELECT reads `updated_at` from the resolved row.** Assert that `updated_at` appears
   between `SELECT DISTINCT ON (key)` and `FROM config.config_values`:
   `/SELECT DISTINCT ON \(key\)[\s\S]*updated_at[\s\S]*FROM config\.config_values/`.
   - This is the SQL-shape proof for AC-6/AC-13 (design.md § 7). A mocked pool cannot execute
     `DISTINCT ON`, and `listKeysDedup.test.ts` guards the ORDER BY.
2. **AC-6.** Call `listKeys({namespace:'platform', environment:'ENVIRONMENT_STAGING', userId:'u-123'})`.
   The `platform.trading_state` entry's `updatedAt.toISOString()` equals
   `'2026-09-15T08:30:00.000Z'`. The pool returns the per-user row (`updated_at: new Date('2026-09-15T08:30:00Z')`).
3. **AC-13.** Same call with `userId: ''`. The entry's `updatedAt` is `'2026-09-01T10:00:00.000Z'`
   (the global row).
4. **AC-7.** A secret row `marketdata.alpaca.api_key` (`is_secret: true`,
   `value_data: '[redacted]'`, `updated_at: new Date('2026-09-20T12:00:00Z')`), queried with
   namespace `marketdata`, returns `currentValue === '[redacted]'` and
   `updatedAt.toISOString() === '2026-09-20T12:00:00.000Z'`.
5. **Absent column.** A row with no `updated_at` property returns `updatedAt === undefined`, not
   Invalid Date.

Test data (C-13): these rows have **one consumer** (this file), so they stay inline. No
`src/__tests__/fixtures/` home is created.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage
grep -n "__tests__/fixtures" src/__tests__/listKeysUpdatedAt.test.ts   # expect no match: single-consumer inline is compliant
```
Pass conditions: all suites pass, including the existing `listKeysWire`/`listKeysDedup`/
`listKeysCurrentValue`, and c8 reports ≥ 40% lines.

---

### Step 5 — test: e2e config-key fixtures (stub-body helpers, stub rows, shared `updatedAt`)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/configKeys.ts` — modify
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, environment scope correctness, no
secret values rendered in UI.

**Codebase Evidence**:
- `CONFIG_KEY_FIXTURES` is at `e2e/fixtures/configKeys.ts:44-135`. Its `platform.log_level` row is
  at `:45-53`.
- `e2e/mock-backend.ts:1293-1296` spreads each row into the `connectNodeAdapter` `listKeys`
  return, which is the create/init shape. The `setConfig` stub's Timestamp uses the init shape
  `{ seconds: BigInt(0), nanos: 0 }` (`:1302`).
- `e2e/fixtures/index.ts:27` re-exports `./configKeys`. The INVENTORY rows are at
  `INVENTORY.md:36-37`.
- `timestampFromDate` from `@bufbuild/protobuf/wkt` is already used in `src`
  (`src/hooks/useSignalAttribution.ts:2`). `@bufbuild/protobuf` is `^2.0.0` (`package.json:23`).
  The UI client imports `config_pb` types (`hooks/useConfigKeys.ts:3`).
- `tsconfig.json` targets `ES2017` and includes `**/*.ts` (so e2e is type-checked). Use
  `BigInt(...)`, not `0n`.
- Ledger traps:
  - `fails.md:677-679`: hand-written Connect-JSON gets enums and timestamps wrong.
  - `fails.md` 2026-08-31 (feature 167): a raw `page.route` body must already be Connect-JSON;
    Timestamp is an RFC3339 string.
  - Both are answered by generating bodies with `toJson(create(...))` (design.md § 7).

**TDD**: `N/A (test data only — no behavior. Consumed and exercised by Steps 7, 9, 11, 12)`

**Covers**: — (fixture-only; scenarios are asserted in Steps 7/11/12)

**Instructions**:
1. **Shared row.** Add
   `updatedAt: timestampFromDate(new Date('2026-09-01T10:00:00Z'))` to the `platform.log_level`
   row of `CONFIG_KEY_FIXTURES`.
   - Use the init shape, because the row is spread into the mock's create-shaped `listKeys`.
   - The mock's `setConfig` only writes `configValueOverrides`, so this timestamp stays static and
     is race-free under `fullyParallel`.
2. **Stub-body helpers.** Add two exported helpers:
   - `listKeysStubBody(keys: MessageInitShape<typeof ConfigKeyMetaSchema>[]): string`, which
     returns `JSON.stringify(toJson(ListKeysResponseSchema, create(ListKeysResponseSchema, { keys })))`;
   - `setConfigStubBody(): string`, which does the same for `SetConfigResponseSchema` with
     `{ version: '1' }`.
   - Import `create`, `toJson` and `type MessageInitShape` from `@bufbuild/protobuf`, and the
     `*Schema` symbols from `@xstockstrat/proto/config/v1/config_pb`.
   - If `ListKeysResponseSchema`, `SetConfigResponseSchema` or `ConfigKeyMetaSchema` is not
     exported, block the step (F-04). Do not hand-write JSON.
3. **Stub rows.** Add `CONFIG_KEY_STUB_ROWS`, scenario rows for the `page.route` specs, in
   init shape:
   - `trading.risk.max_position_pct`, with a non-empty description (AC-3; a real seeded key);
   - `marketdata.fmp.metrics`, description `'Comma-separated metric tiers to fetch (core, extended)'`
     (AC-4);
   - `marketdata.fmp.enabled`, description `''` (AC-5);
   - `platform.trading_state`, `currentValue: 'ACTIVE'`,
     `updatedAt: timestampFromDate(new Date('2026-09-15T08:30:00Z'))` (AC-8, AC-10, AC-11);
   - `platform.example`, with no `updatedAt` (AC-9).
   - `environment` uses `Environment.STAGING` from `@xstockstrat/proto/common/v1/common_pb`.
4. **INVENTORY.md.**
   - Update row `:37` (`CONFIG_KEY_FIXTURES`): the `platform.log_level` row carries a static
     `updatedAt` (feature 219).
   - Add a row for `listKeysStubBody` / `setConfigStubBody` / `CONFIG_KEY_STUB_ROWS`
     (`e2e/fixtures/configKeys.ts`, `xstockstrat.config.v1.ListKeysResponse`/`SetConfigResponse`/
     `ConfigKeyMeta`), with consumers `e2e/config-ui/{namespace-nav,namespace-editor-rows,edit-focus}.spec.ts`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit && pnpm run lint
grep -n "listKeysStubBody\|CONFIG_KEY_STUB_ROWS" e2e/fixtures/INVENTORY.md
```
Pass conditions: the type check passes (it proves the init shape against the regenerated
`config_pb`), and the INVENTORY row is present.

---

### Step 6 — service: shared namespace module, `ConfigNamespaceView`, `NamespaceSelect` on both routes

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/configNamespaces.ts` — create
- `services/xstockstrat-ui/src/app/config-ui/ConfigNamespaceView.tsx` — create
- `services/xstockstrat-ui/src/app/config-ui/NamespaceSelect.tsx` — create
- `services/xstockstrat-ui/src/app/config-ui/page.tsx` — modify
- `services/xstockstrat-ui/src/app/config-ui/[namespace]/page.tsx` — modify
- `services/xstockstrat-ui/src/app/config-ui/ScopeControl.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, environment (`production`/`staging`)
scope correctness, no secret values rendered in UI.

**Codebase Evidence**:
- **`config-ui/page.tsx`**
  - `KNOWN_NAMESPACES` at `:10-21`; `nsHref` at `:25-30`; missing-env redirect at `:34-36`.
  - Env clamp at `:39`; `resolveConfigScope` at `:41`; `getNativeConfigEnv()` at `:42`.
  - Heading "Configuration Namespaces" at `:48`; `EnvSwitcher` + `ScopeControl` at `:53-54`;
    card grid at `:57-68`.
  - `EnvSwitcher` at `:73-117`. Its hard-coded `href={`/config-ui?env=${e}${userQuery}`}` is at
    `:93`. It uses plain `Link`/`Badge` per the Radix-Tabs role comment at `:86-87`.
- **`[namespace]/page.tsx:10-21`** duplicates the env clamp (`:14`), `resolveConfigScope`
  (`:17`, `selfUserId` dropped) and `getNativeConfigEnv` (`:18`), then renders
  `<NamespaceEditor namespace env user nativeEnv />` (`:20`).
- **`ScopeControl.tsx:12-29`** takes `basePath = '/config-ui'` (`:16`), and `go()` builds
  `URLSearchParams({ env })` + `router.push(`${basePath}?…`)` (`:25-29`).
- **`scope.ts:11-19`** holds `resolveConfigScope`, which returns `{ selfUserId, user }`.
- **Select pattern.** `components/insights/StrategyPicker.tsx:33-44` uses `<Select value
  onValueChange>` + `<SelectTrigger className="h-8 w-56" aria-label={ariaLabel}>` + `SelectItem`s.
  `ui/select.tsx` exports `Select…SelectValue` (`:174-185`), and `SelectTrigger` spreads `...props`.
- **`NamespaceEditor`** reads `useSetConfig(namespace, env, user)` (`NamespaceEditor.tsx:67`), whose
  mutation state is per-instance (`hooks/useSetConfig.ts:9-10`).
- **Ledger traps.**
  - `fails.md` 2026-08-09: a Radix role-asserting primitive must not wrap `<Link>`s, so the
    EnvSwitcher stays `Link`/`Badge`.
  - `e2e/config-ui/env-mode-switcher.spec.ts:25,36` asserts `getByRole('link', …)`.

**TDD**: `red-green required` (RED = Step 7 specs against the pre-Step-6 tree)

**Covers**: —

**Instructions**:
1. **`src/lib/configNamespaces.ts` (new).**
   - Export `KNOWN_NAMESPACES`, moved verbatim from `page.tsx:10-21` (same order).
   - Export `configUiHref(basePath: string, env: string, user: string): string`, generalised from
     `nsHref`. It builds `URLSearchParams({ env })`, sets `user` only when non-empty, and returns
     `${basePath}?${params}`.
2. **`ScopeControl.tsx`.** Replace the body of `go()` (`:25-29`) with
   `router.push(configUiHref(basePath, env, nextUser))`. The props are unchanged.
3. **`ConfigNamespaceView.tsx` (new, async server component).**
   - Props: `{ namespace: string; basePath: string; rawEnv?: string; rawUser?: string }`.
   - It owns the env clamp (`rawEnv === 'production' ? 'production' : 'staging'`),
     `resolveConfigScope(rawUser ?? '')` and `getNativeConfigEnv()`.
   - Render a header row (`flex flex-wrap items-center gap-4`), in order:
     1. `<h1 className="text-lg font-semibold">Configuration</h1>`;
     2. `EnvSwitcher`, moved verbatim from `page.tsx:73-117` into this file, with its `Link`
        `href` built by `configUiHref(basePath, e, user)`. Keep the `:86-87` constraint comment and
        the `Link`/`Badge` markup;
     3. `<ScopeControl env user selfUserId basePath={basePath} />`;
     4. `<NamespaceSelect namespace env user />`.
   - Below the header, render
     `<NamespaceEditor key={`${namespace}|${env}|${user}`} namespace env user nativeEnv />`.
   - Add a ≤2-line comment on the `key`: it must change with namespace/env/scope, so an open draft
     can never Save into a different scope.
4. **`NamespaceSelect.tsx` (new, `'use client'`).**
   - Render a controlled `Select` with `value={namespace}` and
     `onValueChange={(ns) => router.push(configUiHref(`/config-ui/${ns}`, env, user))}`.
   - Use `<SelectTrigger className="h-8 w-48" aria-label="Namespace">` and `SelectValue`.
   - Options are `SelectItem`s over `KNOWN_NAMESPACES`. When `namespace` is not in the list, append
     it as an extra item so the trigger never renders blank. There are no `<Link>`s inside.
5. **`config-ui/page.tsx`.**
   - Keep the missing-env redirect (`:34-36`). Do **not** redirect to `/config-ui/platform`
     (design.md § Rejected Alternatives).
   - Then return `<ConfigNamespaceView namespace="platform" basePath="/config-ui" rawEnv=… rawUser=… />`.
   - Delete `KNOWN_NAMESPACES`, `nsHref`, the grid, the "Configuration Namespaces" heading and copy,
     the `EnvSwitcher` (moved), and the now-unused imports (`Card`, `CardContent`, `Badge`, `cn`,
     `Link`, `ScopeControl`, `resolveConfigScope`, `getNativeConfigEnv`).
6. **`[namespace]/page.tsx`.** Return
   `<ConfigNamespaceView namespace={namespace} basePath={`/config-ui/${namespace}`} rawEnv=… rawUser=… />`.
   As today, there is no env redirect. Drop the now-unused imports.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm run lint:dup
grep -rn "KNOWN_NAMESPACES = \[" src e2e   # exactly one hit: src/lib/configNamespaces.ts
grep -n "config-ui?env=" src/app/config-ui/page.tsx src/app/config-ui/ConfigNamespaceView.tsx   # only the redirect at page.tsx
```
Pass conditions: lint, type check and jscpd pass, there is one `KNOWN_NAMESPACES` declaration, and
no hard-coded `/config-ui?env=` link remains in the header. Behavior is proven by Step 7.

---

### Step 7 — test: namespace Select, deep link, query preservation, scope remount

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/config-ui/namespace-nav.spec.ts` — modify (rewrite; not deleted)

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, environment scope correctness.

**Codebase Evidence**:
- `namespace-nav.spec.ts:13-24` declares its own `KNOWN_NAMESPACES` copy, and `:26-67` asserts the
  card grid plus the "Configuration Namespaces" heading via `getByText`.
- `KNOWN_NAMESPACES` can be imported from `src/lib`. Precedent: `e2e/mock-backend.ts:31` imports
  `../src/lib/headers`.
- Auth: `e2e/helpers/auth.ts` exports `addAuthCookie` (`:65`) and `addAdminCookie` (`:70`), and the
  JWT `user_id` is `TEST_USER_ID = 'test-user-001'` (`e2e/fixtures/users.ts:9`).
- Scope remount: `ScopeControl`'s "my overrides" button shows only with a session user
  (`ScopeControl.tsx:46-58`). The Edit flow is Actions → menuitem "Edit"
  (`reason-capture.spec.ts:14-17`).
- Stub URL form: `'**/xstockstrat.config.v1.ConfigService/SetConfig'` (`sources.spec.ts:354`). The
  browser client posts to `/config-ui/api` (`lib/browserClients/configClient.ts:5`).
- Breadcrumb collision guard: `breadcrumb.spec.ts:118-123` requires exactly one link named
  `platform`. The Select is role `combobox`/`option`, not `link`.

**TDD**: `red-green required`. RED: there is no `combobox` named "Namespace" before Step 6, and the
open edit inputs survive the scope switch.

**Covers**: `AC-1, AC-2, AC-3`

**Instructions**:
Rewrite the spec and import `KNOWN_NAMESPACES` from `../../src/lib/configNamespaces`. Always
locate the Select with `page.getByRole('combobox', { name: 'Namespace', exact: true })`, never
with `getByText('platform')`.

1. **AC-1.** `addAuthCookie`, then `goto('/config-ui?env=staging')`.
   - The combobox has text `platform`.
   - A `table` is visible, and `page.locator('tr', { hasText: 'platform.log_level' })` is visible
     (shared mock).
   - `getByText('Configuration Namespaces')` has count 0.
2. **AC-1 (options).** Open the combobox. Every name in `KNOWN_NAMESPACES` is a
   `getByRole('option', { name, exact: true })`.
3. **AC-2.** `addAuthCookie`, then `goto('/config-ui/platform?env=staging&user=test-user-001')`.
   - Open the combobox and click option `marketdata`.
   - Expect the URL to match `/\/config-ui\/marketdata\?env=staging&user=test-user-001$/`, and the
     combobox to have text `marketdata`.
4. **AC-3.** Before `goto`, `page.route('**/xstockstrat.config.v1.ConfigService/ListKeys', …)`
   fulfills `listKeysStubBody([trading row from CONFIG_KEY_STUB_ROWS])` with
   `contentType: 'application/json'`.
   - `goto('/config-ui/trading?env=staging')`.
   - The combobox has text `trading`, and the row `trading.risk.max_position_pct` is visible.
5. **Query preservation from the landing page.** On `/config-ui?env=production`, select `trading`.
   The URL matches `/\/config-ui\/trading\?env=production/`.
6. **Scope remount (design.md § 7).** `addAdminCookie`, then
   `goto('/config-ui/platform?env=staging')`.
   - Open Edit on `platform.log_level` and assert the `Reason for this change` input is visible.
   - Click button `my overrides`.
   - Expect the URL to contain `user=test-user-001`, and
     `getByPlaceholder('Reason for this change')` to have count 0.

C-12: rows and bodies come from `../fixtures` (`CONFIG_KEY_STUB_ROWS`, `listKeysStubBody`) and
auth from `../helpers/auth`. There are no inline domain literals.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit && pnpm run lint && \
  CI=1 pnpm exec playwright test e2e/config-ui/namespace-nav.spec.ts e2e/config-ui/env-mode-switcher.spec.ts e2e/breadcrumb.spec.ts
grep -n "from '../fixtures'\|helpers/auth\|src/lib/configNamespaces" e2e/config-ui/namespace-nav.spec.ts
```
In the harness sandbox, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to the provisioned browser when
the pinned build is missing (ledger `insights.md` 2026-09-16). Pass condition: all three specs are
green. `env-mode-switcher` proves the moved `EnvSwitcher` links keep `role=link`.

---

### Step 8 — service: breadcrumb plain-span branch, audit crumb relabel, nav aliases for namespace pages

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/components/shared/PageBreadcrumb.tsx` — modify
- `services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx` — modify
  (breadcrumb items only)
- `services/xstockstrat-ui/src/app/config-ui/audit/page.tsx` — modify
- `services/xstockstrat-ui/src/components/shared/navGroups.tsx` — modify
- `services/xstockstrat-ui/src/components/shared/PlatformHeader.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, environment scope correctness.

**Codebase Evidence**:
- **`PageBreadcrumb.tsx:15`.** The JSDoc reads "An item without `href` (or the last item) renders
  as the current, non-link crumb". The branch at `:29-33` renders `BreadcrumbLink` for a non-last
  item with `href`, else `BreadcrumbPage`. `BreadcrumbPage` sets `role="link"`,
  `aria-disabled="true"` and `aria-current="page"` (`ui/breadcrumb.tsx:54-60`), so today a non-last
  href-less item would become a second current crumb.
- **`NamespaceEditor.tsx:258-267`.** Breadcrumb items are
  `[{ label: '← namespaces', href: `/config-ui?env=…` }, { label: namespace }]`, with
  `ariaLabel="Namespace path"`.
- **`audit/page.tsx:96`.** Items are `[{ label: '← namespaces', href: '/config-ui' }, { label: 'Audit Log' }]`.
- **`navGroups.tsx:8-13`.** `SubNavItem { label; href; match?: 'exact' | 'prefix' }`. The Settings
  › Config item is `{ label: 'Config', href: '/config-ui', match: 'exact' }` (`:89`).
- **`PlatformHeader.tsx`.**
  - `isItemActive` (`:97-100`) is the sole matcher, used by `resolveActive` (`:103-109`, which
    falls back to `NAV_GROUPS[0]`), the sub-items (`:299`) and the `aria-current` at `:332`.
  - `PLATFORM_SUBNAV.config` has `{ label: 'Namespaces', href: '/config-ui', match: 'exact' }`
    (`:85`).
- **`components/mobile/BottomTabBar.tsx:14`** renders only `NAV_GROUPS.slice(0, 4)` with its own
  `isGroupActive`. Settings is the 5th group (`navGroups.tsx:80`), so it is unaffected.

**TDD**: `red-green required` (RED = Step 9 specs against the pre-Step-8 tree)

**Covers**: —

**Instructions**:
1. **`PageBreadcrumb.tsx`.**
   - Add a third branch: a non-last item without `href` renders
     `<span className="text-muted-foreground">{item.label}</span>`. The plain span carries no
     role and no `aria-current`.
   - Only the last item renders `BreadcrumbPage`.
   - Update the `:15` JSDoc: "A non-last item without `href` renders as plain text; the last item
     is the current crumb."
   - No existing caller passes a non-last href-less item (design.md § 5).
2. **`NamespaceEditor.tsx`.** Set the breadcrumb `items` to
   `[{ label: 'Config' }, { label: namespace }]` and keep `ariaLabel="Namespace path"`. Do not touch
   the rest of the editor; Step 10 does that.
3. **`audit/page.tsx:96`.** Change `label: '← namespaces'` → `label: 'Config'` and keep
   `href: '/config-ui'`.
4. **`navGroups.tsx`.**
   - Add `aliases?: string[]` to `SubNavItem`, with a 1-line JSDoc: "extra exact pathnames that
     also mark this item active".
   - On the Settings › Config item, add
     `aliases: KNOWN_NAMESPACES.map((ns) => `/config-ui/${ns}`)`, importing from
     `@/lib/configNamespaces`.
5. **`PlatformHeader.tsx`.**
   - In `isItemActive`, return `true` when `item.aliases?.includes(pathname)`, before the existing
     `match` check.
   - Relabel `PLATFORM_SUBNAV.config[0]` from `'Namespaces'` to `'Config'`.
   - Do **not** switch Config to `prefix` matching: that would co-activate on
     `/config-ui/users|audit|…`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm run lint:dup
grep -rn "← namespaces" src   # expect no match
```
Pass conditions: lint and the type check pass, and no `← namespaces` label remains. Behavior is
proven by Step 9.

---

### Step 9 — test: namespace-page header, non-link breadcrumb, audit crumb, nav highlight

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/config-ui/namespace-nav.spec.ts` — modify (append tests)

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, environment scope correctness.

**Codebase Evidence**:
- `nav-reachability.spec.ts:70-90` resolves the shell nav with
  `page.getByRole('navigation', { name: 'Section' })` and asserts `aria-current="page"` on the
  item. The `/config-ui` exact match on Settings › Config must keep passing.
- `breadcrumb.spec.ts:44-61` sites `'Namespace path'` → `/config-ui/platform`, terminal `platform`,
  and `'Audit log path'` → `/config-ui/audit`. `:118-123` requires exactly one link with the
  terminal label.
- `env-mode-switcher.spec.ts:48-51` shows how the env switcher and scope control are asserted:
  `getByText('ENV:')`, `getByText('SCOPE:')`, and the buttons `global` / `my overrides`.

**TDD**: `red-green required`. RED before Step 8:
- `Namespace path` contains the link `← namespaces`;
- Settings › Config has no `aria-current` on `/config-ui/trading`;
- the audit crumb reads `← namespaces`.

**Covers**: `AC-14`

**Instructions**:
Append to `namespace-nav.spec.ts`:

1. **AC-14.** `addAuthCookie`, then `goto('/config-ui/marketdata?env=staging')`.
   - `getByText('ENV:')` and `getByText('SCOPE:')` are visible, and so are the combobox
     `Namespace` and a `table`.
   - Let `crumbs = page.getByLabel('Namespace path', { exact: true })`. Then:
     - `crumbs` ends with `marketdata`: its last `li` has text `marketdata`;
     - `crumbs.getByRole('link', { name: '← namespaces' })` has count 0;
     - `crumbs.getByText('Config', { exact: true })` is visible and is not a link
       (`crumbs.getByRole('link', { name: 'Config', exact: true })` has count 0).
2. **Nav highlight.** On `/config-ui/trading?env=staging`,
   `page.getByRole('navigation', { name: 'Section' }).getByRole('link', { name: 'Config', exact: true })`
   has `aria-current="page"`.
   - On the desktop viewport only. If the Section nav is collapsed on load, open the Settings
     group first, as `nav-reachability.spec.ts:74` does.
3. **Audit crumb.** On `/config-ui/audit`,
   `getByLabel('Audit log path', { exact: true }).getByRole('link', { name: 'Config', exact: true })`
   has `href` `/config-ui`.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit && pnpm run lint && \
  CI=1 pnpm exec playwright test e2e/config-ui/namespace-nav.spec.ts e2e/breadcrumb.spec.ts e2e/nav-reachability.spec.ts e2e/config-ui/audit.spec.ts
```
Pass condition: all green. `breadcrumb.spec.ts` stays satisfied, because the terminal `platform`
crumb is still the only `platform` link.

---

### Step 10 — service: `NamespaceEditor` stable cells + `EditContext` (focus fix), description under key, Updated column

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, environment scope correctness, no
secret values rendered in UI.

**Codebase Evidence**:
- **Root cause.**
  - `columns = useMemo(…)` at `NamespaceEditor.tsx:121-253`, with deps `[editingKey, editValue,
    editReason, validationError, saving, isNativeEnv, handleSave]` at `:252`.
  - `handleSave` is a fresh closure on every render (`:81-119`).
  - `DataTable` renders `flexRender(cell.column.columnDef.cell, cell.getContext())`
    (`components/ui/data-table.tsx:191`), so each new `cell` function is a new component type,
    the `Input`s remount, and `autoFocus` (`:150`) re-steals focus.
  - Ledger: `fails.md` 2026-10-02 (config-ui-usability).
- **Hand-cast row type** at `:69-79`; `type ConfigKeyRow` at `:79`.
- **Local `envToProto`** at `:22-25` duplicates the exported `envToProto` in
  `app/config-ui/hooks/useConfigKeys.ts:7-9`, which returns `Environment`.
- **Description column** at `:180-184` (`hidden md:table-cell`). `TableCell` is
  `whitespace-nowrap` (`components/ui/table.tsx:73`).
- **`DataTable` `data`** must be referentially stable (`data-table.tsx:55-58`).
- **Timestamp.** `timestampToDate(ts: ProtoTimestamp | undefined): Date | undefined` at
  `src/lib/protoTime.ts:16`, the declared single home (`:2`).
- **Empty cell** renders `'—'` (`:176`).
- **Preserved behavior:**
  - `handleSave` validation and the SetConfig request at `:81-119` (`@AC-1/@AC-1b @feature-147`);
  - the secret note and `[0, max]` hint at `:152-162` (`@AC-6 @feature-161`);
  - `Edit` seeds `''` for secrets (`:212-215`).

**TDD**: `red-green required` (RED = Steps 11–12 specs against the pre-Step-10 tree)

**Covers**: —

**Instructions**:
1. **Row type and data.**
   - Delete the hand cast (`:69-79`).
   - Use `import type { ConfigKeyMeta } from '@xstockstrat/proto/config/v1/config_pb'` and
     `const keys = useMemo(() => keysData?.keys ?? [], [keysData])`.
   - Delete the local `envToProto` (`:22-25`) and import `envToProto` from
     `@/app/config-ui/hooks/useConfigKeys`. Its call at `:108` is unchanged in shape.
2. **`EditContext`.** At module scope, add
   `const EditContext = createContext<EditState | null>(null)` plus a `useEditContext()` that throws
   when the context is missing. `EditState` carries:
   - `editingKey`, `editValue`, `setEditValue`, `editReason`, `setEditReason`;
   - `validationError`, `setValidationError`, `saving`, `isNativeEnv`;
   - `startEdit(k: ConfigKeyMeta)`, which runs today's `:211-215` body;
   - `cancelEdit()`, which runs `:238-239`;
   - `handleSave`.

   `NamespaceEditor` provides a plain-object value, deliberately **not** memoised (design.md § 4).
3. **Module-level cell components**, each reading `useEditContext()`:
   - **`KeyCell({ row })`.** Render `<span>{k.key}</span>`, and when `k.description` is non-empty
     also render
     `<p title={k.description} className="font-sans whitespace-normal max-w-[280px] text-xs text-muted-foreground line-clamp-2">{k.description}</p>`.
     Render nothing extra for an empty description.
   - **`ValueCell({ row })`.** Today's `:134-177` JSX, unchanged. The value `Input` keeps
     `autoFocus`, which now fires only on entering edit mode.
   - **`UpdatedCell({ row })`.** Compute `const d = timestampToDate(k.updatedAt)`, then render
     `d ? <span title={d.toISOString()}>{d.toLocaleString()}</span> : <span>—</span>`.
   - **`ActionsCell({ row })`.** Today's `:191-248` JSX, unchanged, with the inline setters
     replaced by `startEdit(k)` / `cancelEdit()`.
4. **Module-level `const COLUMNS: ColumnDef<ConfigKeyMeta>[]`.**
   - `{ accessorKey: 'key', header: 'Key', meta: { className: 'w-[220px] font-mono text-primary' }, cell: KeyCell }`.
     It keeps `accessorKey` so it stays sortable.
   - `{ id: 'value', … cell: ValueCell }`, with the same header and meta as `:129-132`.
   - `{ id: 'updated', header: () => <span title="Row last modified">Updated</span>, enableSorting: false, meta: { className: 'text-xs text-muted-foreground' }, cell: UpdatedCell }`.
   - `{ id: 'actions', … cell: ActionsCell }`, with the same header and meta as `:186-189`.
   - **Delete** the Description column (`:180-184`).
   - Put a 2-line comment directly above `COLUMNS`: "Columns and cells must stay at module scope —
     an inline `cell` arrow remounts the edit inputs on every keystroke (AC-11)."
5. **Wiring.**
   - Remove the `columns` `useMemo` (`:121-253`).
   - Wrap the returned JSX in `<EditContext.Provider value={…}>`.
   - Pass `columns={COLUMNS}` and `data={keys}` to `DataTable`.
   - Keep `handleSave` (`:81-119`) unchanged apart from reading the typed `keys`.
   - Keep the breadcrumb (as Step 8 left it), the badges, the notices, and the
     loading/error states.
6. **Out of scope.** Do not refactor `config-ui/sources/page.tsx:391-430`, which has the same latent
   pattern (recon.md § Risks: out of scope).

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint && pnpm exec tsc --noEmit && pnpm run lint:dup
grep -n "useMemo<ColumnDef\|accessorKey: 'description'" 'src/app/config-ui/[namespace]/NamespaceEditor.tsx'   # expect no match
```
Pass conditions: lint, the type check and jscpd pass, and neither the memoised columns nor the
Description column remain. Behavior is proven by Steps 11–12.

---

### Step 11 — test: edit-form focus stability (keystroke-level)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/config-ui/edit-focus.spec.ts` — create

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, environment scope correctness.

**Codebase Evidence**:
- Existing specs fill whole values with `.fill()` (`reason-capture.spec.ts:17`,
  `value-persists-after-save.spec.ts:41-43`), which never exposes the remount (recon.md § Risks).
- Ledger `fails.md` 2026-10-02: test with `pressSequentially` plus a DOM-node probe, not
  `toBeFocused` alone, because autoFocus re-steals focus on remount.
- Edit flow: `row.getByRole('button', { name: 'Actions' })` → `page.getByRole('menuitem', { name: 'Edit' })`
  (`value-persists-after-save.spec.ts:37-38`). Reason placeholder: `'Reason for this change'`
  (`NamespaceEditor.tsx:167`).
- **Shared-mock race.** `value-persists-after-save.spec.ts` writes `platform.trading_state` into
  the shared `configValueOverrides` under `fullyParallel` (`playwright.config.ts:83`;
  `mock-backend.ts:1286,1301`). So prefill is read before typing rather than asserted as a literal,
  or the row is stubbed.

**TDD**: `red-green required`. RED before Step 10:
- AC-10: focus jumps to the value input after the first reason keystroke, so the reason value is
  truncated.
- AC-11: the probed node is detached after the first keystroke.

**Covers**: `AC-10, AC-11`

**Instructions**:
In each test, stub ListKeys with
`page.route('**/xstockstrat.config.v1.ConfigService/ListKeys', r => r.fulfill({ contentType: 'application/json', body: listKeysStubBody([<platform.trading_state row from CONFIG_KEY_STUB_ROWS>]) }))`.
Use `addAdminCookie`, then `goto('/config-ui/platform?env=staging')`, then open Edit on
`platform.trading_state`.

1. **AC-10.**
   - Read `const prefill = await valueInput.inputValue()`, where `valueInput` is the first `input`
     in the row.
   - Click the reason input and run `pressSequentially('halting for maintenance')`.
   - Expect the reason input `toBeFocused()` and `toHaveValue('halting for maintenance')`, and
     `valueInput` `toHaveValue(prefill)`.
2. **AC-11.**
   - Clear the value input with `fill('')`. This is fine because it happens before the probe.
   - Tag the node via `valueInput.evaluate(el => el.setAttribute('data-probe', '1'))`.
   - Run `valueInput.pressSequentially('halted')`, asserting after **each** character, for
     example in a loop over `'halted'` calling `press(char)` then
     `expect(page.locator('[data-probe="1"]')).toBeFocused()`.
   - Finally expect `page.locator('[data-probe="1"]')` `toHaveValue('halted')`.
   - The probe surviving proves there was no remount, despite `autoFocus`.

C-12: the row and body come from `../fixtures` and auth from `../helpers/auth`. There are no inline
domain literals.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit && pnpm run lint && \
  CI=1 pnpm exec playwright test e2e/config-ui/edit-focus.spec.ts e2e/config-ui/reason-capture.spec.ts e2e/config-ui/secret-editing.spec.ts
grep -n "from '../fixtures'\|helpers/auth" e2e/config-ui/edit-focus.spec.ts
```
Pass condition: all green. `reason-capture` and `secret-editing` prove the `handleSave` and secret
paths survived the refactor (`@AC-1/@AC-1b @feature-147`).

---

### Step 12 — test: row description, last-updated cell, refresh after save, C-16 guard

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/config-ui/namespace-editor-rows.spec.ts` — create
- `services/xstockstrat-ui/e2e/config-ui/api-smoke.spec.ts` — modify (comments only)

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, environment scope correctness, no
secret values rendered in UI.

**Codebase Evidence**:
- `api-smoke.spec.ts:48` (`k.description → Description column (hidden on mobile)`) and `:82`
  (`// Description column`) describe the removed column.
- The decay row is `analysis.scoring.signal_decay_half_life_hours`
  (`fixtures/configKeys.ts:83-94`, key at `:86`, validation at `:93`), with `validation {valueType: 2, 0, 8760}` and description
  `'Exponential age-decay half-life in hours; 0 disables. Bounds [0, 8760].'`. Its hint text comes
  from `NamespaceEditor.tsx:158-161` (`Must be a number in [0, 8760].`). The rule is PRESERVE
  `@AC-6 @feature-161` (`services/xstockstrat-ui/acceptance/surface-signal-weight-decay-config.feature`).
- The shared mock serves `CONFIG_KEY_FIXTURES` through the real BFF `forward`
  (`src/lib/configUiBff.ts:26`). Step 5 gives `platform.log_level` a static `updatedAt`.
- `useSetConfig` invalidates `['config-keys', namespace, env, user]` on success
  (`hooks/useSetConfig.ts:12-14`). That refetch is the AC-12 refresh path.
- Mobile overflow: `/config-ui` and `/config-ui/platform` are in `mobile-overflow.spec.ts:26,33`,
  and `Table` wraps itself in `overflow-x-auto` (`components/ui/table.tsx:9`).

**TDD**: `red-green required`. RED before Step 10:
- there is a Description column header and no element under the key;
- there is no Updated cell or title;
- the decay guard (item 7) is **partially RED** before Step 10: its value + bounds-hint
  assertions pass (regression guard), its description-`p`-with-`title` assertion fails.

**Covers**: `AC-4, AC-5, AC-8, AC-9, AC-12`

**Instructions**:
Create `namespace-editor-rows.spec.ts`. Stub specs use the `page.route` ListKeys stub with
`listKeysStubBody(...)` and `CONFIG_KEY_STUB_ROWS`.

1. **AC-4.**
   - `page.setViewportSize({ width: 375, height: 800 })`, then `goto('/config-ui/marketdata?env=staging')`.
   - The row `marketdata.fmp.metrics` contains a `p` whose text and `title` both equal
     `'Comma-separated metric tiers to fetch (core, extended)'`.
   - `getByRole('columnheader', { name: 'Description' })` has count 0.
2. **AC-5.** The row `marketdata.fmp.enabled`'s key cell (`row.getByRole('cell').first()`) contains
   no `p` element.
3. **AC-8** (stub; `goto('/config-ui/platform?env=staging')`). In the `platform.trading_state` row, the last-updated cell's `span[title]` has
   `title` `'2026-09-15T08:30:00.000Z'` and text matching `/2026/`.
4. **AC-9** (same stub and URL as AC-8). The `platform.example` row's Updated cell has text `—`.
5. **AC-12 (stateful stubs; never touch the shared mock).**
   - A closure flag `saved = false` drives the stubs:
     - ListKeys returns `platform.trading_state` with no `updatedAt` and `currentValue: 'ACTIVE'`
       while `!saved`;
     - after the save it returns `currentValue: 'halted'` and
       `updatedAt: timestampFromDate(new Date('2026-10-02T09:00:00Z'))`, built as
       `{ ...STUB_ROW, … }` (a scenario one-off);
     - `/SetConfig` sets `saved = true` and fulfills `setConfigStubBody()`.
   - Use `addAdminCookie`, open Edit, fill value `halted`, fill reason `maintenance`, click
     `Save`.
   - Expect:
     - the row to have the cell `halted` (exact);
     - the Updated `span` to have title `'2026-10-02T09:00:00.000Z'`;
     - `row.getByPlaceholder('Reason for this change')` to have count 0;
     - no navigation (`page.url()` unchanged).
6. **Real-BFF `updatedAt` (no stub).** On `/config-ui/platform?env=staging`, the
   `platform.log_level` row's Updated `span` has title `'2026-09-01T10:00:00.000Z'`.
7. **C-16 guard (`@AC-6 @feature-161`)**, no stub, at `/config-ui/analysis?env=staging`:
   - the `analysis.scoring.signal_decay_half_life_hours` row's Value cell is non-empty and, after
     Actions → Edit, equals the value input's prefill (read the prefill first — no literal, since the
     shared mock may hold another spec's write);
   - it has a description `p` with that `title`;
   - after Actions → Edit, `Must be a number in [0, 8760].` is visible.
8. **`api-smoke.spec.ts`.** Change the `:48` comment to
   `k.description → under the key (clamped, title tooltip)` and the `:82` comment to
   `// rendered under the key`. There are no assertion changes.

C-12: all rows and bodies come from `../fixtures`. The AC-12 post-save row is a
`{ ...STUB_ROW, override }` spread, which the C-12 rule exempts from the fixture inventory.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm exec tsc --noEmit && pnpm run lint && pnpm run test:unit && \
  CI=1 pnpm exec playwright test e2e/config-ui/ e2e/mobile-overflow.spec.ts e2e/breadcrumb.spec.ts e2e/nav-reachability.spec.ts
grep -n "from '../fixtures'\|helpers/auth" e2e/config-ui/namespace-editor-rows.spec.ts
```
Pass condition: the whole config-ui e2e suite is green, plus mobile-overflow, breadcrumb, nav
reachability and the vitest unit suite (no regression in `src/lib/protoTime.test.ts`). This is the
feature's full UI regression gate.

---

### Step 13 — docs: reconcile context docs touched by this feature

**Status**: `pending`
**Service**: `docs`
**Files**:
- `services/xstockstrat-config/docs/context-constitution.md` — modify
- `docs/patterns/ui-ux-governance.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- **`services/xstockstrat-config/docs/context-constitution.md`.**
  - `:19` (CONFIG-2) cites `configServiceImpl.ts:565-580` / `:569-572` (`buildConfigValue`) and
    `:522-536`.
  - `:24` (CONFIG-7) cites `configServiceImpl.ts:519-524` for the `DISTINCT ON` query.
  - `:31` cites `buildConfigValue` as `565-580` and `:48` cites it as `569-572`; both are already stale
    (it sits at `559-573` today) and shift again after Step 3.
  - Step 3's added mapping line shifts `buildConfigValue`, and the query is at `:517-521` today.
- **`docs/patterns/ui-ux-governance.md`.**
  - The coverage audit row at `:216` lists the "config-ui · namespaces" specs (`namespace-nav`,
    `value-persists-after-save`, …). Steps 11–12 add `edit-focus` and `namespace-editor-rows`.
  - This file is in `.agents/context-forge.json` `scrubberExtraTargets`.
- **Root CLAUDE.md § Teardown.** A session that changes behavior a context file describes runs
  `/context-forge:context-constitution refresh` scoped to what it touched. Without the plugin, it
  reconciles by hand and records that in the PR body.

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
1. Re-grep `buildConfigValue` and the `DISTINCT ON` query in `src/grpc/configServiceImpl.ts`.
   Update every `configServiceImpl.ts` line cite in the file (CONFIG-2 `:19`, CONFIG-7 `:24`, and the
   `buildConfigValue` cites at `:31` and `:48`) to the post-Step-3 lines. In CONFIG-7, add one
   clause: `updated_at` is selected from the same resolved row (feature 219).
2. In `ui-ux-governance.md:216`, add `edit-focus` and `namespace-editor-rows` to the
   "config-ui · namespaces" e2e list.
3. Run `/context-forge:context-constitution refresh`, scoped to the files touched by Steps 1–12,
   and fix the grounded drift it reports.
   - If the plugin is unavailable, re-read every context file named above against the code by
     hand.
   - Record both facts (plugin unavailable + manual reconciliation performed) in the PR body.
   - Drift the refresh reports in a context file **not** listed in `**Files**` is fixed only after a
     Deviation Log entry naming that file (F-08).

**Verification**:
```bash
grep -n "DISTINCT ON\|buildConfigValue" services/xstockstrat-config/src/grpc/configServiceImpl.ts
grep -n "CONFIG-2\|CONFIG-7" services/xstockstrat-config/docs/context-constitution.md
grep -n "edit-focus\|namespace-editor-rows" docs/patterns/ui-ux-governance.md
```
Pass conditions: the cited line numbers in CONFIG-2 and CONFIG-7 match the first grep, and the
coverage row lists both new specs.

---

## Deviation Log

### Step 1 — buf breaking baseline
- **Planned**: `buf breaking` against `feature/config-ui-usability`.
- **Actual**: against `origin/main-dev` (CI's PR baseline). The declared Development Branch is the
  harness branch, which already contains this change, so it is not a meaningful baseline.
  `buf` 1.72.0 (pinned) was run via `npx @bufbuild/buf@1.72.0` while the codegen image was building.
- **Disposition**: CI-equivalent fallback.

_Populated by /sdd-execute as implementation proceeds._
