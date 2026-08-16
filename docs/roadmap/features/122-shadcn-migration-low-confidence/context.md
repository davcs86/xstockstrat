# Context: shadcn-migration-low-confidence  (archived 2026-08-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-08-16 — /sdd-archiver

**What**: 4 FRs, all with user-directed design decisions overriding the initial self-run design recommendations (all 3 `/sdd-design` sessions for the sibling 121/122/123 cohort ran without `Task`/`AskUserQuestion` tool access — see fails.md:65 DUP). FR-1: `OrderForm.tsx`/`EditOrderDialog.tsx` inline success/error messages → `Alert`/`AlertDescription`. FR-2: `OrderForm.tsx`/`EditOrderDialog.tsx` state wiring — decided independently from FR-3; kept as-is (no Form library). FR-3: `AddAccountForm.tsx` + `EditCredentialsForm.tsx` → react-hook-form + zod + `ui/field.tsx` (both consumers of `CredentialFields`). FR-4: `AuthForm.tsx` → `ui/field.tsx`. 12 steps.

**Why (irrecoverable rationale)**: `credentialSchema(brokerType)` factory uses `.merge()` not `.and()` — zod v4 deprecated `.and()` for object schema composition. Non-active broker-type fields stay as unconstrained `z.string()` to match `CredentialState` shape (not narrowed to the active broker's fields). Ref-based lazy resolver used **only** for `AddAccountForm` (broker-type selection drives schema shape dynamically) — `EditCredentialsForm` uses a fixed schema passed as a prop and does not need the ref pattern. `data-testid="account-row-${account.id}"` canonical scoping from feature 121 is the correct row-level test scope. `ui/alert.tsx` ships no `success` variant — FR-1 migration required a custom `className` workaround (see Fails).

**Rejected alternatives**:
- `ui/form.tsx` (full shadcn Form recipe: react-hook-form + zod + label + error message + `FormField`-aware calling convention) for FR-3/FR-4 — rejected: 2-call-site surface didn't justify the dependency; `ui/field.tsx` (lighter wrapper) was the right scope (context.md sdd-design Round 2).
- Declining `EditCredentialsForm` migration (Round 1 self-run recommendation) — user overrode in Round 3 (migrate both consumers of `CredentialFields`).
- Declining FR-1 entirely (Round 1/2 self-run recommendation for `OrderForm.tsx`/`EditOrderDialog.tsx`) — user overrode in Round 4 (migrate to `Alert`).

**Scars & gotchas**:
- `ui/alert.tsx` has no `success` variant — FR-1 requires a custom color workaround; a future feature assuming a standard `variant="success"` call will silently get the wrong styling.
- Schema uses `.merge()` not `.and()` — zod v4 deprecation; see Ledger insight.
- Ref-based lazy resolver scope: `AddAccountForm` only, not `EditCredentialsForm`.
- `EditCredentialsForm` reset-on-success e2e coverage gap: no parity coverage existed at migration time — acknowledged, not a post-ship defect, but a known coverage gap.

**Permanent deviations**: design went 4 rounds (not 2) because Round 3 overturned FR-2/FR-3/FR-4 recommendations and Round 4 overturned FR-1; the Tranche-2 pattern (FR-1 steps deferred pending `120-shadcn-migration-high-confidence` shipping `ui/alert.tsx`) collapsed when `120` landed before this feature's execution, so all 12 steps ran in one pass.

**Cross-feature signal**: depends on `120-shadcn-migration-high-confidence` (`ui/alert.tsx`); stacked on `121-shadcn-migration-medium-confidence` in execution; `123-shadcn-migration-custom-composites` is the sibling for composites.

**Deferred follow-ons**: `EditCredentialsForm` reset-on-success e2e coverage (not added — no parity existed at migration time; acknowledged gap).

**Ledger entries written**: insights.md 4 NEW (zod v4 `.merge()` pattern; ref-based lazy resolver for dynamic schema; unmount-vs-clear assertion distinction; npx shadcn add collateral audit); fails.md 1 NEW (alert.tsx no success variant) + 1 DUP skipped (fails.md:65).

**Runtime-invariant recommendations (→ /context-constitution)**: none beyond the Ledger entries.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at this commit; recoverable via `git show <pre-archive-SHA>:<path>`.
