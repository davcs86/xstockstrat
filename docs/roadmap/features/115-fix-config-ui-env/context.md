# Context Log: fix-config-ui-env

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-08-07 (/sdd-triage)

- Bug reported via docs/reports/2026-08-07-config-ui-cross-environment-toggle-defect.md (GitHub
  Issues disabled on this repo — no issue number)
- Severity: SEV-2
- Routed to SDD path (Track C) — defect is architecture-level and reproducible in dev, not a
  confirmed-in-production incident requiring a hotfix
- Created: feature.md, product-spec.md, context.md
- Affected services (from report): xstockstrat-ui (config-ui segment), xstockstrat-config
- Root cause hypothesis: the `environment`/`trading_mode` columns are a genuine config-scoping
  mechanism within one database, but the Config UI toggle was never gated to the deployment's own
  native scope — so it reads as a live environment switch when it can only ever reach the single
  database the running instance is bound to
- Recommended design depth: full → `/sdd-design fix-config-ui-env` (rationale: affected services ≥
  2 per the triage skill's C-0 rule — xstockstrat-ui and xstockstrat-config)
- Development branch: feature/fix-config-ui-env
- Related: companion SEV-1 defect (WatchConfig clients omitting environment/trading_mode) is being
  fixed separately on `hotfix/fix-watchconfig-clients-omit`. That fix makes this UI toggle's
  cross-scope writes reachable by real consumers again once it lands — raising, not lowering, the
  priority of gating the toggle here.

## Session 2026-08-07 (post-triage, pre-design)

- `/sdd-review fix-config-ui-env product-spec` first run FAILed on two artifact-trail issues:
  (a) a race from switching git branches while the review subagents were still reading the
  filesystem (not a real defect — feature.md/context.md exist correctly on this branch; the
  subagent just caught mid-flight branch-switch corruption), and (b) a genuine dangling reference:
  the product spec's `**GitHub Issue**` field pointed at
  `docs/reports/2026-08-07-config-ui-cross-environment-toggle-defect.md`, which lived only on the
  unmerged `claude/trading-mode-env-wiring-78k60s` branch (PR #885) and was unreachable from this
  feature branch's history. Fixed by cherry-picking commit `4e36196` (the report-adding commit)
  onto `feature/fix-config-ui-env`.
- Also addressed the review's WARNING-level findings: numbered the Acceptance Criteria (AC-1/2/3),
  fixed the self-contradictory Fix Scope checkbox (config-key changes: unchecked box + "n/a" note
  → checked), and added an explicit `## Consumer Surface(s)` section naming the `/config-ui`
  segment (C-14).
- **Open design nuance to resolve in `/sdd-design`**: `APPLICATION_ENV` is set to the strings
  `"development"`/`"production"` (`.do/app.yaml:26-27`, `.do/app.dev.yaml:26`), while the Config
  UI's `env` query param and the DB's `environment` CHECK constraint use `"dev"`/`"production"`
  (`services/xstockstrat-config/migrations/002_config_environment.up.sql:8`). A naive
  `APPLICATION_ENV === env` native-scope check would never match on a dev deployment — the fix
  must normalize `"development"` → `"dev"` before comparing (mirrors what the companion Go hotfix
  already does correctly in `resolveEnvironment`: anything other than `"production"` → dev).

## Session 2026-08-07 — sdd-review product-spec

- Re-ran `/sdd-review fix-config-ui-env product-spec` after the fixes above (this time without
  switching branches mid-run). Result: **PASS**, 0 blockers, 1 advisory warning (optionally state
  the fix is UI-only/paper-safe with no market or broker interaction — not a real gap given the
  Out-of-Scope framing already covers it).
- Overlap scan (from the earlier run — unaffected by these edits, no new config keys/proto/DB):
  CLEAN. No live in-flight feature collides with 115.
- Status: draft → spec-ready.

## Session 2026-08-07 — sdd-design (Phase 0 + Phase 1, quick mode, 4 rounds)

- Phase 0 Recon: wrote recon.md (services: xstockstrat-ui config-ui segment only — xstockstrat-config
  was listed as affected for its data model, not because it needs code changes; key reuse patterns:
  `TradingModeBadge` fixed-value pattern, existing `Promise<SearchParams>` Server Component convention).
- Phase 1 Grilling: 4 rounds (quick mode nominally requires 1; user requested 3 additional rounds).
  Round 1: switcher-only UI gating proposed, adversary blocked it — cosmetic, leaves the actual
  `SetConfig` write path fully reachable via direct URL/bookmark/stale tab, misreads product-spec's
  own Consumer Surface section (which names `[namespace]/page.tsx`, not just `EnvModeSwitcher`).
  Round 2: proposed BFF-layer guard (verified sound against real code) + fetch-based `native-env` API
  route for `[namespace]/page.tsx` — adversary found the route's "unauthenticated" framing didn't
  match `middleware.ts`'s actual matcher, and the fetch introduces a loading-race that reopens the
  AC-1 presentation gap. Round 3: revised to a Server Component wrapper + prop-passing split (no
  network round-trip, no race) — adversary caught an asymmetric `ENVIRONMENT_UNSPECIFIED` handling
  bug (raw exact-match would falsely reject a legitimate write on a dev-native deployment) and a C-12
  fixture-centralization gap (new BFF-guard e2e test would be a 3rd inline `SetConfig` payload
  literal). Round 4 (closing check): APPROVE, no new objections, one non-blocking citation correction.
- Chosen approach: BFF-layer `Code.FailedPrecondition` write guard in `configUiBff.ts`'s `setConfig`
  (the actual enforcement, closes every access path) + UI gating on both named consumer surfaces
  (`EnvModeSwitcher` badge, `[namespace]/page.tsx` banner + disabled Save via Server-wrapper prop).
  Rejected: switcher-only fix, fetch-based native-env route, `Code.PermissionDenied`, unconditional
  `UNSPECIFIED` rejection.
- Constitution rules touched: C-01, C-05, C-08, C-10, C-12/C-13, C-14. No Floor breaches across any
  of the 4 rounds.
- Open risk carried forward: MODE (paper/live) axis residual risk — a MODE-mismatched write is not
  orphaned the way an ENV-mismatched one is (same database, could go live on a future redeploy with
  the other TRADING_MODE) — explicitly deferred per product-spec's Out of Scope, not addressed by
  this feature. Also: `Environment.UNSPECIFIED`'s exact protobuf-es member name is inferred by
  analogy (not directly confirmed against generated stubs) — to be confirmed at `/sdd-spec`/execute
  time; `tsc` will fail loudly if wrong, so this cannot ship silently incorrect.
- Status: spec-ready → design-approved.

## Session 2026-08-07 — sdd-spec

- Generated implementation-spec.md with 8 steps. Status → implementation-ready.
- Steps 1-4 (BFF layer, the load-bearing enforcement): `src/lib/deploymentEnv.ts`
  (`getNativeConfigEnv`/`isNativeConfigEnvironment`) + its vitest unit test, the guard wired into
  `configUiBff.ts`'s `setConfig` handler (`Code.FailedPrecondition` after the existing
  `requireAdminScope`), and an e2e smoke test in `api-smoke.spec.ts` proving the guard rejects a
  mismatched-environment write with HTTP 400. Steps 5-8 (UI presentation, the two named consumer
  surfaces): `EnvModeSwitcher` badge-gating in `config-ui/page.tsx` + rewritten
  `env-mode-switcher.spec.ts` assertions, and a Server-wrapper/Client-child split of
  `[namespace]/page.tsx` into a new `NamespaceEditor.tsx` (banner + disabled Save) + new
  `env-gate.spec.ts`.
- Key codebase findings during additional verification (beyond recon.md):
  - Confirmed the browser never calls `xstockstrat-config` directly — `useSetConfig.ts` posts to
    `/config-ui/api` (`browserClients/configClient.ts`), which resolves to
    `src/lib/configUiBff.ts`'s `dispatchConnect`. The BFF guard's only viable landing site is
    `configUiBff.ts`'s `setConfig` handler (`:17-28`), matching design.md exactly.
  - Resolved design.md's Open Risk #2 (unverified `Environment.UNSPECIFIED` member naming):
    confirmed via `useConfigKeys.ts:11-18`'s live `Environment.PRODUCTION`/`Environment.DEV` and
    sibling `TradingMode.UNSPECIFIED` usage — protobuf-es strips the `ENVIRONMENT_`/`TRADING_MODE_`
    prefix as assumed; `deploymentEnv.ts`'s `Environment.UNSPECIFIED` reference is correct as
    written, not just inferred by analogy.
  - `api-smoke.spec.ts` already has **three** inline `SetConfig` payload-shape literals (lines
    144-151, 158-165, 176-183), not two as design.md's citation named — Step 4 centralizes all
    three into the new `e2e/fixtures/configKeys.ts` `setConfigPayload()` factory alongside the new
    4th (env-mismatch) test, per C-12.
  - `playwright.config.ts`'s `webServer.env` block is confirmed at lines 148-187 (not 159-185 as
    recon.md approximated) — `APPLICATION_ENV: 'development'` is added there in Step 4; Steps 6 and
    8 depend on it for a deterministic native scope in CI.

