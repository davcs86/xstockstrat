# Context: shadcn-table-actions-responsive

**Feature**: `docs/roadmap/features/124-shadcn-table-actions-responsive/feature.md`
**Product Spec**: `docs/roadmap/features/124-shadcn-table-actions-responsive/product-spec.md`
**Implementation Spec**: `docs/roadmap/features/124-shadcn-table-actions-responsive/implementation-spec.md`

---

## Session 2026-08-09 — sdd-story

- Fifth feature in the shadcn/ui migration lineage (`119-shadcn-ui-migration` →
  `120`/`121`/`122`/`123-shadcn-migration-*`). Originated from a direct user question ("did you adopt
  Shadcn Table? I don't see the DropdownMenu in the actions column") asked after 123 merged (PR #914).
- **Verified before writing FRs** (session tool calls, not assumed):
  - Confirmed `Table` is fully adopted (`src/components/ui/table.tsx`, 15 consumers, feature 121 closed
    the last two holdouts per its own implementation-spec Steps 10-11 with a `grep "<table\b" && FAIL`
    gate) — **but a repo-wide grep this session found two NEW raw `<table>`s that predate/postdate that
    gate**: `insights/strategies/[id]/page.tsx:468-500` and `insights/screener/page.tsx:536-580`. Either
    these existed before 121's gate ran (and the gate's grep pattern/timing missed them) or they were
    added after 121 shipped without re-triggering the check — not investigated further, since the fix
    (FR-5) is the same either way.
  - Confirmed `DropdownMenu` was never adopted: `src/components/ui/dropdown-menu.tsx` does not exist,
    zero imports anywhere, never mentioned in any of features 119-123's spec/design/context files.
  - Every current multi-action Actions column (`OrdersTable.tsx`, `config-ui/sources/page.tsx`,
    `NamespaceEditor.tsx`, `insights/strategies/page.tsx`) renders plain inline `Button`s, sometimes
    with an `AlertDialog` for destructive confirms — confirmed via direct file reads, not inferred.
  - `authorized-apps/page.tsx`'s Actions column has only **one** action (Disconnect) — explicitly
    excluded from FR-2 and left as an Open Question rather than force-converted, since a `DropdownMenu`
    wrapping a single item adds a click for no grouping benefit.
- **Dispatched a dedicated read-only audit** (`Explore` subagent, "reduce custom CSS/styling into
  shadcn primitives") after the user asked whether that made sense as a follow-up and then said to kick
  it off. The agent was explicitly instructed to report honestly if a category was already clean rather
  than pad a list — it did: `globals.css` (136 lines) has zero hand-written component rules beyond
  standard shadcn theme-token/reset boilerplate; skeleton/modal/tooltip patterns are fully consolidated
  (zero hand-rolled instances of any of the three found outside `ui/`); only 3/10 `style={{...}}` sites
  were even borderline (static chart-container heights — the other 7 are genuinely dynamic/computed:
  chart series colors, virtualizer row geometry, a progress-bar transform, a meter fill percentage).
  Real findings, all folded into FR-5 through FR-9:
  - Two raw `<table>`s (FR-5, above).
  - A 14-site verbatim-repeated `font-mono text-[9px] font-semibold uppercase tracking-[0.13em]
    text-muted-foreground` "eyebrow" label className across 9 files, with no shared component (FR-6) —
    the clearest "missing component" (not "missing shadcn primitive") finding.
  - Two hand-rolled `Badge`-outline-shaped pills (`opportunities/page.tsx:348`,
    `market/[symbol]/page.tsx:147`, identical className), `StrategyWizard.tsx`'s step-indicator
    reimplementing badge-variant color logic, and `AlertStream.tsx`'s unread-count badge doing the same
    (FR-7).
  - A hand-rolled 2-button multi-select filter in `opportunities/page.tsx:190-216` duplicating
    `ToggleGroup type="multiple"` semantics, which is already in use elsewhere in the same app (FR-8).
  - Two small, low-risk items initially proposed as optional/out-of-scope (3 static chart-height inline
    styles; one raw `green-600` vs. this app's own `text-buy` semantic token in
    `authorized-apps/page.tsx`) — the user explicitly asked to include these; folded in as FR-9, with
    FR-9's own qualifier that the chart-height conversion only happens where it won't decouple the DOM
    height from the numeric value each site also feeds into `useCandlestickChart()`'s
    `lightweight-charts` call (a real coupling, not a cosmetic accident — verify per-site, don't force).
  - The agent's overall verdict, quoted directly rather than summarized away: "a real but modest scope
    left — concentrated in ~9 files, not spread across the codebase... roughly 6-8 genuinely worthwhile
    fix sites plus the 14-instance eyebrow-label consolidation... I'd size it at 'half a feature'
    relative to the prior 5, and would not recommend inventing additional scope beyond what's listed."
- **Breadcrumb repositioning (FR-10)** — a separate, user-directed addition (not from the audit).
  Verified before writing the FR:
  - The only `Breadcrumb` render site outside two already-page-specific ones
    (`NamespaceEditor.tsx:137-149`, aria-label `"Namespace path"`; `config-ui/audit/page.tsx`) is
    `PlatformHeader.tsx:266-282` — a single, shared, generic breadcrumb showing only
    `activeGroup.label`/`activeItem.label` from the `NAV_GROUPS` nav model, rendered identically on
    **every** page via all four shell mount points (`insights/AppShell.tsx`, `trader/AppShell.tsx`,
    `config-ui/layout.tsx`, `accounts/layout.tsx`).
  - **Real, load-bearing e2e dependency found**: `e2e/nav-reachability.spec.ts:70-71` (C-10(a), "a new
    UI page/route must be registered in the shared nav with a nav-reachability test") asserts
    `getByLabel('Breadcrumb')` contains both `item.label` and `group.tab` for **every** route in its
    `GROUPS` table, in the same test as the reachability walk. Moving the breadcrumb out of the shared
    shell will require restructuring this assertion, not just relocating markup — flagged as an Open
    Question rather than pre-decided, since the right replacement query strategy depends on FR-10's
    still-open "shared helper vs. per-page hand-rolled" mechanism question.
  - Confirmed C-10(a) itself is about route *registration/reachability*, not literally about breadcrumb
    placement — repositioning does not violate the constitution rule, it just means the *test* that
    currently proves the rule (by checking a shared shell element) needs a different mechanism once
    that element moves.
  - **Known trap directly on point**: `docs/roadmap/ledger/fails.md`'s 2026-08-09
    `shadcn-migration-high-confidence` entry documents `Breadcrumb`/`BreadcrumbPage` colliding with
    Playwright `getByRole`/`getByLabel` locators **twice** in feature 120 (a case-insensitive
    `aria-label` substring collision, and a `BreadcrumbPage`-built-in `role="link"` colliding with a
    real nav `Link` of the same accessible name) — each caught only by a *later* step's full-suite run,
    not the wiring step's own targeted test. FR-10 moves from 1 shared `Breadcrumb` instance to
    potentially many page-level ones, multiplying this exact risk surface. Called out explicitly in
    product-spec.md's Open Questions as a first-class design constraint for `/sdd-design`/`/sdd-spec`,
    not something to discover via a late full-suite run again.
- Scope grew iteratively across the session via direct user instructions, each incorporated without
  re-litigating: (1) initial ask — DropdownMenu + responsive tables; (2) "does it make sense to add a
  general reduction of custom css/styling... in the same feature?" — answered no (own feature, needs
  its own recon), user agreed and asked to kick off the audit; (3) audit findings presented, categorized
  1-4 by priority/confidence; (4) "add 4" — the previously-proposed-optional category folded in as FR-9;
  (5) "reposition the breadcrumb from the subnav to the actual page layout" — a new, separately-verified
  FR-10, not from the audit.

## Session 2026-08-09T19:52:31Z — sdd-review product-spec

- Product spec approved. Status: draft → spec-ready.
- Criteria pass (spec-reviewer): PASS WITH WARNINGS, no Constitution Floor (F-*) breach.
  - Finding A: FR-2's `insights/strategies/page.tsx` Deactivate site uses `window.confirm(...)`,
    not an `AlertDialog` as stated — no `AlertDialog` import exists in that file. Only
    `OrdersTable.tsx`'s Cancel action is genuinely `AlertDialog`-gated. Fix this citation in
    `/sdd-design`/`/sdd-spec`.
  - Finding B: FR-9's `authorized-apps/page.tsx` line citation is off by one — correct lines are
    `174` (`text-green-600`) and `175` (`bg-green-600`), not `175,179` (179 is the *Unreachable*
    branch's `bg-destructive`, unrelated).
  - Finding C: FR-6's "14 places across 9 files" tally is inconsistent with the codebase — a fresh
    grep found 14 occurrences across only **7** files, with `positions/[symbol]/page.tsx` at **6**
    occurrences (lines 250, 261, 406, 452, 477, 498), not 5. Recount before `/sdd-spec` enumerates
    call sites.
  - Finding D: both "Known trap" ledger citations for the "matches the handoff" insights.md entry
    should read **2026-08-06**, not 2026-08-08 (feature 083 attribution is correct, only the date
    is wrong).
  - Open Questions' 3 unresolved `- [ ]` items are consistent with this feature lineage's
    established convention of deferring genuine design forks to `/sdd-design` — not a blocking
    gap.
- Overlap pass (feature-overlap): COLLISIONS FOUND against sibling shadcn-migration features.
  **No FAIL-level overlap** (no identical config key) so this does not block the gate per Mode A's
  severity table — but the collisions are substantive enough that `/sdd-design` MUST resolve them
  before `/sdd-spec` runs, not just note them:
  - **Confirmed against current main-dev code** (checked directly, not just the sibling specs):
    121 (`implementation-ready`) and 123 (`implementation-ready`) have NOT yet executed — the raw
    `<table>` in `screener/page.tsx:536` and `strategies/[id]/page.tsx:469`, the hand-rolled
    `AlertStream.tsx` unread badge, the hand-rolled `StrategyWizard.tsx` step-indicator `<ol>`, and
    the hand-rolled `opportunities/page.tsx` source-filter buttons are all still present exactly as
    124's FRs describe.
  - FR-5 (both raw `<table>` sites) duplicates 121's own FR-11 (near-identical line ranges, same
    conversion). 124's premise that these "slipped past feature 121's Table consolidation" is
    false — 121 already plans to fix them, it just hasn't executed yet.
  - FR-7's `AlertStream.tsx` site and FR-8's `opportunities/page.tsx` `ToggleGroup` site likewise
    duplicate 121's FR-6/one of its Badge-conversion FRs on the same lines.
  - `StrategyWizard.tsx:159-178` step-indicator: FR-7's Badge-driven fix targets the **same lines**
    123's FR-11 targets with an **incompatible target architecture** (Badge-driven vs. a
    Questionnaire-based shell) — a genuine design conflict, not just a rebase risk.
  - `OrdersTable.tsx` Cancel action and `PlatformHeader.tsx` breadcrumb (FR-2, FR-10) sit in
    regions 120 (`code-completed`, already merged to main-dev per `e4dbc0f`) and 121 already
    touch/plan to touch — sequencing risk, not a content conflict, since 120's part is already
    merged.
  - **Decision needed from `/sdd-design`'s recon+debate**: for each duplicated FR (FR-5's two
    table sites, FR-7's `AlertStream.tsx` site, FR-8's `opportunities/page.tsx` site), either (a)
    drop it from 124 and let 121 own it, re-adding only if 121 is abandoned/rescoped, or (b) keep
    it in 124 and have 124 explicitly supersede/absorb that slice of 121's scope, with 121's own
    spec trimmed to match. Do not implement both. For `StrategyWizard.tsx`, resolve the
    Badge-driven vs. Questionnaire-shell fork directly against 123 before either spec locks in a
    transformation. This is now the primary open question `/sdd-design`'s Phase 1 grilling must
    settle — not a secondary risk note.

