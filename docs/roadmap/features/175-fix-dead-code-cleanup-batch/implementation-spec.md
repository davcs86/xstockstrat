# Implementation Spec: fix-dead-code-cleanup-batch

**Status**: `pending`
**Created**: 2026-09-04
**Feature**: `docs/roadmap/features/175-fix-dead-code-cleanup-batch/feature.md`
**Total Steps**: 7
**Feature Branch**: `feature/fix-dead-code-cleanup-batch`

---

## Execution Summary

Three independent dead-scaffolding removals plus a `@types/node` devDependency type-pin, batched into
one PR with **zero runtime behavior change**, executed in the design's locked A→E order
(`design.md` § Chosen Approach). The order front-loads the Node bump so lockfile churn is isolated
and attributable (Step 1), gates the Node compile **before** any deletion (Step 2 = design pass B,
Node-only pre-delete), then deletes and re-verifies each family (Go: Steps 3–4; Node: Steps 5–6),
then reconciles the teardown docs (Step 7 = design pass E). Go is untouched before deletion, so it has
no pre-delete gate — its build/lint/test runs only post-delete (Step 4).

**Consumer surface (C-14): None — internal/platform-only** (product-spec `## Consumer Surface(s)`).
Every item is dead-code removal or a devDependency type-pin bump with no RPC, UI segment, or Agent MCP
tool touched. This is a recorded decision, not an omission — no `xstockstrat-ui` / `xstockstrat-agent`
step is required.

**Business-rule promotion (C-16): deliberate NON-promotion** (`design.md` § Business Rules Touched).
`@AC-1..4` are one-time removal-regression guards, not durable behavioral guarantees, so they are NOT
promoted into the per-service business-rule suites at launch. Recon confirmed zero existing `@AC-*`
depends on `getEnvBool`, `propagation.ts`, or the `@types/node` version.

### Scenario Coverage (C-15)

| Scenario | Covered by |
|---|---|
| `@AC-3` — four Node leaves resolve `@types/node ^24`, typecheck via build script | Step 2 |
| `@AC-4` — `xstockstrat-ui` resolves `@types/node ^24`, `next build` succeeds | Step 2 |
| `@AC-1` — `getEnvBool` (+ suppressor + dedicated test) gone from the 3 Go config packages; each still builds/lints/tests | Step 4 |
| `@AC-2` — `propagation.ts` gone from all Node leaf services (identity per recorded design decision: **deleted**); each still builds (tsc) + tests | Step 6 |

**RED-locus note (P-06, `design.md` verification mechanics):** for `@AC-1`/`@AC-2` the construct-scoped
RED is the *presence* of the now-deleted symbol/file (grep / `git ls-files` non-empty before, empty
after); for `@AC-3`/`@AC-4` the RED is the **version string** (`^24` absent → present), and the
build/tsc/`next build` is a green-before-**and**-after regression guard, never a manufactured build-RED.

## Step Dependencies

- **Step 2 requires Step 1** — the pre-delete Node build gate (design pass B) and the `^24` version /
  resolution assertions can only pass after the bump lands.
- **Step 4 requires Step 3** — verifies the Go deletion.
- **Step 6 requires Step 5** — verifies the Node deletion; its `pnpm build` re-confirms the Node-24
  compile survived deletion (design pass D, Node portion).
- **Step 5 must run after Step 2** — the Node pre-delete gate (Step 2) must prove a green Node-24
  compile *before* deletion can mask a regression (design pass B rationale).
- **Step 7 (teardown) runs last** — it reconciles the six teardown docs and then asserts the
  **landed-diff gate** (fails-082): `git diff --name-only main-dev...HEAD` must equal EXACTLY the 23
  paths enumerated in `design.md` (17 non-teardown + 6 teardown), no more, no less.
- **FR-3 sibling-dep bounce (design Open Risk):** if a green Node-24 build at Step 1/2 requires a
  **sibling** dep bump (`@types/react`, `next`, `@types/pg`, …) or a non-trivial refactor rather than an
  in-file mechanical type fix, **STOP and bounce to the operator** — do not absorb it, and do not leak a
  24th path into the diff gate.
