# Implementation Spec: fix-config-ui-env

**Status**: `pending`
**Created**: 2026-08-07
**Feature**: `docs/roadmap/features/115-fix-config-ui-env/feature.md`
**Total Steps**: 8
**Feature Branch**: `feature/fix-config-ui-env`

---

## Execution Summary

The BFF write guard (Steps 1–4) lands first because it is the load-bearing enforcement per
design.md — it closes every write path (direct RPC, bookmark, stale tab), not just the UI's own
links. Steps 1–2 build and unit-test the single canonical native-scope helper
(`src/lib/deploymentEnv.ts`) that every later step consumes. Steps 3–4 wire it into
`configUiBff.ts`'s `setConfig` handler and prove the guard with an e2e smoke test. Steps 5–8 are
the presentation layer AC-1 asks for, on the two named consumer surfaces (product-spec `##
Consumer Surface(s)`): the `EnvModeSwitcher` (Steps 5–6) and the namespace edit page (Steps 7–8).
Both UI steps depend on Step 1's helper and on Step 4's `playwright.config.ts` `APPLICATION_ENV`
addition for a deterministic native scope in CI.

No proto, migration, or config-key step is required — `Environment` already carries
`ENVIRONMENT_UNSPECIFIED`/`ENVIRONMENT_DEV`/`ENVIRONMENT_PRODUCTION`
(`packages/proto/common/v1/common.proto:57-61`) and `APPLICATION_ENV` is an existing deployment
env var (`.do/app.yaml:26`, `.do/app.dev.yaml:26`), only newly *consumed* here. Only one service,
`xstockstrat-ui`, is touched — `xstockstrat-config` was named in product-spec's Affected Services
for its data model, not because recon or design found a code path there needing a change.

## Step Dependencies

- Step 2 requires Step 1: unit-tests the helper `deploymentEnv.ts` creates.
- Step 3 requires Step 1: the BFF guard imports `getNativeConfigEnv`/`isNativeConfigEnvironment`.
- Step 4 requires Step 3: e2e-tests the guard Step 3 adds; also adds `playwright.config.ts`'s
  `APPLICATION_ENV: 'development'` webServer env var, which Steps 6 and 8 depend on for a
  deterministic native scope.
- Step 5 requires Step 1: `EnvModeSwitcher`'s Server Component wrapper calls `getNativeConfigEnv()`.
- Step 6 requires Step 5 (rewrites its assertions) and Step 4 (`APPLICATION_ENV` in `webServer.env`).
- Step 7 requires Step 1: the new Server Component wrapper calls `getNativeConfigEnv()`.
- Step 8 requires Step 7 (tests the split it introduces) and Step 4 (`APPLICATION_ENV` in
  `webServer.env`).
- No step touches `xstockstrat-config` — confirmed by recon.md: the ENV/MODE-scoped data model is
  the thing the toggle exposes, not a code path this fix modifies.