## Session 2026-08-07 — sdd-review impl-spec (advisory)

- Result: 0 failures, 7 warnings (advisory — did not block). Overlap: low-severity (one shared
  additive row in `e2e/fixtures/INVENTORY.md` with feature 096, mechanical rebase, no ordering
  dependency).
- Unresolved ⚠ carried into execution (all minor citation line-number drift — content described
  remains accurate, only line numbers shifted by 1-3; execute-time discovery re-reads files fresh
  so these self-correct, but recording per P-03):
  - Step 3: `bffShared.ts:8-14` import-shape citation off by one — actual `9-15`. — [x] resolved
    (execute-time discovery re-verifies against the live file).
  - Step 4: `callBff` helper citation (`api-smoke.spec.ts:21-35`) truncated — actual `21-38`. — [x] resolved.
  - Step 6: docstring citation (`lines 3-11`) off by one — actual `4-12`. — [x] resolved.
  - Step 7: `use(params)`/`use(searchParams)` citation (`lines 58-59`) off by one — actual `57-58`;
    `Props` type citation (`page.tsx:53-56`) off — actual `51-54`. — [x] resolved.
  - Step 7: instruction wording "(all imports except `use`, the ... helpers, and the JSX)" is
    ambiguous — intent (confirmed by rest of step) is the helpers/JSX carry over unchanged, not
    excluded. — [x] resolved (re-spec'd at the sdd-execute re-spec gate below).
  - Cross-cutting: MODE-axis deferral's C-14 "named follow-up" framing has no actual follow-up
    feature number — already debated and user-approved in `design.md`/this file's design session;
    surfaced again here for visibility only. — [ ] unaddressed — accepted deferral, no action.
- Overlap findings: `e2e/fixtures/INVENTORY.md` shared with `096-position-and-order-detail-pages`
  (additive rows in each, no semantic clash).

## Session 2026-08-07 — sdd-execute sequential (re-spec gate, §5.3)

- Merged current `origin/main-dev` into `feature/fix-config-ui-env` (`git merge -X ours
  origin/main-dev`) before validating the spec — main-dev had moved 40+ commits since this branch
  was cut (features 111/dedup, MCP authz fixes, and an unrelated `config-ui-duplicate-keys-defect`
  fix that touched `[namespace]/page.tsx` directly).
- Validated every step's `**Codebase Evidence**` against the post-merge tree. Only Step 7 was
  affected: the duplicate-keys fix added a `meta?.environment ?? envToProto(env)` /
  `meta?.tradingMode ?? modeToProto(mode)` fallback inside `handleSave` and shifted the file by ~5
  lines. The change is orthogonal to feature 115 — `handleSave` still moves into
  `NamespaceEditor.tsx` unchanged as part of "the current page.tsx's full body," and the Save
  button's `disabled` clause the step modifies matches by exact content, not a hardcoded line
  number, so no design change was needed.
- Re-spec'd Step 7 (directive: none, single-feature run → blocker → user confirmed re-spec):
  corrected the `**Codebase Evidence**` line citations to the current file, noted the
  `meta?.environment` addition explicitly so a future reader isn't surprised by it, and rewrote the
  ambiguous "(all imports except `use`, the ... helpers, and the JSX)" instruction wording to state
  plainly that the helpers/`handleSave`/JSX all move over unchanged.
- No other step required re-specing — Steps 1-6, 8 all validated clean against the post-merge tree.

Tooling setup (steps 1-8, all `xstockstrat-ui`): node ✓ v22.22.2 · pnpm ✓ 9.15.0 · `pnpm install --frozen-lockfile` ✓ · chromium ✓ (pre-provisioned, `/opt/pw-browsers/chromium`).

### Step 1 — service: native-scope helper (`src/lib/deploymentEnv.ts`) [done]
- Created `deploymentEnv.ts` per spec. TDD cycle run in test-first order per Step 2's note (spans
  both steps, per `tdd-gate.md` — red/green captured together, each step's own file committed
  separately): red — `pnpm run test:unit -- deploymentEnv.test.ts` failed with `Cannot find module
  './deploymentEnv'` (right reason — missing implementation, not a typo); green — same command, 7/7
  new tests passed after implementation landed. `pnpm run lint` clean (one pre-existing unrelated
  warning in `insights/strategies/[id]/page.tsx`, not touched by this step).
