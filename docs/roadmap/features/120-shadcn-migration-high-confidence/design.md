# Design: shadcn-migration-high-confidence

**Created**: 2026-08-08
**Rounds**: 2 (full; termination: pending user approval)
**Approved by**: _pending_
**Grounded in**: recon.md

---

## Chosen Approach

Consumer surface (C-14): `xstockstrat-ui` only, across `/insights`, `/trader`, `/config-ui`, and
`/auth/login` — every change is a like-for-like markup swap inside an already-shipped,
already-reachable page (product-spec.md § Consumer Surface(s)). No new routes, no nav
registration.

**Authoring.** Primary path is `npx shadcn@latest add <name>` against the existing
`components.json` preset (`bLTl5gh6`, `recon.md` § Codebase Map). If the CLI is unavailable,
hand-author to the **post-119 plain function-component shape** confirmed at
`services/xstockstrat-ui/src/components/ui/button.tsx:46` / `select.tsx` — `function X({
className, ...props })` + `cva()` + `cn()` from `ui/utils.ts` + `data-slot` props — **not**
`React.forwardRef`/`.displayName` (`recon.md` § Patterns to REUSE; this corrected a stale
recipe in the original product-spec, now fixed in `product-spec.md` FR-12 directly).

**Step ordering** (five tiers, each primitive interleaved with its lowest-risk consumer rather
than all 8 primitives batched before any call site — this is the round-1→round-2 fix that
closes the F-09 rework-after-close risk an all-primitives-first batch would create):

1. **Warm-up — adopt-existing, zero primitive dependency, zero e2e risk**: FR-11 (Skeleton →
   `insights/page.tsx`, `auth/login/page.tsx`), FR-10 (Badge → `CopilotRail.tsx:124-126`, the
   "beta" pill only — disambiguated from FR-4's separate Alert edit on the same file, see
   below), FR-6 (Textarea → `FormulaWorkspace.tsx:254-259,351-356`, `RuleEditor.tsx:327-335`).
