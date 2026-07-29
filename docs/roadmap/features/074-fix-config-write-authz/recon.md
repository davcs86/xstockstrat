# Recon: fix-config-write-authz

**Created**: 2026-07-29
**From**: product-spec.md
**Affected services**: `xstockstrat-config`, `xstockstrat-ui`

---

## Objective

`ConfigService.SetConfig` (gRPC 50060) performs no authorization check of any kind, and the
config-ui BFF handler that calls it requires only a valid session — so any authenticated UI user of
any role can write arbitrary config today, including `platform.maintenance_mode` and
`trading.approval.*`. This feature adds an `ADMIN`-bit (`x-access-scope & 0x04`) gate on the
`SetConfig` RPC itself, plus the matching `requireAdminScope` gate in the BFF as defense in depth,
without changing the proto, the schema, or any config key.

## Codebase Map

- **`xstockstrat-config`** (Node.js, gRPC 50060)
  - Entry point: `services/xstockstrat-config/src/index.ts:47-50` — `new grpc.Server()` (no options,
    **no interceptor**), `addService(createConfigServiceDefinition(), configImpl)`, bind on
    `0.0.0.0:${grpcPort}` (default `50060`, `index.ts:13`)
  - Service definition: `services/xstockstrat-config/src/grpc/serviceDefinition.ts:5` — one-line
    re-export of the ts-proto `ConfigServiceService`
  - Handler class: `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — 4 handlers, all
    `(call: any, callback: any)` except the stream:
    - `watchConfig(call)` — `:191` (server-streaming)
    - `getConfig(call, callback)` — `:232`
    - **`setConfig(call, callback)` — `:251`, body spans `:251-274`** (destructure `:252`, INSERT
      `:256-265`, `pg_notify` `:266-268`, success callback `:270`, catch `:271-273`)
    - `listKeys(call, callback)` — `:276`
  - **No handler reads `call.metadata`** — grep for `metadata` under `src/` hits only the dead
    propagation file below
  - Dead code: `services/xstockstrat-config/src/middleware/propagation.ts` — exports
    `PropagationContext` (`:4`), `propagationStore` AsyncLocalStorage (`:10`),
    `extractFromHttpRequest(req: IncomingMessage)` (`:14`, reads `req.headers['x-access-scope'] ?? '0'`
    at `:17`). **Zero importers**; HTTP-shaped (Connect-RPC-era leftover), not grpc-js `Metadata`.
    Already logged as a repeated defect —
    `services/xstockstrat-config/docs/context-constitution-findings.md:4`
  - gRPC error idiom: raw numeric callback objects, no helper, no `grpc.status` import —
    `configServiceImpl.ts:272` (`callback({ code: 13, message: err.message })`), same at `:308`
  - Tests: `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts` — **`node:test` +
    `node:assert/strict`** via `--experimental-strip-types`. Fake-`call` idiom is a plain object
    literal with **no metadata** (`:50-55`); fake pool factory `makePool(rows)` (`:25-33`);
    graceful-skip guard on the proto import (`:15-22`, `:36`)
  - Test scripts: `package.json:12` (`test`), `package.json:13` (`test:coverage`, **c8 `--lines 40`**
    — the threshold lives only in that CLI flag, no config file)
  - Last migration: `008_analysis_fundsignal_keys` in `services/xstockstrat-config/migrations/`
    (none needed for this feature)
  - `services/xstockstrat-config/CLAUDE.md:19-28` (gRPC-only, 50060), `:44-60` (WatchConfig flow),
    `:66-68` ("Mutate config via the `SetConfig` gRPC RPC on port 50060"), `:70-76` (Config
    Governance) — **contains no authz/admin statement anywhere**

- **`xstockstrat-ui`** (Next.js, HTTP 3000)
  - BFF router: `services/xstockstrat-ui/src/lib/configUiBff.ts:14-28` — exactly 3 handlers:
    `listKeys` (`:15`, `forward`, session-only), **`setConfig` (`:16`, `requireSession` at `:17`,
    injects `author: claims.user_id` at `:19`, `backendHeaders(claims, ctx)` at `:20`)**,
    `listSignalSources` (`:26`) and `manageSignalSource` (`:27`) on `IngestService`. Dispatch prefix
    `'/config-ui/api'` (`:32`). Import block (`:4-10`) does **not** yet import `requireAdminScope`
  - Guards: `services/xstockstrat-ui/src/lib/bffShared.ts` — `requireSession` (`:32-36`, throws
    `Code.Unauthenticated`), **`requireAdminScope(claims)` (`:50-54`, throws
    `ConnectError('Admin scope required', Code.PermissionDenied)`)**, `backendHeaders` (`:41-47`),
    `forward(call, {admin?})` (`:63-72`), `forwardAdmin(call)` (`:75-79`), error-path header
    normalization so the browser Connect client can parse the error JSON (`:139-144`)
  - Scope model: `services/xstockstrat-ui/src/lib/auth.ts` — `JwtClaims` (`:4-10`),
    `export const ADMIN_SCOPE = 0x04` (`:63`; the DRY guard rail bans the raw literal elsewhere —
    `services/xstockstrat-ui/.eslintrc.json:22`), `rolesToAccessScope` (`:65-76`; only
    `role === 'admin'` sets the bit at `:73`), `hasAdminScope` (`:79-81`)
  - Browser callers: `src/app/config-ui/hooks/useSetConfig.ts:8,11` → sole consumer
    `src/app/config-ui/[namespace]/page.tsx:60` (`setConfigMutate`), `handleSave` `:73-94`, error
    render `:115`; **Edit/Save buttons gated only on `isSecret` + edit state, no role check**
    (`page.tsx:162-171`, `:174-182`)
  - Existing e2e on the target: `e2e/config-ui/api-smoke.spec.ts:19` (`SET_CONFIG_BFF` const),
    **`:120-132`** ("accepts a valid SetConfig payload and returns 200", `addAuthCookie` at `:121`,
    asserts 200 at `:131`) and **`:134-147`** ("SetConfig does not return an error field on
    success", `addAuthCookie` at `:135`, asserts `:145-146`) — **both break under an admin gate**
  - Auth helpers: `e2e/helpers/auth.ts` — `signTestJwt(roles = [])` `:27`, `addCookieWithRoles`
    `:46`, `addAuthCookie(page)` → roles `[]` `:56-58`, `addAdminCookie(page)` → `['admin']` `:61-63`
  - Mock backend: `e2e/mock-backend.ts:752-754` — `async setConfig() { return {}; }` (no change
    needed; the gate is BFF-side)
  - Vitest: `vitest.config.ts:10` include `src/**/*.test.ts`, `:15` coverage `src/lib/**`,
    **`:18` excludes `src/lib/*Bff.ts`** — so `configUiBff.ts` is coverage-excluded by design and
    e2e is the established verification path; `bffShared.ts` is *not* excluded

- **Repo-level caller (neither service):** `scripts/integration-test.sh:41`
  (`CONFIG_URL="http://${BASE_HOST}:8060"`), `:493-497` and `:520-524` — `post_raw … /SetConfig` for
  `platform.maintenance_mode`, **with no identity headers**, both suppressed by `|| true`. The
  `post`/`post_raw` helpers (`:111`, `:120`) send no `x-user-id`/`x-access-scope`.

## Patterns to REUSE

- **The ADMIN-bit gate itself** → reuse the platform rule and its Python reference implementation,
  don't invent a new convention: `docs/patterns/header-propagation.md:24-26` ("Admin-gated RPCs
  check the ADMIN bit on the propagated scope: `int(x-access-scope) & 0x04`. They abort
  `PERMISSION_DENIED` ('admin scope required')") and
  `services/xstockstrat-ingest/app/handlers/servicer.py:119-132` `_has_admin_scope`. Identical
  helpers exist at `services/xstockstrat-analysis/app/handlers/servicer.py:147-159` and
  `services/xstockstrat-indicators/app/handlers/servicer.py:30-42`.
- **Reading gRPC metadata in Node** → the canonical shape is already documented (but not
  implemented anywhere in Node): `docs/patterns/header-propagation.md:116-147`
  `extractFromMetadata(md: Metadata)`. Note `:145-147` explicitly excuses sink/source services
  (ledger, config) from wiring the AsyncLocalStorage *store* — that excuse is about propagation,
  not about authz.
- **BFF admin gate** → reuse `requireAdminScope` (`bffShared.ts:50-54`); for an explicit handler
  body (the exact shape of `setConfig`, which cannot use bare `forwardAdmin` because it injects
  `author`) copy `manageStrategy` — `services/xstockstrat-ui/src/lib/insightsBff.ts:42-54`
  (`requireAdminScope(claims)` at `:51`).
- **Paired admin/non-admin e2e test shape** → copy
  `e2e/trader/live-strategies.spec.ts:37-58` (admin succeeds, `addAdminCookie`) + `:60-78`
  (non-admin denied: `expect(result.status).not.toBe(200)`, `expect(result.body.toLowerCase())
  .toContain('permission')`). Second precedent:
  `e2e/insights/strategy-authoring.spec.ts:31-50`.
- **Node handler unit test** → copy `makePool` + the fake-`call` object literal from
  `services/xstockstrat-config/src/__tests__/configServiceImpl.test.ts:25-33,50-55`, extended with a
  fake `metadata.get()`.
- **Client-side admin signal (if the design chooses to gate the Edit button)** → reuse
  `useIsAdmin()` — `services/xstockstrat-ui/src/hooks/useLiveStrategies.ts:42-53`, backed by
  `src/app/api/auth/me/route.ts:11`. Currently unused anywhere in `src/app/config-ui/**`.
- **Auth cookie fixtures** are already canonical in the test-data inventory —
  `e2e/fixtures/INVENTORY.md:13` (C-12 satisfied by using `e2e/helpers/auth.ts`, no new fixture
  needed unless a config-domain object is introduced).

## Dependencies

- Proto/RPC: **none changed.** `packages/proto/config/v1/config.proto:17,20,23,26` defines exactly 4
  RPCs (`WatchConfig`, `GetConfig`, `SetConfig`, `ListKeys`); `SetConfigRequest` occupies field
  numbers 1-7 with no identity field. `x-access-scope` is gRPC metadata, not a proto field —
  no `buf breaking`/`buf lint` gate applies, no `./scripts/buf-gen.sh` run needed.
- Migration: **none.** (Highest existing in `services/xstockstrat-config/migrations/` is `008`.)
- Config keys: **none new.** The keys named in the spec (`platform.maintenance_mode`,
  `trading.approval.*`) are pre-existing and only illustrative of blast radius.
- Inter-service edges: `xstockstrat-ui` (config-ui BFF) → `xstockstrat-config` `SetConfig` (gRPC
  50060) — the only in-repo runtime caller. `x-access-scope` is **already** forwarded on that call
  (`configUiBff.ts:20` → `bffShared.ts:41-47`), so no header plumbing is needed.
- New env vars / ports: **none.**

## Risks / Not-found

1. **No Node backend has ever read gRPC metadata.** Grep for `call.metadata` / `Metadata` across all
   `services/**/*.ts` returns zero real hits; `ledger`/`identity`/`notify` each carry the same dead
   HTTP-only `propagation.ts`. This fix creates the Node-side precedent — argues for a small shared
   helper with a real unit test rather than an inline one-liner. **Not found:** any existing Node
   `extractFromMetadata`, any grpc-js server interceptor, any `grpc.Server({...})` options block.
2. **No `PERMISSION_DENIED` precedent in any Node service.** Grep finds no `code: 7` and no
   `PERMISSION_DENIED` anywhere in Node. The nearest sibling idiom is a raw numeric literal —
   `services/xstockstrat-identity/src/grpc/identityServiceImpl.ts:60` (`code: 16`). Whether to
   introduce `grpc.status.PERMISSION_DENIED` (named) or follow the `code: 7` numeric-literal house
   style is an open design choice.
3. **Two live callers will break, and one breaks *silently*.** (a) `e2e/config-ui/api-smoke.spec.ts:120,134`
   both run on the **no-roles** `addAuthCookie` and assert 200 — they flip to denied and must move to
   `addAdminCookie`. (b) `scripts/integration-test.sh:493-497`/`:520-524` send no identity headers and
   swallow the result with `|| true`, so **CI stays green while the maintenance-mode scenario becomes
   a no-op** and its downstream assertion (`:513-518`, "PlaceOrder correctly rejected") fails for a
   reason unrelated to its message. This is the C-10 integration-completeness risk for this feature.
   Note `integration-test.sh:41` also still points `CONFIG_URL` at the **removed** port 8060.
4. **`docs/runbooks/config-rollout.md` becomes wrong.** Step 2's gRPC example (`:76-91`) is a bare
   `grpc.insecure_channel` + `stub.SetConfig(...)` with no metadata — post-fix it returns
   `PERMISSION_DENIED`. The sibling Connect-RPC example (`:93-104`) is *already* stale (targets the
   removed port 8060). Product-spec AC #4 as written ("reproduce Step 2's example end-to-end
   post-fix") is therefore unsatisfiable until the runbook is updated — flagged by `/sdd-review`.
5. **Read RPCs deliberately unscoped, but this collides with feature 073.** The bug's Root Cause
   names `SetConfig`/`GetConfig`/`ListKeys` as all ungated, while the acceptance criteria cover only
   `SetConfig`. Feature 073 (`mcp-config-management`) **assumes** `GetConfig`/`ListKeys` stay open
   (073 product-spec:185). If this design gates the reads, 073's `get_config`/`list_config_keys`
   tools inherit a constraint their spec assumes away. Must be decided explicitly, not defaulted.
6. **The BFF is currently the *only* enforcement point, and it has none.** There is no page- or
   component-level admin check anywhere in `src/app/config-ui/**` (no `useIsAdmin`, no
   `hasAdminScope`), so a non-admin sees a fully functional Edit/Save UI. Post-fix they get a raw
   `Save error: …` string (`page.tsx:115`) unless the design also gates the affordance. Related
   already-logged defect of the same class:
   `services/xstockstrat-ui/docs/context-constitution-findings.md:16` (config-ui audit route has no
   admin check, despite its own `// Admin-only` comment at
   `src/app/config-ui/api/audit/route.ts:11`).
7. **Adjacent ungated mutation in the same router, out of scope by the spec.** `manageSignalSource`
   (`configUiBff.ts:27`) is a *mutating* handler also on session-only `forward`. The spec scopes
   this feature to `setConfig`; flagged so it is an explicit exclusion, not an oversight.
8. **`fails.md` trap that applies (2026-07-01 / C-10 family, "shipped the producer, forgot the
   shared consumer"):** every entry in that family is the same shape as Risk 3 — a change landed at
   its first surface and the shared consumer was missed. The e2e specs, the integration script, and
   the runbook are this feature's shared consumers.
9. **Latent pre-existing bug in the edit site.** `configServiceImpl.ts:254` reads request fields as
   **snake_case** (`call.request.trading_mode`) — a known logged defect
   (`services/xstockstrat-config/docs/context-constitution-findings.md:19`). Not this feature's to
   fix, but any new test constructing a fake `call` must match the existing snake_case shape.
10. **Coverage gate shape differs per service.** `xstockstrat-config` uses c8 `--lines 40` from a
    `package.json` CLI flag; `xstockstrat-ui` vitest excludes `src/lib/*Bff.ts` from coverage
    entirely, so the BFF change cannot be covered by a unit test — e2e is the verification path
    there (relevant to C-08 test pairing).

## Recommended Scope

Advisory step boundaries (input to the grilling, not binding):

1. **`service` — `xstockstrat-config`:** add a metadata-reading admin-scope helper + the gate in
   `setConfig`, returning `PERMISSION_DENIED`. Decide: shared helper module vs inline; named
   `grpc.status` vs numeric literal; whether to revive/replace the dead `propagation.ts`.
2. **`test` — `xstockstrat-config`** (paired with step 1, C-08): `node:test` cases for
   admin-allowed / no-scope-denied / missing-metadata-denied, extending the existing `makePool` +
   fake-`call` idiom with a fake `metadata.get()`.
3. **`service` — `xstockstrat-ui`:** add `requireAdminScope(claims)` to the `setConfig` BFF handler
   (`configUiBff.ts:16-22`), mirroring `insightsBff.ts:42-54`.
4. **`test` — `xstockstrat-ui` e2e:** flip `api-smoke.spec.ts:120,134` to `addAdminCookie` and add a
   non-admin-denied case, copying `live-strategies.spec.ts:60-78`.
5. **`integration` — repo scripts:** make `scripts/integration-test.sh` section 13 send admin
   identity headers (and stop swallowing the failure), so the maintenance-mode scenario keeps
   testing what its assertion claims.
6. **`docs`:** update `docs/runbooks/config-rollout.md` Step 2 with the required admin metadata (and
   note the stale 8060 Connect example), plus an authz line in
   `services/xstockstrat-config/CLAUDE.md`.
7. **Optional / to decide in grilling:** `useIsAdmin()` gating of the config-ui Edit/Save
   affordance (Risk 6), and whether `GetConfig`/`ListKeys` stay open (Risk 5).