- MODE (paper/live) axis: explicitly out of scope per product-spec's Out of Scope and design.md §5
  (residual risk recorded as an Open Risk, not a step — no follow-up feature number exists yet;
  this is the recorded determination itself, per Constitution C-14's "named follow-up" framing).

---

### Step 1 — service: native-scope helper (`src/lib/deploymentEnv.ts`)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/deploymentEnv.ts` — create

**Reviewers**: Service Owner (xstockstrat-ui) — "environment scope correctness" (`docs/runbooks/reviewer-registry.md` § Service Owners)

**Codebase Evidence**:
- `APPLICATION_ENV` vocabulary: `.do/app.yaml:26-27` / `.do/app.dev.yaml:26-27` set it to
  `"production"`/`"development"`; the only current consumer is
  `services/xstockstrat-ui/src/telemetry.ts:20` (`process.env.APPLICATION_ENV ?? 'development'`).
- Config UI's own vocabulary: `services/xstockstrat-config/migrations/002_config_environment.up.sql:8`
  (`CHECK (environment IN ('dev', 'production'))`) — confirms `"development"` must normalize to
  `"dev"`, not be compared raw.
- `Environment` proto enum: `packages/proto/common/v1/common.proto:57-61` —
  `ENVIRONMENT_UNSPECIFIED = 0; ENVIRONMENT_DEV = 1; ENVIRONMENT_PRODUCTION = 2;`. Confirmed the
  generated TS stub strips the `ENVIRONMENT_` prefix (resolves design.md's Open Risk #2): grep of
  `services/xstockstrat-ui/src/app/config-ui/hooks/useConfigKeys.ts:11-18` shows live usage of
  `Environment.PRODUCTION`, `Environment.DEV`, and `TradingMode.UNSPECIFIED` (the sibling enum, same
  codegen) imported from `@xstockstrat/proto/common/v1/common_pb` — `Environment.UNSPECIFIED` is the
  same pattern.
- Backend's own resolution to mirror: `services/xstockstrat-config/src/grpc/configServiceImpl.ts:22`
  (`const ENV_MAP: Record<number, EnvStr> = { 0: 'dev', 1: 'dev', 2: 'production' };`) and `:87-92`
  (`resolveEnv`) — confirms `UNSPECIFIED`(0) → `dev`, matching design.md's chosen comparison.
- Existing small canonical-constant module pattern to mirror:
  `services/xstockstrat-ui/src/lib/basepath.ts` (three exported `BASE_PATH_*` constants, no
  framework imports) — `deploymentEnv.ts` is the same shape of file, one level up in complexity.

**TDD**: `red-green required`

**Instructions**:
Create `services/xstockstrat-ui/src/lib/deploymentEnv.ts`:

```ts
// Canonical native-scope resolution for the Config UI's ENV axis (feature 115). Reads
// APPLICATION_ENV (existing deployment env var — .do/app.yaml:26-27 / .do/app.dev.yaml:26-27)
// and normalizes its "development"/"production" vocabulary to the Config UI's own
// "dev"/"production" vocabulary (services/xstockstrat-config/migrations/002_config_environment.up.sql:8).
// Consumed by the BFF write guard (configUiBff.ts) and by Server Components only —
// APPLICATION_ENV is not exposed to the client bundle (next.config.js has no env/
// publicRuntimeConfig key for it); a Client Component must receive the resolved value as a prop.
import { Environment } from '@xstockstrat/proto/common/v1/common_pb';

export function getNativeConfigEnv(): 'dev' | 'production' {
  return process.env.APPLICATION_ENV === 'production' ? 'production' : 'dev';
}

/**
 * True when `env` (a SetConfigRequest/ListKeysRequest environment field) matches this
 * deployment's native scope. Environment.UNSPECIFIED resolves to Environment.DEV before
 * comparing, mirroring the backend's own resolveEnv/ENV_MAP
 * (services/xstockstrat-config/src/grpc/configServiceImpl.ts:22,87-92) — an unconditional
 * exact-match would falsely reject a legitimate write on a dev-native deployment.
 */
export function isNativeConfigEnvironment(env: Environment): boolean {
  const effective = env === Environment.UNSPECIFIED ? Environment.DEV : env;
  const nativeProtoEnv =
    getNativeConfigEnv() === 'production' ? Environment.PRODUCTION : Environment.DEV;
  return effective === nativeProtoEnv;
}
```

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
```
(No behavioral check here — Step 2's vitest run is the paired red→green proof; `tsc`/`next lint`
alone confirms the `Environment` import resolves and the file type-checks.)

---

### Step 2 — test: `deploymentEnv.test.ts`

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/deploymentEnv.test.ts` — create

**Reviewers**: Service Owner (xstockstrat-ui) — "environment scope correctness"

**Codebase Evidence**:
- Existing `src/lib/*.test.ts` unit-test pattern: `services/xstockstrat-ui/src/lib/scoreDisplay.test.ts:1-9`
  (`describe`/`it`/`expect` from `vitest`, plain function imports, no mocking framework).
- Coverage scope: `services/xstockstrat-ui/vitest.config.ts:9-24` — `coverage.all: false`, scoped to
  `src/lib/**`; `deploymentEnv.ts` is not in the `exclude` list (`src/lib/*Bff.ts`,
  `connectClients.ts`, `identity.ts`), so this test makes it count toward the 40% threshold.

**TDD**: `red-green required` (write this test against the pre-Step-1 tree first — the import from
`./deploymentEnv` fails until Step 1 lands; `/sdd-execute`'s TDD gate captures that red run, then
the green run after Step 1).

**Instructions**:
Create `services/xstockstrat-ui/src/lib/deploymentEnv.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { Environment } from '@xstockstrat/proto/common/v1/common_pb';
import { getNativeConfigEnv, isNativeConfigEnvironment } from './deploymentEnv';

const ORIGINAL_APPLICATION_ENV = process.env.APPLICATION_ENV;

afterEach(() => {
  if (ORIGINAL_APPLICATION_ENV === undefined) delete process.env.APPLICATION_ENV;
  else process.env.APPLICATION_ENV = ORIGINAL_APPLICATION_ENV;
});

describe('getNativeConfigEnv', () => {
  it('returns "production" only when APPLICATION_ENV is exactly "production"', () => {
    process.env.APPLICATION_ENV = 'production';
    expect(getNativeConfigEnv()).toBe('production');
  });

  it('normalizes "development" to "dev"', () => {
    process.env.APPLICATION_ENV = 'development';
    expect(getNativeConfigEnv()).toBe('dev');
  });

  it('falls back to "dev" when APPLICATION_ENV is unset', () => {
    delete process.env.APPLICATION_ENV;
    expect(getNativeConfigEnv()).toBe('dev');
  });
});

describe('isNativeConfigEnvironment', () => {
  it('matches DEV, not PRODUCTION, on a dev-native deployment', () => {
    process.env.APPLICATION_ENV = 'development';
    expect(isNativeConfigEnvironment(Environment.DEV)).toBe(true);
    expect(isNativeConfigEnvironment(Environment.PRODUCTION)).toBe(false);
  });

  it('matches PRODUCTION, not DEV, on a production-native deployment', () => {
    process.env.APPLICATION_ENV = 'production';
    expect(isNativeConfigEnvironment(Environment.PRODUCTION)).toBe(true);
    expect(isNativeConfigEnvironment(Environment.DEV)).toBe(false);
  });

  it('treats UNSPECIFIED as DEV on a dev-native deployment (matches)', () => {
    process.env.APPLICATION_ENV = 'development';
    expect(isNativeConfigEnvironment(Environment.UNSPECIFIED)).toBe(true);
  });

  it('treats UNSPECIFIED as DEV on a production-native deployment (does not match)', () => {
    process.env.APPLICATION_ENV = 'production';
    expect(isNativeConfigEnvironment(Environment.UNSPECIFIED)).toBe(false);
  });
});
```

**Verification**:
```
cd services/xstockstrat-ui && pnpm run test:unit -- deploymentEnv.test.ts
cd services/xstockstrat-ui && pnpm run test:coverage
```
Confirm all cases pass and the `src/lib` coverage threshold (40% lines/functions/statements) still
holds — `deploymentEnv.ts` is now a fully-exercised file in the `all: false` scope.

---

### Step 3 — service: BFF write guard (`configUiBff.ts`)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/lib/configUiBff.ts` — modify

**Reviewers**: Service Owner (xstockstrat-ui) — "config mutation safety, environment scope correctness, Connect-RPC call safety"

**Codebase Evidence**:
- Current `setConfig` handler (the only write-side gate today, admin-scope only):
  `services/xstockstrat-ui/src/lib/configUiBff.ts:17-28`.
- `Code`/`ConnectError` are not yet imported in this file — `bffShared.ts:8-14` shows the existing
  import shape (`import { createConnectRouter, ConnectError, Code, ... } from '@connectrpc/connect';`)
  to mirror.
- `Code.FailedPrecondition` → HTTP 400 mapping (distinct from `PermissionDenied`'s 403, which
  `requireAdminScope` already returns): `services/xstockstrat-ui/src/lib/connectClients.ts:43-48`.
- `SetConfigRequest.environment` field type: `packages/proto/config/v1/config.proto:94`
  (`xstockstrat.common.v1.Environment environment = 6;`) — matches `isNativeConfigEnvironment`'s
  `Environment` parameter type from Step 1.

**TDD**: `red-green required`

**Instructions**:
In `services/xstockstrat-ui/src/lib/configUiBff.ts`:
1. Add `import { ConnectError, Code } from '@connectrpc/connect';` and
   `import { getNativeConfigEnv, isNativeConfigEnvironment } from '@/lib/deploymentEnv';` to the
   import block.
2. In the `setConfig` handler (currently lines 17-28), insert the guard immediately after the
   existing `requireAdminScope(claims);` call and before the `configClient.setConfig(...)` call:

```ts
    async setConfig(req, ctx) {
      const claims = await requireSession(ctx);
      // Config writes are admin-only — enforced here as defense in depth. The backend
      // ConfigService.SetConfig also checks the propagated x-access-scope ADMIN bit
      // (feature 074); neither gate is load-bearing alone. Keeps an explicit body rather
      // than forwardAdmin because the author is injected from the verified session below.
      requireAdminScope(claims);
      // This deployment's native scope is fixed by APPLICATION_ENV — dev and production are
      // separate physical databases, so a write scoped to the other environment is silently
      // unreachable by any real consumer (feature 115). Reject it here, not just in the UI,
      // so a direct RPC call / bookmark / stale tab can't bypass the gate the UI presents.
      if (!isNativeConfigEnvironment(req.environment)) {
        throw new ConnectError(
          `This deployment's native environment is ${getNativeConfigEnv()}; ` +
            'SetConfig requests scoped to a different environment are rejected.',
          Code.FailedPrecondition,
        );
      }
      return configClient.setConfig(
        { ...req, author: claims.user_id },
        { headers: backendHeaders(claims, ctx) },
      );
    },
