# Design: fix-dead-code-cleanup-batch

**Created**: 2026-09-04
**Rounds**: 4 (quick base + operator elected 3 extra; termination: approved)
**Approved by**: user @ 2026-09-04
**Grounded in**: recon.md

---

## Chosen Approach

Three independent dead-scaffolding removals plus a `@types/node` devDependency type-pin, batched into
one PR with **zero runtime behavior change**. Execution runs a strict five-step order (A→E) that
front-loads the Node bump so lockfile churn is isolated and attributable, gates Node compile
**before** deletion (Node-only), deletes, re-verifies everything (Go + Node) **after** deletion, then
reconciles the teardown docs.

**Deletions:**
- **Item 5 (Go, FR-1):** delete `getEnvBool` from `xstockstrat-{trading,portfolio,marketdata}/internal/config/config.go`
  (recon `config.go:60`/`:233`/`:247`), **and the `TestGetEnvBool` FUNCTION only** in each service's
  `config_test.go` — the file is **shared** (trading 7 / portfolio 9 / marketdata 15 test funcs), so the
  file itself and its other tests (`TestResolveEnvironment`, `TestWatcher*`) stay. Portfolio also drops
  the `var _ = getEnvBool` suppressor (`config.go:245`) **and** the now-orphaned `strconv` import
  (`config.go:9`, used only by `getEnvBool` at `:238`); trading/marketdata have no `strconv` import and
  delete cleanly.
- **Item 6 (Node, FR-2):** delete `src/middleware/propagation.ts` from **all four** leaf services
  **including identity** — its `propagationStore`/`extractFromHttpRequest` have zero importers, and
  `identity/src/grpc/ledgerAudit.ts:13` propagates via its **own** `PROPAGATED_HEADERS` const over gRPC
  `Metadata`, never importing the HTTP-edge module (mechanism mismatch — retaining it is pointless;
  C-03 intact). Prune the `propagation.ts` entry from `config/.eslintrc.json:31` (keep `authz.ts`, which
  is live).
- **Item 7 (Node, FR-3):** bump `@types/node ^20 → ^24` in **five** `package.json` (ledger, notify,
  config, identity, **ui**) and regenerate the **root** `pnpm-lock.yaml` via `pnpm install`.

