# UI/UX Governance

`xstockstrat-ui` is the platform's **only** human-facing surface — all four segments (`/trader`,
`/insights`, `/config-ui`, `/accounts`) ship from one Next.js app. This doc is the **single normative
home** for visual/interaction consistency across those segments: design tokens, component-library
governance, the shared shell contract, loading/empty/error conventions, and the accessibility baseline.
It **governs**; it does not re-teach plumbing. For the architecture underneath the UI, read the docs
this one deliberately does not restate:

- Auth, BFF wiring, Edge-runtime safety → `docs/patterns/frontend-auth.md`
- basePath, the BFF connect-web call chain, browser typed-client data shape, Suspense/hydration
  mechanics, middleware matcher, app icons → `docs/patterns/nextjs-frontends.md`
- The implementation home for every rule below (exact preset id, `@theme` block, per-file scars) →
  `services/xstockstrat-ui/CLAUDE.md` § Styling and § Opportunities-first shell
- Reuse-before-adding enforcement (jscpd + the `dry-reviewer` subagent) → `docs/patterns/dry-guard-rail.md`

Binding index: the always-do rule this doc encodes is Constitution **C-17** (`docs/sdd/constitution.md`);
the a11y/nav/consumer-surface tie-ins are **C-10 / C-12 / C-13 / C-14**.

---

## 1. Design tokens & theming

**Consume role tokens; never hardcode a color.** All color, radius, font, and animation values come
from the shadcn preset `bLTl5gh6` (style `radix-rhea`) via the `@theme inline` block in
`src/app/globals.css`, which maps Tailwind's `--color-*`/`--font-*`/`--radius-*`/`--animate-*` namespace
onto the app's `:root` custom properties. That block is the **single source of theme truth**.