```

`listKeys` is untouched — reads stay ungated per design.md (the backend documents them as
deliberately open; gating them would break the "view a fixed, inert value" UX Steps 5-8 build).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
```
(Behavioral proof is Step 4's e2e test — the BFF handler has no standalone unit-test harness in
this codebase; `src/lib/*Bff.ts` files are excluded from vitest coverage,
`vitest.config.ts:16`, and are proven by Playwright e2e instead.)

---

### Step 4 — test: BFF guard e2e coverage (`api-smoke.spec.ts` + fixture + playwright env)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/fixtures/configKeys.ts` — create
- `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md` — modify
- `services/xstockstrat-ui/e2e/config-ui/api-smoke.spec.ts` — modify
- `services/xstockstrat-ui/playwright.config.ts` — modify

**Reviewers**: Service Owner (xstockstrat-ui) — "config mutation safety, environment scope correctness"

**Codebase Evidence**:
- Pre-existing duplication (the trigger for centralization per **C-12**): the same
  `SetConfig` payload literal shape (`namespace`/`key`/`value`/`reason`/`environment`/`tradingMode`)
  appears twice already: `services/xstockstrat-ui/e2e/config-ui/api-smoke.spec.ts:144-151` and
  `:158-165`; a third, scenario-distinct copy (different key/value, asserts admin-denial) is at
  `:176-183`.