**Verification mechanics (each a NAMED `**Covers**: AC-N` step in implementation-spec.md, re-run at
execute — C-15's step-locus, not merely context.md).** The RED→GREEN signal is construct-scoped
*presence*: for AC-1/AC-2 the RED is the *absence* of a now-deleted symbol/file (grep/`git ls-files`
empty after); for AC-3/AC-4 the RED is the **version string** (`^24` absent→present), while build/tsc/
next-build is a **green-before-and-after regression guard**, never a manufactured build-RED.

- **@AC-1 (getEnvBool gone):** `grep -rn 'func getEnvBool' services/<svc>/internal/config` → 0 after
  (per trading/portfolio/marketdata); portfolio `grep '"strconv"' …/config.go` → 0. Discharge per svc:
  `GOWORK=off go build ./... && golangci-lint run ./internal/config/... && go test ./internal/config/... -cover`
  (coverage ≥ 40 **as enforced by CI**, not by the local `-cover` flag — `internal/config` is
  coverage-included; a covered func + its only test leave together, ratio-neutral).
- **@AC-2 (propagation.ts gone):** `git ls-files 'services/*/src/middleware/propagation.ts'` → 0 after
  (index-authoritative). Discharge: `pnpm --filter <svc> build` (real `tsc`) for ledger/notify/config/
  **identity** — identity's post-delete compile is proven **here**, not by the deletion bullet — plus
  `pnpm --filter … test`; and `grep 'propagation.ts' config/.eslintrc.json` → 0.
- **@AC-3 (four leaves ^24):** version grep `"@types/node"` → `^24` per leaf; resolution
  `pnpm why @types/node --filter <5 svcs>` each **direct edge → 24.x** (NOT a graph-wide "no 20.x").
  Discharge: `pnpm --filter <leaf> build` (`tsc`; green before **and** after).
- **@AC-4 (ui ^24):** version grep `^24` + `pnpm why … --filter ui` → 24.x; **sole** gate
  `pnpm --filter xstockstrat-ui build` (= `next build`, which type-checks the full tsconfig program
  incl. the `e2e/` Playwright specs — `next.config.js` sets no `typescript.ignoreBuildErrors`). **No
  standalone `tsc --noEmit` green-gate** (the `next` tsconfig plugin is LSP-only and `.next/types` exist
  only post-build, so a bare `tsc` risks a false-RED — fails-155; an optional `tsc --noEmit` is
  informational only).

**Ordered execution (A→E):**
- **A.** Edit five `package.json` `^20 → ^24` → `pnpm install` (regenerates **root** `pnpm-lock.yaml`) →
  `pnpm why @types/node --filter <5 svcs>` each → 24.x. *If a green build requires a **sibling** dep
  bump (`@types/react`, `next`, `@types/pg`) or a non-trivial refactor → STOP, bounce to the operator*
  (FR-3 out-of-scope; do not absorb).
- **B.** Node-only pre-delete gate (Go untouched pre-delete, so no Go here):
  `pnpm --filter {ledger,notify,config,identity} build` + `pnpm --filter xstockstrat-ui build`. Isolates
  a Node-24 regression to the bump before deletion can mask it.
- **C.** Delete (fresh re-grep for callers/importers first): Go func + `TestGetEnvBool` func ×3
  (+ portfolio suppressor + `strconv`); Node `propagation.ts` ×4 + prune `config/.eslintrc.json:31`.
- **D.** Full re-verify (Go + Node): Go per svc `go build && golangci-lint && go test -cover`; Node
  `pnpm --filter {ledger,notify,config,identity} build` + `test`; re-grep empties.
- **E.** Teardown (same PR, narrow): reconcile only the `getEnvBool`/`propagation.ts` clauses in the
  **six** teardown docs (below); run `/context-forge:context-constitution refresh` scoped to touched docs.

**Landed-diff gate (fails-082) — `git diff --name-only main-dev...HEAD` must equal EXACTLY these 23
paths, no more, no less:**
```
services/xstockstrat-ledger/package.json
services/xstockstrat-notify/package.json
services/xstockstrat-config/package.json
services/xstockstrat-identity/package.json
services/xstockstrat-ui/package.json
pnpm-lock.yaml                                              # ROOT lock only (see Open Risks)
services/xstockstrat-ledger/src/middleware/propagation.ts
services/xstockstrat-notify/src/middleware/propagation.ts
services/xstockstrat-config/src/middleware/propagation.ts
services/xstockstrat-identity/src/middleware/propagation.ts
services/xstockstrat-trading/internal/config/config.go
services/xstockstrat-portfolio/internal/config/config.go
services/xstockstrat-marketdata/internal/config/config.go
services/xstockstrat-trading/internal/config/config_test.go
services/xstockstrat-portfolio/internal/config/config_test.go
services/xstockstrat-marketdata/internal/config/config_test.go
services/xstockstrat-config/.eslintrc.json
docs/patterns/header-propagation.md                        # 6 teardown docs ↓
docs/context-constitution-findings.md
CLAUDE.md
services/xstockstrat-trading/docs/context-constitution-findings.md
services/xstockstrat-portfolio/docs/context-constitution-findings.md
services/xstockstrat-marketdata/docs/context-constitution-findings.md
```
17 non-teardown (5 package.json + 1 root lock + 4 propagation.ts + 3 config.go + 3 config_test.go +
1 eslintrc) + **6 teardown docs** = 23.

## Rejected Alternatives

- **Isolate ui into a follow-up feature** (round-2 adversary recommendation) — rejected by operator
  decision (keep ui in, hardened). Mitigated by AC-4 + the `next build` gate + the written sibling-dep
  bounce rule, so the e2e-inclusive blast radius is bounded and attributable.
- **Keep identity's `propagation.ts` + document retention** — rejected (rounds 1-3 consensus): mechanism
  mismatch (HTTP `IncomingMessage` scaffolding vs `ledgerAudit`'s gRPC `Metadata` + own const) makes
  retention pointless; wiring `ledgerAudit` *into* the module would be a behavior-touching refactor, a
  different change class, out of scope.
- **"The toolchain green build is the AC assertion"** (round-1 proposer) — rejected: a green build proves
  "still compiles" but NOT the absence clause (a pre-deletion tree is fully green). Replaced by the
  construct-scoped grep RED→GREEN as a named impl-spec step.
- **A permanent CI grep-guard against re-adding the symbols** — rejected (How-to-Act #2 overbuild): the
  removal ACs are one-time deletion regressions, not durable behavioral guarantees.
- **Standalone `tsc --noEmit` as ui's green-gate** — rejected (round-3, fails-155): `next build` already
  type-checks the full program incl. e2e; a bare `tsc` adds zero coverage and risks a false-RED.
- **`pnpm why` graph-wide "no 20.x anywhere"** — rejected (round-4): a transitive 20.x floor is out of
  scope; asserting it would force an out-of-scope `pnpm.overrides` (the FR-3 bounce). Scope the assertion
  to the five **direct** edges.

## Open Risks (→ context.md Open Threads / /sdd-spec)

- [ ] **Vestigial per-service lockfiles — deliberately untouched.** `services/{config,identity,ledger,notify}/pnpm-lock.yaml`
  exist and pin `@types/node@20.19.37` (already out of sync with the root lock's `20.19.39`). **Nothing
  reads them** — all four leaf Dockerfiles copy the **root** `pnpm-workspace.yaml package.json pnpm-lock.yaml`
  (`Dockerfile:13`) and `pnpm install --frozen-lockfile` (`:17`); `pnpm --filter`/`pnpm why` operate off
  the root lock. Root `pnpm install` won't touch them, so they are **excluded from the 23-path gate**.
  **Do not run a per-service `pnpm install`** — it would dirty one and surprise-fail the exact-diff gate.
- [ ] **FR-3 sibling-dep bounce.** If `@types/node ^24` surfaces a type error a mechanical in-file fix
  can't clear without a sibling bump (`@types/react`, `next`, `@types/pg`) or a refactor, **step A halts
  and bounces to the operator** — never absorbed; must not leak a 24th path into the diff gate.
- [ ] `/sdd-spec` re-confirms at execute: exact `@types/node` line in each `package.json` incl. ui; the
  root lockfile path; that `config/.eslintrc.json:31` is the only eslint override referencing
  `propagation.ts` among the four; and re-greps every deletion target before removal.
- [ ] Teardown NARROWS (174 discipline): reconcile only the `getEnvBool`/`propagation.ts` clauses in the
  six docs; leave unrelated findings untouched. The `header-propagation.md` Go reference at `:50` (a
  LIVE `trading/internal/middleware/propagation.go`) is NOT in scope — leave it.

## Constitution Rules Touched

- **C-08 / P-06 / C-15** — each `@AC-*` is discharged by a named impl-spec Verification step: the
  construct-scoped RED→GREEN presence assertion (AC-1/2) or version-pin assertion (AC-3/4) **plus** the
  build/lint/test that proves "still builds/passes". ledger/identity route through `pnpm build` (real
  `tsc`), never their strip-types `test`/`test:coverage` which type-check nothing (fails-021/074 —
  averted). No vacuous-green, no false-RED (round-4 confirmed).
- **C-15** — `@AC-4` added for ui + FR-3/Affected-Services/Out-of-Scope reconciled to five services
  (operator scope decision), closing the uncovered-FR gap. Covering assertions live in
  implementation-spec.md, not context.md.
- **C-16** — **deliberate NON-promotion recorded here:** AC-1/AC-2/AC-3/AC-4 are one-time
  removal-regression guards, not durable behavioral guarantees, so they are NOT promoted into the
  per-service business-rule suites at launch. scenario-recon confirmed **zero existing `@AC-*` impacted**.
- **C-11 / teardown (fails-670)** — the six teardown docs (incl. `header-propagation.md:123`, added
  post-recon) reconciled in the same PR; `context-constitution refresh` scoped to touched docs.
- **C-01 / F-04** — every path/symbol grep-confirmed this session; stale findings line numbers corrected
  at teardown.
- **How-to-Act #2/#3** — minimum change (no abstraction, no permanent guard, no ui isolation-refactor);
  surgical diff bounded by the 23-path gate.
- **No Floor (F-*) breach** — no proto/migration/authz/secret/DB-pool/config-value surface touched
  (confirmed across all four rounds).

## Business Rules Touched (C-16)

- **None PRESERVE/EXTEND/CHANGE** — pure dead-code removal + a devDependency type-pin; scenario-recon
  swept every affected service's `acceptance/*.feature` + `docs/sdd/business-rules/platform.feature` and
  found **zero `@AC-*`** depending on `getEnvBool`, `propagation.ts`, or the `@types/node` version. The
  feature's own `@AC-1..4` are net-new one-time removal guards (not promoted — see C-16 above).