- **Vestigial per-service lockfiles — do NOT touch:** `services/{config,identity,ledger,notify}/pnpm-lock.yaml`
  exist but nothing reads them (all four leaf Dockerfiles copy the **root** lock + `--frozen-lockfile`).
  Run only the **root** `pnpm install`; a per-service `pnpm install` would dirty one and break the
  23-path gate. They are excluded from the gate by design.

---

### Step 1 — service: bump `@types/node ^20 → ^24` across five Node workspaces + regenerate root lockfile

**Status**: `done`
**Service**: `xstockstrat-{ledger,notify,config,identity,ui}` (workspace-wide devDependency)
**Files**:
- `services/xstockstrat-ledger/package.json` — modify
- `services/xstockstrat-notify/package.json` — modify
- `services/xstockstrat-config/package.json` — modify
- `services/xstockstrat-identity/package.json` — modify
- `services/xstockstrat-ui/package.json` — modify
- `pnpm-lock.yaml` — modify (ROOT lock only)

**Reviewers**: xstockstrat-ledger owner — append-only invariant, event ordering; xstockstrat-notify owner — stream delivery, alert dedup; xstockstrat-config owner — config key naming, WatchConfig stability; xstockstrat-identity owner — JWT expiry/rotation, secret store integration; xstockstrat-ui owner — Connect-RPC call safety, no direct DB access

**Codebase Evidence**:
- Confirmed via `grep -n '"@types/node"'`: `ledger package.json:37` `"@types/node": "^20.12.12"`, `notify:38` `"^20.12.12"`, `config:35` `"^20.12.12"`, `identity:37` `"^20.12.12"`, `ui:63` `"@types/node": "^20"` (note ui's pin is `^20`, not `^20.12.12`).
- Root lockfile: `pnpm-lock.yaml` present at repo root (454 KB); `pnpm-workspace.yaml` present — pnpm 9.15.9 workspace (root `CLAUDE.md` Language Versions).
- Vestigial per-service locks present (`services/xstockstrat-{config,identity,ledger,notify}/pnpm-lock.yaml`) — **excluded from scope** (`design.md` Open Risk); no leaf Dockerfile reads them.

**TDD**: `red-green required` — paired with Step 2. Construct RED is the `^24` version string (absent before this step, present after); the build gate in Step 2 is the green-before-and-after regression guard.

**Covers**: `—`

**Instructions**:
1. In each of the five `package.json`, replace the `@types/node` version value with `^24`:
   - ledger `:37`, notify `:38`, config `:35`, identity `:37` — `"^20.12.12"` → `"^24"`.
   - ui `:63` — `"^20"` → `"^24"`.
   Change only the `@types/node` line in each file; touch no sibling dependency.
2. From the repo root, run **root** `pnpm install` to regenerate `pnpm-lock.yaml`. Do **not** run any
   per-service `pnpm install` (would dirty a vestigial per-service lock and break the 23-path gate).
3. **Bounce gate (FR-3):** if resolving `@types/node ^24` forces a sibling bump (`@types/react`, `next`,
   `@types/pg`, …) or a non-trivial refactor to build green, STOP and escalate to the operator — this is
   out of scope and must not be absorbed.

**Verification**:
```bash
grep -n '"@types/node"' services/xstockstrat-ledger/package.json services/xstockstrat-notify/package.json \
  services/xstockstrat-config/package.json services/xstockstrat-identity/package.json services/xstockstrat-ui/package.json
# → every line shows ^24
git diff --name-only | grep -E 'pnpm-lock.yaml$'   # → root pnpm-lock.yaml only; no services/*/pnpm-lock.yaml
```

---

### Step 2 — test: verify `@types/node ^24` resolution + Node/ui pre-delete build gate

**Status**: `done`
**Service**: `xstockstrat-{ledger,notify,config,identity,ui}`
**Files**: none (verification only)

**Reviewers**: xstockstrat-ledger owner — append-only invariant; xstockstrat-notify owner — stream delivery; xstockstrat-config owner — WatchConfig stability; xstockstrat-identity owner — JWT/secret store; xstockstrat-ui owner — Connect-RPC call safety

**Codebase Evidence**:
- Build scripts confirmed via `grep -n '"build"'`: ledger `:8` `"build": "tsc"`, notify `:8` `"tsc"`, config `:8` `"tsc"`, identity `:8` `"tsc"`. These are the **real type gates** for the four leaves.
- ledger/identity `test` scripts run `node --experimental-strip-types --test` (ledger `:13`, identity `:12`) which **type-checks nothing** (fails-021/074 vacuous-green) — so `pnpm build` (tsc), not `test`, is the type-discharge here.
- ui: `next build` is ui's sole type gate — `next.config.js` sets no `typescript.ignoreBuildErrors`, and it type-checks ui's full tsconfig program incl. the `e2e/` Playwright specs (`design.md` AC-4; fails-155: a bare `tsc --noEmit` risks a false-RED, so it is NOT the gate).

**TDD**: `red-green required` — construct RED = the `^24` version string (from Step 1); build/`next build` is the green-before-and-after regression guard.

**Covers**: `AC-3, AC-4`

**Instructions**:
1. **@AC-3 (four leaves ^24):** assert each leaf's direct `@types/node` edge resolves to a 24.x major
   (NOT a graph-wide "no 20.x anywhere" — a transitive 20.x floor is out of scope, `design.md` R4).
2. **@AC-3 build (type gate):** build each leaf via its `tsc` build script — never its strip-types test
   runner.
3. **@AC-4 (ui ^24):** assert ui's direct `@types/node` edge resolves 24.x, then `next build` (ui's sole
   type gate) succeeds across the full tsconfig include set (src + e2e).