- `INVENTORY.md` currently lists "Config keys" under **Not yet centralized** →
  `e2e/mock-backend.ts` (`listKeys`) — this step adds the first fixture module for this domain.
- Fixture-module doc-header pattern to mirror: `services/xstockstrat-ui/e2e/fixtures/formulas.ts:1-8`
  (comment block: canonical-fixture note, shape-source proto citation, INVENTORY.md pointer).
- `SET_CONFIG_BFF` constant and `callBff` helper already defined:
  `services/xstockstrat-ui/e2e/config-ui/api-smoke.spec.ts:19,21-35`.
- `addAdminCookie` helper: `services/xstockstrat-ui/e2e/helpers/auth.ts:61`.
- `playwright.config.ts`'s `webServer.env` block (currently lines 159-185) has no
  `APPLICATION_ENV` key — confirmed absent by direct read.

**TDD**: `red-green required`

**Instructions**:
1. Create `services/xstockstrat-ui/e2e/fixtures/configKeys.ts`:
```ts
/**
 * Canonical SetConfig payload factory for BFF smoke tests (api-smoke.spec.ts).
 *
 * Shape source: `xstockstrat.config.v1.SetConfigRequest`
 * (packages/proto/config/v1/config.proto:88-100).
 *
 * Registered in e2e/fixtures/INVENTORY.md — update it when this file changes.
 */
export function setConfigPayload(overrides: Record<string, unknown> = {}) {
  return {
    namespace: 'platform',
    key: 'platform.log_level',
    value: { value: { case: 'stringVal', value: 'debug' } },
    reason: 'Updated via config-ui',
    environment: 1,
    tradingMode: 0,
    ...overrides,
  };
}
```
2. In `services/xstockstrat-ui/e2e/config-ui/api-smoke.spec.ts`, add
   `import { setConfigPayload } from '../fixtures/configKeys';` to the import block, then replace the
   three existing inline `SetConfig` payload literals (lines 144-151, 158-165, 176-183) with calls to
   `setConfigPayload({ ...overrides })` (e.g. the `warn` test becomes
   `setConfigPayload({ value: { value: { case: 'stringVal', value: 'warn' } } })`; the admin-denial
   test becomes `setConfigPayload({ key: 'platform.maintenance_mode', value: { value: { case: 'boolVal', value: true } }, reason: 'should be rejected' })`).