2. **Per-primitive: add + lowest-risk wire, same tier.** For each of the 8 new primitives
   (Tabs, Toggle Group, Alert Dialog, Alert, Checkbox, Breadcrumb, Accordion, Progress —
   product-spec.md FR-12's corrected range, FR-1–FR-5 + FR-7–FR-9), the add-step is
   immediately followed by its lowest-risk / no-e2e-risk consumer wire-step, so an
   integration-fit mismatch (e.g. Accordion's default expand/collapse vs. `PlatformHeader.tsx`'s
   current mobile-nav UX; Alert Dialog's single-cancel vs. a two-step arm/confirm) surfaces
   while that primitive's own step is still open, not three tiers later.
   - **Alert Dialog** wires first to `accountShared.tsx:213-245` — this is the **easier**,
     already-two-button (Confirm/Cancel) shape, a natural fit for
     `AlertDialogAction`/`AlertDialogCancel`; `OrdersTable.tsx:140-149`'s single
     label-toggling button is the **harder** shape (no separate dismiss control, doesn't map
     onto AlertDialog's trigger/cancel/action structure without synthesizing a new control)
     and is deliberately sequenced second, after the primitive is proven on the easy case.
     (Round 2's adversary caught the proposer's rationale reading backwards on this point —
     corrected here: `accountShared.tsx` is easier, not harder, and that's *why* it's first.)
   - **Alert** gets an app-specific `warning` `cva` variant (see Constitution Rules Touched /
     DRY below) reconciling the identical hand-rolled `border-yellow-500/40 bg-yellow-500/5`
     tone duplicated across `CopilotRail.tsx:151-154` and `SectionRenderer.tsx:113-116`
     (round-2 adversary finding, verified by reading both files) — both collapse onto
     `variant="warning"` instead of leaving the conditional className hand-rolled on top of
     the migrated primitive.
   - **Toggle Group** gets an app-specific `buy`/`sell` `cva` variant for `OrderForm.tsx`,
     mirroring `button.tsx:22-25`/`badge.tsx:19-20`.
   - **Progress** gets an app-specific `buy`/`paper`/`sell`/`muted` `cva` variant promoting
     `WatchlistReadiness.tsx`'s existing `barClass()` firing-state taxonomy (same design
     tokens as `button.tsx`/`badge.tsx`'s buy/sell) into the primitive — this is semantically
     meaningful state, not decoration, so it collapses rather than staying hand-rolled per
     site. `SignalReadiness.tsx:71-82` and `SectionRenderer.tsx:64-71` use a static
     `bg-primary` fill with no state logic (verified by reading both) and stay on
     `variant="default"`.
   - Only Toggle Group, Alert, and Progress carry an app-specific variant + mirrored
     `<name>.test.ts` (FR-12); the other 5 primitives (Tabs, Alert Dialog, Checkbox,
     Breadcrumb, Accordion) get a minimal `<name>.test.ts` asserting the exported
     component/variants surface exists and the default variant renders its expected class(es)
     — FR-12 requires a mechanical regression test for **every** primitive added under this
     feature, not only the ones with an app-specific variant; the test's *content* scales with
     what there is to protect, but the file is never skipped.
   - After **every** primitive-add step (all 8, no exceptions — a narrower "only if it touches
     shared files" reading is explicitly rejected since every new `ui/*` file is by definition
     shared), run `pnpm build`/`tsc --noEmit` and the **full** Vitest suite (not just the new
     `.test.ts`), per the ledger's `resolve.alias`-vs-`tsconfig.json` drift trap
     (`docs/roadmap/ledger/insights.md`, 2026-08-08 shadcn-ui-migration).
   - **`CardNotice.tsx`** (FR-4's third call site) is a **shared component** with consumers
     beyond the cited file: `OrderBook.tsx:71-72`, `PortfolioPanel.tsx:15-16`, and
     `trader/portfolio/page.tsx:69-70,152` all render it. Round-2 adversary verified (grep for
     its rendered strings — "Loading portfolio…", "Portfolio unavailable", "No open positions
     in the selected account.") that none of these carry e2e-load-bearing selectors — recorded
     here so the finding lives in a durable artifact, not just the debate transcript. The
     migration keeps `CardNotice`'s existing `<Card><CardContent>` wrapper and swaps only its
     inner `<p>` for `AlertDescription` (reading (a) from the two candidate shapes the
     adversary raised) — **not** a full `Card`→bare-`Alert` replacement, which would visibly
     change the box chrome for all four consumers and cross into the "visual/behavioral
     redesign" the product spec puts out of scope (`product-spec.md` § Out of Scope).
3. **No-e2e-risk call sites** (remaining, after each primitive's first wire lands):
   `FormulaReferencePanel.tsx`, `insights/market/[symbol]/page.tsx`,
   `trader/positions/[symbol]/page.tsx`, `ChartPanel.tsx` (Tabs); `NamespaceEditor.tsx`,
   `config-ui/audit/page.tsx` (Breadcrumb — no dedicated e2e spec exists for the audit page at
   all); `SignalReadiness.tsx` (Progress); `ParameterEditor.tsx`, remaining `FormulaWorkspace.tsx`
   checkbox site (Checkbox); `PlatformHeader.tsx:209-253` (Accordion — zero e2e-selector hits,
   ships in its own step right after the Accordion primitive-add, ahead of Breadcrumb's
   two-step below, since it needs no red/green round-trip).
4. **Confirmed e2e-risk call sites — mandatory two-step split** (component-swap step, then
   spec-update step — never merged into one): `RuleEditor.tsx` Tabs (`role=button` +
   `"JSON"`/`"Visual"` names, `aria-label`s on the textareas); `screener/page.tsx` Toggle Group
   (`role=button` + `aria-label`s `"hard filter"`/`"rank only"`); `OrdersTable.tsx` Alert Dialog
   (`data-testid` `cancel-ord-filled`/`cancel-ord-new`); `OrderForm.tsx` Toggle Group
   (exact-case `'BUY'`/`'SELL'` accessible names); `CopilotRail.tsx:149-165` Alert
   (`data-testid` `copilot-concentration` — the FR-4 half, distinct from FR-10's Badge edit on
   `:124-126`, which already landed in the warm-up tier); `WatchlistReadiness.tsx` Progress
   (`data-testid` `readiness-row-*`/`in-queue`, **plus** verify the 0–1 float →
   0–100 int conversion `Math.round(conviction*100)` survives the swap to the primitive's
   `value` prop, and verify whether shadcn's `Progress` drives its fill via a CSS
   `transform`/`Indicator` sub-part rather than the current inline `style={{width}}`, since
   neither existing e2e coverage nor the round-2 debate checks bar-width/class, only row
   visibility); `PlatformHeader.tsx:260-269` Breadcrumb (`aria-label="Breadcrumb"` exact case —
   verify shadcn's default wrapper case against the generated file, don't assume it matches).
   **Every step in this tier must run the *unmodified* e2e spec against the swapped markup
   first and record the actual pass/fail in `context.md` — even when the primitive is expected
   to preserve the selector (e.g. a `data-testid` the swap shouldn't disturb) — before touching
   the spec file.** This is mandatory, not conditional on the swap actually breaking something
   (P-06 audit-trail discipline; a silently-skipped "it'll probably still pass" assumption is
   the ledger's own recorded failure mode — `fails.md` 2026-07-29 074).
5. Toggle Group's Radix role rendering (`role="radio"`/`"radiogroup"` vs. the current
   `role="button"`) and Breadcrumb's default `aria-label` case are **not** assumed — both are
   explicit per-step verification items against the CLI-generated file, alongside Progress's
   two verification items above.

## Rejected Alternatives

- **Batch all 8 primitives before any call-site migration** (recon's original Recommended
  Scope / round-1 proposal) — rejected: an integration-fit mismatch in any primitive surfaces
  no signal until 3-4 tiers later, forcing a Deviation Log entry or a new patch step under F-09
  instead of being caught while that primitive's own step is still open.
- **Single-step component-swap + e2e-spec-update for e2e-risk call sites** (round-1 proposal) —
  rejected: no explicit red-before-green checkpoint; a "swap markup, then rewrite the selector
  to match whatever the new DOM exposes" pattern can pass green while silently dropping a
  behavior the old selector protected. Split into two steps per site instead, at the cost of
  roughly 6 extra steps.
- **No app-specific `warning` variant on Alert; accept the CopilotRail/SectionRenderer tone
  duplication as out-of-scope stylistic residue** — rejected: it's the exact "independent
  copies of the same widget" shape AC-3 exists to close, and both sites already use the
  identical token pair, so reconciling costs one more variant + test, not a design fork.
- **Replace `CardNotice.tsx`'s `<Card><CardContent>` wrapper entirely with a bare `Alert`** —
  rejected: changes visible box chrome for all four real consumers (not just the one FR-4
  names), crossing into the out-of-scope "visual/behavioral redesign" the spec forbids. Keep
  the existing wrapper, swap only the inner text element.
- **Treat FR-12's mechanical-test requirement as conditional on having an app-specific
  variant** (round-2 proposal's implicit reading) — rejected: FR-12's text requires a test for
  every primitive added under the feature; scale the test's assertions to what's actually
  there (variant presence vs. component-surface presence) rather than omitting the file for 5
  of the 8 primitives.

## Open Risks

- [ ] AlertDialog's overlay/focus-trap/ESC-dismiss behavior is new relative to both current
  inline confirm flows (`accountShared.tsx`, `OrdersTable.tsx`) — an accepted, inherited
  behavior surface beyond pure markup substitution; call out explicitly in AC-6's manual
  visual/behavior review rather than assuming it's purely cosmetic. To be addressed at the
  `/sdd-spec` steps for FR-3.
- [ ] Progress's fill mechanism (inline `style={{width}}` vs. a Radix `Indicator`
  `transform`) and the 0–1→0–100 conversion are unverified against the CLI-generated file. To
  be addressed at the FR-9/`WatchlistReadiness.tsx` step.
- [ ] Toggle Group's rendered ARIA role and Breadcrumb's default `nav aria-label` case are
  unverified against the CLI-generated files. To be addressed at their respective wire steps.
- [ ] `CardNotice.tsx`'s Card+Alert nesting shape (swap inner `<p>` only, keep the existing
  `Card`/`CardContent` wrapper) is a design-level decision recorded here, not yet verified
  against the CLI-generated `alert.tsx`'s expected usage pattern (whether `AlertDescription`
  composes cleanly inside an existing `CardContent`). To be addressed at the FR-4 step.

## Constitution Rules Touched

- `C-01` (evidence-cited claims) — honored by: every FR/step traceable to a `recon.md`
  `path:line`; FR-6/FR-9's imprecise "identical" wording already corrected in `product-spec.md`;
  `CardNotice.tsx`'s real consumer graph now named here instead of left as an unverified
  "every touched file" claim.
- `C-10(a)` (integration completeness — reachability) — honored by: no new routes/pages; every
  touched file is already reachable (product-spec.md § Consumer Surface(s), reaffirmed in
  Chosen Approach above).
- `C-14` (consumer surface named) — honored by: Chosen Approach's opening line naming the exact
  UI segments; no Agent-surface or backend change.
- **DRY guard rail** — honored by: the Alert `warning` variant decision (closes the
  CopilotRail/SectionRenderer tone duplication) and the Progress `buy`/`paper`/`sell`/`muted`
  variant decision (closes the WatchlistReadiness taxonomy duplication risk), both instead of
  leaving hand-rolled conditional classNames on top of the migrated primitives.
- `F-09` (step immutability during execution / Deviation Log discipline) — honored by:
  interleaving primitive-add with first-wire (tier 2) instead of batching all 8 primitives
  first, so an integration-fit mismatch is caught while the relevant step is still open rather
  than forcing a late patch step.
- `P-06` (red-before-green) — honored by: the mandatory unmodified-spec-run-and-record
  instruction on every tier-4 two-step, explicit and non-optional rather than assumed.
- `P-03` (no invented facts / no unverified absence claims) — honored by: `CardNotice.tsx`'s
  consumer sweep and e2e-selector check now recorded as verified-and-negative, not silently
  assumed absent; Progress's fill-mechanism and value-scaling items flagged as unverified
  rather than assumed to work.