**Verification**:
```bash
# @AC-3 version + resolution (four leaves)
grep -n '"@types/node"' services/xstockstrat-{ledger,notify,config,identity}/package.json   # all ^24
pnpm why @types/node --filter xstockstrat-ledger --filter xstockstrat-notify \
  --filter xstockstrat-config --filter xstockstrat-identity                                  # each direct edge → 24.x
# @AC-3 type gate (tsc via build script, NOT strip-types test)
pnpm --filter xstockstrat-ledger --filter xstockstrat-notify --filter xstockstrat-config --filter xstockstrat-identity build
# @AC-4 ui
grep -n '"@types/node"' services/xstockstrat-ui/package.json                                 # ^24
pnpm why @types/node --filter xstockstrat-ui                                                  # direct edge → 24.x
pnpm --filter xstockstrat-ui build                                                            # = next build; succeeds
```

---

### Step 3 — service: delete dead `getEnvBool` from the three Go config packages

**Status**: `done`
**Service**: `xstockstrat-{trading,portfolio,marketdata}`
**Files**:
- `services/xstockstrat-trading/internal/config/config.go` — modify (remove `getEnvBool`)
- `services/xstockstrat-portfolio/internal/config/config.go` — modify (remove `getEnvBool` + suppressor + orphaned `strconv` import)
- `services/xstockstrat-marketdata/internal/config/config.go` — modify (remove `getEnvBool`)
- `services/xstockstrat-trading/internal/config/config_test.go` — modify (remove `TestGetEnvBool` function only)
- `services/xstockstrat-portfolio/internal/config/config_test.go` — modify (remove `TestGetEnvBool` function only)
- `services/xstockstrat-marketdata/internal/config/config_test.go` — modify (remove `TestGetEnvBool` function only)

**Reviewers**: xstockstrat-trading owner — paper-only dev invariant, position limit enforcement; xstockstrat-portfolio owner — concurrent write safety; xstockstrat-marketdata owner — Alpaca feed idempotency

**Codebase Evidence**:
- `getEnvBool` definitions (fresh grep this session): `trading config.go:60` `func getEnvBool(key string, fallback bool) bool {`; `portfolio config.go:233` `func getEnvBool(key string, def bool) bool {`; `marketdata config.go:247` `func getEnvBool(key string, def bool) bool {`.
- **Zero production callers.** All non-definition references are: the dedicated tests (`trading config_test.go:74,76`; `portfolio :150,152`; `marketdata :147,149`) and the portfolio suppressor (`portfolio config.go:245` `var _ = getEnvBool`). No other call site in any service dir.
- **`config_test.go` is a SHARED file** (not dedicated to `getEnvBool`) — delete only the `TestGetEnvBool` function, never the file. Confirmed via `grep -n '^func Test'`: trading has 7 test funcs (`TestGetEnvBool` at `:53`, siblings incl. `TestResolveEnvironment :163`); portfolio has 9 (`TestGetEnvBool :133`, siblings `TestWatcherGet* / TestResolveEnvironment :160`); marketdata has 15 (`TestGetEnvBool :130`, siblings `TestResolveSecret_* / TestWatcher_* / TestResolveEnvironment :281`).
- **`strconv` orphan — portfolio ONLY.** `grep -n strconv`: only `portfolio config.go:9` `"strconv"` (import) and `:238` `strconv.ParseBool` (inside `getEnvBool`). trading/marketdata have **no** `strconv` import. Deleting portfolio's `getEnvBool` orphans the import → remove `config.go:9` too, or `golangci-lint` fails on the unused import (recon Risks).