3. Add a new test in the `test.describe('POST /api/config — inline edit save flow', ...)` block,
   after the existing admin-denial test:
```ts
  test('SetConfig is rejected for a non-native environment (FailedPrecondition → 400)', async ({
    page,
  }) => {
    // webServer.env sets APPLICATION_ENV=development (native scope = dev = Environment.DEV = 1).
    // environment: 2 (PRODUCTION) is the non-native scope for this deployment.
    await addAdminCookie(page);
    await page.goto('/auth/login');
    const { status, body } = await callBff(
      page,
      SET_CONFIG_BFF,
      setConfigPayload({ environment: 2 }),
    );
    expect(status).toBe(400);
    expect(JSON.stringify(body).toLowerCase()).toContain('native environment');
  });
```
4. In `services/xstockstrat-ui/playwright.config.ts`, add `APPLICATION_ENV: 'development',` to the
   `webServer.env` block (after `INGEST_ENDPOINT: '127.0.0.1:9093',`, before `JWT_SECRET: ...`), with
   a short comment noting it fixes this deployment's native Config UI scope to `dev` for feature 115's
   BFF guard and UI gating.
5. In `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`, add a row to the **Canonical fixtures**
   table: `Config key SetConfig payload | \`setConfigPayload\` | \`e2e/fixtures/configKeys.ts\` |
   \`xstockstrat.config.v1.SetConfigRequest\` | \`e2e/config-ui/api-smoke.spec.ts\`` and remove the
   "Config keys" row from **Not yet centralized** (the `listKeys` response shape stays inline in
   `mock-backend.ts` — only the `SetConfig` request payload is centralized by this step).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm test:e2e e2e/config-ui/api-smoke.spec.ts
```
Confirm the new "rejected for a non-native environment" test fails (import/500, or an unexpected 200)
against the pre-Step-3 tree and passes after Step 3; confirm the three converted tests still pass
unchanged in behavior.

---

### Step 5 — service: `EnvModeSwitcher` gating (`config-ui/page.tsx`)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/page.tsx` — modify

**Reviewers**: Service Owner (xstockstrat-ui) — "config mutation safety, environment scope correctness"

**Codebase Evidence**:
- Current `HomePage` + `EnvModeSwitcher`: `services/xstockstrat-ui/src/app/config-ui/page.tsx:21-99`
  (no `'use client'` directive — a Server Component, confirmed by direct read of the file's first
  line, `import { redirect } from 'next/navigation';`).