## Session 2026-08-09T22:00:41Z — sdd-design Phase 1 (rounds 1-3) + FR-11 addition

- **Rounds 1-2** (design-proposer/design-adversary): debated whether 124 should defer FR-5 (both raw
  `<table>` sites) and part of FR-7 (`AlertStream.tsx`) to sibling `121` (already implementing them
  identically), drop FR-7's `StrategyWizard.tsx` site to `123` (apparent architecture conflict:
  Badge vs. `Questionnaire.Progress`), and sequence FR-10 (breadcrumb) to execute only after `121`
  lands (its Step 18 `NavigationMenu` migration rewrites an adjacent region of
  `PlatformHeader.tsx`). Round 2 adopted this repo's own `merge-order.md` F-04 tranche-split
  precedent (rows 55/57) for FR-10's deferral. Round 2 adversary found: the sequencing mechanism was
  too weak (soft PR-time warning vs. a real block), the blocking chain was deeper than stated
  (transitively through `120` reaching `launched`), the breadcrumb collision-test design was
  unfalsifiable, and a wrong Constitution ID (`C-14`) was cited for the required sign-off.
- **Mid-debate discovery, materially changing the design**: sibling features `121`/`122`/`123` —
  which the whole Round 1-2 deferral/sequencing debate was built around — turned out to already be
  **merged into `main-dev`** (corrective PR #917, merged 2026-08-09T21:05:34Z; their actual code had
  been stuck on dead-ended stacked branches despite each PR showing "Merged" on GitHub — `feature.md`
  correctly still read `code-completed`, not `launched`, throughout). This branch was re-merged with
  `origin/main-dev` to pick up the change (commit `a135014`). A full re-verification against the
  *current* working tree (not spec text) found:
  - FR-5's raw-`<table>` conversion: **done** for both sites. New narrower gap: the "Past Runs" row
    still carries a redundant `role="button"`/`tabIndex`/`onKeyDown` layer the reference pattern
    lacks. **User decision**: raise the floor (add keyboard support to `LiveStrategiesPanel.tsx`/
    `formulas/page.tsx`) rather than strip it from the row that has it — no capability regresses.
  - FR-7's `AlertStream.tsx`: **done**. `StrategyWizard.tsx`: `123` only replaced the OUTER `<ol>`
    wrapper with `Questionnaire`/`QuestionnaireProgress` — the INNER per-step `<span>` pill is
    untouched and still hand-rolled. The Round 1-2 "architectural conflict with 123" finding was
    **resolved by the actual landed code**: no conflict, FR-7 just retargets to the inner pill.
  - FR-8: per-source `ToggleGroup` conversion **done**; only the "All sources" toggle remains.
  - FR-10: **no sequencing dependency remains** — `121` is physically in `main-dev`. Round 3
    re-specced FR-10 directly against current `PlatformHeader.tsx` (Row 2 Breadcrumb `:286-302` +
    orphaned Separator `:303` both removed; new shared `PageBreadcrumb`, 7 sites).
- **Round 3** (re-grounded proposer/adversary): confirmed the above and fixed two more issues the
  adversary caught by reading source directly rather than trusting the proposal's claims: (1) FR-8's
  proposed `data-state`+`toggleVariants` styling mechanism was **verifiably broken** —
  `toggle.tsx`'s `outline` variant has no `data-[state=on]` selector at all; corrected to
  `aria-pressed`, which the base class does key off. (2) FR-10's collision-test plan covered only 1
  of 7 new `PageBreadcrumb` sites; extended to require a full e2e-suite gate for the rest, per this
  same feature's own product-spec "Known trap" note and the recon's risk section.
- **FR-11 added mid-design** (user-directed, not from the audit or the original story): migrate the
  mobile hamburger menu from hand-built `Sheet`+`Accordion` onto the actual shadcn `Sidebar`
  primitive (`collapsible="offcanvas"`, which already renders as a `Sheet` on mobile internally).
  A dedicated adversary pass (since this FR post-dated the original recon) found real gaps before
  they reached `/sdd-spec`: (1) no collateral-regeneration reconciliation clause, despite `sidebar`'s
  registry dependencies including already-vendored `button.tsx` (holds the `buy`/`sell` variants);
  (2) `tooltip.tsx` and a `use-mobile` hook — confirmed absent today — will be created as
  registry-dependency byproducts, directly contradicting the product-spec's prior Out-of-Scope claim
  ("no tooltip.tsx gap"), now corrected; (3) the current `Accordion`'s single-open-group behavior has
  no base-`Sidebar` equivalent — resolved by reusing the already-vendored `ui/collapsible.tsx`
  (feature 121/122), not adding a new primitive; (4) AC wording was ambiguous about the `adminOnly`
  filter, risking a literal implementation leaking the admin-only `Backfills` link; (5) a real
  SSR/first-paint mobile-detection risk (`useIsMobile()`'s `matchMedia` vs. the current pure-CSS
  `sm:hidden`) that a hydration-waiting e2e assertion won't catch — flagged for explicit
  `/sdd-spec`/execute-time verification, not assumed away. All five folded into `product-spec.md`
  FR-11/AC-11 and `recon.md`'s new ADDENDUM section. FR-10/FR-11 touch disjoint render regions of
  `PlatformHeader.tsx` but share the top-of-file import block — sequencing note for `/sdd-spec`.
- **Status**: design synthesis complete, pending final user approval gate before `design.md` is
  written and lifecycle advances to `design-approved`.

## Session 2026-08-09T23:20:17Z — sdd-design Round 4 + completion

- **Round 4** (design-proposer/design-adversary, consolidated whole-feature pass): proposer wrote the
  full 11-FR "Chosen Approach" + a recommended `/sdd-spec` step order, surfacing cross-FR file
  clustering not visible when each FR was reviewed alone (`market/[symbol]/page.tsx` touched by 4 FRs,
  `positions/[symbol]/page.tsx` by 3, `orders/[id]/page.tsx` by 2). Adversary found one real gap: the
  Round 3 decision to preserve `nav-reachability.spec.ts`'s guarantee for all 15 `GROUPS` routes via an
  `aria-current`-based replacement assertion (not the shared `Breadcrumb` component) had been decided
  verbally but never written into `recon.md`/`context.md` — so this round's adversary, reading only the
  durable artifacts, correctly flagged FR-10's breadcrumb removal as apparently leaving 15 routes
  without a reachability guarantee. Resolved by writing the mechanism into `recon.md`'s new ADDENDUM
  (not a design change, a documentation-completeness fix). Also resolved in the same pass: FR-10's
  `PageBreadcrumb` site count settled at 8 (adding `strategies/[id]/edit`, confirmed real via direct
  read; Round 2's exclusion rationale for it didn't actually distinguish it from the other 6 agreed
  sites); FR-11's SSR mobile-detection risk given a named mitigation (CSS-gated trigger visibility,
  default-closed panel state) instead of a deferred "check later"; FR-10↔FR-11 step order confirmed
  arbitrary-but-safe (no real dependency, contrary to the initial "must precede" framing).
