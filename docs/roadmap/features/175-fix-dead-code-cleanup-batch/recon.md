# Recon: fix-dead-code-cleanup-batch

**Created**: 2026-09-04
**From**: product-spec.md
**Affected services**: Go — xstockstrat-{trading,portfolio,marketdata}; Node — xstockstrat-{ledger,notify,config,identity}

---

## Objective

Three independent, low-risk cleanups batched into one PR (comment-audit items 5–7), each verified by
**fresh** grep this session (a delete demands live re-confirmation, not a trusted prior claim):
(5) delete unused `getEnvBool` from the three Go config packages, (6) delete unused
`middleware/propagation.ts` from the Node leaf services, (7) bump `@types/node` `^20 → ^24` on the four
Node services. **No runtime behavior change** — pure scaffolding removal + a devDependency type-pin.

## Codebase Map

### Item 5 — `getEnvBool` (Go), all three DEAD (zero production callers)

| Service | Definition | Suppressor | Dedicated test | `strconv` orphan? |
|---|---|---|---|---|
| trading | `internal/config/config.go:60` | none | `config_test.go:74-76` (tests ONLY `getEnvBool`) | **No** — config.go has no `strconv` import (its `getEnvBool` parses without it) |
| portfolio | `internal/config/config.go:233` | `var _ = getEnvBool` at `:245` | `config_test.go:150-152` (ONLY `getEnvBool`) | **Yes** — `strconv` imported at `config.go:9`, used ONLY by `getEnvBool` (`strconv.ParseBool` at `:238`); deleting the func orphans the import → must remove `:9` too |
| marketdata | `internal/config/config.go:247` | none | `config_test.go:147-149` (ONLY `getEnvBool`) | **No** — no `strconv` import |

- **Zero production callers** in all three (grep across each service dir returned only the definition,
  the portfolio suppressor, and the dedicated test). Removing the function ⇒ remove its dedicated test
  (C-08 pairing: the RED here is the *absence* of the symbol, not a new failing assertion) and, for
  portfolio only, the suppressor **and** the now-orphaned `strconv` import.
- **Asymmetry to honor:** only **portfolio** orphans an import. trading/marketdata delete cleanly.

### Item 6 — `middleware/propagation.ts` (Node), all FOUR DEAD

- Four files exist: `services/xstockstrat-{ledger,notify,config,identity}/src/middleware/propagation.ts`,
  each exporting `PropagationContext` / `propagationStore` (`AsyncLocalStorage`) / `extractFromHttpRequest`.
- **Zero importers** of the module or its symbols in every service's `src` (grep on
  `middleware/propagation|PropagationContext|propagationStore|extractFromHttpRequest`). config's only
  `propagation` hit is a *comment* in `grpc/authz.ts`, not an import.
- **Identity is dead too — the report's "live via ledgerAudit" claim is FALSE (item-6 correction):**
  `identity/src/grpc/ledgerAudit.ts` does propagate the trio on its outbound gRPC calls, but via its
  **own** `const PROPAGATED_HEADERS = ['x-user-id','x-access-scope','x-trace-id']` at `ledgerAudit.ts:13`
  (used at `:40`) — it does **not** import `propagation.ts`. `propagationStore` / `extractFromHttpRequest`
  have zero importers in `identity/src`. So identity's module is unused by the same zero-importer test as
  the other three.
- **config eslint override to prune:** `services/xstockstrat-config/.eslintrc.json:31` lists
  `["src/grpc/authz.ts", "src/middleware/propagation.ts"]` in an override `files` array — deleting the
  file means striking only the `propagation.ts` entry (keep `authz.ts`, which is LIVE:
  `authz.ts:7 HEADER_USER_ID`). (This override entry appears config-only among the four — verify at spec.)
- No test imports `propagation.ts` in any of the four (the identity `x-user-id` test hits in
  `identityServiceImpl.test.ts` are unrelated — they exercise gRPC metadata, not the middleware).

### Item 7 — `@types/node` (Node), all FOUR pinned `^20`

- `"@types/node": "^20.12.12"` at ledger `package.json:37`, notify `:38`, config `:35`, identity `:37`.
  Runtime is Node 24 (root `CLAUDE.md` Language Versions). Bump each to `^24`.
