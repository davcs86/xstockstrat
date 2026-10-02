# Context: config-ui-usability

**Feature**: `docs/roadmap/features/219-config-ui-usability/feature.md`
**Product Spec**: `docs/roadmap/features/219-config-ui-usability/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/219-config-ui-usability/implementation-spec.md`

---

## Session 2026-10-02 — sdd-story

- Created feature.md (status: draft), product-spec.md, acceptance.feature, context.md from user story.
- Operator decisions (asked up front, recorded verbatim in intent):
  - Last-updated timestamp: **do the proto change now** (`ConfigKeyMeta.updated_at`). The
    audit-log-derived and skip alternatives were rejected.
  - Namespace selection: **replace the landing grid with a dropdown**; `/config-ui/[namespace]`
    is kept for deep links.
  - Description: **under the key, clamped**; the separate column is dropped.
  - Process: **full SDD pipeline** requested (no C-11 override).
- Focus-bug root cause found during intake: `NamespaceEditor`'s `columns` `useMemo` depends on
  `editValue`/`editReason`/`handleSave` (and `handleSave` is re-created every render). The
  tanstack `flexRender` treats each new `cell` function as a new component type, so both `Input`s
  remount on every keystroke and the value input's `autoFocus` re-fires.

- Development happens on the harness-assigned branch `ccr-8a11e328-8tlo4j` (PR #1207 → `main-dev`),
  not `feature/config-ui-usability`. This is a session constraint: the harness pushes only to that branch.

## Session 2026-10-02 — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Pass 1 FAILED on criterion 9 (unchecked Open Questions, P-03). Fixed: decisions recorded, and
  ledger traps moved to a Known Traps section. Also fixed: FR-2 now specifies the shared header and
  the non-link breadcrumb; AC-6 is split (AC-13 added); AC-8 checks the visible text; AC-14 was added.
- Pass 2 PASS WITH WARNINGS. Both warnings were folded in: AC-12 now has a before/after `updatedAt`
  so the refresh assertion can fail, and FR-2 covers relabelling the audit-page breadcrumb (C-10).
- Overlap findings: none (CLEAN). Field 10 is free. Feature 217 also regenerates `packages/proto/gen`,
  so whichever merges second re-runs `./scripts/buf-gen.sh`.

## Session 2026-10-02 — sdd-design

- Phase 0 Recon: wrote recon.md for xstockstrat-config, xstockstrat-ui and packages/proto.
  - Key reuse patterns: `ScopeControl` basePath + `router.push`; `protoTime.timestampToDate`;
    the `listKeysWire` / SQL-capture test harnesses.
- Phase 1 Grilling: 3 rounds. Quick mode mandates 1; the user asked for 2 more.
- Chosen approach:
  - a shared server `ConfigNamespaceView` on both routes, with `/config-ui` rendering platform
    directly (no redirect);
  - module-level DataTable cells reading an `EditContext` (the focus fix);
  - `NamespaceEditor` keyed by namespace|env|user, so a draft can't save into a different scope;
  - `ConfigKeyMeta.updated_at = 10` taken from the same `DISTINCT ON` row;
  - nav `aliases` so namespace pages highlight Settings › Config.
- Rejected:
  - redirecting to `/config-ui/platform` (breaks the exact-match nav highlight and AC-1);
  - refs/useMemo columns, a dialog editor, a mock namespace filter, shared-mock timestamp stamping;
  - hand-written Connect-JSON fixtures.
- User decisions:
  - timestamp semantics = **row last modified** (no `value_changed_at` migration);
  - breadcrumb = **plain-span branch in PageBreadcrumb**;
  - **nav aliases fix included** (not deferred).
- AC-2 wording amended to use the caller's own id (`test-user-001`), keeping the same ID, because
  `resolveConfigScope` clamps foreign ids.
- Constitution rules touched: C-09, C-10, C-12/13, C-14, C-15, C-16, C-17, C-18; F-01/04/06/07
  honored. Floor breaches: none.
- Status: spec-ready → design-approved.

## Session 2026-10-02 — sdd-spec

- Generated implementation-spec.md with 13 steps. Status: design-approved → implementation-ready.
- Order:
  - proto → proto-gen;
  - config `listKeys` + node:test (AC-6/7/13);
  - e2e fixtures;
  - three UI service→test pairs: header/Select (AC-1/2/3), breadcrumb + nav aliases (AC-14), and
    the editor refactor (focus AC-10/11; rows AC-4/5/8/9/12);
  - a docs reconciliation step.
- Key codebase findings:
  - `listKeys` SELECT is at `configServiceImpl.ts:517-521` and mapping at `:524-551`. No migration
    (last is `030`).
  - `buf breaking` baseline: `feature/config-ui-usability` does not exist (harness branch
    `ccr-8a11e328-8tlo4j`). Step 1 names `origin/main-dev` (CI's PR baseline) as the substitute, to
    be logged as a deviation.
  - `PlatformHeader.isItemActive` (`:97-100`) is the only nav matcher for Settings. `BottomTabBar`
    renders only `NAV_GROUPS.slice(0, 4)`, so `aliases` need no mobile change.
  - The context doc `services/xstockstrat-config/docs/context-constitution.md` CONFIG-2/CONFIG-7
    cites `configServiceImpl.ts` lines that are already off and will shift further. Step 13
    reconciles them, adds the new specs to `ui-ux-governance.md:216`, and does the teardown.
  - There is no in-repo precedent for `toJson(XSchema, create(XSchema, …))` in e2e. Step 5 blocks
    (F-04) if the `*Schema` exports are missing, rather than hand-writing JSON.
  - `env-mode-switcher.spec.ts:37` uses `getByText('production', {exact:true})`. Re-run it in
    Step 7 now that the landing page renders the editor's env badge.

## Open Threads

- [ ] Guard against inline cell arrows reintroducing the remount: module-scope comment + AC-11
  probe test (editor refactor step).
- [ ] AC-6/AC-13 are proven by SQL shape only; no DB harness (backend step).
- [ ] Feature 217 also regenerates `packages/proto/gen`; re-run `buf-gen.sh` if it merges first
  (proto step / merge).

## Session 2026-10-02 — sdd-review impl-spec (advisory)

- Result: 1 failure and 15 warnings (advisory, did not block); 1 Floor risk.
- Resolved before execution (spec bodies are still mutable pre-execution; F-09 applies from the first step flip):
  - [x] **F-03 risk.** Step PRs would have targeted `main-dev`, not the declared branch. Resolved by
    declaring `ccr-8a11e328-8tlo4j` as the Development Branch (feature.md and the spec header) and
    running `/sdd-execute sequential`: no per-step PRs; PR #1207 is the single integration PR.
  - [x] Step 2: the Files list used a wildcard. It now enumerates the tracked `gen/ts/dist/config/v1`
    files, drops the non-emitted `.pyi`, and verifies via `git diff --stat` instead of grepping
    generated code.
  - [x] Step 12: item 7 RED accounting corrected to "partially RED"; its value assertion is now
    deterministic (prefill-based); AC-8/AC-9 goto URL stated.
  - [x] Step 13: added the stale `buildConfigValue` cites at `:31`/`:48`; out-of-Files drift goes
    through the Deviation Log (F-08).
- Carried into execution:
  - [ ] Step 3: cite drift "returned object (:529-549)" is actually `:531-550`. Re-grep at execution.
  - [ ] Step 6: touches 6 files (>5). Accepted, because module + view + routes are one coherent change.
    Also add a vitest unit test for `configUiHref` (cheap, in `src/lib` coverage scope).
  - [ ] Step 9: replace the "if the Section nav is collapsed" hedge with a deterministic precondition
    at execution.
  - [ ] Step 8: the `PLATFORM_SUBNAV.config` relabel is cosmetic (`subNav` is legacy and ignored).
    Kept, because the design approved it.
  - [ ] Steps 5/7/9/11/12: no numeric coverage gate (Playwright/frontend). N/A by design.
- Overlap findings: CLEAN. WARN on `e2e/fixtures/INVENTORY.md` and `packages/proto/gen/**` with
  feature 217; both need only a rebase/regenerate.

## Session 2026-10-02 — sdd-execute (sequential) boot

- **Renumbered 218 → 219.** Merging `origin/main-dev` brought in `218-fix-setupenv-unbootable-env`
  (filed by another session in `0fbb3b8`). Per root CLAUDE.md § Feature Roadmap, the later
  allocation moves to the next free number (`max+1 = 219`). Directory, path cites and
  "feature 218" mentions were updated. `@AC-*` IDs are unchanged.

- Tooling setup (steps 1-13): node 22 ✓ (CLAUDE.md pins 24; CI uses 24) · pnpm 9.15.9 ✓ · pnpm install ⬇ · docker ✓ (dockerd started) · buf ⬇ 1.72.0 via npx · codegen image building (step 2) · Playwright chromium ✓ (/opt/pw-browsers)

### Step 1 — proto: add `ConfigKeyMeta.updated_at = 10` [done]
- Added `google.protobuf.Timestamp updated_at = 10` with a constraint comment. `buf lint` and `buf breaking` (vs origin/main-dev) pass. TDD: N/A (proto).
- Files modified: `packages/proto/config/v1/config.proto`
- Deviations: the breaking baseline is `origin/main-dev` (Deviation Log).

### Step 2 — proto-gen: regenerate stubs for `config/v1` [done]
- Ran `./scripts/buf-gen.sh` inside the pinned `Dockerfile.codegen` image (proxy CA via a BuildKit secret). The diff is limited to the 8 listed `config/v1` files, with no drift elsewhere. TDD: N/A (proto-gen).
- Files modified: the `gen/{go,python,ts,ts/dist}/config/v1` files listed in the step.
- Deviations: none

### Step 3 — service: `ListKeys` selects and maps `updated_at` [done]
- Added `updated_at` to the single `DISTINCT ON (key)` SELECT (resolved row; WHERE/ORDER BY untouched) and mapped it as `updatedAt: r.updated_at ?? undefined` beside `currentValue`. The redaction branch is untouched. Lint: 0 errors.
- TDD: RED is Step 4's suite run against the pre-Step-3 tree (`# pass 1 # fail 4`: SQL shape, AC-6, AC-13, AC-7 failed; the absent-column case passed). GREEN after this step: `# pass 5 # fail 0`.
- Files modified: `services/xstockstrat-config/src/grpc/configServiceImpl.ts`
- Deviations: none. Review warning "Step 3 cite drift (:529-549 vs :531-550)": re-grepped and edited at the actual line. [x]

### Step 4 — test: `ListKeys` `updatedAt` over a real gRPC connection [done]
- New `listKeysUpdatedAt.test.ts` on the grpc-js round-trip harness. The pool emulates DISTINCT ON resolution by `$3`. It covers the SQL shape, AC-6, AC-13, AC-7 and the absent→unset case. RED 1/4 → GREEN 5/0. The full suite is 118/118 with c8 at 80.37% lines (gate 40%). Rows are inline (single consumer, C-13).
- Files modified: `services/xstockstrat-config/src/__tests__/listKeysUpdatedAt.test.ts`
- Deviations: none

### Step 5 — test: e2e config-key fixtures [done]
- `platform.log_level` got a static init-shape `updatedAt`. Added `listKeysStubBody`/`setConfigStubBody` (protobuf-es `toJson(create(...))`; schemas confirmed exported) and the keyed `CONFIG_KEY_STUB_ROWS`. INVENTORY updated (row extended + new row). TDD: N/A (fixture-only).
- Files modified: `services/xstockstrat-ui/e2e/fixtures/configKeys.ts`, `services/xstockstrat-ui/e2e/fixtures/INVENTORY.md`
- Deviations: tsc baseline has 3 pre-existing errors in untouched files; the pass condition is "no new errors" (Deviation Log).

### Step 6 — service: shared namespace module, `ConfigNamespaceView`, `NamespaceSelect` [done]
- `src/lib/configNamespaces.ts` (`KNOWN_NAMESPACES` + `configUiHref`, now used by EnvSwitcher, NamespaceSelect and ScopeControl); `ConfigNamespaceView` server component shared by both routes (EnvSwitcher moved verbatim with basePath-aware hrefs; editor keyed `ns|env|user`); `NamespaceSelect` client combobox. Landing grid removed; `/config-ui` keeps its env redirect and renders platform directly.
- TDD: RED is Step 7's spec against the pre-Step-6 UI: 6/6 failed (no combobox; no scope control on the namespace page). GREEN after Step 6 (see Step 7).
- Static checks: tsc shows only the 3 baseline errors; lint 0 errors; jscpd 0 clones; one `KNOWN_NAMESPACES` declaration.
- Files modified: `src/lib/configNamespaces.ts`, `src/lib/configNamespaces.test.ts` (Deviation Log), `src/app/config-ui/{ConfigNamespaceView,NamespaceSelect,page,ScopeControl}.tsx`, `src/app/config-ui/[namespace]/page.tsx`
- Review warning "Step 6: >5 files + configUiHref unit test": the unit test is added (3/3). The file count is accepted as one coherent change. [x]

### Step 7 — test: namespace Select, deep link, query preservation, scope remount [done]
- Rewrote `namespace-nav.spec.ts` (not deleted) against the combobox (exact role name), importing `KNOWN_NAMESPACES` from src. AC-3 uses a `page.route` stub built by `listKeysStubBody`. Added the scope-remount case.
- RED: 6 failed (pre-Step-6). GREEN: 21/21 passed across namespace-nav, env-mode-switcher and breadcrumb (CI mode).
- Files modified: `services/xstockstrat-ui/e2e/config-ui/namespace-nav.spec.ts`
- Deviations: none

### Step 8 — service: breadcrumb plain-span branch, audit crumb relabel, nav aliases [done]
- `PageBreadcrumb`: a non-last item without href renders as a plain `<span>`; only the last item is `BreadcrumbPage`. Editor crumbs are `[Config, <ns>]`; the audit crumb is relabelled `Config`. `SubNavItem.aliases` is matched in `isItemActive`, and Settings › Config aliases every `/config-ui/<known ns>`. `PLATFORM_SUBNAV.config[0]` is relabelled `Config`.
- TDD: RED is Step 9's appended specs against the pre-Step-8 tree (3/3 failed). GREEN in Step 9.
- Static: tsc baseline only; lint 0 errors; jscpd 0; no `← namespaces` left in src.
- Files modified: `src/components/shared/{PageBreadcrumb,navGroups,PlatformHeader}.tsx`, `src/app/config-ui/[namespace]/NamespaceEditor.tsx` (crumb items only), `src/app/config-ui/audit/page.tsx`
- Review warning "Step 8 relabel cosmetic": kept, because the design approved it. [x]

### Step 9 — test: header, non-link breadcrumb, audit crumb, nav highlight [done]
- Appended AC-14, nav-highlight and audit-crumb cases to `namespace-nav.spec.ts`. RED 3/3 → GREEN 23/23 across namespace-nav, breadcrumb, nav-reachability and audit.
- Files modified: `services/xstockstrat-ui/e2e/config-ui/namespace-nav.spec.ts`
- Review warning "Step 9 nav hedge": the precondition is deterministic. Settings › Config exists in the Section nav only if the route resolves to the Settings group, so no collapse/expand branch is needed. [x]
