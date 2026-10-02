# Recon: config-ui-usability

**Created**: 2026-10-02
**From**: product-spec.md
**Affected services**: xstockstrat-config, xstockstrat-ui (+ `packages/proto`)

---

## Objective

Make the `/config-ui` namespace editor fast to operate:
- a namespace Select above the keys table replaces the landing card grid;
- each row shows a clamped description and a last-updated timestamp, from a new additive
  `ConfigKeyMeta.updated_at` populated by `ListKeys` from the resolved row;
- the inline edit form stops remounting its inputs on every keystroke, so focus stays where the
  operator put it.

## Codebase Map

- **`packages/proto`**
  - `ConfigKeyMeta` — `packages/proto/config/v1/config.proto:154-168`. Fields 1–9 are used; the
    last is `current_value = 9` (`:167`). Every field carries a preceding comment.
  - The Timestamp import is already present (`:7`). Existing Timestamp fields to mirror:
    `ConfigSnapshot.updated_at = 3` (`:52`) and `SetConfigResponse.updated_at = 2` (`:140`).
  - ts-proto opts are at `packages/proto/buf.gen.yaml:26-31`. `useDate` is unset, so its default
    (true) maps Timestamp to JS `Date`.
- **`xstockstrat-config`** (Node, ts-proto + grpc-js)
  - Service definition: the ts-proto `ConfigServiceService` (`src/grpc/serviceDefinition.ts:1,5`).
    No proto-loader.
  - Handler: `listKeys` at `src/grpc/configServiceImpl.ts:511-556`.
    - SELECT at `:517-521`: `DISTINCT ON (key) … ORDER BY key, (user_id = $3) DESC NULLS LAST`.
    - Mapping at `:524-551`; secret redaction at `:536`.
  - Timestamp precedent: `updatedAt: new Date()` at `:176`, `:199` and `:505`.
  - Schema: `config_values.updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
    (`migrations/001_config_tables.up.sql:19`).
    - The BEFORE UPDATE trigger sets `NEW.updated_at = NOW()` on every update
      (`017_config_secrets_and_scoping.up.sql:76`).
    - The SetConfig upsert also sets `updated_at = NOW()` (`configServiceImpl.ts:491-498`).
    - Last migration: `030`. No migration is needed.
  - Tests (`node:test`) live in `src/__tests__/`:
    - `listKeysWire.test.ts:29-128` runs a grpc-js round trip with stubbed rows;
    - `listKeysCurrentValue.test.ts:41-80` captures the SQL and asserts on it;
    - `listKeysDedup.test.ts:62,68` asserts on `DISTINCT ON` / `ORDER BY`.
  - Commands: `pnpm test`, `test:coverage` (c8, 40%), `lint` (`package.json:12-17`). The CI
    `coverage_threshold` is 40 (`ci.yml:536`).
- **`xstockstrat-ui`** (Next.js 15)
  - Landing page `src/app/config-ui/page.tsx`:
    - `KNOWN_NAMESPACES` at `:10-21`; `nsHref` at `:25`; env redirect at `:34-35`;
    - heading at `:48`; `EnvSwitcher` + `ScopeControl` at `:53-54`; card grid at `:57-68`;
    - the `EnvSwitcher` server component at `:73-117`.
  - `src/app/config-ui/[namespace]/page.tsx:14-20` is a server component. It clamps env, runs
    `resolveConfigScope`, and renders `NamespaceEditor`. It does not pass `selfUserId`.
  - `NamespaceEditor.tsx`:
    - local `envToProto` at `:22`, which duplicates `hooks/useConfigKeys.ts:7`;
    - edit state at `:53-56`; `handleSave` at `:81-119`;
    - `columns` useMemo at `:121-253`; `autoFocus` at `:150`; Description column at `:180-184`;
    - **deps at `:252`**; breadcrumb at `:258-267`; `DataTable` at `:304-309`.
  - `ScopeControl.tsx:12,25-29` is a client component with query-preserving `router.push`.
  - `scope.ts:11-19` holds `resolveConfigScope`.
  - The audit breadcrumb is at `audit/page.tsx:96`.
  - `DataTable` renders cells via `flexRender(cell.column.columnDef.cell, …)` at
    `src/components/ui/data-table.tsx:191`.

## Patterns to REUSE

- Namespace Select → reuse `ui/select.tsx` (Radix, `:174-185`) as a controlled
  `value`/`onValueChange`, following `components/insights/StrategyPicker.tsx:33-44`. That pattern
  includes a unique `aria-label` on `SelectTrigger`.
- Query-preserving navigation → copy `ScopeControl.tsx:25-29` (`URLSearchParams` +
  `router.push`); `app/insights/page.tsx:67-74` is a second example.
- Shared header → reuse the existing `EnvSwitcher` and `ScopeControl` as-is; move them, don't
  re-create them.
- Namespace list → move `KNOWN_NAMESPACES` to one module, imported by the page and the Select.
  Do not duplicate it.
- Timestamp → reuse `timestampToDate` from `src/lib/protoTime.ts:16`, the declared one shared
  home (`:2`). Render with `toLocaleString()`, as `insights/strategies/[id]/page.tsx:133` does.
  Don't use `@bufbuild/protobuf/wkt` `timestampDate` directly; `users/page.tsx:164` diverges here
  and is not to be copied.
- `envToProto` → reuse `hooks/useConfigKeys.ts:7` instead of the local copy at
  `NamespaceEditor.tsx:22`, only if the edit touches it anyway (no drive-by cleanup).
- Empty / null cell → `'—'`, matching the existing `NamespaceEditor` value cell and
  `strategies/[id]:133`.
- Server-side test → the `listKeysWire.test.ts` grpc-js round-trip harness plus the
  SQL-capture pattern from `listKeysCurrentValue.test.ts:41-80`.
- e2e fixtures (C-12):
  - extend `CONFIG_KEY_FIXTURES` (`e2e/fixtures/configKeys.ts:44-135`) with `updatedAt` on
    selected rows, and update the `INVENTORY.md:37` row;
  - the mock `listKeys` (`e2e/mock-backend.ts:1290-1303`) spreads the fixtures;
  - `setConfig` (`:1300-1303`) can stamp a per-key override timestamp the same way
    `configValueOverrides` stamps the value;
  - auth comes from `e2e/helpers/auth.ts` (`addAuthCookie`).

## Existing Business Rules (preserve / extend)

- **PRESERVE** `@AC-3 @feature-147` "GetConfig and ListKeys redact secrets at the edge"
  (`services/xstockstrat-config/acceptance/config-secrets-and-scoping.feature`). Adding
  `updated_at` must not touch the redaction branch; 218 `@AC-7` re-asserts this.
- **EXTEND** `@AC-11 @feature-147` "A per-user config value overrides the global value" (same
  file). `updated_at` must come from the same `DISTINCT ON` resolved row (218 `@AC-6`/`@AC-13`).
- **PRESERVE** `@AC-8 @feature-161`: the `ListKeys` key set for `analysis` is unchanged
  (`services/xstockstrat-config/acceptance/surface-signal-weight-decay-config.feature`).
- **PRESERVE** `@AC-6 @feature-161`: the decay half-life row still shows its default, its
  description, and the `[0, 8760]` hint after the re-layout
  (`services/xstockstrat-ui/acceptance/surface-signal-weight-decay-config.feature`).
- **PRESERVE** `@AC-9 @feature-043`: Users stays reachable from config-ui nav
  (`services/xstockstrat-ui/acceptance/user-management-ui.feature`).
- **PRESERVE** `@AC-9 @feature-156`: "Run fundamentals scan" stays reachable
  (`services/xstockstrat-ui/acceptance/fix-fundamentals-signal-producer.feature`).
- **PRESERVE** `@AC-6 @feature-153`: config-ui data calls stay on the `makeBrowserTransport`
  `/config-ui/api` client (`services/xstockstrat-ui/acceptance/ui-auth-improvements.feature`).
- **PRESERVE** `@AC-1`/`@AC-1b @feature-147`: the SetConfig request for secrets is unchanged by the
  edit-form refactor.
- **EXTEND** `@AC-5 @feature-184` (`services/xstockstrat-config/acceptance/opportunity-config-operability.feature`).
  218 `@AC-12` adds the UI-side refresh after a write.
- **No CHANGE verdicts.** The grid, heading, Description column and `← namespaces` link are
  asserted only by e2e specs, not by durable `@AC-*`.

## Dependencies

- **Proto/RPC:** `ConfigKeyMeta` gets field 10, which is free (`config.proto:154-168`). The change
  is additive and non-breaking.
  - The UI reads it as protobuf-es `Timestamp {seconds: bigint, nanos}`.
  - The config service writes it as a JS `Date` (ts-proto `useDate`).
- **Migration:** none.
- **Config keys:** none.
- **Inter-service edges:** unchanged. The UI BFF `forward`s `ListKeys` (`src/lib/configUiBff.ts:26`).
- **Other ConfigKeyMeta consumers:** the agent's `list_config_keys` builds its result field by
  field (`services/xstockstrat-agent/app/client.py:1947-1974`), so it is unaffected and out of
  scope.
- **New env vars / ports:** none.

## Risks / Not-found

- **Invalid Date encoding.** Stubbed test rows have no `updated_at`. The mapping must leave
  `updatedAt` unset when the column is null or absent, never `new Date(undefined)`.
- **Focus bug is structural.** `handleSave` is a fresh closure on every render (`:81`), and the
  deps include `editValue`/`editReason` (`:252`). `flexRender` sees a new cell function and
  remounts the subtree.
  - No stable-column inline-edit pattern exists in the app; the design must choose one.
  - `config-ui/sources/page.tsx:391-430` has the same latent pattern. Out of scope: no
    `autoFocus`, and nobody has reported it.
- **Existing e2e tests use `.fill()` and can't catch the bug.** `reason-capture.spec.ts:14-17`
  and `value-persists-after-save.spec.ts:32-58` fill whole values, which never exposes the
  remount. The regression test must type with `pressSequentially` and assert focus.
- **Breadcrumb test constraint.** `breadcrumb.spec.ts:122` asserts exactly one *link* named
  `platform`. The Select trigger/option shows "platform" but has role `combobox`/`option`, not
  `link`, so it is safe. The breadcrumb's first item becomes a non-link (FR-2).
- **Ledger trap** (`fails.md` 2026-08-09): Radix primitives assert their own ARIA role.
  - The Select is a real combobox that *navigates*. That is acceptable, but it must not wrap
    `<Link>`s.
  - `env-mode-switcher.spec.ts` asserts `EnvSwitcher` links stay `role=link`, so the move must
    keep them as plain `Link`s.
- **Ledger trap** (Connect-JSON fixtures): the mock's `updatedAt` must use the protobuf-es
  message-init shape (`{seconds: BigInt(...), nanos}`), as `setConfig` already does
  (`mock-backend.ts:1302`).
- **Mock namespace filtering.** The mock `listKeys` has no namespace filter, so every namespace
  shows all fixtures. Namespace-switch assertions must rely on URL and Select state, not on
  table contents. Alternatively, add a namespace filter to the mock; the debate decides.
- **Tests asserting the old layout** (to rewrite, not delete):
  - `namespace-nav.spec.ts:27-67` (grid + heading, own `KNOWN_NAMESPACES` copy at `:13-24`);
  - `env-mode-switcher.spec.ts:22-90` (must still pass with the header moved);
  - `mobile-overflow.spec.ts:26,33`; `warmup.setup.ts:33`.
- **Not found:** no `typecheck` script (type checking runs via `next build`); no
  `src/__tests__/fixtures/` home in config (C-13 is lazy, so inline rows are fine with one
  consumer); no formatter beyond `timestampToDate`.

## Recommended Scope

1. **proto:** add `updated_at = 10` and regenerate (`buf lint`, `buf breaking`, `buf-gen.sh`).
2. **config service:** SELECT `updated_at` and map it null-safely. Tests: SQL contains
   `updated_at`, the per-user vs global resolved timestamp (AC-6/13), and secret + timestamp
   (AC-7).
3. **ui fixtures/mock:** add `updatedAt` to fixtures and the mock (setConfig stamps a timestamp)
   and update `INVENTORY.md`.
4. **ui editor:**
   - stable columns and the focus fix (AC-10/11);
   - description under the key (AC-4/5);
   - Updated column (AC-8/9/12);
   - shared header + namespace Select on both routes (AC-1/2/3/14);
   - audit breadcrumb relabel.
5. **ui e2e:** rewrite `namespace-nav.spec.ts`, add focus, description and timestamp specs, and
   re-run the existing config-ui suite.
