# Product Spec: shadcn-migration-low-confidence

**Created**: 2026-08-08

---

## Problem Statement

The same "Component Ledger" audit that produced `120-shadcn-migration-high-confidence` and
`121-shadcn-migration-medium-confidence` also found 4 occurrences it explicitly rated **low
confidence**: the shape is only a loose match to a shadcn primitive, and in one case (Form) migrating
"correctly" would mean introducing new dependencies (`react-hook-form`, `zod`) that don't otherwise
exist in `services/xstockstrat-ui/package.json` for two call sites. This feature exists to make a
deliberate, recorded decision per occurrence — migrate, or explicitly decline and say why — rather
than let a low-confidence audit line silently become an unreviewed backlog item.

## User Story

As an `xstockstrat-ui` developer, I want each low-confidence finding from the shadcn/ui gap audit
evaluated on its own merits — with a recorded decision to migrate or to leave as-is — so that the
audit's least-certain findings don't get force-fit into a primitive that costs more (new dependencies,
more indirection) than the one-line hand-rolled code it would replace.

## Functional Requirements

FR-1. Evaluate `src/components/trader/OrderForm.tsx:215-217` and
`src/components/trader/EditOrderDialog.tsx:82` — one-line inline success/error text (`text-destructive`
/ `text-buy` paragraphs, no boxed container) the audit rated a loose match for `Alert`. If
`120-shadcn-migration-high-confidence` has already shipped `ui/alert.tsx`, adopt it here **only if**
doing so doesn't add unwanted visual weight to a compact order-entry form; otherwise record the
decision to leave the plain text as-is and why (e.g. a boxed alert is disproportionate for a one-line
inline field message next to a submit button).

FR-2. Evaluate `src/components/auth/AuthForm.tsx:28-93` (`CredentialsForm` — local `useState` fields,
manual `fetch` submit, inline `<p>` error text) against shadcn's `Form` recipe (react-hook-form + zod +
`FormField`/`FormMessage` wiring). Record whether adopting it is worth the new
`react-hook-form`/`zod` dependencies for this one two-field login form, or whether the existing manual
`useState` + `Input`/`Button` composition (already using the repo's `ui/input.tsx`/`ui/button.tsx`) is
the appropriately minimal implementation.

FR-3. Evaluate `src/components/trader/accountShared.tsx`'s `CredentialFields`
(`accountShared.tsx:51-113` — broker-conditional controlled inputs, `BrokerType.IBKR` vs. the
Alpaca default branch) and `buildCredentialsJson` (`accountShared.tsx:39-48`) against the same
`Form` recipe. `CredentialFields` is a shared field-rendering component with **two** independent
consumers, each owning its own manual submit handler that calls `tradingClient` directly:
`EditCredentialsForm` (`accountShared.tsx:116-167`, calls `updateBrokerAccountCredentials`) and
`AddAccountForm` (`accountShared.tsx:259-332`, calls `registerBrokerAccount`). A "migrate"
decision therefore means wiring **both** consumers to `react-hook-form` context (and
`CredentialFields`, as a shared component, becoming aware of that context) — not a single
call-site change. Record the same migrate-or-decline decision, noting that this form's
broker-conditional field set (per-broker required/optional credential fields) is a more complex
validation shape than `AuthForm`'s two static fields — react-hook-form + zod's schema-per-broker
validation may be a stronger fit here even if FR-2 declines. Both `BrokerType` values in the proto
(`BROKER_TYPE_ALPACA`, `BROKER_TYPE_IBKR` — `packages/proto/common/v1/common.proto:66-67`) are the
full enum; whichever decision is made (migrate or decline) must preserve both branches'
existing required-field behavior unchanged — this feature does not alter broker credential
storage or validation semantics, only the widget wiring that renders and submits them.

FR-4. If FR-2 and/or FR-3 conclude adoption is warranted, add `react-hook-form` and `zod` to
`services/xstockstrat-ui/package.json`, add `src/components/ui/form.tsx` (the shadcn `Form` primitive:
`Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormMessage`, wired to
`react-hook-form`'s `useFormContext`), and migrate the accepted call site(s) onto it. If both decline,
this FR is a no-op and the feature ships with zero new dependencies.

## Out of Scope

- The 27 high-confidence occurrences (`120-shadcn-migration-high-confidence`) and 22 medium-confidence
  occurrences (`121-shadcn-migration-medium-confidence`).
- The 12 bespoke "no close match" widgets the audit found correctly-not-reinvented.
- Any occurrence not explicitly listed above — this feature's scope is exactly the 4 low-confidence
  rows the audit produced, not a general form-library adoption initiative.

## Affected Services

- `xstockstrat-ui` — `src/components/trader/{OrderForm,EditOrderDialog,accountShared}.tsx`,
  `src/components/auth/AuthForm.tsx`; conditionally `src/components/ui/form.tsx` and
  `package.json`/`pnpm-lock.yaml` if FR-4 triggers.

## Consumer Surface(s)

_Constitution **C-14**._

- [x] **UI** — `xstockstrat-ui` `/trader` segment (order entry success/error text, account credential
  forms) and the root `/auth/login` page (`AuthForm`). All within already-shipped, already-reachable
  pages — no new routes.
- [ ] **Agent** — not applicable.
- [ ] **None**.

## Proto Contract Changes

- [x] No proto changes required

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes

## Feature Workflow Notes

Branch to create: `feature/shadcn-migration-low-confidence` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval (non-breaking, UI-only change — `xstockstrat-ui` owner)
- [ ] 2 service owners + platform lead (breaking proto change) — not applicable
- [ ] DBA review + service owner (schema migration) — not applicable

## Acceptance Criteria

1. Each of FR-1/FR-2/FR-3 has a recorded decision (migrate or decline) with a one-paragraph rationale
   in `context.md`, before any code is written for that item.
2. Where a decision is "migrate," the call site adopts the primitive and behaves identically from the
   user's perspective (same validation messages, same submit flow).
3. Where a decision is "decline," no code changes for that item — the audit finding is closed as
   reviewed-and-kept, not silently dropped.
4. If FR-4 does not trigger (both Form evaluations decline), `package.json` gains no new dependencies
   and this feature's diff is limited to whatever FR-1 decided.
5. `pnpm lint` and `pnpm build` pass; `pnpm test:e2e` passes for every spec covering a touched
   component.

## Open Questions

- [ ] Should FR-2 and FR-3 be decided independently, or does adopting `react-hook-form`/`zod` for one
  obligate reusing it for the other (avoiding "form library A here, manual state there" inconsistency)?
  Route to `/sdd-design` — this is exactly the kind of design-fork the SDD gate exists to surface
  rather than guess at.
- [x] **Resolved by `/sdd-review`**: `grep -rn "react-hook-form\|from 'zod'\|\"zod\""
  services/xstockstrat-ui/src services/xstockstrat-ui/package.json` returns zero matches. Neither
  `react-hook-form` nor `zod` is present anywhere in `xstockstrat-ui` today, under any install
  path or transitive re-export. If FR-4 triggers, both are genuinely new dependencies with no
  existing precedent to reconcile against.
