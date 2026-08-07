# Design: fix-config-ui-env

**Created**: 2026-08-07
**Rounds**: 4 (quick mode; 1 mandated + 3 user-requested; termination: approved)
**Approved by**: user @ 2026-08-07
**Grounded in**: recon.md

---

## Chosen Approach

The fix has two layers, both required — the BFF guard is the load-bearing enforcement; the UI
gating is the presentation layer AC-1 asks for. Neither alone satisfies the product spec: UI-only
gating (round 1's original proposal) hides the entry point but leaves the actual silent write
reachable via direct URL, bookmark, or a stale open tab.

**1. BFF write guard (the actual fix).** `services/xstockstrat-ui/src/lib/configUiBff.ts`'s
`setConfig` handler, immediately after the existing `requireAdminScope(claims)` call (currently the
only write-side gate), rejects a `SetConfig` request whose `environment` doesn't match this
deployment's own native scope:

```ts
if (!isNativeConfigEnvironment(req.environment)) {
  throw new ConnectError(
    `This deployment's native environment is ${getNativeConfigEnv()}; ` +
      'SetConfig requests scoped to a different environment are rejected.',
    Code.FailedPrecondition,
  );
}
```

`Code.FailedPrecondition` (not `Code.PermissionDenied`, the code `requireAdminScope` already uses)
is deliberate: this is a deployment-state mismatch, not an authorization failure, and
`connectCodeToHttp` (`services/xstockstrat-ui/src/lib/connectClients.ts:43-48`) maps it to HTTP
400 — distinct from the 403 an admin-scope failure returns, so a legitimate admin on the wrong
deployment gets an accurate signal, not a misleading "not allowed."

The comparison resolves `Environment.UNSPECIFIED → Environment.DEV` before comparing, mirroring the
backend's own `resolveEnv`/`ENV_MAP` (`services/xstockstrat-config/src/grpc/configServiceImpl.ts:22,87-92`)
and the platform's documented convention that an `UNSPECIFIED` enum value means "server default,"
never an error (PROTO-3). A raw exact-match would falsely reject a legitimate write on a dev-native
deployment while correctly rejecting one on a prod-native deployment — asymmetric and wrong. No
current caller sends `UNSPECIFIED` today (verified: `[namespace]/page.tsx`'s `envToProto` always
returns `1` or `2`, and both e2e fixture sites always pass an explicit `environment`), so this is
forward-looking correctness, closed now rather than left as a latent trap.

**2. `src/lib/deploymentEnv.ts` (new)** — the single canonical home for the native-scope check,
consumed by the BFF and by both Server Components below (never by a Client Component — `APPLICATION_ENV`
is not exposed to the client bundle, `next.config.js` has no `env`/`publicRuntimeConfig` key for it):

```ts
export function getNativeConfigEnv(): 'dev' | 'production' {
  return process.env.APPLICATION_ENV === 'production' ? 'production' : 'dev';
}

