# Context Log: fix-dead-code-cleanup-batch

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-09-04 (/sdd-triage --from-report)

- Consolidated Cleanup batch from `docs/reports/2026-09-04-comment-audit-triage.md` items 5, 6, 7
  (comment-audit pass). No GitHub issue — Issues disabled on this repo; the dated report is the
  routable artifact. Batched per operator instruction ("one consolidated Cleanup feature/PR").
- Severity: SEV-3 (dead code / stale type pin; no financial or behavioral path).
- Routed to SDD path (Track C) — the report's "Cleanup" class is a real code change, so it takes the
  SEV-3 → Track C SDD route rather than riding an unrelated PR.
- Created: feature.md, product-spec.md, acceptance.feature (regression scenarios), context.md, status.md.

### Triage verification (grep evidence)

- **Item 5 — `getEnvBool` dead (Go):** confirmed defined at trading `config.go:60`, portfolio
  `config.go:233` (+ `var _ = getEnvBool` suppressor `:245`), marketdata `config.go:247`. Only
  non-suppressor references are each service's `config_test.go` (a test that exists solely to cover the
  dead function). Removal takes the function + suppressor + that test. Already in the root findings log.
- **Item 6 — `propagation.ts` dead (Node):** confirmed **no importers** for ledger, notify, AND config
  (config's only `propagation` mention is a *comment* in `grpc/authz.ts`, not an import).
  **Report correction:** the report says the dead copies are ledger/notify/config and identity's is
  "live via `ledgerAudit`". Evidence contradicts the identity claim — identity's `propagationStore` /
  `extractFromHttpRequest` have **zero importers**, and `ledgerAudit.ts` reads `x-trace-id` from gRPC
  call metadata via its own `PROPAGATED_HEADERS` const (it does NOT import `propagation.ts`). Root
  `CLAUDE.md` (Header Propagation Convention) independently says the leaf services *including identity*
  have an unused `propagation.ts`. So all four are unused. Decision deferred to the design gate: delete
  identity's too (evidence-consistent) or document intentional retention — NOT silently expanded here.
- **Item 7 — `@types/node ^20` vs Node 24:** confirmed all four Node services pin
  `"@types/node": "^20.12.12"`; runtime is Node 24. Bump to `^24` + regenerate lockfiles.

### Routing

- Recommended design depth: **quick** → `/sdd-design fix-dead-code-cleanup-batch quick`.
  Rationale: base case (SEV-3, multi-service, no proto/migration/config, clear root cause) would be a
  `skip`, BUT triage surfaced a source-report inaccuracy on item 6 (identity) and a test-coupling on
  item 5 (removing the function removes its test). One adversarial round locks the deletion set
  (3 vs 4 propagation.ts files) and the getEnvBool test removal before `/sdd-spec`, avoiding rework.
  `/sdd-spec` must re-run the import/symbol greps to re-confirm before any deletion.
- Teardown note: `getEnvBool` / `propagation.ts` are referenced in several
  `docs/context-constitution-findings.md` files (root + per-module). Removing the code obliges a
  context-constitution refresh in the SAME PR (root `CLAUDE.md` Teardown rule).
- Development branch: `feature/fix-dead-code-cleanup-batch`.

---

## Session 2026-09-04 — sdd-review product-spec

- Product spec approved (PASS, 0 blockers/0 warnings). Status: draft → spec-ready.
- Added FR-1 (remove getEnvBool ×3 Go) / FR-2 (delete propagation.ts ×3 Node + identity decision) /
  FR-3 (@types/node ^24 ×4 Node); `## Consumer Surface(s)` None — internal/platform-only; tagged
  @AC-1 @FR-1 @item-5 / @AC-2 @FR-2 @item-6 / @AC-3 @FR-3 @item-7.
- Reviewer confirmed the report correction: all FOUR propagation.ts copies (incl. identity) are
  unused; ledgerAudit.ts uses its own PROPAGATED_HEADERS, does not import propagation.ts. Batching
  the three cleanups is acceptable (independent, per-item testable). Identity delete-vs-document fork
  is a genuine binary decision to settle before /sdd-spec.
- NOTE for execute: reconcile the getEnvBool-dead references in
  services/xstockstrat-{trading,marketdata,portfolio}/docs/context-constitution-findings.md in the
  same PR (teardown).
- Overlap: CLEAN (all 175 files disjoint from 172/173/174/084).
