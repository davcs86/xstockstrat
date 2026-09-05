# Design: ui-resume-halted-account

**Created**: 2026-09-05
**Rounds**: 4 (quick → extended by user; termination: approved after round-4 adversary returned SOUND)
**Approved by**: user @ 2026-09-05
**Grounded in**: recon.md

---

## Chosen Approach

UI-only, admin-only, **no** RPC/proto/schema/config change — consumed against the pre-existing
admin-only `ResumeAccount` RPC. Consumer surface (C-14): `xstockstrat-ui` `/trader` account-management
(`AccountsModule`/`AccountRow`/`AccountSelector`) — a halt indicator + a Resume control. Build order:

1. **Extract `HALT_SOURCE` (C-10 same-PR).** The `Record<HaltSource, EnumRender>` map is a
   **non-exported** module-local const in `positions/page.tsx:43-47`. Move it (data-only, React-free)
   into `@/lib/opportunityShared.tsx` (home of `EnumBadge`/`EnumRender`), **delete** the orphaned local
   const + its "Kept local" comment (`:41-47`), and rewire the positions page to import it. This kills
   the status-map copy-drift (fails.md:742) and preserves the positions-page indicator. Keep the
   icon-bearing component out of `opportunityShared` (server-bundle trap, fails.md:1652 — verify with a
   real `next build`).
2. **New `HaltBadge.tsx`** (`src/components/trader/`, client leaf): lucide `Ban` icon + "Halted" label
   + `Badge variant="warning"` (amber, verified real `badge.tsx:25`; distinctness is icon + label +
   amber, no hardcoded color — C-17) + a tooltip carrying `halt_reason`; an `iconOnly` prop for the
   compact `AccountSelector`. `warning` deliberately avoids the three-red collision with the
   credential-invalid `destructive` badge and the `RECONCILIATION` `HALT_SOURCE` (itself `role:'sell'`).
3. **BFF route.** Register `resumeAccount` via `forwardAdmin` after `traderBff.ts:57` — `requireSession`
   → `requireAdminScope` → forward with `backendHeaders`, mirroring the RPC's `RequireAdminScope`
   server-side (not just a hidden button), no scope widening (FR-1/FR-5). No browser-client edit
   (`resumeAccount` is already on the generated `TradingService` client).
4. **`AccountContext.applyAccountUpdate(account)`.** New narrow method:
   `setAccounts(prev => prev.map(a => a.id===account.id ? account : a))` — a **full replace** from
   `ResumeAccountResponse.account` (which is always a full `recordToProtoAccount`, `trading.go:2651`),
   **fail-loud `throw` on `!account?.id`**, no sparse merge. Then a background `refreshAccounts()`. This
   closes the swallowed-`catch{}` clear-failure (`AccountContext.tsx:41-43`): the optimistic clear
   stands even if the refetch fails. (Full-replace is referentially safe — `fetchAccounts` already
   replaces every account object wholesale on each refresh.)