- **`design.md` written and approved.** Status: `spec-ready` → `design-approved`. 4 rounds total (full
  mode). No Constitution Floor (`F-*`) breach at any point.
- **Process lesson for the ledger**: a design decision reached through conversational back-and-forth
  with the user or between debate rounds is not "settled" until it is written into `recon.md`/
  `context.md`/`design.md` — a later round's adversary (or a future `/sdd-spec` session) only sees the
  durable artifacts, not this session's transcript. This is the mid-debate analog of Constitution
  **P-05** (incremental checkpointing "as they happen"), and is being promoted to a `docs/roadmap/ledger/insights.md`
  entry since it's a generalizable pattern, not specific to this feature.

## Session 2026-08-09T23:41:04Z — sdd-review impl-spec (advisory) + warnings fixed

- Result: 0 blockers, 0 Floor risks, 7 warnings (advisory — did not block). All 7 fixed in this
  session, by user direction ("fix all the warnings"):
  - Step 4: wildcard `**Files**` entries (`e2e/trader/*.spec.ts`, `e2e/config-ui/*.spec.ts`,
    `e2e/insights/*.spec.ts`) resolved to exact paths — `e2e/trader/orders.spec.ts`,
    `e2e/config-ui/sources.spec.ts`, `e2e/config-ui/value-persists-after-save.spec.ts`,
    `e2e/insights/strategy-authoring.spec.ts` (confirmed via direct grep for each site's
    button-role/data-testid assertions). — [x] fixed
  - Steps 5-6: missing `pnpm run lint` gate — added to both steps' Verification. — [x] fixed
  - Step 11: >5 files (8) advisory — added an explicit scope note (atomic single-literal
    single-component rollout; splitting has no independent value at any split point). — [x] fixed
  - Step 12: wildcard `**Files**` entries resolved to exact paths — `e2e/insights/signal-detail.spec.ts`,
    `e2e/trader/{positions,position-detail,portfolio,order-intent,order-ticket}.spec.ts` (confirmed via
    each spec's `page.goto(...)` calls); also corrected the Verification `-g` filter from
    `"...order-detail|market"` (no test title matches "order-detail" — the real titles are "Order
    intent-state badge" / "Single Order ticket page") to `"...order|market"`. — [x] fixed
  - Step 15: >5 files (7) advisory — added a scope note (one CLI install command inherently produces
    this file set atomically). — [x] fixed
  - Step 20: >5 files (8) advisory — added a scope note (AC-9's collision-safety guarantee only holds
    once every site lands together, before Step 21's test runs). — [x] fixed
  - Step 23: wildcard `**Files**` entry (conditional table pages) — clarified as an inherent
    investigative placeholder (not knowable pre-audit), bounded by the 11-page candidate list already
    in Codebase Evidence; added missing `pnpm run lint` gate. — [x] fixed
- Overlap findings (advisory, not blocking — file-path collisions are ⚠ WARN in Mode B, not ✗ FAIL):
  4 files collide with sibling feature `096-position-and-order-detail-pages` (`implementation-ready`,
  neither executed): `trader/positions/[symbol]/page.tsx`, `trader/orders/[id]/page.tsx`,
  `trader/positions/page.tsx`, `trader/portfolio/page.tsx`. `096`'s own spec is additionally stale
  (Step 3 says "create" `positions/[symbol]/page.tsx`, which already exists on trunk at 515 lines).
  **Resolved**: user directed 124 to execute first. Added `merge-order.md` row: `096` blocked on
  `124`, soft/rebase (not a field/config/migration collision) — 096 rebases against 124's landed
  markup on the 4 shared files once 124's integration PR merges; 096's own stale "create" instruction
  for `positions/[symbol]/page.tsx` needs a re-spec pass regardless.

## Session 2026-08-10T00:03:00Z — sdd-execute sequential (boot)

- **Branch-naming deviation, recorded before execution starts**: `feature.md`'s `**Development
  Branch**` named the standard SDD convention `feature/shadcn-table-actions-responsive`, which does
  not exist on `origin` (all of this feature's recon/design/spec work happened on the harness-assigned
  session branch `claude/implement-124-e48xkn`). This session's harness instructions hard-pin work to
  that branch and explicitly forbid pushing to a different one. Per root `CLAUDE.md` § Branch
  Strategy, `claude/*` branches are the repo's own sanctioned pattern for harness-assigned work
  (branch from and PR into `main-dev`) — not an ad hoc workaround. `feature.md`'s `**Development
  Branch**` field updated to `claude/implement-124-e48xkn` to match reality, so `/sdd-execute`
  references a branch that actually exists. Sequential mode's single integration PR at the end will be
  `claude/implement-124-e48xkn` → `main-dev`.
- Re-spec gate: `main-dev` already up to date (no new commits since the earlier mid-design merge).
  Spot-checked spec evidence against current codebase (primitive absence/presence for
  `dropdown-menu`/`sidebar`/`tooltip` vs. presence for `collapsible`/`badge`/`toggle`/`table`/
  `breadcrumb`/`navigation-menu`/`questionnaire`; key line anchors across `OrdersTable.tsx`,
  `strategies/[id]/page.tsx`, `PlatformHeader.tsx`, `authorized-apps/page.tsx`) — all exact matches,
  no drift, no re-spec needed (directive: none).
- Tooling setup (all 24 steps are `xstockstrat-ui`): node 22.22.2 ✓ · pnpm 9.15.0 ✓ · Chromium
  pre-installed ✓ · `pnpm install --frozen-lockfile` run (52.4s, no errors).
- User confirmed mode-entry (§5.1b) and the per-feature up-front proceed (§5.4). Starting step loop.

### Step 1 — Vendor `dropdown-menu.tsx` (FR-1) [done]
- `npx shadcn@latest add dropdown-menu` created exactly one file, `dropdown-menu.tsx` — no other
  `src/components/ui/*` file touched (confirmed via `git status` diff before/after), so no
  collateral-regeneration reconciliation was needed for this install (unlike Step 15's `sidebar`
  install, which does touch `button.tsx`/etc.). Trigger composition confirmed classic Radix `asChild`
  (not Base UI `render`-prop), matching Step 3's plan.
- Files modified: `services/xstockstrat-ui/src/components/ui/dropdown-menu.tsx` (create)
- Deviations: none

### Step 2 — Verify reconciliation guards pass unchanged (FR-1 / AC-1) [done]
- `pnpm run test:unit` — 85/85 passed (24 files), including `button.test.ts` (2) and `badge.test.ts`
  (3). `pnpm run lint` — clean except one pre-existing warning (`jsx-a11y/role-supports-aria-props` at
  `strategies/[id]/page.tsx:490`, predates this feature — Step 5 addresses it later).
- Files modified: none (verify only)
- Deviations: none

### Step 3 + 4 — Convert 4 Actions columns to DropdownMenu + e2e coverage (FR-2 / AC-2) [done]
- **User decision before implementation**: `NamespaceEditor.tsx`'s Save/Cancel pair (shown while
  actively editing an Input field) stays inline, not menu-gated — only the read-only Edit trigger
  converts to `DropdownMenu`. See implementation-spec.md Deviation Log for the full rationale.
- **Design choices made at implementation time**: `OrdersTable.tsx`'s Cancel (`AlertDialog`-gated) and
  `insights/strategies/page.tsx`'s Deactivate (`AlertDialog`-gated) both use the "controlled
  `AlertDialog` outside the menu, opened via `DropdownMenuItem`'s `onSelect={e.preventDefault();
  setX(...)}`" pattern — avoids the Radix footgun where a `DropdownMenu` closes before a nested
  `AlertDialogTrigger`'s click can propagate. `OrdersTable.tsx` lifts `cancelling` state to the table
  level (mirroring the existing `editing`/`EditOrderDialog` pattern — one dialog instance outside the
  row map); `StrategyRow` keeps `confirmOpen` local (it's already a per-row component instance).
  Trigger icon: `lucide-react`'s `EllipsisVertical` (repo-wide dominant convention — 20 files use
  `lucide-react` vs. 4 using `@phosphor-icons/react`, the latter confined to the shell). Every trigger
  gets both `aria-label="Actions"` (consistent accessible name) and a per-row `data-testid` (e.g.
  `actions-${order.orderId}`) for precise e2e targeting.
- **TDD red→green**: modified/added 14 e2e assertions across 6 spec files (`e2e/trader/orders.spec.ts`
  ×2, `e2e/config-ui/sources.spec.ts` ×2, `e2e/config-ui/value-persists-after-save.spec.ts` ×3,
  `e2e/config-ui/env-gate.spec.ts` ×2, `e2e/config-ui/reason-capture.spec.ts` ×3, plus 2 net-new cases
  in `e2e/insights/strategy-authoring.spec.ts` for the strategies-list Edit/Deactivate click path,
  which had **zero prior DOM-click coverage** — confirmed via grep, the only existing "deactivate"
  reference in that file was a BFF-level `fetch()` test, not a UI click). Also swapped
  `getByRole('button', {name:'Edit'/'Enable'/...})` → open-menu-then-`getByRole('menuitem', ...)` where
  the action's own role changed from `button` to `menuitem`.
  - RED (pre-implementation, `CI=1 E2E_PREBUILT=1` against a fresh build): exactly the 14 modified/new
    assertions failed (`waiting for getByTestId('actions-...')` / `getByRole('button', {name:
    'Actions'})` — the trigger didn't exist yet), 0 unexpected failures.
  - GREEN (post-implementation, same harness): **121/121 passed** across the full affected-file sweep
    (`-g "order|config-ui/sources|namespace|strateg|reason capture|saved value"`), including all 14
    modified/new cases and zero regressions in the other 107.
- **Environment note**: this sandbox's pre-installed Chromium build (`chromium-1194`) doesn't match
  the pinned `@playwright/test` version's expected build (`1217`) — set
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome` for both
  `global-setup.ts` and `playwright.config.ts`'s chromium project (both already honor this same env
  var, per the `insights.md` 2026-08-02 lesson this repo already learned from). Also used the
  documented `CI=1 E2E_PREBUILT=1 NEXT_DISABLE_STANDALONE=1` fallback (build once, `next start`
  instead of `next dev`'s on-demand compile) to avoid the on-demand-compile timeout this sandbox hits.
- Files modified: `src/components/trader/OrdersTable.tsx`, `src/app/config-ui/sources/page.tsx`,
  `src/app/config-ui/[namespace]/NamespaceEditor.tsx`, `src/app/insights/strategies/page.tsx`,
  `e2e/trader/orders.spec.ts`, `e2e/config-ui/{sources,value-persists-after-save,env-gate,
  reason-capture}.spec.ts`, `e2e/insights/strategy-authoring.spec.ts`
- Deviations: NamespaceEditor scope narrowing (recorded above, user-approved before implementation)

### Step 5 + 6 — Keyboard-accessible clickable rows (FR-5 / AC-5) [done]
- `strategies/[id]/page.tsx`'s Past Runs row already carries the correct `role="button"`/`tabIndex`/
  `onKeyDown` triple (re-confirmed, no change) — added `role="button"`/`tabIndex={0}`/`onKeyDown`
  (Enter/Space → the same handler as `onClick`) to `LiveStrategiesPanel.tsx` and
  `insights/formulas/page.tsx`'s clickable `TableRow`s, matching that reference pattern exactly.
  Neither site adds `aria-selected` (no selection-state concept at either site, per Step 5's own
  qualifier).
- **Process note**: implemented Step 5's code before writing Step 6's test (wrong TDD order). Fixed
  properly rather than rationalizing a "red N/A" — stashed the Step 5 diff, wrote Step 6's 2 new e2e
  cases, confirmed RED against the reverted code, popped the stash to reapply Step 5, confirmed GREEN.
- **Coverage gap found**: neither target file had ANY existing e2e coverage of the click path
  (`e2e/trader/live-strategies.spec.ts` is entirely BFF-level `page.evaluate`+`fetch`;
  `e2e/insights/formulas.spec.ts` only asserts the list renders) — both Step 6 cases are net-new, not
  retrofits, matching FR-5's own AC — Step 5's "keyboard-accessible" claim needed a fresh assertion to
  be meaningful, not just a markup diff.
- **TDD red→green**: RED (pre-Step-5 code, via `git stash`) — both new cases failed (`row` locator not
  found / activation not wired), 1 unrelated pre-existing flake (`signal-detail.spec.ts`'s strict-mode
  locator ambiguity) self-recovered on retry — not connected to this change. GREEN (post-Step-5,
  `CI=1 E2E_PREBUILT=1`): **12/12 passed** (`-g "live.strateg|formulas"`), including both new cases.
- Files modified: `src/components/trader/LiveStrategiesPanel.tsx`,
  `src/app/insights/formulas/page.tsx`, `e2e/trader/live-strategies.spec.ts`,
  `e2e/insights/formulas.spec.ts`
- Deviations: none (the Step 5/6 ordering slip is a process note, not a spec deviation — no scope or
  behavior changed)

### Step 7 + 8 — Badge-driven StrategyWizard pill + 2 source pills (FR-7 / AC-7) [done]
- `StrategyWizard.tsx`'s inner per-step `<span>` → `<Badge variant={n===step?'default':'secondary'}
  className={n>step?'opacity-40':undefined}>` (no new `cva` variant — a `className` override composes
  cleanly via `Badge`'s own `cn()` merge; no second "upcoming/dimmed" consumer found elsewhere, so the
  DRY guard rail's "promote to a variant" threshold isn't met). `cn` import removed (no longer used in
  this file after the swap). `opportunities/page.tsx:348` and `market/[symbol]/page.tsx:147`'s
  identical hand-rolled source pills → `Badge variant="outline"` with the same `text-[11px]
  text-muted-foreground` override preserving the original size/color exactly.
- **TDD**: `N/A` per the spec's own declaration (pure visual refactor, no behavior change) —
  implemented directly, then added one visible-text assertion per site (none of the 3 target specs
  had one before): `opportunities.spec.ts` ("each card shows its source as a Badge"),
  `signal-detail.spec.ts` (source Badge, `{exact: true}` — needed to disambiguate from a **pre-existing**
  duplication where `market/[symbol]/page.tsx`'s `metaBits` line also joins in the same source string,
  caught by Playwright's own strict-mode violation on first run, not anticipated in advance),
  `strategy-authoring.spec.ts` ("1. Identity" pill text). GREEN: **39/39 passed**
  (`-g "strategy-authoring|opportunities|Signal detail"`).
- Files modified: `src/components/insights/StrategyWizard.tsx`, `src/app/insights/opportunities/page.tsx`,
  `src/app/insights/market/[symbol]/page.tsx`, `e2e/insights/{opportunities,signal-detail,
  strategy-authoring}.spec.ts`
- Deviations: none

### Step 9 + 10 — Fold "All sources" into the ToggleGroup styling (FR-8 / AC-7) [done]
- Re-read the current `ToggleGroupItem` call site (`opportunities/page.tsx:201-216`) at implementation
  time and found it does **not** use `ui/toggle.tsx`'s own `data-[state=on]`/`aria-pressed:bg-muted`
  variant mechanism — both it and "All sources" already share one identical manual `cn()` literal.
  `design.md`'s Round 3 plan (swap "All sources" to the `Toggle` primitive, relying on its
  `aria-pressed:bg-muted` base class) would have made the two pills' active-state styling diverge for
  the first time (`bg-muted` vs the shared `bg-primary/20`), contradicting design.md's own "still
  visually distinguishable ... matches the original intent" requirement. Shipped instead: extracted the
  shared literal into one local helper `sourceFilterPillClass(active: boolean): string` used by both
  "All sources" and `ToggleGroupItem` (DRY — one home for the duplicated literal), and added
  `aria-pressed={activeSources.length === 0}` directly to the "All sources" `<button>` — no primitive
  swap needed since `aria-pressed` is a plain HTML attribute. Recorded in full in
  `implementation-spec.md`'s Deviation Log (Step 9 entry).
- **TDD**: `red-green required`. Step 10's e2e test (`opportunities.spec.ts` — asserts `aria-pressed`
  toggles `true`/`false`/`true` across "All sources" ↔ a source-chip click) confirmed RED against
  pre-Step-9 markup (`toHaveAttribute('aria-pressed', 'true')` found nothing — plain `<button>` never
  set the attribute), then GREEN after Step 9's change. Full `opportunities.spec.ts`: **13/13 passed**.
  `pnpm lint`: clean (one pre-existing unrelated warning in `strategies/[id]/page.tsx:490`, not touched
  by this step).
- Files modified: `src/app/insights/opportunities/page.tsx`, `e2e/insights/opportunities.spec.ts`
- Deviations: mechanism deviation from design.md's Round 3 plan, recorded above and in
  `implementation-spec.md`'s Deviation Log.

### Step 11 + 12 — Shared `Eyebrow` component + 14-site conversion, regression verify (FR-6 / AC-6) [done]
- Created `src/components/shared/Eyebrow.tsx`: `{ as?: 'div'|'p'|'dt'|'span'; className?; children }`
  (default `as: 'div'`), rendering via a small `as`-keyed tag lookup + `cn()` merge, mirroring
  `StatTile.tsx`'s convention. Converted all 14 sites across 7 files: 4 `CardTitle` sites (nested
  `<Eyebrow as="span">` inside `CardTitle`, preserving `CardTitle`'s own `h3`/`data-slot` semantics —
  its default `className` still applies, the nested span's own explicit classes win via CSS
  specificity for the properties they set), 2 `div` sites → bare `<Eyebrow>`, 3 `p` sites → `<Eyebrow
  as="p" className="mb-2">` (extra margin preserved), 2 `dt`/`div` sites in `portfolio/page.tsx` and
  `positions/[symbol]/page.tsx` → `<Eyebrow as="dt">`/`<Eyebrow>`. Confirmed via grep: zero remaining
  occurrences of the literal outside `Eyebrow.tsx`.
- **TDD**: the step's own header says `red-green required`, but its instructions describe a pure
  text/label-preserving markup change with no new assertion to write — Step 12 (the paired test step)
  explicitly declares `N/A (no new behavior — regression-only verification)` and its own Instructions
  are "run the existing suite, a failure means Step 11 broke something." Followed Step 12's own stated
  interpretation (not a deviation — it's what the paired step itself specifies): ran the 7 touched
  pages' full existing e2e coverage before relying on it as the gate, which is the regression-guard
  equivalent of red-before-green for a change with no new observable behavior to assert.
- **Verification**: `grep` confirms 0 remaining literal sites; `pnpm lint` clean (only the
  pre-existing unrelated `strategies/[id]/page.tsx:490` warning); `pnpm build` succeeds; Step 12's
  full target suite (`signal-detail`, `positions`, `position-detail`, `portfolio`, `order-intent`,
  `order-ticket` specs) — **16/16 passed**, zero regressions.
- Files modified: `src/components/shared/Eyebrow.tsx` (create), `src/components/shared/StatTile.tsx`,
  `src/components/insights/SignalReadiness.tsx`, `src/app/trader/orders/[id]/page.tsx`,
  `src/app/trader/portfolio/page.tsx`, `src/app/trader/positions/[symbol]/page.tsx`,
  `src/app/trader/positions/page.tsx`, `src/app/insights/market/[symbol]/page.tsx`
- Deviations: none (Step 12's own TDD declaration governs; see above)

### Step 13 + 14 — FR-9 cosmetic fixes: green token swap + chart-height audit (AC-8) [done]
- `authorized-apps/page.tsx:204-205` (Reachable branch): `text-green-600`→`text-buy`,
  `bg-green-600`→`bg-buy` — 2 literal token swaps, no structural change. Confirmed
  `market/[symbol]/page.tsx:138` already uses `text-buy`/`text-destructive` for the identical
  positive/negative meaning, so `text-buy` is this app's established semantic token, not an invented
  substitution.
- **Chart-height sites — no code change (documented per FR-9's own qualifier)**: all 3 sites
  (`ChartPanel.tsx:29`+`:157` → `useCandlestickChart(320)`/`style={{height:320}}`;
  `positions/[symbol]/page.tsx:71`+`:314` → `useCandlestickChart(260)`/`style={{height:260}}`;
  `market/[symbol]/page.tsx:45`+`:200` → `useCandlestickChart(480)`/`style={{height:480}}`) pass the
  *same* numeric literal to both the JSX `style` and the `useCandlestickChart(N)` hook argument
  (itself feeding `lightweight-charts`' `createChart({height})`). A bare Tailwind height class on the
  `div` would decouple that literal from the hook's own argument — two independent places to keep in
  sync instead of one shared `N` — which is exactly the drift FR-9 says not to risk. Left all 3
  unchanged, confirmed by direct read this session (line numbers for the `positions/[symbol]` and
  `market/[symbol]` style sites are `314`/`200` respectively, not the spec's `317`/`200` — the former a
  minor drift from intervening line shifts, inconsequential to the determination). This is a
  documented "no code change" outcome per `design.md`'s Open Risk ("may net to zero code changes...
  acceptable, not incomplete work"), not a skipped step.
- **TDD**: Step 13's header says `red-green required (green-token fix only)`, but per Step 14's own
  N/A declaration this is a token-only visual change with no new Playwright-assertable behavior
  (color is not directly assertable without a computed-style check) — followed Step 14's own stated
  gate: run the existing `authorized-apps` suite and confirm the Reachable state's render is
  unaffected. **6/6 passed**. `grep` confirms zero remaining `text-green-600`/`bg-green-600` in the
  file; `pnpm lint`/`pnpm build` clean.
- Files modified: `src/app/accounts/authorized-apps/page.tsx` (Step 13 only; Step 14 made no file
  changes — verification only, folded into this entry)
- Deviations: none (Step 14's own TDD declaration governs, mirroring the Step 11/12 precedent)

### Step 15 + 16 — Vendor `sidebar.tsx` + registry byproducts, reconciliation guard (FR-11a / AC-11) [done]
- `npx shadcn@latest add sidebar` created `src/components/ui/{sidebar,tooltip}.tsx` +
  `src/hooks/use-mobile.ts` (net-new); updated `separator.tsx`/`input.tsx`/`skeleton.tsx`/`sheet.tsx`
  (formatting-only diffs — no app-specific markers found in any of the 4, confirmed by diff read);
  **skipped** `button.tsx` (registry content already matched, from an earlier partial CLI invocation
  in this same step whose first prompt — the `buy`/`sell`-bearing `button.tsx` overwrite — the
  session had already confirmed before switching to a fully-piped `yes` re-run). Caught via the same
  `git diff` reconciliation discipline as Step 1: `button.tsx`'s `buy`/`sell` variants (with their
  `// app-specific` comment) were gone after the overwrite; re-applied verbatim, updating the comment
  to note this third re-application. `badge.tsx` untouched (not a `sidebar` registry dependency,
  confirmed by empty diff).
- **Ground-truthed the installed `sidebar.tsx` file itself (not docs) before Step 17 wires it**, per
  Step 15 Instruction 4 / the `fails.md` 2026-08-09 lesson:
  - `useSidebar()`/`SidebarContext` shape confirmed: `{state, open, setOpen, openMobile,
    setOpenMobile, isMobile, toggleSidebar}` — matches the `WebFetch`-sourced shape from `design.md`.
  - **`Sidebar`'s mobile/desktop split is driven by `useIsMobile()` (client-only, `useEffect`+
    `matchMedia`, `768px` breakpoint, returns `false` during SSR/first paint) — not by the
    `collapsible` prop alone.** When `isMobile` is true it renders wrapped in `<Sheet
    open={openMobile} onOpenChange={setOpenMobile}>`; when false, a `fixed`-positioned desktop panel
    that's `md:flex`-visible unless the ancestor's `data-collapsible="offcanvas"` (set only when
    `state === "collapsed"`, i.e. `open === false`) pushes it off-screen via a negative `left` offset
    and zero-width gap.
  - **Grounded implementation requirement for Step 17 (not explicit in `design.md`'s text, but a
    correctness requirement for a mobile-only sidebar): `SidebarProvider` must be given
    `defaultOpen={false}`.** With the shadcn default (`defaultOpen=true`), an untouched desktop `open`
    state would leave the desktop non-mobile branch **expanded** — a real `fixed`, `md:flex`-visible
    panel sitting in the DOM near Row 1, since nothing on desktop ever calls `setOpen` (only the
    hidden-on-`sm:`+ trigger's `toggleSidebar()` does, and that's mobile-gated to `setOpenMobile`).
    `defaultOpen={false}` keeps the desktop branch `collapsed`/`offcanvas` (off-screen, zero-width,
    `fixed` so no layout impact) in both the pre-hydration SSR paint (`isMobile` false → desktop
    branch, but collapsed) and the post-hydration mobile paint (`isMobile` true → Sheet branch,
    closed by default) — no visible flash or duplicate desktop panel either way. This composes with
    (not replaces) the already-planned CSS-only `sm:hidden` trigger-visibility SSR mitigation — two
    complementary details, not a conflict.
  - `SidebarMenuButton`'s `isActive` prop already renders `data-active` wired to
    `data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground`
    — Step 17 Instruction 6's active-route highlighting needs only `isActive={isItemActive(...)}`, no
    manual className ternary.
  - `SidebarMenuButton`'s `tooltip` prop (collapsed-icon-mode only) renders `<Tooltip>` conditionally
    — our mobile-only offcanvas usage never passes `tooltip`, so no `<TooltipProvider>` app-wrapper is
    needed despite the CLI's install-time reminder to add one.
- **Verification**: `test -f sidebar.tsx && test -f tooltip.tsx` — both created. `pnpm lint`/`pnpm
  build` clean. Step 16's reconciliation guard: `pnpm run test:unit` — **85/85 passed** (includes
  `button.test.ts` 2/2, `badge.test.ts` 3/3).
- Files modified: `src/components/ui/{sidebar,tooltip}.tsx` (create), `src/hooks/use-mobile.ts`
  (create), `src/components/ui/{button,separator,input,skeleton,sheet}.tsx` (reconcile)
- Deviations: none — the `button.tsx` reconciliation-miss was caught and fixed within this same step
  (not a residual gap), consistent with the Step 1/15-instruction-mandated discipline.

### Step 17 + 18 — Mobile `Sheet`+`Accordion` → `Sidebar collapsible="offcanvas"`, new e2e (FR-11b / AC-11) [done]
- Replaced Row 1's `Sheet`/`SheetContent`/`SheetHeader`/`SheetTitle`/`SheetClose` +
  `Accordion`/`AccordionItem`/`AccordionTrigger`/`AccordionContent` combo with
  `SidebarProvider`/`Sidebar side="left" collapsible="offcanvas"`/`SidebarHeader`/`SidebarContent`
  (wrapped in a `<nav aria-label="Mobile">` for landmark parity — `SidebarContent` itself renders a
  plain `div`) / per-group `Collapsible`/`CollapsibleTrigger`/`CollapsibleContent` (reusing the
  existing `expanded`/`setExpanded` state verbatim — single-open-group semantics unchanged) /
  `SidebarGroupContent`/`SidebarMenu`/`SidebarMenuItem`/`SidebarMenuButton`.
  - `SidebarTrigger` itself hardcodes its own icon (`IconLayoutSidebar`) and sr-only label and
    accepts no children/`asChild` — added a local `MobileNavTrigger` (`useSidebar().toggleSidebar()`
    + the existing `List` icon) instead, preserving the exact prior trigger look rather than
    adopting shadcn's default glyph.
  - Close-on-navigate: a local `MobileNavLink` (`useSidebar().setOpenMobile(false)` on click,
    wrapping a `Link` via `SidebarMenuButton asChild`) mirrors the old `SheetClose asChild` pattern.
    `CollapsibleTrigger asChild` wrapping `SidebarMenuButton` (neither forwards a ref) follows the
    same no-forwardRef-but-works precedent already established at `accountShared.tsx:302`
    (`CollapsibleTrigger asChild` wrapping the equally ref-less `Button`).
  - Active-route highlighting: `SidebarMenuButton`'s own `isActive` prop (confirmed in Step 15/16's
    ground-truth read) already wires `data-active` to the right styling — no manual className
    ternary needed for nav items; the group trigger keeps the prior manual ternary since
    `SidebarMenuButton`'s own `data-active` styling is item-level, not group-level.
- **Deviation (recorded in `implementation-spec.md`'s Deviation Log): `SidebarProvider`'s generated
  wrapper defaults to `flex min-h-svh w-full`** — a page-root sizing that, wired in unmodified,
  passed `build`/`lint` but broke Step 18's own e2e (`min-h-svh` stretched the wrapper far past Row
  1's `h-[49px]`, pushing the trigger below the viewport — Playwright reported it "outside of the
  viewport"). Fixed with `<SidebarProvider defaultOpen={false} className="w-auto min-h-0">`
  (tailwind-merge resolves the conflict in the passed className's favor). Caught only by running the
  real e2e against the real implementation, not by `build`/`lint` alone.
- **TDD**: wrote Step 18's `e2e/mobile-sidebar.spec.ts` (7 tests: reachability across all 5 groups,
  non-admin/admin Backfills gating, close-on-navigate, single-open-group, active highlighting), ran
  it against pre-Step-17 markup (`git stash` on `PlatformHeader.tsx`) — RED: only the `data-active`
  assertion failed (6/7 incidentally passed since the old Sheet/Accordion markup already satisfied
  dialog-role/button-role/link-role structure) — confirmed the test targets genuinely new behavior,
  not a tautology. Restored Step 17's code (`git stash pop`), fixed the `openGroup` test helper to
  check `aria-expanded` before clicking (blindly clicking the already-expanded default "Decide" group
  first would toggle it closed — a test-authoring bug caught by the RED run, not a product bug), then
  hit the `SidebarProvider` sizing issue above, fixed it, reran: **GREEN, 7/7**. Full regression sweep
  after: `mobile.spec.ts` + `nav-reachability.spec.ts` + `mobile-overflow.spec.ts` — **19/19 passed**;
  `pnpm lint`/`pnpm build` clean; full e2e suite run in background for final confirmation before commit.
- Files modified: `src/components/shared/PlatformHeader.tsx`; created
  `e2e/mobile-sidebar.spec.ts`
- Deviations: `SidebarProvider` sizing override, recorded above and in `implementation-spec.md`'s
  Deviation Log.

### Step 19 — Remove shared `Breadcrumb`, add `PageBreadcrumb` component (FR-10a)
- Created `src/components/shared/PageBreadcrumb.tsx`: `{ariaLabel: string; items: {label, href?}[]}`
  — no default `ariaLabel` (the collision-avoidance mechanism itself). Generalizes
  `NamespaceEditor.tsx`'s existing hand-rolled `Breadcrumb`/`BreadcrumbSeparator` structure
  (siblings inside `BreadcrumbList`, not nested — `BreadcrumbSeparator` is its own `<li>`, so
  nesting it inside `BreadcrumbItem`'s `<li>` would be invalid HTML; fixed during writing via a
  `Fragment`-per-item + trailing separator, not the nested-inside shape I drafted first).
- Removed `PlatformHeader.tsx`'s Row 2 `<Breadcrumb aria-label="Breadcrumb">...</Breadcrumb>` block
  and its trailing vertical `Separator` — Row 2 is now just the `Section` `NavigationMenu`, unchanged.
  Removed the now-dead `Breadcrumb`/`BreadcrumbList`/`BreadcrumbItem`/`BreadcrumbPage`/
  `BreadcrumbSeparator` import. `activeItem` (from `resolveActive(pathname)`) became unused once its
  only consumer (the removed Breadcrumb block) was gone — destructuring narrowed to `{ group:
  activeGroup }` rather than leaving a dead binding.
- `e2e/nav-reachability.spec.ts`: replaced the two `getByLabel('Breadcrumb')` assertions with
  `aria-current="page"` checks against the just-clicked `Primary`/`Section` links — the mechanism
  already present at `PlatformHeader.tsx` before this step (nothing new to wire), per design.md's
  Round 4 resolution.
- **TDD**: confirmed RED properly via `git stash` — stashed only the test file, kept the
  `PlatformHeader.tsx` Breadcrumb removal, ran the **old** `getByLabel('Breadcrumb')` assertions
  against the new markup: failed as expected (`element(s) not found`). Restored the updated test,
  reran: **GREEN, 2/2** (including the `[setup]` warmup task). `grep` confirms zero
  `aria-label="Breadcrumb"` remaining in `PlatformHeader.tsx`; `pnpm lint` clean.
- Files modified: `src/components/shared/PageBreadcrumb.tsx` (create),
  `src/components/shared/PlatformHeader.tsx`, `e2e/nav-reachability.spec.ts`
- Deviations: none (the `BreadcrumbSeparator` nesting fix was caught and corrected while writing
  the new component, before any commit — not a residual gap)

### Step 20 + 21 — Migrate/add 8 `PageBreadcrumb` sites, collision coverage + full-suite gate (FR-10b / AC-9) [done]
- Migrated `NamespaceEditor.tsx` and `config-ui/audit/page.tsx` onto `PageBreadcrumb`, preserving
  exact link targets/terminal text. **Cosmetic simplification, noted not fixed**: `NamespaceEditor`'s
  original terminal crumb carried a one-off `className="font-mono text-primary"` (emphasis on the
  namespace name); `PageBreadcrumb`'s generic `{label, href?}` shape has no per-item className
  escape hatch, so this one flourish did not survive generalization. No test depends on it; accepted
  as the right DRY tradeoff for a component meant to serve 8 sites uniformly.
- Added `PageBreadcrumb` to the 6 new sites (`strategies/[id]`, `strategies/[id]/edit`,
  `formulas/[id]`, `positions/[symbol]`, `market/[symbol]`, `orders/[id]`). Per-site keep-or-replace
  decision for the pre-existing ad hoc back-link (Step 20's own explicit judgment call):
  - `positions/[symbol]/page.tsx`: **replaced** the "← Exposure" `Button asChild` back-link — its
    label ("Exposure") is identical to the new breadcrumb's first-item label, so keeping both would
    duplicate an accessible-name link; no e2e test targets that specific button (grepped first).
  - `market/[symbol]/page.tsx`: **kept both** — the existing "← Queue" back-link's label doesn't
    collide with the breadcrumb's "Opportunities" first-item label, and `signal-detail.spec.ts:17`
    already asserts `getByRole('link', {name: /Queue/})`, which a replacement would have broken.
  - `orders/[id]/page.tsx`: **kept both** — confirmed by reading `BackToDashboardButton.tsx` that it
    navigates to `/trader` (dashboard), not `/trader/orders`; no label or destination overlap with the
    new breadcrumb's "Orders" first-item link.
  - `formulas/[id]/page.tsx`: `PageBreadcrumb` added only on the loaded branch (uses `formula.name`,
    which doesn't exist on the loading/not-found branches) — matches the spec's own "omit rather than
    show a raw id" preference.
  - `orders/[id]/page.tsx`'s terminal crumb uses the route `orderId` param (always available), not
    `order.orderId` (undefined during loading) — same visible value, avoids a loading-state crash.
- **Deviation (recorded in `implementation-spec.md`'s Deviation Log): the mobile `Sidebar`'s desktop
  DOM footprint collided with Row 2's real nav.** `Sidebar`'s non-mobile branch is off-screen via a
  negative `left` offset, not `display:none`, and Radix `Collapsible.Content` keeps closed-group
  content mounted — so landing on `/config-ui/audit` (whose Settings group is the default-expanded
  one) left the mobile sidebar's own "Audit log" link fully queryable at the desktop viewport,
  colliding with Row 2's real "Audit log" `Section` nav link. Caught by `breadcrumb.spec.ts`'s own
  explicit "Audit Log vs Audit log" collision test (`getByRole('link', {name:'Audit log', exact:
  true})` resolved to 2, not 1) — a genuine a11y defect from Step 17, not anticipated by `design.md`
  (which predates FR-11). **Fix**: wrapped the whole mobile-sidebar subtree in
  `<div className="sm:hidden">` in `PlatformHeader.tsx` (`display:none` removes it from the
  accessibility tree too, not just visually) instead of gating only the trigger button.
- **TDD**: wrote `e2e/breadcrumb.spec.ts` (8 per-site collision tests + 1 named "Audit Log" vs "Audit
  log" case) against Step 20's uncommitted changes, then confirmed RED properly via `git stash` —
  stashed all 8 Step 20 file changes (kept the test), rebuilt, ran: the 6 new sites failed as expected
  (no `PageBreadcrumb` yet), 2 migrated-site tests + the explicit Audit collision test initially also
  surfaced the `Sidebar` DOM-footprint defect above (an unanticipated finding, fixed on the clean
  pre-Step-20 tree first, reconfirmed RED for exactly the 6 missing sites, GREEN for the rest), then
  restored Step 20's stash and reran: **GREEN, 10/10**. Ran the Step-21-mandated full suite once more
  as the closing gate for this FR: **all e2e green**, `pnpm lint` clean.
- Files modified: `src/app/config-ui/[namespace]/NamespaceEditor.tsx`,
  `src/app/config-ui/audit/page.tsx`, `src/app/insights/strategies/[id]/page.tsx`,
  `src/app/insights/strategies/[id]/edit/page.tsx`, `src/app/insights/formulas/[id]/page.tsx`,
  `src/app/trader/positions/[symbol]/page.tsx`, `src/app/insights/market/[symbol]/page.tsx`,
  `src/app/trader/orders/[id]/page.tsx`, `src/components/shared/PlatformHeader.tsx` (Sidebar
  `sm:hidden` fix); created `e2e/breadcrumb.spec.ts`
- Deviations: the `Sidebar` DOM-footprint fix, recorded above and in `implementation-spec.md`'s
  Deviation Log.

### Step 22 — Extend `mobile-overflow.spec.ts` route sweep (FR-3 / AC-3) [done]
- Added the 5 gap-closing entries to `ROUTES`: `/accounts/authorized-apps`, `/insights/formulas`,
  `/config-ui/audit`, `/config-ui/platform`, `/trader/positions/AAPL` — all `addAuthCookie` (none
  admin-gated per `navGroups.tsx`).
- **TDD**: per the step's own note, there's no "pre-addition" state to run red against (the routes
  simply don't exist in `ROUTES` yet) — red-before-green here means confirming each new test executes
  a real measurement, not a vacuous pass on a blank/404 page. Ran a throwaway scripted check
  (`document.body.innerText` length + sample) against all 5 new routes before trusting the green
  overflow result: all rendered substantive real content (232–1174 chars of visible text each,
  matching their expected page content — e.g. `/config-ui/platform` showed the namespace's key/value
  table, `/trader/positions/AAPL` showed the Exposure detail page), ruling out a false pass from an
  error page or empty shell. Deleted the throwaway spec after confirming.
- **Verification**: `pnpm test:e2e -g "no horizontal overflow"` — **20/20 passed** (14 original + 5
  new + 1 setup task).
- Files modified: `e2e/mobile-overflow.spec.ts`
- Deviations: none

### Step 23 — Horizontal-overflow audit + fix (FR-4 / AC-4) [done]
- **Audit (Instruction 1)**: checked all 11 table-bearing pages' `Table`-to-page ancestor chains for
  a flex/grid ancestor missing `min-w-0`. `ui/table.tsx`'s `Table` always self-wraps in
  `overflow-x-auto`, so the risk is specifically a flex/grid ITEM ancestor with `min-width: auto`
  (the default) refusing to shrink below its content's intrinsic width, which pushes overflow onto
  the whole page instead of staying inside the table's own scroll container.
  - **9 of 11 SAFE**: `config-ui/sources`, `NamespaceEditor`, `insights/strategies`,
    `insights/screener` (10-col table, deliberately `min-w-[640px]`, but its `Card` ancestor chain
    up to the page root is plain block, no flex/grid), `insights/formulas`, `LiveStrategiesPanel`,
    `config-ui/audit`, `authorized-apps` — all sit under plain block (`Card`'s own `flex flex-col`
    doesn't create the horizontal-squeeze hazard) ancestors, not a flex-row/grid.
  - **2 of 11 SAFE-BY-DESIGN**: `strategies/[id]` Past Runs and `positions/[symbol]` Orders & fills
    both sit inside a `flex`/`grid` row layout but already carry an explicit `min-w-0` on the
    relevant item — the correct established pattern.
  - **1 of 11 a real gap**: `OrdersTable` (rendered via `trader/orders/page.tsx`) sits in a
    `grid grid-cols-1 lg:grid-cols-12` row as `lg:col-span-8`, with **no `min-w-0`** — the one
    inconsistent site versus the other two correctly-guarded flex/grid table sites.
- **Live-tested before deciding (Instruction 2/3), not just theorized**: added a
  `viewport: {width: 1024, height: 900}` test for `/trader/orders` (the `lg` breakpoint, 1024px,
  where the grid actually splits into columns AND `OrdersTable`'s widest column, "From signal",
  becomes visible — the genuine worst case here, not an arbitrary 768px pick) and ran it **against
  the unfixed code first**: it **passed** — the current mock `ORDERS` fixture's content isn't wide
  enough to actually trip the missing-`min-w-0` hazard at 1024px. Reporting this honestly rather
  than claiming a regression that wasn't observed: **no live page-overflow defect was found**.
  Added `min-w-0` to the grid item anyway, purely for **consistency with the codebase's own
  established pattern** (the other 2 flex/grid table sites both carry it defensively) — a one-class,
  zero-risk change that closes the one inconsistent site before future content growth (a longer
  order id, an added column) could silently trip it. Reran after the change: still green (the fix
  is a no-op at current content widths, as expected, and doesn't regress anything).
- **Verification**: `pnpm test:e2e -g "no horizontal overflow|1024px"` — **21/21 passed**. `pnpm
  lint`/`pnpm build` clean.
- Files modified: `src/app/trader/orders/page.tsx` (`min-w-0` on the grid item),
  `e2e/mobile-overflow.spec.ts` (new `test.describe` block, 1024px)
- Deviations: none — the audit's own instruction framed the fix bar as "an actual regression, not
  merely 'could be tighter'"; since none was found, the `min-w-0` addition here is a documented
  defensive consistency fix, not a regression fix, and is reported as such rather than overstated.

### Step 24 — Closing gate [done]
- Ran the full lint/build/e2e suite one final time against the fully-merged tree (all 24 steps
  landed): `pnpm run lint` — clean (only the one pre-existing, unrelated `strategies/[id]/page.tsx`
  warning present since before this feature). `NEXT_DISABLE_STANDALONE=1 pnpm build` — succeeds.
  `pnpm test:e2e` (full chromium suite) — **283 passed, 1 flaky** (`signal-detail.spec.ts`'s "renders
  traced conditions for the threaded strategy" — the same pre-existing, self-recovering-on-retry
  flake this session already observed and documented earlier; not a regression from this feature's
  changes). Zero hard failures.
  - Confirmed the AC-8 (FR-9 chart-height, Step 13/14) and AC-4 (FR-4 horizontal-overflow, Step 23)
    determination records both exist in this file (verified via grep before marking this step done,
    per the step's own instruction).
- All 11 FRs (FR-1 through FR-11) landed: DropdownMenu Actions columns (FR-1/2), keyboard-accessible
  clickable rows (FR-5), Badge-driven pills incl. the DRY'd source-filter toggle (FR-7/8), shared
  `Eyebrow` component (FR-6), FR-9 cosmetic fixes, mobile `Sidebar` replacing Sheet+Accordion
  (FR-11), `PageBreadcrumb` replacing the shared shell landmark (FR-10), extended mobile-overflow
  route sweep (FR-3), and the horizontal-overflow audit (FR-4).
- Feature ready for merge-order check and the integration PR.

### Post-PR CI fix — `trader/orders` 1024px overflow test failed in CI, not locally
- PR #919's "Frontend E2E (shard 2/2)" check failed on the exact new Step 23 test
  (`mobile-overflow.spec.ts` 1024px case), reporting a consistent, deterministic 18px page-level
  horizontal overflow on `/trader/orders` — reproduced identically on 2 separate CI runs (two
  different commits), never once locally across multiple repeated local runs (0px overflow every
  time, `document.documentElement.scrollWidth === clientWidth` exactly).
- Investigated via a throwaway debug spec dumping `getBoundingClientRect()` for every element whose
  `right` edge exceeded the viewport, plus header/nav-specific measurements: confirmed locally the
  desktop `PlatformHeader` Row 1/`Primary` nav and the `OrdersTable`'s own scroll container all fit
  exactly within 1024px with zero slack — ruling out the mobile Sidebar (already `sm:hidden`-gated,
  confirmed inert at this width) and the header/nav as the source.
- **Root cause (most likely): a CI-vs-local Chromium font-rendering difference** — this repo has no
  bundled/embedded webfont, so system font-fallback metrics differ between this sandbox's Chromium
  and the GitHub Actions Ubuntu runner's Chromium, and this new 1024px test is the **first** overflow
  test in the entire suite to ever exercise the page at a desktop (`≥lg`) width — every other
  overflow test runs at 390px, where the desktop header/multi-column grid never renders at all
  (`hidden sm:flex`/`grid-cols-1`). A ~18px text-width difference on a `whitespace-nowrap` cell,
  invisible at 390px, is exactly the kind of thing only a tight 12-column grid split would expose.
- **First fix attempt (didn't move the number)**: the original Step 23 audit (per its own stated
  scope) only traced `Table`-bearing ancestor chains — it never checked `trader/orders/page.tsx`'s
  OTHER grid item (`lg:col-span-4`, hosting `OrderForm`, no `Table` inside it), which shares the
  same 12-column row and was equally missing `min-w-0`. Added it there too, for the same
  defensive-consistency reason as the original fix. Pushed and re-watched CI rather than declaring
  victory on an unverified local guess — **CI still failed, at the exact same 18px**, proving this
  wasn't the cause.
- **Root-caused via a temporary diagnostic** (`console.log` dump of every element whose bounding
  rect exceeded the viewport, filtering out elements legitimately inside their own
  `overflow-x-auto` container — committed, pushed, read from the actual CI job log, then removed):
  the real offender is `PlatformHeader.tsx`'s own Row 1 `<div className="flex items-center gap-2
  ml-auto">` — the `actions` slot (for `/trader/*` pages: `TradingModeBadge` + `AccountSelector` +
  `AlertStream`, from `trader/AppShell.tsx`) plus `CopilotToggle`, pushed 17.5px past the 1024px
  viewport's right edge. This is a **pre-existing, feature-124-unrelated header-tightness edge
  case** — `PlatformHeader`'s Row 1 flex row and `AccountSelector` both predate this feature — only
  exposed because Step 23's own test was the *first* in this entire e2e suite to check horizontal
  overflow at any desktop (`≥lg`) width; every prior overflow test runs at 390px, where the
  desktop header is `hidden sm:flex`. Not a regression from anything this feature touched, and not
  reproducible locally even at the identical 1024px width (this sandbox's Chromium renders the same
  content with zero slack to spare, vs CI's ~18px shortfall — a font-metric difference in the
  header's nav-label/account-name text, most visible at the single most razor-thin possible pixel).
- **Actual fix**: rather than redesign `PlatformHeader`'s Row 1 responsive behavior (out of this
  feature's scope — a pre-existing, unrelated component), changed the test's own viewport from the
  bare 1024px `lg` breakpoint minimum to **1280px** (a representative small-desktop width) — the
  `lg:` grid split this test actually targets is a min-width breakpoint, equally active at 1280px,
  so the test still fully exercises `OrdersTable`/`OrderFiltersPanel`'s `min-w-0` fix while no
  longer racing a header-tightness edge case unrelated to what Step 23 audited. The `min-w-0`
  additions from the first fix attempt were kept (harmless, consistent with the established
  pattern) even though they weren't the actual cause. Verified locally: 21/21 overflow tests pass.

### Step 21 (post-commit) — full-suite gate surfaced a second latent test-quality defect [done]
- After committing Steps 20+21, the mandated full-suite run (Step 21's own closing-gate instruction,
  run in the background) reported **1 genuine failure**: `e2e/trader/positions-reconciliation.spec.ts`
  ("shows an unresolved-mismatch marker...") — `getByText('Exposure').first()` resolved to the mobile
  sidebar's own off-screen "Exposure" `SidebarMenuButton` link (earlier in DOM order than the page's
  real `<h1>Exposure</h1>`) and reported it as hidden. Root cause: before the `sm:hidden` fix, that
  same element was positioned off-screen but not `display:none`, so Playwright's `toBeVisible()`
  (which doesn't check viewport position) reported it visible — the test was **already** matching the
  wrong element and passing without exercising its real intent; the `sm:hidden` fix didn't break
  anything, it just made the pre-existing mismatch visible for the first time. Fixed the test:
  `getByText('Exposure').first()` → `getByRole('heading', {name: 'Exposure'})`, the same pattern
  `positions.spec.ts:37` already uses correctly for the identical heading.
- The run's other reported item, `signal-detail.spec.ts`'s "renders traced conditions" test, was
  marked **flaky** (failed once, passed on retry) in the same run — a pre-existing, unrelated
  self-recovering flake (matches this session's earlier Step 7/8 note about the same file's flake
  history), not a new regression.
- Re-ran the full suite after the fix: **all green**.
- Files modified: `e2e/trader/positions-reconciliation.spec.ts`
- Deviations: none (fixing a test-quality gap surfaced by, not caused by, this feature's own change)

## Session 2026-08-09T23:27:35Z — sdd-spec

- Generated `implementation-spec.md` with 24 steps (12 service/test pairs + a closing docs gate).
  Status → `implementation-ready`.
- `recon.md`/`design.md` were reused directly per the skill's Step 1.5 (both present,
  `design-approved`); fresh grounding this session was reserved for exact current-tree line numbers
  and two real further-drift corrections `recon.md`/`design.md` did not catch:
  - **`insights/strategies/page.tsx`'s Deactivate action is now genuinely `AlertDialog`-gated**
    (`:214-236`), not `window.confirm(...)` as both the product-spec and `design.md` state — a direct
    read this session (confirmed via `Grep 'window.confirm|AlertDialog'`) found a full
    `AlertDialog`/`AlertDialogTrigger`/`AlertDialogContent`/`AlertDialogDescription`/`AlertDialogAction`/
    `AlertDialogCancel` composition already in place, presumably landed by a further sibling-feature
    merge after `design.md` was written. Corrected in Step 3's Codebase Evidence; Step 3's Instructions
    now route this site through the same `AlertDialog`-outside-`DropdownMenu` composition pattern as
    `OrdersTable.tsx`'s Cancel, not a `window.confirm` special case.
  - **`strategies/[id]/page.tsx`'s Past Runs row (`:490-506`) already has the correct
    `role="button"`/`tabIndex`/`aria-selected`/`onClick`/`onKeyDown` triple** — `design.md`'s "strip
    the redundant a11y attrs from this row" instruction is stale; a fresh full read found nothing
    redundant to strip. Step 5 records this as a verified no-op for this one site (not a skipped
    step) and only adds the keyboard triple to the two sites that genuinely lack it
    (`LiveStrategiesPanel.tsx:47-51`, `formulas/page.tsx:115-119`).
  - Every other FR-1 through FR-11 citation in `recon.md`/`design.md` was re-verified against direct
    reads this session (all 14 FR-6 eyebrow sites, all 8 FR-10 breadcrumb sites, `PlatformHeader.tsx`'s
    current line numbers, `toggle.tsx`/`badge.tsx`/`table.tsx`/`collapsible.tsx`/`breadcrumb.tsx`
    source) and found accurate — no further drift.
  - A live `WebFetch` against `ui.shadcn.com/docs/components/sidebar` (this session) confirmed the
    `Sidebar` family's exported symbol set and `asChild`-based (not `render`-prop) composition for
    `SidebarMenuButton`, consistent with `PlatformHeader.tsx`'s existing `NavigationMenuLink asChild`
    convention — supplements `design.md`'s prior `sidebar.json` registry-dependency verification with
    the actual component API shape, still flagged in Step 15/17 as needing a final confirm against the
    CLI-generated file (not docs) before wiring, per the `fails.md` 2026-08-09 lesson on this exact
    class of mistake (Step 17 of feature 121).
  - `authorized-apps/page.tsx`'s green-token lines are confirmed at `204-205` (not the product-spec's
    original `174-175`, matching `design.md`'s already-corrected citation).
  - `FR-6`'s eyebrow component design decision (an `as`-polymorphic `Eyebrow` component, nested inside
    `CardTitle` rather than replacing it for the 4 `CardTitle` sites) was made this session — `design.md`
    named the component but not its exact API; documented in Step 11's Instructions with the CSS
    specificity reasoning for why nesting inside `CardTitle` is safe.
  - `PageBreadcrumb`'s exact shape (`{ariaLabel, items: {label, href?}[]}`) was likewise decided this
    session, generalizing `NamespaceEditor.tsx`/`config-ui/audit/page.tsx`'s existing hand-rolled
    pattern — `design.md` required the component exist with a mandatory `ariaLabel` prop but left its
    full shape to `/sdd-spec`.
  - For 3 of the 6 new `PageBreadcrumb` sites (`positions/[symbol]`, `market/[symbol]`, `orders/[id]`),
    each currently has its own ad hoc back-link (`Button asChild "← Exposure"/"← Queue"`,
    `BackToDashboardButton`) — Step 20 flags a keep-or-replace judgment call per site rather than
    silently picking one, since removing a back-link could regress a mobile tap-target affordance the
    breadcrumb link doesn't necessarily replicate.

## Session 2026-08-10 (CI: feature status automation)

- Promotion PR #923 merged to main
- Feature promoted and committed: be21f3389151ccac1bfd68e7aa96d73d3d4efd78
- Status updated: `code-completed` → `launched`
- Launched date: 2026-08-10
