# Context: ui-resume-halted-account  (archived 2026-09-16)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-16 — /sdd-archiver

**What**: Shipped the UI-side Resume trigger + halt indicator that feature 169 deferred — a `resumeAccount` trader-BFF route (`forwardAdmin`), a `HaltBadge` on `AccountRow`/`AccountSelector`, and an admin-gated confirm-to-resume action — all UI-only against the pre-existing admin-only `ResumeAccount` RPC (no proto/schema/config/backend change). Launched via PR #1104 on 2026-09-06.

**Why (irrecoverable rationale)**: The single load-bearing decision was **admin-only, no RPC change** — locked by the user despite the product-spec's user story naming an "operator" persona. The decisive fact: there is no `operator`/`trader` access scope in code (`rolesToAccessScope` grants the admin bit only to `admin`; a `trader` never gets it — `auth.ts:81-92`). So the shipped Resume control is usable only by admin-role users, not the operator the story targets. Widening was declined as a separate `xstockstrat-trading` authz change and flagged for operator override.

**Rejected alternatives**:
- `HaltBadge variant="sell"` — red-family, three-red collision with the `destructive` credential badge and the `RECONCILIATION` HALT_SOURCE EnumBadge; `warning`/amber reserves red for credential-invalid.
- Sparse-merge fallback in `applyAccountUpdate` — dead code (`ResumeAccountResponse.account` is always a full record, `trading.go:2651`); replaced by full-replace + fail-loud.
- Rendering Resume on `!isActive` rows — resuming a pool-evicted account clears a moot flag; the indicator survives, the action stays `isActive`-gated.
- Copying `HALT_SOURCE` into account components — status-map copy-drift; extract-and-rewire in the same PR (C-10).
- Widening `ResumeAccount` to operator-or-admin (169 FR-5) — deferred, out of scope.

**Scars & gotchas**:
- The shared `RowActionsMenu` keeps its Radix dropdown mounted through the confirm flow (`onSelect` → `preventDefault`); re-clicking the trigger deadlocks against the still-open menu — the @AC-3 test needed an `Escape` reset before re-opening. Reusable trap for any future `confirm:` action on `RowActionsMenu`.
- The confirm dialog's `halt_reason` renders in BOTH the AlertDialog and the row behind it — an unscoped `getByText` is a strict-mode dup; assertions must be scoped to `getByRole('alertdialog')`.
- Stateful e2e mock required: `resumeAccount` must flip `halted→false` for the subsequent `listBrokerAccounts` or the background refetch re-halts the row and the in-place assertion flakes.

**Permanent deviations**:
- Product-spec user story says "As an operator…" → shipped a control only admin-role users can see/use → because no operator scope exists in code and the user locked admin-only, matching the RPC's `RequireAdminScope`. Once specs are deleted this reads as a bug ("why can't the operator resume?") — it was deliberate, pending a separate trading authz change.
- The indicator was placed in the unconditional badge row (`accountShared.tsx:295-304`), deliberately outside the `isActive` action gate, so it survives a `halted && !isActive` deregistered-while-halted row; only the Resume action is `isActive`-gated. Rests on the verified contract that `DeregisterBrokerAccountSvc` sets `is_active=false` without clearing `halted` (`trading.go:2720`).

**Cross-feature signal**: Direct completion of feature 169's deferred UI trigger and feature 102's positions-page indicator; reuses 169's `ResumeAccount` RPC, ledger `account.halt.resumed`, and INFO alert unchanged. The product-spec mis-cited `docs/context-constitution-findings.md` as recording the admin-vs-operator discrepancy — recon confirmed findings does NOT record it; a caution that "resolved" Open-Question citations were not always ground-truthed.

**Deferred follow-ons**: Widen `ResumeAccount` from admin-only to operator-or-admin (feature 169 FR-5's original intent) — an explicit `xstockstrat-trading` authz change, still open. The next `/sdd-story` for operator self-service should start here, not rediscover the missing scope.

**Ledger entries written**: insights.md (3), fails.md (2) — see the 2026-09-16 entries. (Two vacuous-green/server-bundle lessons were DUPs of fails.md:1650 and :1652 and were not re-appended.)

**Runtime-invariant recommendations (→ /context-constitution)**: TRADING-* — `is_active` and `halted` are orthogonal on `broker_accounts`; `DeregisterBrokerAccountSvc` sets `is_active=false` without clearing `halted` (`trading.go:2720`), so consumers must not assume `!isActive ⇒ !halted`.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at a6029d9a.
