# Product Spec: fix-dead-code-cleanup-batch

**Type**: bug (cleanup)
**Defect Report**: `docs/reports/2026-09-04-comment-audit-triage.md` (items 5, 6, 7)
**Severity**: SEV-3
**Created**: 2026-09-04

---

## Problem Statement

Three low-risk dead-code / stale-pin cleanups surfaced by the comment-audit pass, batched into one
feature/PR (they are independent and individually trivial, but share a "remove/refresh dead scaffolding"
shape). Each is verified below with grep evidence gathered at triage.

### Item 5 — dead `getEnvBool` in the three Go services

`getEnvBool` is defined but never called from production code:

- `services/xstockstrat-trading/internal/config/config.go:60`
- `services/xstockstrat-portfolio/internal/config/config.go:233` (plus a `var _ = getEnvBool`
  suppressor at `:245`)
- `services/xstockstrat-marketdata/internal/config/config.go:247`

The only non-suppressor references are the unit tests that exist solely to cover the dead function
(`config_test.go` in each service). Removing the function therefore also removes its dedicated test
and (for portfolio) the `var _ =` suppressor. Already logged in the root findings log.

### Item 6 — dead `middleware/propagation.ts` in the Node leaf services

`src/middleware/propagation.ts` exports `PropagationContext` / `propagationStore` /
`extractFromHttpRequest` (an `AsyncLocalStorage`-based HTTP-edge propagation helper) that no code
imports. Triage grep (import-statement + exported-symbol search across each service's `src`):

- `services/xstockstrat-ledger/src/middleware/propagation.ts` — **no importers → dead**
- `services/xstockstrat-notify/src/middleware/propagation.ts` — **no importers → dead**
- `services/xstockstrat-config/src/middleware/propagation.ts` — **no importers → dead** (the only
  `propagation` hit in `config/src` is a *comment* in `grpc/authz.ts` referencing the pattern doc, not
  an import)

**Correction to the report (open decision):** the report lists the dead copies as ledger/notify/config
and asserts identity's copy is "live via `ledgerAudit`". Triage evidence does **not** support that:
- `services/xstockstrat-identity/src/middleware/propagation.ts` — its `propagationStore` and
  `extractFromHttpRequest` exports have **zero importers** in `identity/src`.
- `services/xstockstrat-identity/src/grpc/ledgerAudit.ts` does propagation-like work but reads
  `x-trace-id` from gRPC **call metadata** via its own `PROPAGATED_HEADERS` const — it does **not**
  import `propagation.ts`.
- The root `CLAUDE.md` Header Propagation Convention section independently states that the leaf
  services *including identity* currently make no outbound per-request calls, so their
  `propagation.ts` is "presently unused".

So the honest reading is that **all four** copies are unused. This spec deletes the three
report-confirmed copies (ledger, notify, config) and treats **identity's** copy as an explicit
decision for the design gate: delete it too (consistent with the evidence), or document why it is
intentionally retained. Do **not** silently expand the deletion set without that decision.

### Item 7 — `@types/node ^20` pin against a Node 24 runtime

All four Node services pin `"@types/node": "^20.12.12"` (`services/xstockstrat-{ledger,notify,config,
identity}/package.json`) while the platform runtime is Node 24 (root `CLAUDE.md` Language Versions).
Bump to `^24` so the type surface matches the runtime. The report frames this as batchable into any
Node dependency touch; it is included here.

## Reproduction Steps

Static — confirmed by the grep evidence above (no runtime reproduction needed for dead code / a type
pin). `/sdd-spec` must re-run the import/symbol greps to re-confirm before deletion.

## Root Cause Hypothesis

Accumulated scaffolding: `getEnvBool` and `propagation.ts` were added for paths (env-bool config, the
Connect-RPC HTTP propagation edge) that were later removed or never wired; the `@types/node` pin was
never bumped when the runtime moved to Node 24.

## Affected Services

- Go: `xstockstrat-trading`, `xstockstrat-portfolio`, `xstockstrat-marketdata` (item 5)
- Node: `xstockstrat-ledger`, `xstockstrat-notify`, `xstockstrat-config` (item 6 deletions),
  `xstockstrat-identity` (item 6 open decision), and all four for item 7's `@types/node` bump.

## Fix Scope

- [x] No proto changes anticipated
- [x] No database migrations anticipated
- [x] No config key changes anticipated
- [ ] Item 5: remove `getEnvBool` + its suppressor + its dedicated unit test in each of the three Go
      services. Confirm no other caller via fresh grep first.
- [ ] Item 6: delete the three confirmed-dead `propagation.ts` (ledger, notify, config). **Open
      decision**: whether to also delete identity's (evidence says dead) or document its retention.
- [ ] Item 7: bump `@types/node` to `^24` in the four Node `package.json` files; regenerate lockfiles
      with the repo's tooling; verify `tsc`/build.
- [ ] DRY/CI: `getEnvBool` and `propagation.ts` are near-identical across services — confirm removal
      does not leave a dangling reference in any `docs/context-constitution-findings.md` that should be
      updated in the same PR (findings docs are teardown-audited).

## Acceptance Criteria

See `acceptance.feature`. Per item: the symbol/file is gone and the affected service still builds,
lints, and passes its remaining tests; `@types/node` resolves to `^24` and typecheck passes. Plus:
no new dead-code finding introduced; findings-doc entries for the removed items reconciled.

## Out of Scope

- Any behavioral change to config loading, header propagation, or gRPC handling.
- Bumping other dependencies beyond `@types/node`.
- The live identity `ledgerAudit` propagation-header logic (unaffected by deleting `propagation.ts`).