5. **`AccountRow` (`accountShared.tsx`).** In the **badge row** (`:295-304`, which renders
   **unconditionally**, not inside the `isActive` action gate at `:306`), render — **gated strictly on
   `account.halted===true`** — `<HaltBadge/>` + the React-escaped (system-generated) `halt_reason` +
   `<EnumBadge render={HALT_SOURCE[account.haltSource]}/>`. Placing it in the badge row (not the action
   block) means the **indicator survives a `halted && !isActive` row** (a deregistered-while-halted
   account) — the signal stays visible. Add an admin-gated (`useIsAdmin()`) **Resume** action inside
   the existing `RowActionsMenu` `isActive`-gated block (`:306-330`) with `confirm:{title,description}`
   surfacing `halt_reason`; `onSelect` → BFF `resumeAccount({accountId})` → `applyAccountUpdate(resp.account)`.
   (Resume being `isActive`-gated is correct — a deregistered account can't be resumed into the broker pool.)
6. **`AccountSelector`.** Render `<HaltBadge iconOnly/>` beside each halted option (`:37-52`); fold halt
   into the collapsed gear dot by **renaming `hasCredentialIssue → hasAccountIssue`** (`:20`/`:69`) and
   OR-ing `a.halted===true`, so a halted non-selected account still signals when the dropdown is closed.
7. **e2e.** Extend `accounts.ts` fixtures with a halted account (**`isActive:true + halted:true`** — the
   load-bearing invariant, else the tests green vacuously, fails.md:1650); spec covers halt indicator on
   row/selector/gear-dot, a non-halted/offline row shows **no** halt badge, admin sees Resume / non-admin
   does not, and **confirm-then-clears in place** (no remount). The mock backend is **stateful** —
   `resumeAccount` flips the account so the subsequent `listBrokerAccounts` returns `halted:false`
   (else the background refetch re-halts the row); the non-admin test drives the **real `dispatchConnect`**
   with the mock's `resumeAccount` returning success unconditionally, so `PermissionDenied` can only
   originate from `forwardAdmin` (isolates `@AC-4/169`).

## Rejected Alternatives

- **`HaltBadge variant="sell"`** — red-family, collides with the `destructive` credential badge and the `RECONCILIATION` `role:'sell'` EnumBadge (three red badges), defeating the distinct-marker intent; `warning` reserves red for credential-invalid.
- **Sparse-merge fallback in `applyAccountUpdate`** — dead code: `ResumeAccountResponse.account` is never sparse; replaced by a full-replace + fail-loud.
- **Rendering the Resume action on `!isActive` rows** — resuming a deregistered account clears a moot flag on a pool-evicted account; the indicator survives while the action stays `isActive`-gated.
- **Copying `HALT_SOURCE` into the account components** — status-map drift; extract-and-rewire instead.

## Open Risks

- [ ] **`isActive` × `halted` orthogonality** — verified orthogonal in trading (`DeregisterBrokerAccountSvc`
  sets `is_active=false` without clearing `halted`, `trading.go:2720`). Mitigation is automatic: the
  indicator renders in the unconditional badge row, the Resume action stays `isActive`-gated. `/sdd-spec`
  must place `HaltBadge` in the `:295-304` badge row explicitly and gate only the action.
- [ ] **Stateful e2e mock** — the resume mock must flip `halted→false` for the post-resume `listBrokerAccounts`,
  and the assertion waits for the settled post-refetch frame (in place), or it flakes / passes vacuously.
- [ ] **Server-bundle safety** — only the React-free `HALT_SOURCE` map moves into `opportunityShared`;
  the `lucide`/tooltip `HaltBadge` stays a client-only leaf. Verify with a real `next build` (fails.md:1652).

## Constitution Rules Touched

- `C-17` — honored: `HaltBadge` uses the semantic `warning` token (raw color inside the primitive's cva, the sanctioned home); no hardcoded color on the badge or icon.
- `C-10` — honored: `HALT_SOURCE` extraction + positions-page rewire land in the same PR (update-every-instance); the account-management surface is the existing reachable `/trader/accounts`.
- `C-08`/`C-15` — honored: the BFF non-admin-rejection test is isolated (unconditional-success mock + real router); the confirm-then-clears e2e is in-place with a stateful mock (no vacuous green).
- `C-09`/`F-01` — n/a: no proto, migration, config, or pool change.

## Business Rules Touched (C-16)

All PRESERVE (RPC unchanged; UI additions additive):
- PRESERVE `@AC-1/@AC-2/@AC-3/@AC-6/@AC-7 @feature-169` — the resume RPC behavior (clear, ledger event, INFO alert, no-op, poller) is consumed unchanged.
- PRESERVE `@AC-4 @feature-169` — non-admin denied: enforced at both the BFF (`forwardAdmin`) and the RPC (`RequireAdminScope`); the isolated BFF test guards the edge.
- PRESERVE `@AC-2 @feature-159` (offline card hides broker-only fields) — badge gated strictly on `halted===true`; OFFLINE accounts are never halted (halt sources are broker-only).
- PRESERVE `@AC-3 @feature-157` (offline accounts listed in the selector) — `activeAccounts` filter unchanged; no account dropped.
- NET-NEW (author here): the halt indicator + Resume control UI guarantees are this feature's own `@AC-*` (no prior UI halt/credential-display suite to preserve).