- **Lockfile mechanism:** pnpm workspace (`pnpm-workspace.yaml`, pnpm 9.15.9). Regenerate with
  `pnpm install` (updates the root workspace lockfile); commit the lockfile delta in the same PR
  (mirrors the repo's "lockfile in sync" discipline). Confirm the exact lockfile path(s) at spec time.

## Patterns to REUSE

- **No new abstraction.** This is deletion + a version-string edit. The only "pattern" is the repo's
  own teardown discipline: a code delete obliges a `context-constitution` refresh in the **same** PR
  (root `CLAUDE.md` Teardown).
- Go bool-config, where still needed, is read by the surviving `config.go` helpers — `getEnvBool` has
  **no** surviving caller to re-home, so nothing is re-wired.

## Existing Business Rules (preserve / extend) — C-16 read side

**ZERO `@AC-*` impacted.** `scenario-recon` scanned every affected service's `acceptance/*.feature`
suite (trading ×4, portfolio ×5, marketdata ×2, ledger ×2, notify ×2, config ×2, identity) plus
`docs/sdd/business-rules/platform.feature`. No scenario depends on `getEnvBool`, `propagation.ts`, or
the `@types/node` version — consistent with a no-behavior-change cleanup. C-16 is clear: nothing to
PRESERVE/EXTEND/CHANGE; the feature's own `@AC-1..3` are net-new *removal-regression* guards.

## Dependencies

- Proto/RPC: none. Migration: none. Config keys: none.
- Consumer surface (C-14): **None** — internal/platform-only; no UI/Agent surface.

## Teardown Targets (findings + docs to reconcile IN-PR)

The dead symbols are cited in several context files; a delete that leaves the citation is drift.

- **Root `docs/context-constitution-findings.md`:**
  - `:33` — `getEnvBool` dead-code entry with **stale line numbers** (cites trading `:55`, portfolio
    `:195-208`, marketdata `:201`; actual `:60`/`:233`/`:247`). The code is being deleted, so **remove
    the entry** (it documents a now-nonexistent defect), don't just refresh the numbers.
  - `:34` — `propagation.ts` entry says the dead copies are "ledger/notify/config (no longer identity —
    feature 043 wired identity's live via `ledgerAudit`)". **This is the item-6 error:** it conflates
    "identity propagates headers" (true) with "identity's `propagation.ts` is used" (FALSE — ledgerAudit
    inlines its own const). Correct/remove to reflect all four deleted.
  - `:18` — the paired doc-lie row draws the same wrong conclusion ("delete `propagation.ts` only from
    ledger/notify/config … except identity"). Reconcile it to "all four unused / deleted".
- **Root `CLAUDE.md:335`** (Header Propagation Convention) — says the Node leaf services' `propagation.ts`
  is "presently unused"; after deletion the file no longer exists, so update the sentence (the module is
  gone, not merely unused). Note identity still propagates via `ledgerAudit`'s own const — keep that true.
- **`docs/patterns/header-propagation.md:123`** (added post-recon, round-1 adversary catch) — the Node
  section hard-cites `Reference store: services/xstockstrat-ledger/src/middleware/propagation.ts` with a
  live copy-this `propagationStore`/`AsyncLocalStorage` snippet at `:126-151`. Deleting all four copies
  leaves that a **dangling reference** (fails-670). Re-home in-PR: inline/neutralize the snippet or
  re-point the "Reference store" line (the Go reference at `:50` — `trading/internal/middleware/propagation.go`
  — is LIVE and NOT in scope; leave it). This is the sixth teardown doc.
- **Per-service Go findings:** trading `docs/context-constitution-findings.md:5`, portfolio `:7`,
  marketdata `:5` each point at the root `getEnvBool` entry — refresh/remove to match.
- Teardown must **NARROW, not over-resolve** (the 174 discipline): reconcile only the `getEnvBool` /
  `propagation.ts` clauses; leave any unrelated finding in the same doc untouched.

## Risks / Not-found

- **Identity delete-vs-document is the one real decision** (product-spec open decision, FR-2). Evidence
  says identity's module is dead by the same test as the others → deletable. The *counter*-argument is
  a latent DRY duplication: `ledgerAudit.ts`'s inline `PROPAGATED_HEADERS` vs the (dead) module's header
  handling — one could argue identity's `propagation.ts` should be **wired into** `ledgerAudit` rather
  than deleted. That is a **different change class** (wire + refactor, a behavior-touching edit) and
  out of this cleanup's scope. Surface at the gate; default recommendation = delete all four + note the
  DRY item as a separate, non-blocking observation (do not silently expand into a refactor).
- **Coverage (Go):** `internal/config/` is a coverage-**included** package (Go threshold 40). Deleting a
  covered function together with its only test is ratio-neutral-to-minor (both the covered lines and the
  test that covered them leave together) — verify the config-package `go test` stays ≥ threshold at spec.
- **CI commands:** Go — `GOWORK=off go test ./...` + `golangci-lint` (a leftover orphan import would fail
  `golangci-lint`, which is exactly why portfolio's `strconv` must go). Node — per-service `tsc` +
  `node --test` (ledger/identity strip-types; notify/config build-then-test) + `c8 --lines 40`.
- **Not found:** no production caller of `getEnvBool`; no importer of any `propagation.ts`; no test
  importing `propagation.ts`; no `@AC-*` depending on any removed symbol.

## Recommended Scope

1. **Item 5:** delete `getEnvBool` + its dedicated `config_test.go` test in all three Go services; also
   delete the portfolio suppressor (`config.go:245`) **and** the orphaned `strconv` import (`config.go:9`).
   Re-grep for callers first. Verify `GOWORK=off go test` + `golangci-lint` per service.
2. **Item 6:** delete `propagation.ts` from ledger, notify, config **and identity** (evidence-consistent),
   prune the config `.eslintrc.json:31` override entry, verify `tsc` + tests per service. Record the
   identity delete decision in `context.md` (FR-2). Note the ledgerAudit DRY item as out-of-scope.
3. **Item 7:** bump `@types/node → ^24` in the four `package.json`; `pnpm install` to regenerate the
   lockfile; verify `tsc`/build per service.
4. **Teardown (same PR):** reconcile root findings `:18/:33/:34`, root `CLAUDE.md:335`, and the three
   per-service Go findings pointers; narrow, don't over-resolve.
