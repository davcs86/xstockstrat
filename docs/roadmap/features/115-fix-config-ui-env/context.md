# Context: fix-config-ui-env  (archived 2026-08-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-16 — /sdd-archiver

**What**: BFF-layer `Code.FailedPrecondition` write guard in `configUiBff.ts`'s `setConfig` handler (the load-bearing enforcement — closes every access path, direct URL/stale tab/bookmark included) plus UI gating on both named consumer surfaces (`EnvModeSwitcher` badge in `config-ui/page.tsx`; banner + disabled Save in `[namespace]/page.tsx` via a Server Component wrapper / Client Component (`NamespaceEditor.tsx`) split). Zero changes to `xstockstrat-config`. 8 steps.

**Why (irrecoverable rationale)**: `Code.FailedPrecondition` chosen over `Code.PermissionDenied` because topology mismatch ≠ authorization failure (caller has full credentials, system state prevents the action — see design.md §Rejected Alternatives, confirmed by the adversary's round-2 objection). `APPLICATION_ENV` uses `"development"`/`"production"` (`.do/app.dev.yaml:26`) while the Config UI's `env` query param and the DB `environment` CHECK constraint use `"dev"`/`"production"` (`services/xstockstrat-config/migrations/002_config_environment.up.sql:8`) — normalization `"development"` → `"dev"` required at every comparison site (mirrors the companion Go hotfix's `resolveEnvironment` logic). `APPLICATION_ENV` is not `NEXT_PUBLIC_*` — absent from the client bundle; must be passed as a server-side prop via a thin Server Component wrapper. `Environment.UNSPECIFIED` must resolve to DEV before comparing (protobuf-es strips the `ENVIRONMENT_` prefix — confirmed via `useConfigKeys.ts:11-18`'s live `Environment.PRODUCTION`/`Environment.DEV` usage; `Environment.UNSPECIFIED` reference in `deploymentEnv.ts` is correct, not merely inferred). Reads left ungated (backend documents as open; a mis-ENV read cannot cause data corruption).

**Rejected alternatives**:
- Switcher-only UI gating — rejected round 1: cosmetic, leaves the `SetConfig` write path reachable via direct URL/bookmark/stale tab (context.md sdd-design round 1).
- Fetch-based `native-env` API route for `[namespace]/page.tsx` — rejected round 2: loading race reopens the AC-1 presentation gap (context.md round 2).
- `Code.PermissionDenied` — rejected: topology mismatch ≠ auth failure (context.md round 2; design.md §Rejected Alternatives).
- Unconditional `UNSPECIFIED` rejection — rejected round 3: would falsely block a legitimate write on a dev-native deployment (backend's `ENV_MAP` already treats UNSPECIFIED as DEV).

**Scars & gotchas**:
- `api-smoke.spec.ts` had THREE inline `SetConfig` payload literals (not 2 as design.md cited) — Step 4 centralizes all three plus the new env-mismatch test into `e2e/fixtures/configKeys.ts`'s `setConfigPayload()` factory per C-12.
- The `config-ui-duplicate-keys-defect` fix that landed on `main-dev` concurrently added a `meta?.environment ?? envToProto(env)` fallback inside `handleSave`, shifting `[namespace]/page.tsx` by ~5 lines — orthogonal to this feature, self-correcting because Step 7 matches by content, not hardcoded line number.
- Playwright env note for CI-equivalent runs: repo's pinned Chromium build (headless_shell-1217) ≠ pre-provisioned (`chromium-1194`) — run with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` + `CI=true`.

**Permanent deviations**: none beyond the vocabulary normalization (`"development"` → `"dev"`) which was captured in the spec before execution.

**Cross-feature signal**: companion `hotfix/fix-watchconfig-clients-omit` (SEV-1) was a prerequisite — that hotfix restored WatchConfig consumers reading `environment`/`trading_mode`, making this UI gate's write-blocking meaningful again.

**Deferred follow-ons**: MODE (paper/live) axis enforcement explicitly deferred per product-spec Out of Scope — a MODE-mismatched write is not orphaned (same DB, can go live on a future redeploy with the other TRADING_MODE).

**Ledger entries written**: insights.md 3 NEW (BFF+UI two-layer guard pattern; FailedPrecondition for deployment mismatch; Server Component wrapper for server-only env vars); fails.md 2 NEW (APPLICATION_ENV vocabulary mismatch; APPLICATION_ENV not in client bundle) + 1 DUP skipped (fails.md:329).

**Runtime-invariant recommendations (→ /context-constitution)**:
- UI-CONFIG-1: `configUiBff.ts`'s `setConfig` handler is the ONLY write path all Config UI browser clients flow through — enforcement must land there; UI-only gating leaves direct-URL and stale-tab paths wide open.
- UI-ENV-1: `APPLICATION_ENV` vocabulary: DO app platform uses `"development"`/`"production"`; Config UI DB CHECK constraint uses `"dev"`/`"production"` — normalization required at every comparison site.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at this commit; recoverable via `git show <pre-archive-SHA>:<path>`.