- Fixed-badge pattern to mirror: `services/xstockstrat-ui/src/components/shared/TradingModeBadge.tsx:12-22`
  (`Badge` + a plain `title`-attribute tooltip, no shared Radix `Tooltip` primitive exists in
  `src/components/ui/`).
- `Badge` variants available: `services/xstockstrat-ui/src/components/ui/badge.tsx:9-22` (`default`,
  `secondary`, `destructive`, `outline`, `buy`, `sell`, `paper`, `live`, `warning`, `info`) — no
  `disabled` variant exists; use `outline` + explicit opacity/cursor classes (mirrors the pattern
  already used for the switcher's own inactive-link styling at `page.tsx:71`).

**TDD**: `red-green required`

**Instructions**:
In `services/xstockstrat-ui/src/app/config-ui/page.tsx`:
1. Add `import { Badge } from '@/components/ui/badge';` and
   `import { getNativeConfigEnv } from '@/lib/deploymentEnv';` to the import block.
2. In `HomePage` (line 21), after resolving `env`/`mode` (lines 26-27), add
   `const nativeEnv = getNativeConfigEnv();` and pass it to the switcher:
   `<EnvModeSwitcher env={env} mode={mode} nativeEnv={nativeEnv} />` (was `env={env} mode={mode}` at
   line 36).
3. Change `EnvModeSwitcher`'s signature (line 58) to
   `function EnvModeSwitcher({ env, mode, nativeEnv }: { env: string; mode: string; nativeEnv: 'dev' | 'production' })`.
4. Replace the ENV `.map` block (lines 63-76) so the native option stays the existing `<Link>` and
   the non-native option renders as a fixed `Badge`:
```tsx
        {['dev', 'production'].map((e) =>
          e === nativeEnv ? (
            <Link
              key={e}
              href={`/config-ui?env=${e}&mode=${mode}`}
              className={cn(
                'px-2.5 py-1 rounded-md border text-xs font-medium transition-colors',
                env === e
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:border-border/80 hover:text-foreground',
              )}
            >
              {e}
            </Link>
          ) : (
            <Badge
              key={e}
              variant="outline"
              className="px-2.5 py-1 rounded-md text-xs font-medium cursor-not-allowed opacity-60"
              title={`This deployment's native environment is ${nativeEnv}; SetConfig requests scoped to a different environment are rejected.`}
            >
              {e}
            </Badge>
          ),
        )}
```
The MODE `.map` block (lines 79-96) is unchanged — MODE stays fully live per product-spec's Out of
Scope and design.md §5.

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
```
(Behavioral proof is Step 6's e2e run.)

---

### Step 6 — test: `env-mode-switcher.spec.ts` rewrite

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/config-ui/env-mode-switcher.spec.ts` — modify

**Reviewers**: Service Owner (xstockstrat-ui) — "environment scope correctness"

**Codebase Evidence**:
- Test to rewrite #1 (asserts the now-removed unguarded click-through):
  `services/xstockstrat-ui/e2e/config-ui/env-mode-switcher.spec.ts:25-33`
  (`'clicking "production" updates URL to ?env=production'`).
- Test to rewrite #2 (asserts `production` is a `link`, which it no longer is):
  `services/xstockstrat-ui/e2e/config-ui/env-mode-switcher.spec.ts:62-70`
  (`'all four switcher options are rendered'`).
- The other four tests (`:15-23` dev-default, `:35-43` live click, `:45-52` paper click,
  `:54-60` both rows visible) are unaffected — MODE is untouched and `dev` stays a `<Link>`.
- Deterministic native scope for this suite comes from Step 4's `playwright.config.ts`
  `APPLICATION_ENV: 'development'` addition (native env = `dev`).

**TDD**: `red-green required`

**Instructions**:
In `services/xstockstrat-ui/e2e/config-ui/env-mode-switcher.spec.ts`:
1. Replace the test at lines 25-33 (`'clicking "production" updates URL to ?env=production'`) with:
```ts
  test('ENV "production" renders as a fixed badge, not a link, on this dev-native deployment', async ({
    page,
  }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui?env=dev&mode=paper');

    await expect(page.getByRole('link', { name: 'production' })).toHaveCount(0);
    const badge = page.getByText('production', { exact: true });
    await expect(badge).toBeVisible();
    await expect(badge).toHaveAttribute('title', /native environment is dev/);
  });
```
2. Replace the test at lines 62-70 (`'all four switcher options are rendered'`) with:
```ts
  test('dev/paper/live render as links; production renders as a fixed badge', async ({ page }) => {
    await addAuthCookie(page);
    await page.goto('/config-ui');

    await expect(page.getByRole('link', { name: 'dev' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'production' })).toHaveCount(0);
    await expect(page.getByText('production', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'paper' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'live' })).toBeVisible();
  });
