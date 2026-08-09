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
