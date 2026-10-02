# Design: config-ui-usability

**Created**: 2026-10-02
**Rounds**: 3 (quick mode upgraded to 3 rounds at the user's request; termination: approved)
**Approved by**: user @ 2026-10-02
**Grounded in**: recon.md

---

## Chosen Approach

### 1. Shared namespace module — `src/lib/configNamespaces.ts` (new)

- **Contents.**
  - `KNOWN_NAMESPACES`, moved from `config-ui/page.tsx:10-21`.
  - `configUiHref(basePath, env, user)`, generalised from `nsHref` (`page.tsx:25-30`).
- **Location.** It lives in `src/lib/` rather than `app/config-ui/` because the shared shell nav
  (`navGroups.tsx`) also imports it.
- **One builder for every config-ui query-preserving link.** Three callers use it:
  - `EnvSwitcher`, replacing the hard-coded `/config-ui?env=` at `page.tsx:93`. That hard-coding
    would otherwise bounce a namespace page back to the landing page.
  - The new `NamespaceSelect`.
  - `ScopeControl.go()` (`ScopeControl.tsx:25-29`), which already takes a `basePath` (`:16`).

### 2. Shared server view — `src/app/config-ui/ConfigNamespaceView.tsx` (new)

- **Props:** `{namespace, basePath, rawEnv, rawUser}`.
- **Server-side work.** It owns the env clamp, `resolveConfigScope` (`scope.ts:11-19`) and
  `getNativeConfigEnv`. Today this is duplicated at `page.tsx:39-42` and `[namespace]/page.tsx:14-18`.
- **Header**, in order:
  1. `<h1>Configuration</h1>`.
  2. `EnvSwitcher`, moved verbatim from `page.tsx:73-117`, with its hrefs built by
     `configUiHref(basePath, …)` and kept as plain `Link`/`Badge` (no Radix role trap).
  3. `ScopeControl basePath={basePath}`.
  4. The client `NamespaceSelect`.
- **Editor.** Below the header it renders
  `<NamespaceEditor key={`${namespace}|${env}|${user}`} …>`.
  - Header controls navigate softly on a query-only change, which keeps client state.
  - Save sends `userId: user` (`NamespaceEditor.tsx:109`).
  - The key remounts the editor on any namespace/env/scope change. That also resets the
    `useSetConfig` mutation state (`useSetConfig.ts:10`), so an open draft can never Save into a
    different scope.
- **Route wrappers.**
  - `config-ui/page.tsx` keeps its missing-env redirect (`:34-35`), then renders the view with
    `basePath='/config-ui'` and `namespace='platform'`. It does **not** redirect to
    `/config-ui/platform` (see Rejected Alternatives).
  - `[namespace]/page.tsx` renders the view with `basePath=`/config-ui/${namespace}``. As today, it
    has no env redirect.
- **Deletions.** The card grid and the "Configuration Namespaces" copy are deleted.

### 3. Client `NamespaceSelect.tsx` (new)

- **Control.** A controlled `ui/select` following `StrategyPicker.tsx:33-44`, with
  `aria-label="Namespace"` on `SelectTrigger` (passthrough at `select.tsx:31,43`).
- **Navigation.** `onValueChange` calls `router.push(configUiHref(`/config-ui/${ns}`, env, user))`.
- **Options.** Options are `SelectItem`s, not `Link`s. A deep-linked namespace that is not in
  `KNOWN_NAMESPACES` is appended as an extra option, so the trigger never renders blank.

### 4. `NamespaceEditor.tsx` — focus fix and row rendering

- **Focus fix.** Replace the `columns` `useMemo` (`:121-253`, unstable deps at `:252`) with:
  - a **module-level `COLUMNS`** constant;
  - module-level `KeyCell` / `ValueCell` / `UpdatedCell` / `ActionsCell` components that read a
    plain-object `EditContext` provided by `NamespaceEditor`.

  Why this works:
  - `flexRender` (`data-table.tsx:191`) renders a function cell as a component, so a stable cell
    identity means re-render without remount. The inputs keep their DOM nodes and focus.
  - The context value is deliberately not memoised, because `handleSave` is unstable and a memo
    would be a no-op. Correctness comes from stable component identity, not from memoisation.
  - A 2-line comment pins that `COLUMNS` and the cells must stay at module scope.
- **Unchanged.** `handleSave` and its validation (`:81-119`), the value `Input` `autoFocus` (which
  now fires once, on entering edit mode), and the env/scope badges.
- **Data typing.** The row type is the generated `ConfigKeyMeta`, replacing the hand cast at `:69-79`.
  `data` is memoised (`data-table.tsx:55-58`). `envToProto` is reused from `hooks/useConfigKeys.ts:7`.
- **Key column.** It keeps `accessorKey:'key'`, so it stays sortable.
  - The key text goes in its own element.
  - The description goes in a separate `<p title={description}>` with
    `font-sans whitespace-normal max-w-[280px] text-xs text-muted-foreground line-clamp-2`, rendered
    only when the description is non-empty. `whitespace-normal` is needed because `TableCell` is
    `whitespace-nowrap` (`table.tsx:73`).
- **Description column.** Deleted (`:180-184`).
- **Updated column.**
  - Not sortable (`enableSorting:false`). The header has `title="Row last modified"`.
  - The cell computes `timestampToDate(updatedAt)` (`protoTime.ts:16`) and renders
    `toLocaleString()` text with `title = d.toISOString()` (e.g. `2026-09-15T08:30:00.000Z`).
  - It renders `—` when there is no timestamp.
  - Semantics: **row last modified**, per the user's decision. The BEFORE UPDATE trigger bumps
    `updated_at` on any row update (`017_config_secrets_and_scoping.up.sql:76`).
- **Breadcrumb.** `[{label:'Config'},{label:namespace}]`, `ariaLabel='Namespace path'`.

### 5. Shared shell components

- **`PageBreadcrumb.tsx`** — a third branch renders a non-last item without `href` as a plain
  `<span>`. Today such an item falls through to `BreadcrumbPage` (`PageBreadcrumb.tsx:29-32`;
  `role=link` + `aria-current` at `breadcrumb.tsx:54-60`), which would give two current crumbs.
  - This is the user's decision.
  - No existing caller passes a non-last href-less item.
- **`navGroups.tsx`** — `SubNavItem` gains an optional `aliases?: string[]`, a list of extra exact
  pathnames. `PlatformHeader.tsx` `isItemActive` (`:99-101`) also matches them.
  - The Settings › Config item gets `aliases: KNOWN_NAMESPACES.map(ns => `/config-ui/${ns}`)`.
  - Today `resolveActive` (`PlatformHeader.tsx:103-108`) falls back to the "Decide" group on every
    `/config-ui/<ns>` page, and the dropdown makes that the main path.
  - Using `prefix` matching instead would also activate Config on `/config-ui/users|audit|…`.
  - `PLATFORM_SUBNAV.config` "Namespaces" (`PlatformHeader.tsx:85`) is relabelled "Config".
- **Audit page** — the `audit/page.tsx:96` crumb changes from `'← namespaces'` to `'Config'`
  (href unchanged).

### 6. Backend (`xstockstrat-config` + proto)

- **Proto.** `ConfigKeyMeta` gets `google.protobuf.Timestamp updated_at = 10;` with a leading
  comment ("updated_at of the resolved row — per-user override else global"). The Timestamp import
  already exists at `config.proto:7`.
- **`listKeys`.** Add `updated_at` to the same `DISTINCT ON (key)` select list
  (`configServiceImpl.ts:517-521`) and map it as `updatedAt: r.updated_at ?? undefined`
  (`:524-551`).
  - pg returns a `Date`, and ts-proto `useDate` encodes it.
  - `undefined` leaves the field unset, so there is no Invalid Date.
  - The redaction branch at `:536` is untouched.
- **Consumer surface (C-14).** The UI `/config-ui` reads `updatedAt` through the BFF's existing
  `forward` (`configUiBff.ts:26`), which needs no change. The agent tool maps fields explicitly
  (`client.py:1947-1974`) and is unaffected (out of scope).

### 7. Tests

- **Config service (`node:test`).**
  - The SQL-capture test asserts `updated_at` is in the select list (pattern from
    `listKeysCurrentValue.test.ts:41-80`).
  - The wire round trip carries `updatedAt` (pattern from `listKeysWire.test.ts`).
  - A secret row returns `[redacted]` plus `updatedAt` (AC-7).
  - A row without the column leaves the field unset.
  - **AC-6/AC-13 trace honestly as SQL shape.** `updated_at` sits in the same `DISTINCT ON` select
    as the resolved row, and the existing `ORDER BY` test (`listKeysDedup.test.ts:62,68`) guarantees
    per-user wins. A mocked pool cannot execute `DISTINCT ON`, so there is no behavioural DB proof.
- **UI e2e — focus.**
  - AC-10: click Reason, `pressSequentially`, assert Reason focused, and assert Value equals its
    *prefill* (read before typing, not a literal, because of the shared-mock race with
    `value-persists-after-save.spec.ts`).
  - AC-11: tag the value input with a `data-probe` via `evaluate`, `pressSequentially`, and assert
    the probed node still exists with the typed value. This detects a remount despite `autoFocus`.
- **UI e2e — scope remount.** Open Edit, click "my overrides", assert the edit inputs are gone.
- **UI e2e — stubbed responses.**
  - AC-3/4/5/8/9/12 use `page.route` stubs on `**/xstockstrat.config.v1.ConfigService/ListKeys`;
    AC-12 adds a stateful `/SetConfig` stub.
  - The stub bodies come from a helper in `e2e/fixtures/configKeys.ts`:
    `toJson(ListKeysResponseSchema, create(ListKeysResponseSchema, {keys}))`, using protobuf-es v2
    (`@bufbuild/protobuf ^2`, `*Schema` exports). The helper is registered in `INVENTORY.md`.
  - The shared mock state is never mutated.
- **UI e2e — real BFF path.**
  - One shared `CONFIG_KEY_FIXTURES` row gets a static `updatedAt` in the Timestamp **init** shape
    (`timestampFromDate(new Date('…Z'))`), because it is spread into the mock's create-shaped
    `listKeys` (`mock-backend.ts:1293-1296`).
  - It is asserted through the real BFF.
  - Expected titles use the browser `toISOString()` form (`.000Z`).
- **UI e2e — C-16 guard.** The `analysis.scoring.signal_decay_half_life_hours` row still renders
  its default value and description (with title), and shows the `[0, 8760]` hint in edit mode.
- **UI e2e — nav.** `aria-current` on Settings › Config at `/config-ui/trading`.
- **Rewrites.**
  - `namespace-nav.spec.ts`: import `KNOWN_NAMESPACES` from `src/lib` (precedent:
    `mock-backend.ts:31`); assert through `getByRole('combobox',{name:'Namespace',exact:true})`, never
    `getByText('platform')`.
  - `api-smoke.spec.ts`: fix the "Description column" comments.

## Rejected Alternatives

- **Redirect `/config-ui` → `/config-ui/platform`.**
  - Rejected because it breaks the exact-match Settings › Config `aria-current`
    (`nav-reachability.spec.ts:80-90`, `PlatformHeader.tsx:99`).
  - It forces a review of seven `env-mode-switcher` gotos plus the warmup, mobile-overflow and
    auth specs, and it contradicts AC-1's literal URL.
  - The view is shared, so its "one URL per screen" benefit is cosmetic.
- **useMemo columns with refs for the edit state** — rejected: reading refs during render is
  fragile, and the cause is component identity, which module scope fixes by construction.
- **Edit form in a `FormDialog` or expanded row** — rejected: a UX redesign beyond FR-6 (C-18 YAGNI).
- **Edit state via TanStack `table.options.meta`** — rejected: `DataTable` doesn't forward `meta`
  and `TableMeta` is untyped. React Context is local and sufficient at tens of rows.
- **Derive "last updated" from `config_audit`** — rejected by the user in favour of the proto field.
- **A new `value_changed_at` column (value-only semantics)** — rejected by the user. Row-last-modified
  semantics need no migration.
- **Namespace filter in the e2e mock** — rejected: `secret-editing.spec.ts` reads
  `marketdata.alpaca.api_key` on the platform page. Per-spec `page.route` stubs are honest without
  that cost.
- **A global `configUpdatedAtOverrides` stamp in the shared mock** — rejected: it races
  `value-persists-after-save.spec.ts` under `fullyParallel`.
- **Hand-written Connect-JSON stub bodies** — rejected: a recurring ledger trap
  (`fails.md:677-679`). They are generated via `create`/`toJson` instead.
- **Nav `prefix` match for Config** — rejected: it would co-activate on `/config-ui/users|audit|…`.
- **`<NamespaceEditor>` reset via `useEffect` on `[env, user]`** — rejected: one frame of stale
  draft and easy to get wrong. The `key` remount is atomic.

## Open Risks

- [ ] A future inline `cell: (ctx) => <ValueCell/>` arrow silently reintroduces the remount — guarded
  by the module-scope comment plus the AC-11 probe test (implementation step: editor refactor).
- [ ] `updated_at` also moves when a migration UPDATEs a row. Accepted semantics ("row last
  modified", in the header tooltip) — revisit only if operators report confusion.
- [ ] AC-6/AC-13 have no DB-backed proof (SQL-shape only) — accepted; the config service has no
  DB test harness (backend step).
- [ ] Feature 217 also regenerates `packages/proto/gen`; whichever PR merges second re-runs
  `./scripts/buf-gen.sh` (proto step / merge time).

## Constitution Rules Touched

- `C-09` — honored by: a proto step running `buf lint` + `buf breaking` + `./scripts/buf-gen.sh`.
- `C-10` — honored by:
  - (a) no new route, and nav highlighting is extended to namespace pages and asserted;
  - the audit and editor breadcrumbs are updated together.
- `C-12`/`C-13` — honored by:
  - stub bodies and the shared row live in `e2e/fixtures/configKeys.ts` plus `INVENTORY.md`;
  - config-service rows stay inline (one consumer each; no fixture home until a second one appears).
- `C-14` — honored by: the UI `/config-ui` consumes `updatedAt` in this feature. The agent is
  unchanged and out of scope (a decision, not a deferral).
- `C-15` — honored by: every `@AC-*` maps to a named test (trace above). AC-2 was amended to the
  caller's own id, keeping the same ID.
- `C-16` — honored by: see Business Rules Touched. A rendered guard was added for `@AC-6 @feature-161`.
- `C-17` — honored by:
  - reusing `ui/select`, `DataTable`, `PageBreadcrumb` and tokens only;
  - a unique `aria-label`;
  - no fake-link crumb (plain span);
  - nav `aria-current` correct on namespace pages.
- `C-18` — honored by:
  - one URL builder;
  - the generated row type;
  - no speculative abstraction (`aliases` is the minimum matcher extension);
  - the context memo dropped as a no-op.
- `F-01` — honored by: no migration.
- `F-04` — honored by: every path cited from recon digests and round evidence.
- `F-06` — honored by: no pool change.
- `F-07` — honored by: no config values hardcoded (`KNOWN_NAMESPACES` is UI navigation, not config).

## Business Rules Touched (C-16)

- PRESERVE `@AC-3 @feature-147` "GetConfig and ListKeys redact secrets at the edge"
  (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`) — the redaction
  branch is untouched; 218 AC-7 re-asserts it.
- EXTEND `@AC-11 @feature-147` "A per-user config value overrides the global value" — `updated_at`
  comes from the same resolved row (218 AC-6/AC-13).
- PRESERVE `@AC-8 @feature-161` (config) — the `ListKeys` key set is unchanged; only one column was
  added to the select.
- PRESERVE `@AC-6 @feature-161` (UI) — the decay-key row's default, description and bounds hint are
  guarded by a new rendered e2e assertion.
- PRESERVE `@AC-9 @feature-043`, `@AC-9 @feature-156` — the Users and Fundamentals Scan nav entries
  are untouched.
- PRESERVE `@AC-6 @feature-153` — all data calls stay on the `makeBrowserTransport` `/config-ui/api`
  client.
- PRESERVE `@AC-1`/`@AC-1b @feature-147` — the SetConfig request shape is unchanged; `handleSave` is
  untouched.
- EXTEND `@AC-5 @feature-184` — the UI-side refresh after a write (218 AC-12).