```
3. Update the file's top docstring (lines 3-11) — it currently says "The switcher uses plain `<a>`
   tags"; add a sentence noting the non-native ENV option now renders as a fixed `Badge` instead
   (feature 115).

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm test:e2e e2e/config-ui/env-mode-switcher.spec.ts
```
Confirm the two rewritten tests fail against the pre-Step-5 tree (production is still a link) and
pass after Step 5; confirm the four unaffected tests still pass unchanged.

---

### Step 7 — service: namespace edit page split (Server wrapper + `NamespaceEditor.tsx`)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/[namespace]/page.tsx` — modify (becomes a thin Server
  Component wrapper)
- `services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx` — create (the current
  page.tsx's Client Component body, moved)

**Reviewers**: Service Owner (xstockstrat-ui) — "config mutation safety, environment scope correctness, Connect-RPC call safety"

**Codebase Evidence**:
- Current file (Client Component, `'use client'` at line 1, `use(params)`/`use(searchParams)` at
  lines 58-59): `services/xstockstrat-ui/src/app/config-ui/[namespace]/page.tsx:1-60`.
- Existing `Props` type (`params`/`searchParams` as `Promise<...>`):
  `services/xstockstrat-ui/src/app/config-ui/[namespace]/page.tsx:53-56`.
- Save button's current `disabled` clause (pure additive OR target):
  `services/xstockstrat-ui/src/app/config-ui/[namespace]/page.tsx:227`
  (`disabled={saving || (editingKey === k.key && !!validationError)}`).
- Server-wrapper → Client-child split is safe beneath the existing Client Component boundary:
  `services/xstockstrat-ui/src/app/config-ui/layout.tsx:10-15` (`ConfigUILayout` wraps children in
  `<Providers>`, itself a Client Component) — confirmed by direct read.

**TDD**: `red-green required`

**Instructions**:
1. Create `services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx` containing the
   current `page.tsx`'s full body (all imports except `use`, the `envToProto`/`modeToProto`/
   `errMessage`/`validateFloatMap` helpers, and the JSX), with these changes:
   - `'use client';` stays at the top.
   - `import { useState, use } from 'react';` → `import { useState } from 'react';` (no longer
     needed once `namespace`/`env`/`mode` arrive as resolved props).
   - Replace the `Props` type and function signature (currently `export default function
     NamespacePage({ params, searchParams }: Props)`) with:
     ```ts
     type Props = { namespace: string; env: string; mode: string; nativeEnv: 'dev' | 'production' };

     export function NamespaceEditor({ namespace, env, mode, nativeEnv }: Props) {
       const isNativeEnv = env === nativeEnv;
       ...
     ```
     (named export, not default; drop the `use(params)`/`use(searchParams)`/`resolvedSearchParams`
     lines — `namespace`/`env`/`mode` are now plain destructured props).
   - Add a warning banner immediately before the `{loading && ...}` block, shown only when
     `!isNativeEnv`:
     ```tsx
     {!isNativeEnv && (
       <p className="text-xs text-muted-foreground border border-border rounded-md px-3 py-2 bg-muted/30">
         This deployment&apos;s native environment is <span className="font-mono">{nativeEnv}</span>.
         Viewing <span className="font-mono">{env}</span> config is read-only here — edits are
         rejected by the backend.
       </p>
     )}
     ```
   - Change the Save button's `disabled` clause (the line matching
     `disabled={saving || (editingKey === k.key && !!validationError)}`) to
     `disabled={saving || (editingKey === k.key && !!validationError) || !isNativeEnv}` — a pure
     additive OR, does not change the existing `saving`/`validationError` conditions.
