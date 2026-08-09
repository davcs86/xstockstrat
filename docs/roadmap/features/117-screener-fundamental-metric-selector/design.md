# Design: screener-fundamental-metric-selector

**Created**: 2026-08-07
**Rounds**: 1 (quick mode — mandated round met, no unresolved Floor breach)

---

## Chosen Approach

Convert the Fundamental metric field (`services/xstockstrat-ui/src/app/insights/screener/page.tsx:241-248`,
currently `<Input aria-label="metric">`) to a catalog-driven Radix `Select`, per product-spec FR-1,
reusing the exact pattern already proven twice in this codebase: the page's own watchlist-target
picker (`page.tsx:402-413`) and `ComponentEditor.tsx:159-170`'s catalog-driven `Select`/`SelectItem`
map.

1. **New catalog** — add `FUNDAMENTAL_METRICS: { name: string; description: string }[]` to
   `services/xstockstrat-ui/src/lib/strategyCatalog.ts` as a sibling to `BUILTIN_INDICATORS`
   (`strategyCatalog.ts:52-114`), same `{ name, description }` shape convention, covering the 11
   names in `_FUNDAMENTAL_FIELDS` (`services/xstockstrat-analysis/app/services/screener.py:32-44`):
   `market_cap`, `pe_ratio`, `pb_ratio`, `dividend_yield`, `eps`, `beta`, `roe`, `debt_to_equity`,
   `price`, `year_high`, `year_low`.
