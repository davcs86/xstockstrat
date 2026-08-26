# Context: symbol-page-panel-refinements  (archived 2026-08-26)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-26 — /sdd-archiver

**What**: A pure `xstockstrat-ui` `/trader` presentation + client-state refinement of feature 139's symbol page. It shipped a single user-controllable strategy selection (modeled as a derivation) driving the Indicators / Backtests / "Why this fired" panels; removed the Manage and Broker panels; made Fundamentals always-on; and collapsed the stacked opportunity cards into one tabbed `SymbolPanelGroup`. No proto/config/DB/backend touched.

**Why (irrecoverable rationale)**:
- The original "No strategy resolves for AMZN" dead-end had a specific root cause: `?strategy=` was read **only** by `SignalReadiness`, while Backtests/Indicators resolved via `boundStrategyId || owningStrategy` and ignored the URL seed entirely. The fix unified all three onto one derived value — so the URL seed finally reaches every panel. Once shipped, the *why this was broken* is gone from the code.
- **Manage panel removed because** all its links deep-linked to a generic `/trader?symbol=`, duplicating the on-page "Place order" panel; **Broker panel removed because** its account id/link were already surfaced in the Position subtitle and the "Exposure" breadcrumb. These removal reasons are irrecoverable once design/spec are deleted — the deleted panels would otherwise read as an unexplained gap.
- The stacked-opportunity-cards behavior was **confirmed not a bug**: a single symbol (AMZN) is legitimately evaluated by multiple live strategies at once, so multiple opportunity rows per symbol is correct. This domain fact justified the tabbed group.
- (The decisive selection-model reasoning — *derive precedence, don't seed it* — is already recorded at insights.md 2026-08-18.)

**Rejected alternatives**:
- Effect + `seededRef` to seed selection state — lost: flashes a wrong "no strategy" state before the async watchlist binding resolves (the "seededRef guard is load-bearing" admission was the smell). *(Already balladed into insights.md 2026-08-18.)*
- Sync three pickers via the URL alone — lost: `history.replaceState` isn't reactive, siblings won't re-render; shared React state required.
- **One shared picker in a page toolbar / the section nav** — would have eliminated the 3× combobox a11y redundancy and the entire `getByLabel('Strategy')` ambiguity class, **but the user explicitly chose per-header pickers** (FR-7). This is the live tension for any future revisit (see Deferred).
- `StrategyPicker` in `components/shared/` — lost: it's coupled to the insights `analysisClient` via `useStrategyDefinitions`, so it lives in `components/insights/` to keep the coupling honest.
- Delete "Why it's held" — rejected **at the design gate by explicit user decision**; kept as a Trade panel, which is why `owningStrategy` was retained as a display value even after being dropped as a resolution source. Without this note the retained-`owningStrategy`-for-display-only split looks accidental.

**Scars & gotchas**:
- Promoting a card into its own `SymbolPanelGroup` panel silently adds a hidden mobile `role="radio"` tab carrying the **same text** as the card title, so any unscoped `getByText('Risk & exit')` now matches 2 elements and fails Playwright strict mode. Must scope to `getByRole('heading')` / `getByRole('radio')`. This bit "Risk & exit" when it became its own panel.
- Three synced pickers sharing `aria-label="Strategy"` make `getByLabel('Strategy')` ambiguous, and the collision can surface on a *different* spec than the one under test — requires a full-suite grep + broad e2e pass before close (the fails.md 2026-08-09 Breadcrumb trap recurring; the fix was distinct `aria-label`s per picker).
- Page-level `useSearchParams()` in Next 15 needs a `Suspense` boundary or `pnpm build` fails with a CSR-bailout.

**Permanent deviations**:
- None on behavior. Execution-process deviation only: per the harness single-PR constraint, the 3 steps landed directly on `claude/symbol-page-ui-refinements-t2xp26` (not per-step feature-step branches) and the P-06 RED capture was compressed to "confirmed failing during iteration" rather than a strict per-assertion RED. Recoverable from git, noted for completeness.
- Minor shipped adjustments (IndicatorSection gained a stable outer Card so the `indicator-panels-empty` testid moved to the empty-state `<p>`; Backtests no-strategy copy reworded to "pick a live strategy above") — all grep-able in shipped code/tests.

**Cross-feature signal**: This is the second symbol-page feature (after 139) to be bitten by `SymbolPanelGroup`'s hidden-mobile-radio-duplicate-label test-locator trap and by collision-prone shared `aria-label`s. The pattern: feature 139 introduces an all-mounted panel/nav primitive → every subsequent feature that adds panels inherits a locator-ambiguity tax.

**Deferred follow-ons**: The single-toolbar/section-nav picker (rejected only on user preference, not merit) remains the known lever if the 3× combobox a11y redundancy or `getByLabel` ambiguity ever needs to be retired. The next `/sdd-story` on this page should not re-derive it.

**Ledger entries written**: insights.md (1), fails.md (1) — see the 2026-08-26 entries. (The derived-precedence selection insight was already recorded at insights.md 2026-08-18.)
**Runtime-invariant recommendations (→ /context-constitution)**: none strong (multi-strategy-per-symbol opportunity return is derivable from the analysis opportunity key shape `(user|symbol|strategy)`; flagged only because the e2e mock originally served one row per symbol and hid this case).
**Scenario promotion (C-16)**: none — this feature has no `acceptance.feature` file.
**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 996210e4.