2. Replace `services/xstockstrat-ui/src/app/config-ui/[namespace]/page.tsx`'s content with a thin
   Server Component wrapper (no `'use client'`):
```tsx
import { getNativeConfigEnv } from '@/lib/deploymentEnv';
import { NamespaceEditor } from './NamespaceEditor';

type Props = {
  params: Promise<{ namespace: string }>;
  searchParams: Promise<{ env?: string; mode?: string }>;
};

export default async function NamespacePage({ params, searchParams }: Props) {
  const { namespace } = await params;
  const resolvedSearchParams = await searchParams;
  const env = resolvedSearchParams.env ?? 'dev';
  const mode = resolvedSearchParams.mode ?? 'paper';
  const nativeEnv = getNativeConfigEnv();

  return <NamespaceEditor namespace={namespace} env={env} mode={mode} nativeEnv={nativeEnv} />;
}
```

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm build
```
Confirm the build succeeds (Server/Client Component boundary is valid — no `process.env` read
inside `NamespaceEditor.tsx`, no `use()` hook removed from a context that still needs it).

---

### Step 8 — test: namespace editor gate coverage (`env-gate.spec.ts`)

**Status**: `pending`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/config-ui/env-gate.spec.ts` — create

**Reviewers**: Service Owner (xstockstrat-ui) — "config mutation safety, environment scope correctness"

**Codebase Evidence**:
- Mock backend's `listKeys` handler (first non-secret row is `platform.log_level`, has a clickable
  "Edit" button): `services/xstockstrat-ui/e2e/mock-backend.ts:839-888`.
- `Edit`/`Save` button labels: `services/xstockstrat-ui/src/app/config-ui/[namespace]/page.tsx`
  ("Edit" button text, "Save"/"Saving…" button text) — carried unchanged into `NamespaceEditor.tsx`
  by Step 7.
- `addAdminCookie` helper: `services/xstockstrat-ui/e2e/helpers/auth.ts:61`.
- Deterministic native scope from Step 4's `playwright.config.ts` `APPLICATION_ENV: 'development'`
  (native env = `dev`).
- Sibling spec location convention: `services/xstockstrat-ui/e2e/config-ui/env-mode-switcher.spec.ts`,
  `services/xstockstrat-ui/e2e/config-ui/api-smoke.spec.ts` (same directory).

**TDD**: `red-green required`

**Instructions**:
Create `services/xstockstrat-ui/e2e/config-ui/env-gate.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import { addAdminCookie } from '../helpers/auth';

/**
 * E2E coverage for the namespace editor's non-native-environment gate (feature 115).
 * webServer.env sets APPLICATION_ENV=development, so this deployment's native Config UI
 * scope is 'dev'.
 */
test.describe('NamespaceEditor — non-native environment gate', () => {
  test('shows a warning banner and disables Save when env is not this deployment\'s native scope', async ({
    page,
  }) => {
    await addAdminCookie(page);
    await page.goto('/config-ui/platform?env=production&mode=paper');

    await expect(page.getByText(/native environment is/i)).toBeVisible();

    await page.getByRole('button', { name: 'Edit' }).first().click();
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  test('the native environment (dev) shows no banner and Save stays enabled', async ({ page }) => {
    await addAdminCookie(page);
    await page.goto('/config-ui/platform?env=dev&mode=paper');

    await expect(page.getByText(/native environment is/i)).toHaveCount(0);

    await page.getByRole('button', { name: 'Edit' }).first().click();
    await expect(page.getByRole('button', { name: 'Save' })).toBeEnabled();
  });
});
```

**Verification**:
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm test:e2e e2e/config-ui/env-gate.spec.ts
```
Confirm both tests fail against the pre-Step-7 tree (no banner exists, Save is never disabled by
env) and pass after Step 7. Then run the full config-ui suite once to confirm no regression:
```
cd services/xstockstrat-ui && pnpm test:e2e e2e/config-ui
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
