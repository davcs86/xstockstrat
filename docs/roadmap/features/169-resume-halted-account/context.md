# Context: resume-halted-account  (archived 2026-09-09)

**Feature**: ./feature.md
**Status**: launched — archived by /sdd-archiver; verbose specs pruned (recoverable via git history).

## Archive Synthesis — 2026-09-09 — /sdd-archiver

**What**: `ResumeAccount` RPC on trading + resume operation on `manage_account` MCP tool. Clears both persistent (DB) and in-memory halt state, emits ledger event + INFO alert, admin-scoped only. First Go-native access-scope authorization check.

**Why (irrecoverable rationale)**: DB-first ordering (inverting `haltAccount`'s memory-first) keeps "stay halted" as failure mode in both directions. `manage_account` chosen over separate tool for discoverability. `FailedPrecondition` on non-halted rejected for consistency with `haltAccount`'s already-halted short-circuit pattern — idempotent no-op is safer for operator retry/automation than an explicit error the caller must guard against.

**Rejected alternatives**: Separate `resume_account` tool (34th tool cost); memory-first resume (unsafe failure mode); `FailedPrecondition` on non-halted (rejected for consistency with halt's idempotent short-circuit).

**Scars & gotchas**: `authz.go` uses `grpcstatus.Errorf` not `connect.NewError`; `WithPropagationData` needed for test injection; adapter field is `a.h` not `a.handler`; impl-spec review caught 2 failures + 2 warnings pre-execution.

**Permanent deviations**: `connect.NewError` → `grpcstatus.Errorf`; `a.handler` → `a.h`.

**Cross-feature signal**: `requireAdminScope` and `WithPropagationData` are reusable Go primitives. Feature 179 consumed the RPC.

**Deferred follow-ons**: UI resume button (shipped as feature 179).

**Ledger entries written**: insights.md (2), fails.md (0) — see the 2026-09-09 entries.

**Runtime-invariant recommendations (→ /context-constitution)**: None.

**Pruned artifacts**: product-spec.md, recon.md, design.md, implementation-spec.md — last present at 6c53133e315c7978a97fa36aa05fcdf11aca00a9.
