# Context: fix-dead-code-cleanup-batch  (archived 2026-09-09)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-09 — /sdd-archiver

**What**: Batched three dead-code/stale-pin cleanups: removed unused `getEnvBool` from 3 Go config packages, deleted unused `middleware/propagation.ts` from all 4 Node leaf services, bumped `@types/node` ^20→^24 across 5 Node workspaces. Shipped as stacked PR #5 of 5.

**Why (irrecoverable rationale)**: Batching deliberate (shared "remove dead scaffolding" shape). Design gate elevated from skip to quick because triage surfaced inaccuracy about identity's `propagation.ts` and test-coupling hazard. Report claimed identity's `propagation.ts` was "live via ledgerAudit" — disproved: `ledgerAudit.ts` uses own inline `PROPAGATED_HEADERS` const over gRPC Metadata, never imports HTTP-edge module.

**Rejected alternatives**: Isolate ui `@types/node` bump; keep identity's `propagation.ts`; "green build = AC assertion" for deletion; permanent CI grep-guard; standalone `tsc --noEmit`; `pnpm why` graph-wide assertion.

**Scars & gotchas**: Latent `tsc`-build break from 171 surfaced during pre-delete gate; `config_test.go` is shared file (delete function not file); portfolio's `getEnvBool` orphans `strconv` import; vestigial per-service `pnpm-lock.yaml` must not be touched; stacked-PR base substitution for landed-diff gate.

**Permanent deviations**: None.

**Cross-feature signal**: Stale findings entry propagated false "already investigated" signal. Stacked PRs unmask cross-feature regressions.

**Deferred follow-ons**: `ledgerAudit.ts` inline `PROPAGATED_HEADERS` DRY observation; vestigial per-service `pnpm-lock.yaml` cleanup.

**Ledger entries written**: insights.md (0), fails.md (1) — see the 2026-09-09 entries.

**Runtime-invariant recommendations (→ /context-constitution)**: None.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 6c53133e315c7978a97fa36aa05fcdf11aca00a9.