**TDD**: `red-green required` — paired with Step 4. Construct RED is the *presence* of `func getEnvBool` (grep non-empty before, empty after).

**Covers**: `—`

**Instructions**:
1. **Fresh re-grep first** (`design.md` pass C): re-run `grep -rn getEnvBool services/xstockstrat-{trading,portfolio,marketdata}/internal/config` and confirm the only hits are the definition, the portfolio suppressor, and the three dedicated tests before deleting.
2. **trading:** delete the `getEnvBool` function at `config.go:60` (whole function body). Delete the `TestGetEnvBool` function at `config_test.go:53` (up to but not including the next `func Test…` at `:110`). No `strconv` import to touch.
3. **portfolio:** delete the `getEnvBool` function at `config.go:233`, the `var _ = getEnvBool` suppressor at `config.go:245`, **and** the now-orphaned `"strconv"` import at `config.go:9`. Delete the `TestGetEnvBool` function at `config_test.go:133` (up to the next `func Test…` at `:160`).
4. **marketdata:** delete the `getEnvBool` function at `config.go:247`. Delete the `TestGetEnvBool` function at `config_test.go:130` (up to the next `func Test…` at `:166`). No `strconv` import to touch.
5. Leave every other function and test in all six files untouched (surgical diff — How-to-Act #3).

**Verification**: (behavioral/coverage discharge lives in the paired Step 4)
```bash
grep -rn 'func getEnvBool' services/xstockstrat-trading/internal/config \
  services/xstockstrat-portfolio/internal/config services/xstockstrat-marketdata/internal/config   # → 0
grep -n 'getEnvBool' services/xstockstrat-portfolio/internal/config/config.go                        # → 0 (suppressor gone)
grep -n '"strconv"' services/xstockstrat-portfolio/internal/config/config.go                         # → 0 (orphan import gone)
```

---

### Step 4 — test: `getEnvBool` gone; Go config packages still build, lint, and pass (AC-1)

**Status**: `done`
**Service**: `xstockstrat-{trading,portfolio,marketdata}`
**Files**: none (verification only)

**Reviewers**: xstockstrat-trading owner — paper-only dev invariant; xstockstrat-portfolio owner — concurrent write safety; xstockstrat-marketdata owner — Alpaca feed idempotency

**Codebase Evidence**:
- `internal/config` is a **coverage-included** Go package (not in the excluded set `cmd/handler/repository/telemetry/service`), so the CI 40% threshold applies. Deleting a covered function together with its only test is ratio-neutral-to-minor — both the covered lines and the covering test leave together (recon Coverage note).
- CI runs Go with `GOWORK=off` (root `CLAUDE.md` Important Go build note). A leftover orphan import (portfolio `strconv`) would fail `golangci-lint` — that is exactly why Step 3 removes it.

**TDD**: `red-green required` — construct RED = presence of `func getEnvBool` (Step 3); build/lint/test is the green-before-and-after regression guard.

**Covers**: `AC-1`

**Instructions**:
1. Confirm the absence assertion (the AC-1 RED→GREEN construct) and then discharge the "still builds,
   lints, passes" clause per service.
2. Coverage is enforced by CI's `-coverpkg` set, not the local `-cover` flag — assert the config-package
   test passes and the service total stays ≥ 40%.

**Verification** (per service `<svc>` in trading, portfolio, marketdata):
```bash
# AC-1 absence (construct RED→GREEN)
grep -rn 'func getEnvBool' services/xstockstrat-<svc>/internal/config    # → 0

# still builds + lints + config-package tests pass
cd services/xstockstrat-<svc> && GOWORK=off go build ./... \
  && GOWORK=off golangci-lint run --modules-download-mode=mod \
  && GOWORK=off go test ./internal/config/... -race -count=1

# CI coverage threshold (≥ 40%, coverage-included packages):
cd services/xstockstrat-<svc> && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') \
  && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" \
  && go tool cover -func=coverage.out | grep "^total:"    # confirm ≥ 40%
```

---

### Step 5 — service: delete dead `propagation.ts` from all four Node leaf services + prune config eslint override

**Status**: `pending`
**Service**: `xstockstrat-{ledger,notify,config,identity}`
**Files**:
- `services/xstockstrat-ledger/src/middleware/propagation.ts` — delete
- `services/xstockstrat-notify/src/middleware/propagation.ts` — delete
- `services/xstockstrat-config/src/middleware/propagation.ts` — delete
- `services/xstockstrat-identity/src/middleware/propagation.ts` — delete
- `services/xstockstrat-config/.eslintrc.json` — modify (strike the `propagation.ts` entry, keep `authz.ts`)

**Reviewers**: xstockstrat-ledger owner — append-only invariant; xstockstrat-notify owner — stream delivery; xstockstrat-config owner — WatchConfig stability; xstockstrat-identity owner — JWT/secret store integration

**Codebase Evidence**:
- Four files tracked (fresh `git ls-files 'services/*/src/middleware/propagation.ts'`): config, identity, ledger, notify.
- **All four DEAD — zero importers.** `grep -rn 'middleware/propagation|PropagationContext|propagationStore|extractFromHttpRequest'` across every leaf's `src` returns **only the export sites inside `propagation.ts` itself** (`export interface PropagationContext` / `export const propagationStore` / `export function extractFromHttpRequest`); no import statement anywhere.
- **Identity resolved = DELETE** (`design.md` Chosen Approach; Rejected Alternatives). `identity/src/grpc/ledgerAudit.ts` propagates via its **own** `PROPAGATED_HEADERS` const over gRPC `Metadata` — it never imports the HTTP-edge `propagation.ts` (`extractFromHttpRequest(req: IncomingMessage)`). Mechanism mismatch → retention is pointless; wiring ledgerAudit into the module would be a behavior-touching refactor, out of scope.
- **config eslint override:** `services/xstockstrat-config/.eslintrc.json:31` `"files": ["src/grpc/authz.ts", "src/middleware/propagation.ts"]` — strike only `src/middleware/propagation.ts` (keep `authz.ts`, which is LIVE). Confirmed config is the **only** one of the four leaves whose eslintrc references `propagation` (`grep -rln propagation .../.eslintrc*`).

**TDD**: `red-green required` — paired with Step 6. Construct RED is the *presence* of the tracked `propagation.ts` files (`git ls-files` non-empty before, empty after).

**Covers**: `—`

**Instructions**:
1. **Fresh re-grep first** (`design.md` pass C): re-run the importer grep above across all four leaves' `src` and confirm zero importers before deleting.
2. Delete all four `src/middleware/propagation.ts` files (ledger, notify, config, identity).
3. In `services/xstockstrat-config/.eslintrc.json`, remove the `"src/middleware/propagation.ts"` element from the override `files` array at `:31`, leaving `"src/grpc/authz.ts"` intact. Keep the JSON valid.
4. Do not touch identity's `ledgerAudit.ts` or its `PROPAGATED_HEADERS` const (live; out of scope — record the ledgerAudit DRY observation as non-blocking only).

**Verification**: (build/test discharge lives in the paired Step 6)
```bash
git ls-files 'services/*/src/middleware/propagation.ts'                       # → 0 (index-authoritative)
grep -n 'propagation.ts' services/xstockstrat-config/.eslintrc.json           # → 0 (authz.ts remains)
```

---

### Step 6 — test: `propagation.ts` gone; Node leaf services still build (tsc) and pass (AC-2)

**Status**: `pending`
**Service**: `xstockstrat-{ledger,notify,config,identity}`
**Files**: none (verification only)

**Reviewers**: xstockstrat-ledger owner — append-only invariant; xstockstrat-notify owner — stream delivery; xstockstrat-config owner — WatchConfig stability; xstockstrat-identity owner — JWT/secret store integration

**Codebase Evidence**:
- Type gate is the `tsc` build script (ledger/notify/config/identity `package.json:8` `"build": "tsc"`), **not** the test runner: ledger/identity `test` run `--experimental-strip-types` which type-checks nothing (fails-021/074). identity's post-delete compile is proven **here** (`design.md` AC-2), not by the deletion bullet.
- Coverage threshold 40% via `pnpm run test:coverage` (`c8 --lines 40`) for each leaf (`package.json:13`/`:14`). Lint via `pnpm run lint` (`eslint src --ext .ts`, `package.json:14`/`:15`).

**TDD**: `red-green required` — construct RED = presence of the `propagation.ts` files (Step 5); build/test is the green-before-and-after regression guard.

**Covers**: `AC-2`

**Instructions**:
1. Confirm the absence assertion (AC-2 RED→GREEN construct) via the git index.
2. Discharge "still builds (tsc) + passes tests" for all four leaves through their `build` (real tsc
   type gate) and `test:coverage` scripts — never the bare strip-types `test` for the type check.
3. Include the eslint prune assertion and each leaf's lint run (§B lint gate).

**Verification**:
```bash
# AC-2 absence (construct RED→GREEN)
git ls-files 'services/*/src/middleware/propagation.ts'                       # → 0
grep -n 'propagation.ts' services/xstockstrat-config/.eslintrc.json           # → 0

# still builds (tsc type gate) + lints + tests (per leaf)
pnpm --filter xstockstrat-ledger --filter xstockstrat-notify --filter xstockstrat-config --filter xstockstrat-identity build
cd services/xstockstrat-ledger   && pnpm run lint && pnpm run test:coverage   # c8 --lines 40 passes
cd services/xstockstrat-notify   && pnpm run lint && pnpm run test:coverage
cd services/xstockstrat-config   && pnpm run lint && pnpm run test:coverage
cd services/xstockstrat-identity && pnpm run lint && pnpm run test:coverage
```

---

### Step 7 — docs: teardown reconciliation (six docs) + landed-diff gate

**Status**: `pending`
**Service**: `docs/` (+ root `CLAUDE.md` + per-service Go findings)
**Files**:
- `docs/context-constitution-findings.md` — modify (reconcile the `getEnvBool` + `propagation.ts` rows)
- `CLAUDE.md` — modify (Header Propagation Convention sentence)
- `docs/patterns/header-propagation.md` — modify (Node "Reference store" line)
- `services/xstockstrat-trading/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-portfolio/docs/context-constitution-findings.md` — modify
- `services/xstockstrat-marketdata/docs/context-constitution-findings.md` — modify

**Reviewers**: none (docs category)

**Codebase Evidence**:
- **Root findings** (`docs/context-constitution-findings.md`) has three affected rows (fresh grep):
  - `:18` doc-lie row asserting "delete `propagation.ts` only from ledger/notify/config … except identity (feature 043 wired identity's live via `ledgerAudit`)" — the item-6 error; reconcile to "all four unused / deleted".
  - `:33` `getEnvBool` dead-code entry with **stale line numbers** (cites `trading :55`, `portfolio :195-208`, `marketdata :201`; actual `:60`/`:233`/`:247`). The code is being deleted → **remove the entry**, don't refresh numbers.
  - `:34` `propagation.ts` entry ("in ledger/notify/config (no longer identity — feature 043 …)") — reconcile/remove to reflect all four deleted.
- **Root `CLAUDE.md:335`** (Header Propagation Convention) — "…their `src/middleware/propagation.ts` is presently unused (see `docs/context-constitution-findings.md`)." After deletion the module no longer exists → update the sentence (gone, not merely unused); keep true that identity still propagates via `ledgerAudit`'s own const.
- **`docs/patterns/header-propagation.md:123`** — Node section hard-cites `Reference store: services/xstockstrat-ledger/src/middleware/propagation.ts` with a `propagationStore`/`AsyncLocalStorage` snippet at `:125-145`. Deleting all four copies leaves a **dangling reference** (fails-670) → re-home in-PR: neutralize/inline the snippet or re-point the "Reference store" line. The Go reference at `:50` (`trading/internal/middleware/propagation.go`, a LIVE file) is **NOT** in scope — leave it.
- **Per-service Go findings** each point at the root `getEnvBool` entry: `trading docs/context-constitution-findings.md:5`, `portfolio :7`, `marketdata :5` ("Repo-wide … `getEnvBool` dead … live in the root findings log") — refresh/remove to match the deletion.

**TDD**: `N/A (docs — no code-bearing behavior)`

**Covers**: `—`

**Instructions**:
1. **NARROW, don't over-resolve** (the 174 discipline, `design.md` Open Risk): reconcile only the
   `getEnvBool` / `propagation.ts` clauses in the six docs; leave every unrelated finding untouched.
2. Root findings `:18/:33/:34` — remove/reconcile so all four `propagation.ts` read as deleted and the
   `getEnvBool` dead-code entry is removed (the defect no longer exists).
3. Root `CLAUDE.md:335` — rewrite the "presently unused" clause to reflect that the leaf
   `propagation.ts` modules are removed; preserve the true statement that identity propagates headers
   via `ledgerAudit`'s own `PROPAGATED_HEADERS` const.
4. `docs/patterns/header-propagation.md` — re-point or neutralize the Node "Reference store" line at
   `:123` and its snippet so it no longer cites a deleted file; **do not** touch the LIVE Go reference
   at `:50`.
5. Per-service Go findings (trading `:5`, portfolio `:7`, marketdata `:5`) — refresh/remove the
   `getEnvBool` dead pointer.
6. Run `/context-forge:context-constitution refresh` scoped to the touched docs (root `CLAUDE.md`
   Teardown rule); fix any grounded drift it reports within the narrowed scope. If the plugin is
   unavailable, perform the equivalent by hand and record both the unavailability and the manual
   reconciliation in the PR body (root `CLAUDE.md` Teardown — a bare "plugin unavailable" note does not
   discharge it).

**Verification**:
```bash
# teardown clauses reconciled — no stale dead-symbol citation remains
grep -rn 'getEnvBool' docs/context-constitution-findings.md \
  services/xstockstrat-trading/docs/context-constitution-findings.md \
  services/xstockstrat-portfolio/docs/context-constitution-findings.md \
  services/xstockstrat-marketdata/docs/context-constitution-findings.md   # no "dead getEnvBool" claim remains
grep -n 'propagation.ts' docs/context-constitution-findings.md CLAUDE.md docs/patterns/header-propagation.md
# → no line describes a leaf propagation.ts as an existing/unused module; the LIVE Go
#   trading/internal/middleware/propagation.go reference at header-propagation.md:50 is untouched

# LANDED-DIFF GATE (fails-082) — must equal EXACTLY these 23 paths, no more, no less:
git diff --name-only main-dev...HEAD | sort
# Expect exactly (17 non-teardown + 6 teardown):
#   services/xstockstrat-ledger/package.json
#   services/xstockstrat-notify/package.json
#   services/xstockstrat-config/package.json
#   services/xstockstrat-identity/package.json
#   services/xstockstrat-ui/package.json
#   pnpm-lock.yaml
#   services/xstockstrat-ledger/src/middleware/propagation.ts
#   services/xstockstrat-notify/src/middleware/propagation.ts
#   services/xstockstrat-config/src/middleware/propagation.ts
#   services/xstockstrat-identity/src/middleware/propagation.ts
#   services/xstockstrat-trading/internal/config/config.go
#   services/xstockstrat-portfolio/internal/config/config.go
#   services/xstockstrat-marketdata/internal/config/config.go
#   services/xstockstrat-trading/internal/config/config_test.go
#   services/xstockstrat-portfolio/internal/config/config_test.go
#   services/xstockstrat-marketdata/internal/config/config_test.go
#   services/xstockstrat-config/.eslintrc.json
#   docs/patterns/header-propagation.md
#   docs/context-constitution-findings.md
#   CLAUDE.md
#   services/xstockstrat-trading/docs/context-constitution-findings.md
#   services/xstockstrat-portfolio/docs/context-constitution-findings.md
#   services/xstockstrat-marketdata/docs/context-constitution-findings.md
# NOT present: any services/*/pnpm-lock.yaml (vestigial per-service locks — deliberately untouched)
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
