# Product Spec: ui-resume-halted-account

**Created**: 2026-09-04

---

## Problem Statement

An account can be halted (bracket-protection flatten failure or reconciliation mismatch). Feature 169
shipped the `ResumeAccount` RPC, an agent trigger (`manage_account` resume), and an agent indicator;
feature 102 added a halt indicator on the `/trader` positions page. But feature 169 explicitly
deferred the **UI trigger** (`product-spec.md:37,52`): a browser user can *see* a halt on the
positions page but has **no way to clear it** — no Resume button, no `resumeAccount` BFF route — and
must fall back to the agent or a DBA. The halt indicator also does not appear beside the
account-management controls, where an operator would naturally act (see
`docs/reports/2026-09-04-performance-bottlenecks-audit.md` § 4).

## User Story

As an operator managing broker accounts in the UI, I want to see when an account is halted from the
account-management surface and click a Resume control to clear the halt, so that I can recover a
halted account without switching to the agent or asking a DBA.

## Functional Requirements

FR-1. The `xstockstrat-ui` trader BFF exposes a `resumeAccount` route that forwards to the trading
`ResumeAccount` gRPC RPC, propagating the caller's `x-user-id` / `x-access-scope` / `x-trace-id` and
**not** widening the caller's access scope at the edge.
FR-2. The account-management surface (`AccountsModule` / `AccountSelector` / `accountShared`) shows a
halt indicator (halted state + `halt_reason` + `HaltSource`) for any halted account, sourced from the
`ListBrokerAccounts` halt fields already returned (proto fields 9–12), alongside the existing
`credentialStatus`.
FR-3. A halted account presents a **Resume** control on that surface; a non-halted account does not.
FR-4. Clicking Resume calls the BFF route; on success the account's halt indicator clears (reflecting
the RPC's persistent + in-memory clear), and the control disappears. The operation is idempotent — a
resume on an already-resumed account is a benign no-op, consistent with the RPC.
FR-5. The Resume control is only offered to callers whose access scope is authorized to resume; an
unauthorized caller is not shown an actionable control, and the BFF/RPC rejects an unauthorized call
(defense in depth — the button's absence is UX, the RPC's scope check is the enforcement).

## Out of Scope

- Any change to how an account gets **halted** (the SET paths, risk logic) — halt is already
  implemented (features 030/102).
- The three analysis/portfolio performance tracks — **features 176, 177, 178**.
- Auto-resume / scheduled resume — this is a manual operator control only.

## Affected Services

Exact service names from CLAUDE.md Service Registry:
- `xstockstrat-ui` — Next.js; owns the trader BFF (`traderBff.ts`) and the account-management
  components; gains the `resumeAccount` route, the halt indicator, and the Resume control + hook.
- `xstockstrat-trading` — Go; owns the `ResumeAccount` RPC and its access-scope enforcement. No RPC
  behavior change is required unless FR-5's scope reconciliation (below) resolves toward changing it.

## Consumer Surface(s)

_Constitution **C-14**._
- [x] **UI** — `xstockstrat-ui` `/trader`: new halt indicator + **Resume** control on the
  account-management surface (`AccountsModule`/`AccountSelector`/`accountShared`), backed by a new
  `resumeAccount` BFF route. This is the whole point of the feature — the missing consumer surface
  feature 169 deferred.
- [ ] **Agent** — no change (agent `manage_account` resume already exists).
- [ ] **None**

## Proto Contract Changes

- [x] No proto changes required — `ResumeAccount` and the `BrokerAccount` halt fields already exist.

## Config Key Changes

- [x] No new config keys

## Database Changes

- [x] No schema changes — halt state columns already exist (`broker_accounts.halted/halted_at/
  halt_reason/halt_source`).

## Feature Workflow Notes

Branch to create: `feature/ui-resume-halted-account` (branch from `main-dev`)
Approval gates required (per docs/runbooks/feature-workflow.md):
- [x] 1 service owner approval — ui owner (+ trading owner if the scope reconciliation touches the RPC)
- [x] Security role review — privileged mutation reaching a broker account (scope correctness)
- [ ] 2 service owners + platform lead (breaking proto) — N/A
- [ ] DBA review + service owner (schema migration) — N/A

## Acceptance Criteria

See `acceptance.feature` (scenarios `@AC-*`) — the single source of acceptance truth (Constitution
**C-15**). Each `FR-N` above is covered by ≥1 tagged scenario there.

## Open Questions

- [ ] **Scope discrepancy (context-constitution-findings + audit § 4):** the `ResumeAccount` RPC
  enforces **admin-only** (`RequireAdminScope`), whereas feature 169 FR-5 specified **operator or
  admin**. This feature must resolve which is correct and align the UI control's visibility (FR-5)
  with the RPC's actual enforcement — decide in `/sdd-design`, do not silently pick one.
- [ ] **Known trap (fails.md:71, C-10 nav reachability):** the halt indicator/Resume control must be
  reachable on the account-management surface a user actually opens; verify the surface is the one
  registered/rendered, not an orphan component.
- [ ] Should the positions-page halt indicator (feature 102) also gain the Resume control, or does the
  control live solely on the account-management surface to avoid two divergent action sites?
- [ ] Confirmation UX before resuming (a halt often signals an unresolved condition) — does resume
  need a confirm step, and should it surface the `halt_reason` in that confirm?
