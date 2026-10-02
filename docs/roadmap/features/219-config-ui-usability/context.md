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
