# Design: shadcn-migration-high-confidence

**Created**: 2026-08-08
**Rounds**: 4 (full; termination: pending user approval)
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

**Step ordering** (four ordering tiers, each primitive interleaved with its lowest-risk consumer
rather than all 8 primitives batched before any call site — this is the round-1→round-2 fix that
closes the F-09 rework-after-close risk an all-primitives-first batch would create — plus one
cross-cutting verification note that applies across tiers 2 and 4, not a fifth tier):

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
   while that primitive's own step is still open, not three tiers later. **Exception: Toggle
   Group.** Its only two consumers — `screener/page.tsx:348-378` and `OrderForm.tsx:144-157` —
   are *both* confirmed e2e-risk (`recon.md` § Risks); there is no low-risk site to wire first.
   Toggle Group's add-step (variant decision below) goes straight to tier 4's two-step split for
   both consumers, with no interim wire in this tier (round-4 finding).
   - **Alert Dialog** wires first to `accountShared.tsx:213-245` — this is the **easier**,
     already-two-button (Confirm/Cancel) shape, a natural fit for
     `AlertDialogAction`/`AlertDialogCancel`; `OrdersTable.tsx:140-149`'s single
     label-toggling button is the **harder** shape (no separate dismiss control, doesn't map
     onto AlertDialog's trigger/cancel/action structure without synthesizing a new control)
     and is deliberately sequenced second, after the primitive is proven on the easy case.
     (Round 2's adversary caught the proposer's rationale reading backwards on this point —
     corrected here: `accountShared.tsx` is easier, not harder, and that's *why* it's first.)
     **Round 3 finding**: `accountShared.tsx:187-200`'s `handleRemove` is `async` and the current
     UI deliberately keeps both Confirm/Cancel visible-but-`disabled={removing}` across the
     in-flight `deregisterBrokerAccount` call. Radix's `AlertDialogAction` closes the dialog on
     click by **default** unless the consumer's own `onClick` calls `event.preventDefault()` to
     keep it open across an async operation. The FR-3 step must wire
     `<AlertDialogAction onClick={(e) => { e.preventDefault(); handleRemove(); }}>` (or
     equivalent) — not a naive `onClick={handleRemove}` — so the dialog doesn't unmount mid-flight
     and the existing disabled-during-removal UX survives the swap. Added as an explicit AC-6
     checklist item, not left implicit.
   - **Alert** wires first to `CardNotice.tsx:4-22` — round-2 verified (grep for its
     rendered strings) that its 4 real consumers carry no e2e-load-bearing selectors, making
     it Alert's low-risk first wire, the same role `accountShared.tsx` plays for Alert
     Dialog above (round-4 finding: this was discussed at length below but never explicitly
     placed in a tier — corrected here). `CopilotRail.tsx:149-165` and
     `SectionRenderer.tsx:110-123` (both e2e-risk or no-e2e-risk per their own citations
     below) follow in tiers 3/4. Alert gets an app-specific `warning` `cva` variant (see
     Constitution Rules Touched /
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
     **Round 3 finding**: swapping only the inner `<p>` for `AlertDescription` means `CardNotice`
     never touches the `Alert` root, so it gains none of `role="alert"` (which lives on shadcn's
     `Alert` root, not `AlertDescription`) — a real accessibility regression on `CardNotice`'s
     `error` tone specifically, independent of the Card/CardContent chrome decision. Fix: keep
     the chrome decision as-is (avoids doubling box chrome for all 4 consumers) but add
     `role={variant === 'error' ? 'alert' : undefined}` on `CardNotice`'s own returned element —
     a one-line addition that closes the gap without touching the wrapper.
3. **No-e2e-risk call sites** (remaining, after each primitive's first wire lands):
   `FormulaReferencePanel.tsx`, `insights/market/[symbol]/page.tsx`,
   `trader/positions/[symbol]/page.tsx`, `ChartPanel.tsx` (Tabs); `NamespaceEditor.tsx`,
   `config-ui/audit/page.tsx` (Breadcrumb — no dedicated e2e spec exists for the audit page at
   all); `SignalReadiness.tsx`, `SectionRenderer.tsx:64-71` (Progress — round-4 finding: this
   second `SectionRenderer.tsx` site was discussed in tier 2's variant decision above but never
   placed in a tier; `recon.md` § Risks doesn't name it either, corrected there too);
   `SectionRenderer.tsx:110-123` (Alert — same round-4 finding: discussed for its `warning`
   variant reconciliation but never tiered; no e2e spec references its rendered content, per a
   fresh grep, so it lands here); `ParameterEditor.tsx`, remaining `FormulaWorkspace.tsx`
   checkbox site (Checkbox); `PlatformHeader.tsx:209-253` (Accordion — zero e2e-selector hits,
   ships in its own step right after the Accordion primitive-add, ahead of Breadcrumb's
   two-step below, since it needs no red/green round-trip). As with all tier-3 sites, each step
   still does a final targeted grep of its corresponding e2e spec file before marking done
   (recon.md's own caveat — these greps are pattern-targeted, not exhaustive).
4. **Confirmed e2e-risk call sites — mandatory two-step split** (component-swap step, then
   spec-update step — never merged into one): `RuleEditor.tsx` Tabs (`role=button` +
   `"JSON"`/`"Visual"` names, `aria-label`s on the textareas); `screener/page.tsx` Toggle Group
   (`role=button` + `aria-label`s `"hard filter"`/`"rank only"` **and** verify Radix's actual
   rendered role — `role="radio"`/`"radiogroup"` vs. today's `role="button"` — against the
   CLI-generated file rather than assuming it matches); `OrdersTable.tsx` Alert Dialog
   (`data-testid` `cancel-ord-filled`/`cancel-ord-new`); `OrderForm.tsx` Toggle Group
   (exact-case `'BUY'`/`'SELL'` accessible names **and** the same Radix-role verification as
   `screener/page.tsx` above — both Toggle Group consumers need this check, not just one);
   `CopilotRail.tsx:149-165` Alert
   (`data-testid` `copilot-concentration` — the FR-4 half, distinct from FR-10's Badge edit on
   `:124-126`, which already landed in the warm-up tier); `WatchlistReadiness.tsx` Progress
   (`data-testid` `readiness-row-*`/`in-queue`, **plus** verify the 0–1 float →
   0–100 int conversion `Math.round(conviction*100)` survives the swap to the primitive's
   `value` prop, and verify whether shadcn's `Progress` drives its fill via a CSS
   `transform`/`Indicator` sub-part rather than the current inline `style={{width}}`, since
   neither existing e2e coverage nor the round-2 debate checks bar-width/class, only row
   visibility); `PlatformHeader.tsx:260-269` Breadcrumb (`aria-label="Breadcrumb"` exact case —
   verify shadcn's default wrapper case against the generated file; likely moot in practice
   since `e2e/nav-reachability.spec.ts:70-71`'s `getByLabel('Breadcrumb')` has no `exact: true`
   and Playwright's default label matching is case-insensitive substring, but confirm via the
   mandatory unmodified-first-run below rather than skipping the check on that assumption).
   **Every step in this tier must run the *unmodified* e2e spec against the swapped markup
   first and record the actual pass/fail in `context.md` — even when the primitive is expected
   to preserve the selector (e.g. a `data-testid` the swap shouldn't disturb) — before touching
   the spec file.** This is mandatory, not conditional on the swap actually breaking something
   (P-06 audit-trail discipline; a silently-skipped "it'll probably still pass" assumption is
   the ledger's own recorded failure mode — `fails.md` 2026-07-29 074).

**Cross-cutting verification note** (applies within tiers 2 and 4 above, not a fifth tier):
Toggle Group's rendered ARIA role (both consumers, tier 4) and Breadcrumb's default
`aria-label` case (tier 4) are not assumed — both are explicit per-step verification items
against the CLI-generated file, alongside Progress's two verification items (tier 4,
`WatchlistReadiness.tsx`). Round 3 correction: the underlying `radix-ui@^1.6.7` package is
already an installed dependency (`recon.md`), so these facts live in a dependency already
present, not in a file that "doesn't exist yet" — not blocking either way, since the mandatory
tier-4 red-before-green step self-discovers any actual mismatch regardless.

**Completeness check (round 4).** All 27 FR-1–FR-11 call-site occurrences in product-spec.md are
now placed in exactly one of tiers 1–4 above (6 in tier 1's warm-up, verified by direct
enumeration against product-spec.md's FR text). Round 4's adversary found 3 occurrences
(`CardNotice.tsx`, and both `SectionRenderer.tsx` sites) that were discussed in the Chosen
Approach's prose but never explicitly placed in a tier list — all 3 are now tiered above (tier 2
for `CardNotice.tsx`, tier 3 for both `SectionRenderer.tsx` sites), and `recon.md` § Risks is
amended to name both files so the gap doesn't silently recur at `/sdd-spec` time.

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

- [x] AlertDialog's overlay/focus-trap/ESC-dismiss behavior is new relative to both current
  inline confirm flows (`accountShared.tsx`, `OrdersTable.tsx`) — an accepted, inherited
  behavior surface beyond pure markup substitution; call out explicitly in AC-6's manual
  visual/behavior review rather than assuming it's purely cosmetic. **Round 3**: the
  `accountShared.tsx` half of this is now a concrete, non-cosmetic requirement — see the
  `AlertDialogAction`/`event.preventDefault()` finding in Chosen Approach point 2 above — not
  just a manual-review note. `OrdersTable.tsx`'s half remains a later, out-of-this-round item:
  its single label-toggling button (`Cancel`→`Confirm` on the same element,
  `e2e/trader/orders.spec.ts:177-184`) means the two-step split for that site needs a fuller
  test restructure (open the dialog, assert two distinct elements) than the tier-4 template's
  "rename the selector" shape implies — flagged for whoever specs that step, not resolved here.
- [x] Progress's fill mechanism (inline `style={{width}}` vs. a Radix `Indicator`
  `transform`) and the 0–1→0–100 conversion are unverified against the CLI-generated file. To
  be addressed at the FR-9/`WatchlistReadiness.tsx` step — unchanged, this remains a genuine
  per-step verification item (not resolvable from already-installed-dependency evidence the
  way the Toggle Group/Breadcrumb items below are).
- [x] Toggle Group's rendered ARIA role and Breadcrumb's default `nav aria-label` case —
  **Round 3 correction**: framing these as unknowable "until the CLI runs" overstated the gap.
  `package.json` already pins `radix-ui@^1.6.7` as a resolved dependency (`recon.md`) — the
  shadcn-generated wrapper files are thin compositions over that already-installed package, so
  the governing facts live in a dependency already present, not in a file that "doesn't exist
  yet." Not blocking either way: the mandatory tier-4 red-before-green step (run the unmodified
  spec first) self-discovers any actual mismatch regardless. Separately, Breadcrumb's case risk
  is likely moot in practice — `e2e/nav-reachability.spec.ts:70-71`'s `getByLabel('Breadcrumb')`
  has no `exact: true`, and Playwright's default label matching is case-insensitive substring,
  so even a lowercase `aria-label="breadcrumb"` would still resolve. Don't pre-emptively rewrite
  the spec on this assumption — let the mandatory unmodified-first-run confirm it.
- [x] `CardNotice.tsx`'s Card+Alert nesting shape (swap inner `<p>` only, keep the existing
  `Card`/`CardContent` wrapper) — **Round 3 finding**: this shape is fine for the chrome
  question, but it left a real accessibility gap (`role="alert"` lives on the `Alert` root,
  which this shape never touches) — closed via the one-line `role={variant === 'error' ?
  'alert' : undefined}` addition recorded in Chosen Approach point 2 above. No longer an open
  verification item; it's now a concrete instruction.

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

## Rounds

**4** (full mode, mandated minimum of 2 met at round 2; rounds 3 and 4 both requested by the
user to close remaining gaps before approval). Round 3: adversary found no Floor breach and two
concrete, non-cosmetic gaps (the `AlertDialogAction` async-close race on `accountShared.tsx`,
and `CardNotice.tsx`'s missing `role="alert"`) — both resolved directly in that round's
synthesis. Round 4: a fresh full read-through (proposer) plus an independent verification sweep
(adversary) found the design's "five tiers" framing was inaccurate (item 5 was a cross-cutting
note, not a tier) and, more substantively, that 3 of the 27 FR-cited call-site occurrences
(`CardNotice.tsx`, both `SectionRenderer.tsx` sites) were discussed in the prose but never
explicitly placed in any tier — a completeness gap the adversary traced to `recon.md`'s own risk
sweep never naming those files either. Termination: all 3 gaps closed via a full 27-occurrence
cross-reference against tiers 1–4 (documented in the Chosen Approach's "Completeness check"
note), the Toggle Group role-verification duplicated across both its consumers' tier-4 bullets,
and the stale citation corrected. No Floor breach in either round. The design is not required to
be perfect to approve — only free of Floor breaches and unresolved substantive risk — and round
4's adversary confirmed no further systemic gap remains once the 27-occurrence count reconciles.