- Files modified: `services/xstockstrat-ui/src/lib/deploymentEnv.ts`
- Deviations: none

### Step 2 — test: `deploymentEnv.test.ts` [done]
- Test file was written first (per the TDD gate's test-first ordering) during Step 1's red→green
  cycle — already exists and passes (7/7). Re-verified this step's own commands: `pnpm run
  test:unit -- deploymentEnv.test.ts` (7 passed) and `pnpm run test:coverage` (`deploymentEnv.ts`:
  100% stmts/branch/funcs/lines, well above the 40% `src/lib` threshold).
- Files modified: `services/xstockstrat-ui/src/lib/deploymentEnv.test.ts`
- Deviations: none

### Step 3 — service: BFF write guard (`configUiBff.ts`) [done]
- TDD cycle run test-first, spanning Steps 3+4 per `tdd-gate.md`: built Step 4's full deliverable
  set first (fixture, 3 refactored literals, new "rejected for a non-native environment" test,
  `playwright.config.ts` `APPLICATION_ENV` addition), ran the e2e suite for red — confirmed failing
  for the right reason (`Expected: 400, Received: 200`, mock's `setConfig` passes through
  unconditionally), all 3 refactored tests still passed unchanged. Then implemented the guard in
  `configUiBff.ts`; re-ran — 12/12 passed (green). `pnpm run lint` clean (same pre-existing
  unrelated warning).
- Playwright environment note: the repo's pinned Chromium build (headless_shell-1217) isn't the
  pre-provisioned one (`chromium-1194`) — ran with
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` and
  `CI=true` (the non-CI 10s test timeout was too short for cold Next.js dev-server compilation in
  this environment; CI's 30s/240s timeouts are the documented safety margin already built into
  `playwright.config.ts`, not a new fallback). Logged here per the sequential-mode verification
  fallback rule (CI-equivalent, not a spec deviation).
- Files modified: `services/xstockstrat-ui/src/lib/configUiBff.ts`
- Deviations: none (see environment note above — not a spec deviation, a documented CI-equivalent
  invocation)

### Step 4 — test: BFF guard e2e coverage (`api-smoke.spec.ts` + fixture + playwright env) [done]
- Built alongside Step 3 for TDD test-first ordering (see Step 3 entry for the red/green run).
  Centralized the SetConfig payload (3 existing inline literals + the new test) into
  `e2e/fixtures/configKeys.ts`'s `setConfigPayload()` factory per C-12; updated `INVENTORY.md`
  (added the new canonical-fixture row, removed the stale "Config keys" row from "Not yet
  centralized" per the step's own instruction 5).
- Files modified: `services/xstockstrat-ui/e2e/fixtures/configKeys.ts`,
  `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`,
  `services/xstockstrat-ui/e2e/config-ui/api-smoke.spec.ts`,
  `services/xstockstrat-ui/playwright.config.ts`
- Deviations: none

### Step 5 — service: `EnvModeSwitcher` gating (`config-ui/page.tsx`) [done]
- TDD cycle run test-first: wrote Step 6's rewritten tests, `git stash`'d Step 5's `page.tsx`
  change to capture RED against the pre-Step-5 tree — both rewritten tests failed for the right
  reason (`production` still resolved as a link, count 1 not 0), the 4 unaffected tests passed.
  Restored Step 5's change (`git stash pop`), re-ran — 7/7 passed (green). `pnpm run lint` clean.
- Files modified: `services/xstockstrat-ui/src/app/config-ui/page.tsx`
- Deviations: none

### Step 6 — test: `env-mode-switcher.spec.ts` rewrite [done]
- Built alongside Step 5 for TDD test-first ordering (see Step 5 entry for the red/green run via
  `git stash`).
- Files modified: `services/xstockstrat-ui/e2e/config-ui/env-mode-switcher.spec.ts`
- Deviations: none

### Step 7 — service: namespace edit page split (Server wrapper + `NamespaceEditor.tsx`) [done]
- Phase 1 Discovery re-confirmed the re-spec'd Codebase Evidence at execute time, including
  `config-ui/layout.tsx:10-15` (`ConfigUILayout` wraps children in `<Providers>`, itself a Client
  Component — confirms the Server-wrapper → Client-child split is safe beneath the existing
  boundary): no drift since the `04e1890` re-spec commit.
- TDD cycle run test-first, spanning Steps 7+8 per `tdd-gate.md`: wrote Step 8's
  `env-gate.spec.ts` first and ran it against the pre-Step-7 tree — the non-native-scope test
  failed for the right reason (`getByText(/native environment is/i)` — element not found, no
  banner exists yet); the native-env test passed trivially (dev already had no gate). Implemented
  Step 7 (created `NamespaceEditor.tsx` as the current `page.tsx` body moved verbatim + the four
  sanctioned changes; replaced `page.tsx` with the thin Server Component wrapper); diffed the new
  `NamespaceEditor.tsx` against the pre-Step-7 `page.tsx` body to confirm the move was truly
  verbatim (only the four spec'd deltas: `use` import dropped, `Props`/signature swapped to plain
  props + `isNativeEnv`, warning banner inserted, `!isNativeEnv` appended to Save's `disabled`
  clause). Re-ran `env-gate.spec.ts` — 3/3 passed (green, including SSR warmup). Then ran the full
  `e2e/config-ui` suite (41 tests) for a regression check — all 41 passed, no breakage in
  `env-mode-switcher`, `api-smoke`, `namespace-nav`, `reason-capture`, or `sources`.
- Verification: `pnpm run lint` clean (same pre-existing unrelated warning in
  `insights/strategies/[id]/page.tsx`); `pnpm build` succeeded — 39/39 static pages generated,
  `/config-ui/[namespace]` compiles as a dynamic Server Component route with no
  Server/Client-boundary error (confirms no `process.env` read inside `NamespaceEditor.tsx` and no
  `use()` hook left dangling).
- Playwright environment note (same as Steps 3/5): ran with
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` and
  `CI=true` — documented CI-equivalent invocation, not a spec deviation.
- Files modified: `services/xstockstrat-ui/src/app/config-ui/[namespace]/page.tsx`,
  `services/xstockstrat-ui/src/app/config-ui/[namespace]/NamespaceEditor.tsx`
- Deviations: none

### Step 8 — test: namespace editor gate coverage (`env-gate.spec.ts`) [done]
- Built test-first for TDD ordering (see Step 7 entry for the red/green run and the full
  `e2e/config-ui` regression pass — 41/41).
- Files modified: `services/xstockstrat-ui/e2e/config-ui/env-gate.spec.ts`
- Deviations: none