export function isNativeConfigEnvironment(env: Environment): boolean {
  const effective = env === Environment.UNSPECIFIED ? Environment.DEV : env;
  const nativeProtoEnv = getNativeConfigEnv() === 'production' ? Environment.PRODUCTION : Environment.DEV;
  return effective === nativeProtoEnv;
}
```

This normalizes `APPLICATION_ENV`'s `"development"`/`"production"` vocabulary to the Config UI's
own `"dev"`/`"production"` vocabulary (`.do/app.yaml:26-27` vs
`services/xstockstrat-config/migrations/002_config_environment.up.sql:8`) in exactly one place,
rather than adding a third divergent copy alongside the two that already exist
(`[namespace]/page.tsx:21-26` and `useConfigKeys.ts:11-18`).

**Reads stay ungated.** `listKeys`/`GetConfig` are untouched — `xstockstrat-config/CLAUDE.md`
documents these as deliberately open at the backend, and gating them at the BFF would break the
"view a fixed, non-actionable value" UX the badge/banner (below) exists to enable.

**3. `EnvModeSwitcher` — consumer surface #1** (`services/xstockstrat-ui/src/app/config-ui/page.tsx:58-99`).
The non-native `ENV` option renders as a `Badge` + `title`-attribute tooltip instead of a `<Link>`,
mirroring the existing `TradingModeBadge` fixed-value pattern
(`services/xstockstrat-ui/src/components/shared/TradingModeBadge.tsx:12-22`) rather than inventing
a new UI primitive. The native option remains an active `<Link>` — AC-2 (no behavior change to
native-scope reads/writes) holds exactly.

**4. `config-ui/[namespace]/page.tsx` — consumer surface #2**, the actual edit page. Split into a
thin Server Component wrapper (resolves `nativeEnv` server-side via `getNativeConfigEnv()`, no
network round-trip — verified this reaches its Client Component child safely: `config-ui/layout.tsx`
already wraps the route in a `Providers` Client Component boundary, so a Server-wrapper → Client-child
split beneath it is standard Next.js App Router) and a new `NamespaceEditor.tsx` Client Component
receiving `namespace`/`env`/`mode`/`nativeEnv` as props. When `env !== nativeEnv`, it shows a warning
banner and adds `!isNativeEnv` to the Save button's existing `disabled` clause — a pure additive OR,
verified not to change the existing `saving`/`validationError` disabled conditions
(`[namespace]/page.tsx:227` today: `disabled={saving || (editingKey === k.key && !!validationError)}`).

A fetch-based alternative (a new API route + client hook, mirroring `useIsAdmin`/`/api/auth/me`) was
considered and rejected — see Rejected Alternatives. The server-wrapper/prop-passing shape has no
loading state, so it cannot reopen the "button looks enabled while a value resolves" presentation
gap AC-1 is about.

**5. `MODE` (paper/live) axis stays completely untouched** — explicitly out of scope per product-spec.
Technical reason, corrected from an earlier imprecise framing during the debate: unlike `environment`
(siloed by physical database — a mismatched write is permanently orphaned), `trading_mode` rows share
the same database per environment (`configServiceImpl.ts`'s `trading_mode = $3 OR trading_mode = 'all'`
merge). A MODE-mismatched write is not orphaned the way an ENV-mismatched one is — it sits dormant in
the *same* reachable database and could become live on a future redeploy with the other `TRADING_MODE`.
This is a real, different-shaped residual risk (see Open Risks), correctly deferred, not silently
identical to the ENV case.

**6. Tests.** `deploymentEnv.test.ts` (new vitest unit test — `getNativeConfigEnv` normalization
branches, `isNativeConfigEnvironment`'s UNSPECIFIED-equivalence and exact-match cases). Two rewritten
assertions in `env-mode-switcher.spec.ts` (badge-not-link for the non-native option; the other four
existing tests — dev-default, MODE clicks, "both rows visible" — are unaffected, MODE is untouched).
One new case in `api-smoke.spec.ts` asserting the BFF guard rejects a mismatched-environment write
with HTTP 400. One new `env-gate.spec.ts` asserting the namespace-page banner/disabled-Save behavior.
`playwright.config.ts`'s `webServer.env` gets `APPLICATION_ENV: 'development'` added explicitly for a
deterministic native scope in CI (the fallback in `getNativeConfigEnv()` would also resolve an unset
var to `'dev'`, but an explicit value is clearer for a test fixture than relying on a fallback).

Per C-12/C-13: the new BFF-guard e2e test would be the 3rd inline copy of the same `SetConfig`
payload literal shape already duplicated twice within `api-smoke.spec.ts` (lines 144-151, 158-165).
A small `e2e/fixtures/configKeys.ts` factory, registered in `INVENTORY.md`, is added in the same step
so the new test doesn't add a fourth.

## Rejected Alternatives

- **Switcher-only gating (round 1)** — rejected: hides the `EnvModeSwitcher` entry point but leaves
  the actual write path (`[namespace]/page.tsx`'s `SetConfig` mutation) completely unguarded and
  reachable via direct URL/bookmark/stale tab — doesn't satisfy AC-1 or the reproduction steps, and
  the product spec's own Consumer Surface section names `[namespace]/page.tsx` as an affected
  consumer of this change, not just the switcher.
- **Fetch-based `native-env` API route + client hook for `[namespace]/page.tsx` (round 2)** —
  rejected: as an unauthenticated route it diverged from this codebase's stated double-gating
  philosophy without a clear reason (its cited precedent, `config-ui/health/route.ts`, turned out to
  be unreachable-as-claimed once actually traced through `middleware.ts`'s matcher); as a fetch it
  introduces a loading-race window where the Save button renders enabled before the native scope
  resolves — reopening exactly the "presented as a plain, silently-writable choice" gap AC-1 exists
  to close, patched around rather than avoided.
- **`Code.PermissionDenied` for the BFF guard** — rejected: semantically wrong (this is a deployment
  topology mismatch, not an authorization failure) and would map to HTTP 403, more confusing to a
  legitimate admin who holds write scope but is on the wrong deployment than the 400
  `Code.FailedPrecondition` gives.
- **Rejecting `Environment.UNSPECIFIED` outright in the BFF guard (round 3's initial shipped
  default)** — rejected in favor of resolving it to `DEV` before comparing: an unconditional
  rejection is a false positive on a dev-native deployment (the backend's own `resolveEnv` already
  treats `UNSPECIFIED` as `dev`) and a silent, undocumented deviation from the platform's PROTO-3
  convention.
- **Blocking non-native reads (`listKeys`/`GetConfig`) at the BFF** — rejected: the backend
  documents these as deliberately open, and blocking them would break the "view a fixed, inert value"
  UX the badge/banner pattern is built to enable.

## Open Risks

- [ ] **MODE (paper/live) residual risk, deferred, not this feature's scope**: a MODE-mismatched
  config write is not orphaned the way an ENV-mismatched one is — it sits dormant in the same
  database and could become live on a future redeploy with the other `TRADING_MODE`. No BFF guard or
  UI gating is added for this axis in this feature. Named follow-up: a future feature scoped
  specifically to MODE-axis write guarding, if/when this risk is judged worth closing (per C-14,
  deferring only counts when it points at a named follow-up, not "later" — recording that
  determination is itself the follow-up action for now, not a commitment to build one).
- [ ] **`ENVIRONMENT_UNSPECIFIED` proto enum member naming unverified against generated stubs**: the
  design assumes protobuf-es strips the `ENVIRONMENT_`/`ENVIRONMENT_UNSPECIFIED` prefix to
  `Environment.UNSPECIFIED`/`Environment.DEV`/`Environment.PRODUCTION`, inferred by analogy to the
  confirmed `TradingMode.UNSPECIFIED` usage in `useConfigKeys.ts:17`, not directly confirmed against
  `packages/proto/gen/ts/` (which the root CLAUDE.md directs against reading directly). To be
  confirmed at `/sdd-spec`/`/sdd-execute` time by reading the actual import in `useConfigKeys.ts` at
  the point of writing `deploymentEnv.ts` — trivial to fix if the exact member name differs
  (`tsc` will fail loudly on a wrong enum member name, so this cannot ship silently wrong).

## Constitution Rules Touched

- `C-01` — honored by: every claim in this design cites a verified `path:line` (recon.md or direct
  adversary re-verification across 4 rounds); no invented paths or symbols.
- `C-05` — honored by: no new config key is introduced; `APPLICATION_ENV` is an existing deployment
  env var, not a `<service>.<category>.<key>` config value.
- `C-08` — honored by: every code-bearing step (BFF guard, `deploymentEnv.ts`, both UI surfaces) is
  paired with a test in the same implementation step (unit test for the helper, e2e for the BFF
  guard and both UI gates).
- `C-10` — honored by: this fix updates *every* reachable write path (BFF guard covers direct
  RPC/bookmark/stale-tab access, not just the UI's own links) rather than only the discoverable
  surface — the exact shape round 1's rejected proposal failed to satisfy.
- `C-12`/`C-13` — honored by: the new BFF-guard e2e test's `SetConfig` payload comes from a new
  `e2e/fixtures/configKeys.ts` factory (registered in `INVENTORY.md`) rather than a fourth inline
  literal copy.
- `C-14` — honored by: both named consumer surfaces from product-spec (`EnvModeSwitcher` and
  `[namespace]/page.tsx`) receive their own gating in this design — the MODE-axis deferral is
  recorded as an explicit Open Risk with a named-follow-up framing, not a silent gap.
- `F-04` — honored by: no invented file path or symbol; every file referenced (`configUiBff.ts`,
  `connectClients.ts`, `bffShared.ts`, `TradingModeBadge.tsx`, `config-ui/layout.tsx`,
  `configServiceImpl.ts`, `useConfigKeys.ts`) was read directly by a subagent across the 4 debate
  rounds, not assumed.
- No Floor (`F-*`) breach was raised at any of the 4 rounds.