- **Never** write a raw hex/`oklch()`/`hsl()` literal or an arbitrary Tailwind color utility
  (`text-yellow-400`, `bg-[#1a1a1a]`, `text-green-500`) in feature code. Use the role utility that maps
  to a token: `bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, `border-border`,
  `bg-primary`, `text-destructive`, `bg-secondary`, `bg-accent`, `ring-ring`.
- **Semantic domain roles** are first-class tokens — use them, don't re-invent them:
  `text-buy` / `bg-buy` (gain green `hsl(159 52% 54%)`), `text-sell` / `bg-sell` (loss red
  `hsl(359 63% 67%)`), `text-paper` / `bg-paper` (paper-trading tan `hsl(43 41% 64%)`). These carry
  order-side / paper-vs-live meaning platform-wide; a one-off `text-red-500` for a loss is a defect.
- **Charts** consume `--chart-1`…`--chart-5` and the dedicated gridline token `--chart-grid`
  (deliberately *not* `--border`, whose 10%-alpha white near-erases gridlines) via
  `src/lib/chartColors.ts`. Do not hand-pick chart colors.
- **Typography:** `--font-sans` = Roboto (bound in the root layout via `next/font/google`);
  `--font-heading` aliases sans; `--font-mono` = `ui-monospace, SFMono-Regular, Menlo, Consolas`.
  **Numbers, tickers, IDs, thresholds, and timestamps render mono + `tabular-nums`** (FR-3) — never a
  proportional font for a figure that lines up in a column.
- **Radius** uses the `--radius`-derived scale (`rounded-sm`…`rounded-4xl`); base `--radius` is
  `0.45rem`. Do not use arbitrary `rounded-[Npx]`.
- **The app is dark-only** — a deliberate product choice (feature 119). There is **no light mode and no
  theme toggle**; the preset's light block was dropped and the dark values fold into `:root`
  unconditionally. Do not add a `dark:` variant, a light palette, or a theme switcher without a feature
  that explicitly re-opens this decision.

> **Why role tokens, not raw values:** re-theming, contrast fixes, and the eventual (if ever)
> light-mode reversal all happen by editing `globals.css` once. Every hardcoded literal is a site the
> single-source edit silently misses.

---

## 2. Component-library governance

**shadcn/ui is the primitive source.** `src/components/ui/` is managed by the shadcn CLI via
`components.json`; add a primitive with `npx shadcn@latest add <name>`, never by hand-rolling a
near-duplicate.

- **Reuse a primitive + variant before adding anything new.** Before writing a new component or a new
  `cva()` variant, check whether an existing `ui/*` primitive plus one of its variants already covers
  the need. A renamed-but-equivalent helper or a parallel type shape is a DRY violation the
  `dry-reviewer` subagent and the jscpd pre-commit hook will flag — see `docs/patterns/dry-guard-rail.md`.
- **`apply --preset` clobbers — reconcile the app-specific variants.** Re-running
  `npx shadcn@latest apply --preset bLTl5gh6` overwrites every listed primitive **wholesale**, dropping
  the app's functional additions. After any `add`/`apply --preset`, re-add and verify:
  - `Button` variants `buy` / `sell` (order-side coloring), marked `// app-specific`
  - `Badge` variants `buy` / `sell` / `paper` / `live` / `warning` / `info`, marked `// app-specific`
  - the `sidebar.tsx` `data-active={isActive || undefined}` fix (feature 126) — a bare boolean paints
    every row active
  These are guarded by mechanical tests (`src/components/ui/button.test.ts`, `badge.test.ts`) that fail
  loudly if a regenerate silently drops them. Treat those tests as the contract.
- **Base-UI vs classic Radix coexist by design.** `combobox.tsx` is a full `@base-ui/react` compound
  component; the rest of `ui/*` is classic shadcn/Radix. Don't "unify" them — match the primitive to the
  three existing combobox call sites' controlled-value pattern.
- **Enum → render maps are exhaustive and centralized.** Badge/label rendering for a proto enum lives in
  `src/lib/opportunityShared.tsx` (`EnumBadge` + `Record<Enum, EnumRender>`); adding an enum value
  without a map entry fails `tsc`. Do not scatter per-call-site enum switches.

---

## 3. Layout & the shared shell contract

Every segment renders the **same shell**. The nav model is the single source of truth.

- **`NAV_GROUPS` in `src/components/shared/navGroups.tsx`** defines the five groups
  (Decide / Discover / Engine / Book / Settings) over the four physical segments. Import the nav model
  from `navGroups.tsx` — **never from `PlatformHeader`** (that forms a `PlatformHeader ↔ BottomTabBar`
  cycle → a prerender TDZ crash).
- **`PlatformHeader` is the shared chrome** (sticky 2-row desktop bar + mobile offcanvas sidebar +
  `BottomTabBar`), consumed by every segment. Admin-only entries are gated via `/api/auth/me`.
- **Register every new page in the nav model, with a reachability test** — Constitution **C-10(a)**. A
  page that isn't a `NAV_GROUPS` entry must be a legitimate deep-link/detail page reached from a parent
  list/card/redirect (`e2e/nav-reachability.spec.ts` enforces this; the 2026-08-07 audit §6 confirms
  zero orphans today — keep it that way).
- **Each page renders its own breadcrumb** via `src/components/shared/PageBreadcrumb.tsx`
  (`{ariaLabel, items}`) — the shared Row-2 breadcrumb landmark was removed in feature 124.
- **Responsive is mobile-first with the `sm:` breakpoint as the desktop cutover.** Desktop nav is
  `hidden sm:flex`; the mobile offcanvas sidebar + `BottomTabBar` subtree is wrapped in `sm:hidden`
  (wrap the **whole** subtree, not just the trigger — the sidebar's desktop branch renders off-screen
  via a negative offset and otherwise leaks into the a11y tree). Content wrappers add `pb-20 sm:pb-0`
  for bottom-tab clearance. **Mobile tap targets are ≥44px.**
- **The header is `sticky top-0 z-40` with `bg-background/80 backdrop-blur-sm`**; page grids use the
  `grid-cols-1 md:grid-cols-12` convention. Match it; don't invent a per-page layout scaffold.

---

## 4. State conventions — loading / empty / error / forms / tables

The platform has **no toast/notification library** — all feedback is inline and this is intentional
(record it, don't "add sonner"). Route every non-happy state through the canonical primitives:

| State | Canonical primitive | Rule |
|---|---|---|
| Page-level loading | `<Suspense fallback>` + `ui/skeleton.tsx` `Skeleton` | The fallback renders the real shell + card scaffold, **never `null`** (SSR HTML must not be empty). |
| Inline panel loading/error | `src/components/shared/QueryStateMessages.tsx` | The DRY single source: loading = `text-muted-foreground`, error = `text-destructive`. |
| Empty result | `src/components/shared/EmptyState.tsx` (`{title, description?, action?}`) | Specific copy ("No backfill jobs match the filter"), not a bare "No data". |
| Error notice | `src/components/shared/CardNotice.tsx` (`variant: 'error'`) or `ui/alert.tsx` | Error variant sets `role="alert"` + `text-destructive`. |
| Mutation feedback | inline, via `src/hooks/useInvalidatingMutation.ts` | The canonical "call a BFF RPC then invalidate query keys" factory — build order/watchlist-style hooks on it, don't re-implement. |
| Form / confirm modal | `src/components/shared/FormDialog.tsx` (built on `AlertDialog`) | Deliberately does **not** dismiss on outside-click/escape; the caller provides an in-body Cancel. Form fields use `ui/field.tsx` + `ui/label.tsx` + `ui/input-group.tsx`. |
| Tabular data | `ui/data-table.tsx` `DataTable` (TanStack) | Built-in sortable headers, optional pagination, `emptyMessage`, and accessible `onRowClick` (`role="button"`, `tabIndex=0`, Enter/Space) guarded so nested links don't double-fire. Requires referentially-stable `data`. |

Adoption is the governance point, not existence: the shared primitives exist but adoption is uneven
(see the backlog, §9). New/changed UI **must** use them; hand-rolled `<p className="text-sm
text-destructive">Failed to load X</p>` markup is a defect, not a shortcut.

---

## 5. Accessibility baseline

The normative a11y floor for every segment. These distil the ledger's hard-won rules and the standing
findings trail in `docs/reports/2026-08-07-xstockstrat-ui-audit.md` (§§1–4) — read that report as the
evidence log, not as resolved history (most of it is still open; see the backlog, §9).

1. **Every interactive/icon-only control has a unique accessible name.** An icon-only button carries an
   `aria-label` or an `sr-only` span (the `PlatformHeader` mobile-nav button is the reference:
   `<span className="sr-only">Open menu</span>`). A form input has a programmatically associated
   `<label>` (`htmlFor`/`id` or wrapping) — a `placeholder` is **not** a label.
2. **Accessible names are unique per row/instance.** In any list/repeat UI, index the name
   (`` `output name ${i}` ``, `` `Strategy for ${symbol}` ``) — a hardcoded label repeated across rows
   collides for `getByLabel()` and screen readers alike (the single most severe recurring class in the
   audit).
3. **Errors announce; active state is conveyed.** Error notices use `role="alert"`; status/live regions
   use `aria-live` (`polite`). Active nav marks the current page with `aria-current="page"`; toggles use
   `aria-pressed`.
4. **ARIA must be valid on its role.** Don't put `aria-selected` on `role="button"` (valid only on
   `option`/`row`/`tab`/`gridcell`/`treeitem`) — browsers drop it silently. On a vendored primitive, the
   ARIA **role must exist before** `aria-labelledby`/`aria-describedby` means anything.
5. **Hide off-mode UI with `hidden`/`display:none`, never off-screen positioning.** Off-screen nav/content
   stays in the DOM and the accessibility tree, duplicating the real controls (the feature-124 sidebar
   scar). The `sm:hidden`-wrap-the-whole-subtree rule in §3 is the concrete instance.
6. **Bare `data-*` Tailwind variants need `{value || undefined}`.** A bare `data-active:` selector matches
   on attribute *presence*; React stringifies `false` to `"false"` (still present), so pass
   `isActive || undefined` to omit it when off (feature 126).
7. **Tests assert via role/label locators.** e2e uses `getByRole` / `getByLabel` / `aria-current` /
   `aria-pressed` — write components so those locators resolve. There is **no** axe-core or
   visual-regression gate today; that is a known non-goal (§7), so role-based e2e is the a11y contract.

---

## 6. Icons & typography components

- **One icon library per convergence decision.** Today **three** coexist: `@tabler/icons-react` (the
  shadcn `ui/*` primitives — consistent with `components.json`'s `iconLibrary: tabler`),
  `@phosphor-icons/react` (nav/header/copilot/mobile/shared, `weight`-prop convention), and
  `lucide-react` (most segment components). This split is a tracked deviation (§9); until it converges,
  **match the icon library already used in the file/area you're editing** — don't introduce a fourth,
  and don't swap one file's library on a whim.
- **`Eyebrow` (`src/components/shared/Eyebrow.tsx`) is the canonical kicker/label** (mono, uppercase,
  tracked). **`StatTile` / `Stat`** are the canonical metric tiles (mono + `tabular-nums`, tone-coded).
  Use them instead of re-styling a heading.

---

## 7. Testing hooks & non-goals

- **Fixtures come from the canonical home** (`e2e/fixtures/*.ts` + `INVENTORY.md`, auth via
  `e2e/helpers/auth.ts`) — Constitution **C-12/C-13**; see `docs/patterns/test-data-inventory.md`.
- **e2e is the a11y and behavior contract** (role/label locators, chromium in CI).
- **Explicit non-goals (today):** no axe-core automated a11y gate, no visual-regression/snapshot
  baseline, no jsdom component tests (the vitest layer is logic-only, scoped to `src/lib/**`). Adding any
  of these is a future feature, not an ambient expectation.

---

## 8. Coverage audit — durable acceptance vs. e2e (read-only)

**Finding:** `xstockstrat-ui` has broad Playwright e2e coverage of real behavior, but almost none of it
is captured as a **durable, promoted business-rule guarantee**. The durable per-service suite
(`services/xstockstrat-ui/acceptance/*.feature`) holds only **two** files, both partial. Durable
suites are **promotion-only** (Constitution **C-16**; `docs/sdd/business-rules/CLAUDE.md`: "never
hand-author a rule here") — so the gap below is closed by promoting each module's already-passing e2e
behavior through the SDD pipeline (a feature's reviewed `acceptance.feature` → `/sdd-spec` trace →
promotion at launch), **not** by hand-writing `.feature` files. Route the gaps to `/sdd-qa gaps` and the
owning feature's SDD flow.

| Segment · module | e2e coverage (exercised today) | Durable acceptance suite? | Gap → route |
|---|---|---|---|
| trader · orders / order detail | `trader/orders`, `order-form`, `order-ticket`, `order-intent`, `order-parity` | none | promote via owning order features |
| trader · positions / exposure | `trader/positions`, `positions-reconciliation`, `valuation-parity` | none (breadcrumb-only via feature 155) | `/sdd-qa gaps` |
| trader · position detail | `trader/position-detail`, `symbol-section-nav` | none | promote via feature 083/125 |
| trader · accounts | `trader/account-selector`, `offline-accounts` | none | promote via feature 157 |
| trader · portfolio | `trader/portfolio` | none | promote via feature 042 |
| trader · dashboard / alert stream | `trader/alert-stream`, `chart-panel`, `live-strategies` | none | `/sdd-qa gaps` |
| insights · opportunities | `insights/opportunities` | **partial** — `watchlist-opportunity-signal-cues.feature` (AC-9..12) | extend on next touch |
| insights · watchlists | `insights/watchlists` | **partial** — `watchlist-opportunity-signal-cues.feature` (AC-1..6, 13) | extend on next touch |
| insights · signal detail (`market/[symbol]`) | (via opportunities / symbol nav) | none | promote via feature 083 |
| insights · strategies | `strategy-analytics`, `strategy-authoring`, `strategy-ownership` | none | `/sdd-qa gaps` |
| insights · formulas | `insights/formulas`, `formula-deletion` | none | `/sdd-qa gaps` |
| insights · screener | `insights/screener` | none | `/sdd-qa gaps` |
| insights · pnl-patterns | `insights/pnl-patterns` | none | promote via feature 042 |
| insights · backfills | `insights/backfills` | none | `/sdd-qa gaps` |
| config-ui · namespaces | `namespace-nav`, `value-persists-after-save`, `reason-capture`, `env-mode-switcher`, `env-gate`, `secret-editing` | none | promote via feature 147 |
| config-ui · sources | `config-ui/sources` | none | `/sdd-qa gaps` |
| config-ui · audit | `config-ui/audit` | none | `/sdd-qa gaps` |
| config-ui · fundamentals-scan | `config-ui/fundamentals-scan` | **partial** — `fix-fundamentals-signal-producer.feature` | extend on next touch |
| accounts · authorized-apps | `accounts/authorized-apps` | none | promote via feature 051 |
| accounts · mcp-tools | `accounts/mcp-tools` | none | `/sdd-qa gaps` |
| accounts · profile | `accounts/profile` | none | `/sdd-qa gaps` |
| cross-cutting · a11y / nav / mobile / states | `nav-reachability`, `breadcrumb`, `mobile*`, `non-happy-states`, `copilot`, `auth` | none (platform-wide) | promote a11y baseline (§5) via a feature's `acceptance.feature` → `platform.feature` |

> The a11y baseline in §5 is the strongest candidate for a first cross-cutting promotion: it is uniform
> across every route and already asserted by role-based e2e. It enters `platform.feature` **only** as a
> promoted scenario from a feature that carries it — see the note above.

---

## 9. Known deviations / convergence backlog

Documented, not fixed here (docs-only PR). Each is a real current inconsistency with an evidence trail
and a target convention; converge it through `/sdd-triage` (confirmed defects) or `/sdd-story` +
`/sdd-design` (capability-shaped convergence), per the repo's SDD entry-point rule.

| # | Deviation | Evidence | Target convention | Route |
|---|---|---|---|---|
| a | Three icon libraries coexist with no single convention: `@tabler/icons-react` (shadcn `ui/*`, matches `components.json`), `@phosphor-icons/react` (nav/header/copilot/mobile/shared), `lucide-react` (most segment components) | icon imports across `src/` (tabler ×10, phosphor ×7, lucide ×26) | one convention, or a documented intentional split (e.g. tabler for primitives, one library for features) | `/sdd-story` (capability-shaped) |
| b | `StatTile` tones bypass semantic tokens (`text-yellow-400`, `text-destructive` where `text-paper` / `text-sell` are the roles) | `src/components/shared/StatTile.tsx` | tones map to the `--color-buy/sell/paper` roles (§1) | `/sdd-triage` |
| c | `config-ui` layout inlines `PlatformHeader` in its server layout instead of the trader/insights client `AppShell` pattern | `src/app/config-ui/layout.tsx` vs `components/{trader,insights}/AppShell.tsx` | one shell-composition pattern across segments | `/sdd-story` |
| d | No `role="alert"`/`aria-live` on `QueryStateMessages`/`CardNotice`/`EmptyState`; error/empty state markup hand-rolled in 13+ files | audit §4 | adopt the shared primitives everywhere + add `aria-live` once adopted | `/sdd-story` (convergence feature) |
| e | Colliding `aria-label`s (RuleEditor/ComponentEditor/Screener) and missing accessible names (AlertStream bell, Backfills selects, unlabeled inputs, invalid `aria-selected`) | audit §§1–2 | §5 rules 1–4 (unique indexed names, valid ARIA) | `/sdd-triage` (Track C bug fix) |
| f | No toast/notification system — all feedback inline | this doc §4; audit §4 | **intentional** — recorded so a future audit doesn't re-flag it | none (decision record) |

---

## Cross-references

- `docs/patterns/nextjs-frontends.md` — basePath, BFF call chain, typed-client shape, Suspense/hydration
- `docs/patterns/frontend-auth.md` — auth, Edge-runtime safety, per-segment auth routes
- `docs/patterns/dry-guard-rail.md` — reuse-before-adding enforcement
- `docs/patterns/test-data-inventory.md` — fixture homes (C-12/C-13)
- `services/xstockstrat-ui/CLAUDE.md` § Styling / § Opportunities-first shell — the implementation home
- `docs/reports/2026-08-07-xstockstrat-ui-audit.md` — the standing a11y/consistency findings trail
- `docs/sdd/constitution.md` — **C-17** (this doc's binding index), **C-10 / C-12 / C-13 / C-14 / C-16**
- `docs/sdd/business-rules/CLAUDE.md` — why durable acceptance suites are promotion-only