2. **Doc comment** — extend `strategyCatalog.ts`'s "keep in sync" header comment
   (`strategyCatalog.ts:1-12`) to name `_FUNDAMENTAL_FIELDS`/`screener.py` as the third mirrored
   source, alongside the existing two (indicators service `INDICATOR_REGISTRY`, analysis
   `_SUPPORTED_FNS`). *(Folded in from adversary round: this was in recon's "Patterns to REUSE" but
   dropped from the proposer's Key Decisions — now an explicit line item, not left implicit.)*
3. **Order-independent default** — do **not** rely on `FUNDAMENTAL_METRICS[0].name` as the default.
   Both `newCriterion()`'s seeded default (`page.tsx:70`, today's literal `'pe_ratio'`) and the
   kind-switch reset (`page.tsx:211-219`, today's literal `'pe_ratio'` at line 218) source their
   Fundamental default via `FUNDAMENTAL_METRICS.find((m) => m.name === 'pe_ratio')!.name` (or an
   equivalent named constant, e.g. `const DEFAULT_FUNDAMENTAL_METRIC = 'pe_ratio'` defined once and
   reused at both call sites) — never array-index `[0]`. *(Folded in from adversary round: FR-3's
   correctness depends on `pe_ratio` staying the default; a magic-index dependency silently breaks
   if a future contributor alphabetizes the catalog. The Technical-indicator sibling's
   `BUILTIN_INDICATORS[0].name` pattern, `page.tsx:217`, stays untouched — its index-0 choice
   (`SMA`) isn't load-bearing the way `pe_ratio` is here, so it does not need the same fix.)*
4. **Component/JSX** — mirror `ComponentEditor.tsx:159-170`'s catalog-driven `Select`:
   `<Select value={c.metricName} onValueChange={(v) => updateCriterion(i, { metricName: v })}>`
   with a `SelectTrigger aria-label="metric"` and `SelectContent` mapping `FUNDAMENTAL_METRICS` to
   `SelectItem key={m.name} value={m.name}>{m.name} — {m.description}</SelectItem>`. Reuses the
   page's already-imported Radix primitives (`page.tsx:10-16`) — no new import.
5. **e2e coverage** — extend `services/xstockstrat-ui/e2e/insights/screener.spec.ts` with
   assertions using the existing Radix interaction pattern (`click()` + `getByRole('option', ...)`,
   `screener.spec.ts:221-222`, not `.selectOption()`, which only works on a native `<select>`):
   - the Fundamental metric dropdown renders **exactly 11** options
     (`getByRole('option')` count === 11);
   - the default-selected value shown is `pe_ratio` ("P/E ratio") on a freshly-added row;
   - selecting a different catalog entry (e.g. `market_cap`) updates the row's `metricName` and is
     what gets sent on scan.
   *(Folded in from adversary round: these two assertions — option count and rendered default —
   directly cover Acceptance Criteria 1/3 and are also the regression test that would catch the
   magic-index fragility above if it ever regressed.)*
6. **No vitest unit test** for the new catalog array — it is static data with no logic, matching
   the existing `BUILTIN_INDICATORS` precedent (also untested at the unit level,
   `vitest.config.ts:15-23`, `coverage.all: false`). The e2e assertions above are the actual
   regression coverage for this feature.

## Rejected Alternatives

- **Native `<select>` for the Fundamental field too** (matching the sibling Technical-indicator
  field, `page.tsx:228-240`, for full native consistency on the row) — simpler, no Radix
  hydration/`'use client'` concerns for this one control, and it's what the *sibling* metric field
  on the same row already uses. Rejected because product-spec FR-1 explicitly mandates Radix
  `Select` (matching the watchlist-target picker) and the `ComponentEditor.tsx` catalog-driven
  precedent is Radix, not native — overriding an approved FR here would need explicit user sign-off
  in `context.md`, which this design does not have grounds to assume. This *does* leave a
  Radix/native split between the two metric fields on the same criterion row — accepted as the
  direct, known consequence of FR-1, not an oversight.
- **`FUNDAMENTAL_METRICS[0].name` as the default** (simplest, matches the Technical-indicator
  reset's existing `BUILTIN_INDICATORS[0].name` pattern) — rejected as too fragile for a
  load-bearing default; an order-independent `.find()` lookup costs nothing extra given the array
  is 11 entries.

## Open Risks

- **`aria-label="metric"` collision across mixed-kind multi-criteria rows.** Only one
  `aria-label="metric"` control renders per row (the kind ternary at `page.tsx:228-248`), so a
  single-row test never collides. But a user can add a second criterion and set *its* kind to
  Technical, giving the page a native `<select aria-label="metric">` (Technical row) and — after
  this change — a Radix `<button aria-label="metric">` (Fundamental row) simultaneously in the DOM.
  `page.getByLabel('metric')` becomes ambiguous (Playwright strict-mode failure) unless a test
  scopes via the row's `data-testid="criterion-row"` wrapper (`page.tsx:200`). Pre-existing
  behavior (the Input/native-select pair already collided the same way before this change) — not
  introduced by this feature, and this feature's own new e2e assertions stay single-row so they are
  unaffected. **Target step**: the e2e step in `/sdd-spec` should scope its locators through the
  row wrapper rather than a bare `getByLabel('metric')`, as a forward-looking habit, even though
  today's single-row test doesn't strictly require it.
- **Frontend/backend catalog drift.** `FUNDAMENTAL_METRICS` is a static mirror of
  `_FUNDAMENTAL_FIELDS`; nothing enforces the two stay in sync automatically (same accepted
  trade-off as `BUILTIN_INDICATORS`, not a new risk introduced by this feature). If
  `_FUNDAMENTAL_FIELDS` ever gains/loses a field, the UI catalog needs a manual follow-up edit.

## Constitution Rules Touched

- **C-01** (evidence-cited steps) — honored: every claim above is `path:line`-cited to `recon.md`,
  which was itself grounded via `codebase-discovery`.
- **C-10** (integration completeness across shared surfaces) — not triggered: no new UI
  route/nav entry, no duplicated authoritative-value display, no seeded/shared resource.
- **C-11** (no implementation without SDD grounding) — honored: this design is the required gate
  before any code write.
- **C-12/C-13** (test fixtures from the canonical home) — not triggered: no mocked/dummy domain
  data is introduced; the new e2e assertions exercise client-authored form state, not
  server-mocked fixtures (recon confirmed no `INVENTORY.md` entry is warranted).
- **C-14** (name the consumer surface) — honored: product-spec names `/insights/screener`
  explicitly; no new surface, no deferral needed.
- **F-04** (never invent a symbol) — honored: every symbol/path referenced above was confirmed by
  `codebase-discovery` in `recon.md`.

## Termination

Approved after 1 round (quick mode's mandated count). No Floor (`F-*`) breach was raised by the
adversary — all objections were scope/robustness refinements, folded directly into the Chosen
Approach above rather than requiring a second debate round.
