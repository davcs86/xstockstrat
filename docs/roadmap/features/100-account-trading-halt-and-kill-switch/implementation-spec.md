# Implementation Spec: account-trading-halt-and-kill-switch

**Status**: `complete`
**Created**: 2026-08-06
**Feature**: `docs/roadmap/features/100-account-trading-halt-and-kill-switch/feature.md`
**Total Steps**: 13
**Feature Branch**: `feature/account-trading-halt-and-kill-switch`

---

## Execution Summary

Adds a new, independently-seeded config key `platform.trading_state` (string enum
`ACTIVE`/`REDUCE_ONLY`/`HALTED`, per-`trading_mode`), **never** touching the existing
`platform.maintenance_mode` boolean (widening it in place was rejected in design.md as a confirmed
fail-open bug). `xstockstrat-trading` gains a single shared gate — HALTED blocks `PlaceOrder`
outright and blocks `ReplaceOrder`; REDUCE_ONLY permits only risk-reducing orders, verified via
`PortfolioService.GetPosition` for `PlaceOrder` and a pure local qty comparison for `ReplaceOrder`;
`CancelOrder` is deliberately left ungated (mirrors feature 030's own decision on its per-account
gate). `xstockstrat-portfolio` gets a real `ErrPositionNotFound` sentinel (following the
`ErrWatchlistNotFound` precedent) so `GetPosition`'s Connect handler can finally distinguish "no
position" (`NotFound`) from a genuine backend failure (`Internal`) — today it collapses both to
`NotFound` unconditionally, which is what makes REDUCE_ONLY's fail-closed design actually
implementable. The audit trail is the **existing** `config.config_audit` table (no new ledger
dependency, per design.md's final round) — the one real gap is that the config-ui editor hardcodes
`reason: 'Updated via config-ui'`, so `xstockstrat-ui` gains a real reason-capture `<Input>`,
required specifically when editing `platform.trading_state`. Steps run backend-first
(config → portfolio → trading) so the UI step lands against a working write/validate path, then
docs steps close out the CLAUDE.md / config-governance.md / product-spec.md paper trail.

Two of design.md's Open Risks are resolved by evidence already gathered in this session rather than
by a step: **Risk 3** (GetPosition's NotFound-fix could regress feature 096's UI consumer) —
confirmed via direct read that `usePosition`/`page.tsx:149-151` render `error.message` generically
with no status-code branch, so the fix is safe; this is cited as Codebase Evidence in Step 5 rather
than requiring a separate verification step. **Risk 2** (stream-key convention) is moot — this
design builds no ledger event at all. **Risk 6** (automated-trigger authz gap) is explicitly out of
scope for V1 per design.md and needs no step here; it is a named forward dependency for features 102
and 107.

## Step Dependencies

- Step 4 [test] covers Step 3 [service] (`xstockstrat-config` write-time validation).
- Step 6 [test] covers Step 5 [service] (`xstockstrat-portfolio` `ErrPositionNotFound`).
- Step 8 [test] covers Step 7 [service] (`xstockstrat-trading` gate).
- Step 10 [test] covers Step 9 [service] (`xstockstrat-ui` reason capture).
- Step 2 (migration) should land before Step 3 is exercised end-to-end: `SetConfig`'s existing
  existence gate (feature 091, `configServiceImpl.ts:315-335`) rejects a write to an unregistered
  `(namespace,key,environment,trading_mode)` scope unless `create_key=true` — the two steps compile
  and unit-test independently, but a real `SetConfig` write to `platform.trading_state` only
  succeeds once Step 2's rows exist.
- Step 7 should land after Step 5 for full behavioral correctness: before Step 5's fix,
  `portfolio_handler.go`'s `GetPosition` returns `connect.CodeNotFound` for **every** error
  (confirmed at recon/spec time), so Step 7's `codes.NotFound`-vs-other-error branch in
  `checkReduceOnlyExposure` degrades to "always treat as confirmed-no-position" until Step 5 lands —
  the code still compiles and the gate still fails closed either way, but the two error messages it
  distinguishes only diverge correctly once Step 5 is in place.
- Step 13 (product-spec approval-gate correction) can run any time after Step 2, since it only makes
  sense once the parallel-key path is confirmed landed (it already was, per design.md — this step
  just corrects the stale checkbox).
- Steps 11–12 (CLAUDE.md / config-governance.md docs) can land any time after Step 3, since they
  document the finished key contract.

---

### Step 1 — docs: Re-verify FR-1 (no code change) and retire the stale findings-doc row

**Status**: `done`
**Service**: `docs/` (repo-wide) + `services/xstockstrat-trading/docs/`
**Files**:
- `services/xstockstrat-trading/docs/context-constitution-findings.md` — modify (row 13 only)

**Reviewers**: none

**Codebase Evidence**:
- Confirmed via `Read services/xstockstrat-trading/internal/service/trading.go:244`:
  `if s.cfgW.GetBool("platform.maintenance_mode", false) { return nil, fmt.Errorf(...) }` — the code
  already reads `platform.maintenance_mode`, not `trading.maintenance_mode`.
- Confirmed via `Read services/xstockstrat-trading/CLAUDE.md` (Config Keys Consumed table): the row
  for `platform.maintenance_mode` already reads "the real halt key; there is no
  `trading.maintenance_mode`".
- The stale row: `services/xstockstrat-trading/docs/context-constitution-findings.md:13` —
  `| trading.maintenance_mode — "reject all new orders" | Code reads only platform.maintenance_mode | CLAUDE.md:59 vs trading.go:244 | Fix the doc/key name |`
  — this row is dated 2026-07-24 and now describes a defect that no longer exists (the doc/code
  drift was fixed on trunk before this feature started; product-spec.md's Problem Statement already
  documents this re-verification).

**TDD**: `N/A (docs-only verification, no behavior change)`

**Instructions**:
1. Run `grep -n "platform.maintenance_mode\|trading.maintenance_mode" services/xstockstrat-trading/internal/service/trading.go services/xstockstrat-trading/CLAUDE.md` and confirm the only key referenced in code is `platform.maintenance_mode`, and CLAUDE.md's Config Keys Consumed table documents it (not `trading.maintenance_mode`).
2. In `services/xstockstrat-trading/docs/context-constitution-findings.md`, row 13 of the "Documentation that lies" table is now false (the CLAUDE.md and code already agree). Edit that row's "Suggested action" cell to state the drift is resolved, e.g. replace `Fix the doc/key name` with `Resolved — CLAUDE.md:63 and trading.go:244 agree as of 2026-08-04 (feature 100); row kept for history, not an open action`. Do not delete the row (this doc is an append/correct log per its own header, not append-only, but deleting hides the historical drift it once caught).

**Verification**:
```bash
grep -n "trading.maintenance_mode" services/xstockstrat-trading/docs/context-constitution-findings.md
# Confirm the row still exists but its action column no longer reads "Fix the doc/key name"
grep -c "platform.maintenance_mode" services/xstockstrat-trading/internal/service/trading.go
# Confirm >= 1 (still the only halt key read in code)
```

---

### Step 2 — migration: seed `platform.trading_state` per-`trading_mode` in `xstockstrat-config`

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/011_platform_trading_state.up.sql` — create (NNN
  re-verify at execute time — see Instructions)
- `services/xstockstrat-config/migrations/011_platform_trading_state.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps, no conflicts), up+down pair present, run-order
compliance with `scripts/db-migrate.sh`; `xstockstrat-config` owner — config key naming, environment/trading_mode scoping

**Codebase Evidence**:
- Last migration confirmed via `ls services/xstockstrat-config/migrations/`:
  `010_config_audit_insert_trigger.{up,down}.sql` is the highest `NNN`.
- Per-mode seed pattern confirmed via `Read services/xstockstrat-config/migrations/001_config_tables.up.sql:66`
  and `002_config_environment.up.sql:65-66`: `marketdata.alpaca.paper` has two independent rows
  (`trading_mode='live'` value `false`, `trading_mode='paper'` value `true`), the exact "seed
  paper/live independently, not `all`" pattern design.md and product-spec.md require for this key.
- `config.config_values`'s unique constraint is `(namespace, key, environment, trading_mode)`
  (`002_config_environment.up.sql:19-21`), so four rows (dev×paper, dev×live, production×paper,
  production×live) do not collide.
- `value_type` CHECK constraint (`001_config_tables.up.sql:10`) allows `'string'` — no schema change
  needed, matching design.md's C-04-deferred string-enum choice.
- **Design.md Open Risk (3-way migration-number contention)**: `023-position-sizing-engine` and
  `030-stop-loss-bracket-orders` are both `design-approved` (confirmed via
  `grep "Lifecycle Status" docs/roadmap/features/{023,030}*/feature.md`) with **no migration files
  yet on either branch** (confirmed: neither feature has reached `code-completed`) — so `011` is the
  correct next number as of this spec-writing session, but per Constitution **C-07** it must be
  **re-verified against the live tree at execute time**, not hardcoded from this document.

**TDD**: `N/A (migration step — offline verification only, per spec-template)`

**Instructions**:
1. **At execute time**, first re-run `ls services/xstockstrat-config/migrations/ | sort | tail -3` against the current checkout **and** `git ls-tree --name-only origin/main-dev services/xstockstrat-config/migrations/` to confirm `010` is still the highest landed `NNN` and that neither `023` nor `030` claimed `011` first. If either has, renumber this migration to the next free `NNN` and update this step's **Files** paths accordingly (per F-09, record the renumbering in the Deviation Log rather than editing this step's body).
2. Create `services/xstockstrat-config/migrations/011_platform_trading_state.up.sql` seeding exactly four rows, following the `marketdata.alpaca.paper` per-mode pattern (`002_config_environment.up.sql:65-66`) and the `001_config_tables.up.sql` seed-block style:
   ```sql
   -- Migration: 011_platform_trading_state.sql
   -- Service: xstockstrat-config
   -- Feature 100 (account-trading-halt-and-kill-switch): a new PARALLEL kill-switch enum,
   -- independent of platform.maintenance_mode (which stays untouched — widening its
   -- value_type in place was rejected in design.md as a confirmed fail-open bug on a
   -- proto oneof type mismatch). Seeded per trading_mode (not 'all') so an operator can
   -- halt live trading during an incident while paper testing continues unaffected.

   INSERT INTO config.config_values
     (namespace, key, value_type, value_data, description, default_value, consuming_service, environment, trading_mode)
   VALUES
     ('platform', 'trading_state', 'string', 'ACTIVE',
      'Richer halt state: ACTIVE | REDUCE_ONLY | HALTED. REDUCE_ONLY rejects exposure-increasing orders but permits cancellation and risk-reducing closes; HALTED rejects all exposure-increasing orders. Independent of platform.maintenance_mode.',
      'ACTIVE', 'xstockstrat-trading', 'dev', 'paper'),
     ('platform', 'trading_state', 'string', 'ACTIVE',
      'Richer halt state: ACTIVE | REDUCE_ONLY | HALTED. REDUCE_ONLY rejects exposure-increasing orders but permits cancellation and risk-reducing closes; HALTED rejects all exposure-increasing orders. Independent of platform.maintenance_mode.',
      'ACTIVE', 'xstockstrat-trading', 'dev', 'live'),
     ('platform', 'trading_state', 'string', 'ACTIVE',
      'Richer halt state: ACTIVE | REDUCE_ONLY | HALTED. REDUCE_ONLY rejects exposure-increasing orders but permits cancellation and risk-reducing closes; HALTED rejects all exposure-increasing orders. Independent of platform.maintenance_mode.',
      'ACTIVE', 'xstockstrat-trading', 'production', 'paper'),
     ('platform', 'trading_state', 'string', 'ACTIVE',
      'Richer halt state: ACTIVE | REDUCE_ONLY | HALTED. REDUCE_ONLY rejects exposure-increasing orders but permits cancellation and risk-reducing closes; HALTED rejects all exposure-increasing orders. Independent of platform.maintenance_mode.',
      'ACTIVE', 'xstockstrat-trading', 'production', 'live')
   ON CONFLICT (namespace, key, environment, trading_mode) DO NOTHING;
   ```
3. Create the matching `011_platform_trading_state.down.sql`:
   ```sql
   DELETE FROM config.config_values WHERE namespace = 'platform' AND key = 'trading_state';
   ```

**Verification**:
```bash
ls services/xstockstrat-config/migrations/011_platform_trading_state.up.sql \
   services/xstockstrat-config/migrations/011_platform_trading_state.down.sql
# Read both files: confirm the four INSERT rows in .up (dev/paper, dev/live, production/paper,
# production/live, all value 'ACTIVE') have a single, complete inverse DELETE in .down (matching
# namespace='platform' AND key='trading_state' — no row survives a rollback).
```

---

### Step 3 — service: write-time validation for `platform.trading_state` in `xstockstrat-config`

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: `xstockstrat-config` owner — config key naming, environment/trading_mode scoping, WatchConfig stream stability

**Codebase Evidence**:
- `setConfig` method confirmed at `configServiceImpl.ts:286-356`: admin gate (293-300) → destructure
  `{ namespace, key, value, reason }` (302) → author resolution (306-313) → existence gate
  (315-335) → INSERT (337-347).
- Existing per-key validation precedent: `WEIGHT_KEY_REGISTRY` (`configServiceImpl.ts:120-122`),
  keyed on the config key path, consulted from `listKeys` — this feature adds an analogous
  key-specific check consulted from `setConfig` instead (a write-time gate, not a read-time metadata
  annotation, since `platform.trading_state` isn't a float map).
- `inferValueType`/`extractValueData` (`configServiceImpl.ts:428-455`) confirm a string write from
  the UI's generic path arrives as `{ string_val: ... }` or `{ stringVal: ... }` — both forms must be
  read defensively, matching the existing `v.string_val !== undefined || v.stringVal !== undefined`
  idiom used throughout this file.
- Design.md § Chosen Approach: "write-time validation in `SetConfig` rejecting any write to
  `platform.trading_state` outside the three known literals with `INVALID_ARGUMENT`."

**TDD**: `red-green required`

**Instructions**:
1. In `services/xstockstrat-config/src/grpc/configServiceImpl.ts`, after the author-resolution block (ends `configServiceImpl.ts:313`) and before the existence-gate `SELECT` (starts `:315`), insert:
   ```ts
   // Feature 100: platform.trading_state is a closed 3-literal string enum (C-04 deferred to
   // a future proto enum once a second consumer exists — see design.md). Reject any write
   // outside the known literals so a stale/typo'd caller can't mint a value the trading-side
   // gate would otherwise read as an unrecognized-hence-HALTED string with no server-side signal.
   if (namespace === 'platform' && key === 'trading_state') {
     const raw = value?.string_val ?? value?.stringVal ?? '';
     const ALLOWED = ['ACTIVE', 'REDUCE_ONLY', 'HALTED'];
     if (!ALLOWED.includes(raw)) {
       callback({
         code: 3, // INVALID_ARGUMENT
         message: `platform.trading_state must be one of ${ALLOWED.join(', ')} (got: ${JSON.stringify(raw)})`,
       });
       return;
     }
   }
   ```
2. Do not modify `WEIGHT_KEY_REGISTRY`, `inferValueType`, or `extractValueData` — this is a new, independent gate, not a change to the generic write path (recon.md confirmed the generic path needs zero change).

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint
grep -n "trading_state" src/grpc/configServiceImpl.ts
# Confirm the new guard block is present, sitting after the author check and before the
# existence-gate SELECT (line order matters — an invalid literal must be rejected before any DB call)
```

---

### Step 4 — test: `platform.trading_state` write-time validation over a real gRPC loopback

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/__tests__/tradingStateValidation.test.ts` — create

**Reviewers**: `xstockstrat-config` owner — config key naming, environment/trading_mode scoping, WatchConfig stream stability

**Codebase Evidence**:
- Direct template: `services/xstockstrat-config/src/__tests__/setConfigAuthz.test.ts:76-230` — an
  in-process **loopback gRPC** suite (`grpc.Server` + `createConfigServiceDefinition()` +
  `ConfigServiceImpl` + a recording pool stub), the established pattern in this repo for testing
  `setConfig` end-to-end without a real database, per the file's own header comment: "layer 1 alone
  would be a consumer-contract demonstration offered as producer-contract evidence" (the exact
  `fails.md` 2026-07-29/074 trap this repo already learned from).
- Recording-pool pattern (`setConfigAuthz.test.ts:94-103`): the stub returns a row for the existence
  SELECT so authorized writes reach the INSERT — reused here so the new validation guard is tested
  in front of a registered key, not confounded by the unrelated existence gate.

**TDD**: `red-green required` (paired with Step 3 — this test must fail against the pre-Step-3 tree)

**Instructions**:
Create `services/xstockstrat-config/src/__tests__/tradingStateValidation.test.ts` following
`setConfigAuthz.test.ts`'s exact loopback harness (same `before`/`after`, same recording pool, same
`ConfigServiceClient` dial). Cases:
1. `setConfig({ namespace: 'platform', key: 'trading_state', value: { stringVal: 'HALTED' }, ... })` with an admin metadata (`ADMIN_SCOPE` bit set) → `err === null`, and the recorded INSERT ran.
2. Same request with `value: { stringVal: 'REDUCE_ONLY' }` → succeeds.
3. Same request with `value: { stringVal: 'ACTIVE' }` → succeeds.
4. Same request with `value: { stringVal: 'PAUSED' }` (an invalid literal) → `err.code === grpc.status.INVALID_ARGUMENT`, message matches `/must be one of ACTIVE, REDUCE_ONLY, HALTED/`, **and** assert zero INSERT ran (mirror `setConfigAuthz.test.ts`'s `insertQuery()` helper / `assert.equal(queries.length, ...)` pattern) — proves the guard runs before any DB write, not just that the RPC returns an error.
5. Same request with `value: { stringVal: '' }` (empty string) → `INVALID_ARGUMENT`, same zero-INSERT assertion.
6. A write to a **different** key, e.g. `platform.log_level`, with any string value → unaffected (succeeds), proving the guard is scoped to `namespace==='platform' && key==='trading_state'` only.

**Verification**:
```bash
cd services/xstockstrat-config && pnpm run lint && pnpm run test:coverage
# Confirm the new test file's 6 cases all pass, and cd services/xstockstrat-config threshold
# (40%, per reference/spec-template.md) still passes overall.
```

---

### Step 5 — service: `ErrPositionNotFound` sentinel + `GetPosition` error-code fix in `xstockstrat-portfolio`

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go` — modify
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go` — modify

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot
consistency, concurrent write safety

**Codebase Evidence**:
- Existing sentinel-error precedent: `ErrWatchlistNotFound` (`watchlist_repo.go:16-17`), consumed via
  `errors.Is(err, repository.ErrWatchlistNotFound)` at `portfolio_service.go:1147-1148` — the exact
  pattern to mirror, not `GetPortfolio`/`ListPositions`/`GetPnL` (design.md's round-4 adversary
  confirmed these do no NotFound-vs-Internal mapping at all).
- `scanPositionRow` (`portfolio_repo.go:195-206`) confirmed to have **no** `pgx.ErrNoRows`
  special-case today: every scan failure wraps identically as `fmt.Errorf("scan position: %w", err)`.
  `scanPositionRow` is called from both `GetPosition` (`:61-69`, via `QueryRow` — the only call site
  that can actually produce `pgx.ErrNoRows`) and the `ListPositions` row loop (`:128`, via
  `rows.Scan` inside `for rows.Next()`, which cannot produce `pgx.ErrNoRows` — Next() already
  confirmed a row exists) — safe to add the check once, in the shared function.
- `portfolio_handler.go`'s `GetPosition` (lines 43-53) confirmed to **unconditionally** map any
  `h.svc.GetPosition` error to `connect.CodeNotFound` (line 50: `connect.NewError(connect.CodeNotFound, err)`)
  — this is the actual bug design.md's REDUCE_ONLY fail-closed design depends on fixing, since
  today a genuine backend failure is indistinguishable from "no position" at the wire.
- Both `GetPosition` callers confirmed unaffected by this change: `processOrderFill`
  (`portfolio_service.go:257`, `existing, _ := s.repo.GetPosition(...)` — discards the error entirely,
  branches only on `existing != nil`); and the trader UI's Position-detail page
  (`traderBff.ts:90-98` → `usePortfolio.ts:65-83` → `page.tsx:149-151`, confirmed via direct read:
  `{error && <p ...>Failed to load position: {error.message}</p>}` — renders `error.message`
  generically with **no** status-code branch, so mapping the same underlying failure to `Internal`
  instead of `NotFound` changes nothing the UI reads). This closes design.md's Open Risk on feature
  096 regression — confirmed here, not deferred.

**TDD**: `red-green required`

**Instructions**:
1. In `services/xstockstrat-portfolio/internal/repository/portfolio_repo.go`, add near the top of the file (immediately before `type pgxRow interface` at line 191, mirroring `ErrWatchlistNotFound`'s placement in `watchlist_repo.go:16-17`):
   ```go
   // ErrPositionNotFound is returned when a position row does not exist — mirrors
   // ErrWatchlistNotFound (watchlist_repo.go:17). Lets GetPosition's Connect handler
   // distinguish "no position" (NotFound) from a genuine backend failure (Internal),
   // which scanPositionRow could not do before (feature 100).
   var ErrPositionNotFound = errors.New("position not found")
   ```
2. In `scanPositionRow` (`portfolio_repo.go:195-206`), change the scan-error branch:
   ```go
   if err := row.Scan(&symbol, &qty, &avgEntry, &costBasis, &openedAt, &modeStr, &accountID,
       &currentPrice, &marketValue, &unrealizedPnl, &unrealizedPnlPct, &dayPnl, &dayPnlPct); err != nil {
       if errors.Is(err, pgx.ErrNoRows) {
           return nil, ErrPositionNotFound
       }
       return nil, fmt.Errorf("scan position: %w", err)
   }
   ```
   (`errors` and `pgx` are already imported in this file — no new imports.)
3. In `services/xstockstrat-portfolio/internal/handler/portfolio_handler.go`, add the import `"github.com/xstockstrat/portfolio/internal/repository"` and a new helper function (near the file's other unexported helpers, e.g. next to `errorf`):
   ```go
   // classifyGetPositionError maps a GetPosition error to a Connect code: NotFound only for
   // a confirmed absent position (repository.ErrPositionNotFound); every other error (DB
   // failure, timeout) is Internal — previously both collapsed to NotFound unconditionally,
   // which made REDUCE_ONLY's fail-closed design (trading.go) unable to tell "no position,
   // definitely safe to block" from "backend down, block out of caution" (feature 100).
   func classifyGetPositionError(err error) connect.Code {
       if errors.Is(err, repository.ErrPositionNotFound) {
           return connect.CodeNotFound
       }
       return connect.CodeInternal
   }
   ```
4. In `GetPosition` (`portfolio_handler.go:44-53`), replace the hardcoded `connect.CodeNotFound`:
   ```go
   p, err := h.svc.GetPosition(ctx, req.Msg)
   if err != nil {
       return nil, connect.NewError(classifyGetPositionError(err), err)
   }
   return connect.NewResponse(p), nil
   ```
5. Do not touch `GetSnapshot` (also unconditionally `CodeNotFound` at `portfolio_handler.go:86`) or any other handler — out of scope for this feature; design.md scopes this fix to `GetPosition` only.

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off golangci-lint run --modules-download-mode=mod
grep -n "ErrPositionNotFound" internal/repository/portfolio_repo.go internal/handler/portfolio_handler.go
# Confirm the sentinel is declared once, consumed via errors.Is in classifyGetPositionError,
# and scanPositionRow's ErrNoRows branch returns it (not a wrapped fmt.Errorf).
```

---

### Step 6 — test: `ErrPositionNotFound` sentinel + classification, no DB required

**Status**: `done`
**Service**: `xstockstrat-portfolio`
**Files**:
- `services/xstockstrat-portfolio/internal/repository/portfolio_repo_test.go` — create
- `services/xstockstrat-portfolio/internal/handler/portfolio_handler_test.go` — create

**Reviewers**: `xstockstrat-portfolio` owner — P&L calculation accuracy, position snapshot
consistency, concurrent write safety

**Codebase Evidence**:
- `scanPositionRow(row pgxRow)` (`portfolio_repo.go:195`) takes the narrow `pgxRow` interface
  (`Scan(dest ...any) error`, `portfolio_repo.go:191-193`) — directly fakeable with a zero-DB struct,
  the same shape as this repo's existing convention of testing pure logic without a live database
  (`portfolio_helpers_test.go`'s `computeNewPosition`, which replicates `processOrderFill`'s math in
  a DB-free function).
- `classifyGetPositionError(err error) connect.Code` (added in Step 5) is a pure function over an
  `error` value — no DB, no service, no gRPC dial needed.
- **Coverage note**: per `reference/spec-template.md`'s Go coverage command, `COVERPKGS` excludes
  packages matching `/(cmd|handler|repository|telemetry|service)(/|$)` — both
  `internal/repository` and `internal/handler` are excluded from the 40% coverage measurement. This
  test step is still required per **C-08**; state explicitly that no coverage percentage applies and
  `go test ./... -race` passing is the verification bar.

**TDD**: `red-green required` (paired with Step 5 — both new test files must fail to compile/pass
against the pre-Step-5 tree, since `ErrPositionNotFound` and `classifyGetPositionError` do not exist
yet)

**Instructions**:
1. Create `services/xstockstrat-portfolio/internal/repository/portfolio_repo_test.go` (package `repository`):
   ```go
   package repository

   import (
       "errors"
       "testing"

       "github.com/jackc/pgx/v5"
   )

   // fakeNoRowsRow simulates a pgx.Row whose Scan reports no matching row.
   type fakeNoRowsRow struct{}

   func (fakeNoRowsRow) Scan(dest ...any) error { return pgx.ErrNoRows }

   // fakeScanErrRow simulates a genuine scan/DB failure, distinct from "no rows".
   type fakeScanErrRow struct{}

   func (fakeScanErrRow) Scan(dest ...any) error { return errors.New("connection reset") }

   func TestScanPositionRow_NoRows_ReturnsErrPositionNotFound(t *testing.T) {
       _, err := scanPositionRow(fakeNoRowsRow{})
       if !errors.Is(err, ErrPositionNotFound) {
           t.Fatalf("expected ErrPositionNotFound, got %v", err)
       }
   }

   func TestScanPositionRow_OtherScanError_NotErrPositionNotFound(t *testing.T) {
       _, err := scanPositionRow(fakeScanErrRow{})
       if err == nil {
           t.Fatal("expected an error")
       }
       if errors.Is(err, ErrPositionNotFound) {
           t.Fatal("a generic scan failure must not be classified as ErrPositionNotFound")
       }
   }
   ```
2. Create `services/xstockstrat-portfolio/internal/handler/portfolio_handler_test.go` (package `handler`):
   ```go
   package handler

   import (
       "errors"
       "fmt"
       "testing"

       "connectrpc.com/connect"

       "github.com/xstockstrat/portfolio/internal/repository"
   )

   func TestClassifyGetPositionError_NotFound(t *testing.T) {
       got := classifyGetPositionError(repository.ErrPositionNotFound)
       if got != connect.CodeNotFound {
           t.Fatalf("got %v, want CodeNotFound", got)
       }
   }

   func TestClassifyGetPositionError_WrappedNotFound(t *testing.T) {
       wrapped := fmt.Errorf("get position: %w", repository.ErrPositionNotFound)
       got := classifyGetPositionError(wrapped)
       if got != connect.CodeNotFound {
           t.Fatalf("got %v, want CodeNotFound for a wrapped sentinel", got)
       }
   }

   func TestClassifyGetPositionError_GenericError_IsInternal(t *testing.T) {
       got := classifyGetPositionError(errors.New("db connection reset"))
       if got != connect.CodeInternal {
           t.Fatalf("got %v, want CodeInternal for a non-sentinel error", got)
       }
   }
   ```

**Verification**:
```bash
cd services/xstockstrat-portfolio && GOWORK=off go test ./internal/repository/... ./internal/handler/... -race -count=1 -v
# All 5 new test cases pass. internal/repository and internal/handler are excluded from the
# CI coverage-threshold measurement (COVERPKGS regex), so no percentage gate applies here —
# a clean `go test` run is the verification bar per reference/spec-template.md.
GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 7 — service: `platform.trading_state` gate in `xstockstrat-trading` (`PlaceOrder` + `ReplaceOrder`)

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill
detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- Existing `platform.maintenance_mode` check: `trading.go:243-246` (unchanged by this step — stays a
  fully independent, parallel check per design.md).
- `resolveAccount` returns `brokerPoolEntry` with a `userID` field (`trading.go:34-40,188`), called
  at `trading.go:262-265`; `accountEntry.userID` is what feeds the new REDUCE_ONLY check (never
  `req.UserId`, which can be empty for system-triggered callers per design.md).
- `checkPortfolioRisk` (`trading.go:1288-1326`) is the direct precedent for a 2-second-timeout,
  non-blocking `s.portfolio.*` call — this feature's REDUCE_ONLY check follows the same
  `context.WithTimeout(ctx, 2*time.Second)` pattern but is **blocking** (returns an error), unlike
  `checkPortfolioRisk`'s fail-open "log and continue."
  design.md is explicit this is a deliberate divergence for a hard kill-switch gate.
  `s.portfolio` is `portfoliov1.PortfolioServiceClient` (`trading.go:69`), already dialed in
  `NewTradingService` (`trading.go:111-114,123`) — no new client, no new dial.
- `ReplaceOrder`'s fill-state gate (`trading.go:452-458`) and the "`req.Qty != 0` means changed"
  convention (`trading.go:482`) are the exact inputs `isReplaceRiskReducing` compares against.
- `CancelOrder` (`trading.go:387-427`) confirmed to have zero maintenance-mode/halt check today —
  this step deliberately does **not** add one, per design.md's explicit parity with feature 030's own
  decision to leave `CancelOrder` ungated (the operator's sole remaining de-risk tool).
- `codes.FailedPrecondition` is the established status code for a rejected-but-not-malformed request
  in this file (`ReplaceOrder`'s fill-state gate, `trading.go:456-457`; not-replaceable-yet gate,
  `:461-462`) — reused here for consistency rather than the plain `fmt.Errorf` the older
  `maintenance_mode` check uses.
- **Trading-domain step constraints** (`reference/step-constraints.md` §A):
  - *Trading mode gate*: unaffected — `resolveTradingMode` (`trading.go:1330-1339`) and the
    broker paper/live routing are untouched; the new gate is an orthogonal per-mode **config**
    value, not a change to broker routing.
  - *Order type coverage*: the gate runs before the `OrderType`-specific trailing-stop validation
    (`trading.go:251-259`) and does not branch on `OrderType` — applies uniformly to all 5
    `OrderType` values (MARKET/LIMIT/STOP/STOP_LIMIT/TRAILING_STOP).
  - *Fill state completeness*: for `ReplaceOrder`, the pre-existing fill-state switch
    (`trading.go:452-458`, `NEW`/`PARTIALLY_FILLED` only) is unchanged; the new gate runs
    immediately after it, so both replaceable states are covered uniformly by the same check.
  - *Broker coverage*: unaffected — the gate runs before `resolveAccount`'s broker-type dispatch
    and does not branch on `BrokerType`.

**TDD**: `red-green required`

**Instructions**:
1. In `services/xstockstrat-trading/internal/service/trading.go`, add new code immediately after `checkPortfolioRisk` ends (after line 1326) and before `resolveTradingMode` (line 1328's doc comment):
   ```go
   // tradingState is the richer platform.trading_state enum (feature 100), independent of
   // and parallel to platform.maintenance_mode.
   type tradingState int

   const (
       tradingStateActive tradingState = iota
       tradingStateReduceOnly
       tradingStateHalted
   )

   // parseTradingState maps the raw config string to a tradingState. Unrecognized or empty
   // values fail to HALTED — the maximally conservative state — per design.md § Chosen Approach.
   func parseTradingState(raw string) tradingState {
       switch raw {
       case "ACTIVE":
           return tradingStateActive
       case "REDUCE_ONLY":
           return tradingStateReduceOnly
       default: // "HALTED", "", or any unrecognized literal
           return tradingStateHalted
       }
   }

   // currentTradingState reads platform.trading_state live. The GetString default of "HALTED"
   // (not "ACTIVE") means an unseeded/unreachable key fails closed, matching parseTradingState's
   // own fail-closed default for an unrecognized value.
   func (s *TradingService) currentTradingState() tradingState {
       return parseTradingState(s.cfgW.GetString("platform.trading_state", "HALTED"))
   }

   // isExposureIncreasing reports whether an order on the given side increases net exposure
   // given the account's existing position qty in that symbol (0 = flat). A flat account
   // increasing in either direction; a long position increases only on BUY; a short position
   // increases only on SELL.
   func isExposureIncreasing(side tradingv1.OrderSide, existingQty float64) bool {
       switch {
       case existingQty == 0:
           return true
       case existingQty > 0:
           return side == tradingv1.OrderSide_ORDER_SIDE_BUY
       default:
           return side == tradingv1.OrderSide_ORDER_SIDE_SELL
       }
   }

   // isReplaceRiskReducing reports whether a ReplaceOrder request is safe under REDUCE_ONLY:
   // requestedQty == 0 means "leave qty unchanged" (trading.go:482's existing convention) —
   // never exposure-increasing. Otherwise safe only when the new qty is <= the current qty.
   func isReplaceRiskReducing(currentQty, requestedQty float64) bool {
       if requestedQty == 0 {
           return true
       }
       return requestedQty <= currentQty
   }

   // checkTradingStateForPlaceOrder blocks PlaceOrder when platform.trading_state is HALTED,
   // or when it is REDUCE_ONLY and the order would increase exposure. REDUCE_ONLY fails
   // closed on any GetPosition error (not just NotFound) — this gate is the enforcement
   // point, not an advisory warning (design.md § Chosen Approach, a deliberate divergence
   // from checkPortfolioRisk's fail-open philosophy).
   func (s *TradingService) checkTradingStateForPlaceOrder(ctx context.Context, userID, symbol string, mode commonv1.TradingMode, side tradingv1.OrderSide) error {
       switch s.currentTradingState() {
       case tradingStateActive:
           return nil
       case tradingStateHalted:
           return grpcstatus.Errorf(codes.FailedPrecondition, "trading halted: platform.trading_state=HALTED")
       default: // REDUCE_ONLY
           posCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
           defer cancel()
           pos, err := s.portfolio.GetPosition(posCtx, &portfoliov1.GetPositionRequest{
               UserId: userID, Symbol: symbol, TradingMode: mode,
           })
           if err != nil {
               if grpcstatus.Code(err) == codes.NotFound {
                   return grpcstatus.Errorf(codes.FailedPrecondition,
                       "trading reduce-only: no existing position in %s; order would increase exposure", symbol)
               }
               return grpcstatus.Errorf(codes.Unavailable,
                   "trading reduce-only: unable to verify risk-reducing status for %s: %v", symbol, err)
           }
           if isExposureIncreasing(side, pos.Qty) {
               return grpcstatus.Errorf(codes.FailedPrecondition,
                   "trading reduce-only: order for %s would increase exposure", symbol)
           }
           return nil
       }
   }

   // checkTradingStateForReplace mirrors checkTradingStateForPlaceOrder for ReplaceOrder,
   // using a pure local qty comparison instead of a GetPosition call (the order's own current
   // qty is already loaded — no cross-service call needed).
   func (s *TradingService) checkTradingStateForReplace(order *tradingv1.Order, req *tradingv1.ReplaceOrderRequest) error {
       switch s.currentTradingState() {
       case tradingStateActive:
           return nil
       case tradingStateHalted:
           return grpcstatus.Errorf(codes.FailedPrecondition, "trading halted: platform.trading_state=HALTED")
       default: // REDUCE_ONLY
           if !isReplaceRiskReducing(order.Qty, req.Qty) {
               return grpcstatus.Errorf(codes.FailedPrecondition,
                   "trading reduce-only: replace on order %s would increase size", req.OrderId)
           }
           return nil
       }
   }
   ```
2. Wire the HALTED-or-REDUCE_ONLY check into `PlaceOrder`. After `resolveAccount` (`trading.go:262-265`) and before the `checkPortfolioRisk` call (`trading.go:268`), add:
   ```go
   mode := s.resolveTradingMode(req.TradingMode)
   if err := s.checkTradingStateForPlaceOrder(ctx, accountEntry.userID, req.Symbol, mode, req.Side); err != nil {
       return nil, err
   }
   ```
   Note: `PlaceOrder` already computes `mode := s.resolveTradingMode(req.TradingMode)` later at line 271 for a different purpose (order.TradingMode); moving/duplicating this call is intentional — `resolveTradingMode` is a pure read with no side effects (confirmed at `trading.go:1330-1339`), so calling it here is safe. Do not remove the original call at line 271; leave it as-is (the local `mode` variable introduced here is scoped to the new gate call and does not need to survive to line 271 — or, if preferred at execute time, hoist the single `mode := s.resolveTradingMode(...)` call to run once before this gate and reuse it at line 271, removing the duplicate; either is acceptable, note the choice in the Deviation Log).
3. Wire the HALTED-or-REDUCE_ONLY check into `ReplaceOrder`. After the fill-state gate (`trading.go:452-458`) and before the `BrokerOrderId` check (`trading.go:460`), add:
   ```go
   if err := s.checkTradingStateForReplace(order, req); err != nil {
       return nil, err
   }
   ```
4. Add a one-line comment above `func (s *TradingService) CancelOrder` (`trading.go:387`) documenting the deliberate exemption:
   ```go
   // CancelOrder is deliberately NOT gated by platform.trading_state (feature 100) — mirrors
   // feature 030's identical decision on its own per-account halt: cancellation is the
   // operator's sole remaining manual de-risk tool and must work even when trading is halted.
   ```

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go build ./...
grep -n "checkTradingStateForPlaceOrder\|checkTradingStateForReplace" internal/service/trading.go
# Confirm both are declared and each is called exactly once, from PlaceOrder and ReplaceOrder
# respectively, and CancelOrder has zero call sites.
GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 8 — test: `platform.trading_state` gate — pure helpers + fake-portfolio-client cases

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/service/trading_state_gate_test.go` — create

**Reviewers**: `xstockstrat-trading` owner — order execution correctness, broker API safety, fill
detection, paper-only dev invariant, position limit enforcement

**Codebase Evidence**:
- Package `service` fields are directly settable from an in-package test file (same pattern as
  `trading_helpers_test.go`/`trading_sync_test.go`, which call unexported package-level functions
  directly) — `&TradingService{portfolio: fakeClient}` is a valid struct literal within `package service`.
- `portfoliov1.PortfolioServiceClient` is an interface (confirmed: `s.portfolio` field type at
  `trading.go:69`, assigned `portfoliov1.NewPortfolioServiceClient(portfolioConn)` at `:123` — a
  generated gRPC client constructor returning the interface type); a fake struct embedding the zero
  interface value and overriding only `GetPosition` satisfies it at compile time (embedding
  delegates unimplemented methods to a nil receiver, which is never called in these tests).
- `config.Watcher`'s zero value (`&config.Watcher{}`) has a `nil` `snapshot` map; `GetString`
  (`config/config.go:142-150`) does `v, ok := w.snapshot[key]; if !ok { return def }` — reading a nil
  map is safe in Go and always misses, so a zero-value Watcher always returns the `GetString` call's
  default. This is used to prove `currentTradingState()`'s fail-closed-on-unset-key wiring without
  needing to inject a real snapshot (which `config.Watcher` has no exported setter for — confirmed via
  full read of `services/xstockstrat-trading/internal/config/config.go`).
- **Coverage note**: `internal/service` matches the `/(cmd|handler|repository|telemetry|service)(/|$)`
  exclusion regex in `reference/spec-template.md`'s Go coverage command — this test step is required
  by **C-08** regardless; no coverage percentage applies, `go test ./... -race` passing is the bar.

**TDD**: `red-green required` (paired with Step 7 — must fail to compile against the pre-Step-7 tree,
since `parseTradingState`/`isExposureIncreasing`/`isReplaceRiskReducing`/`checkTradingStateForPlaceOrder`
do not exist yet)

**Instructions**:
Create `services/xstockstrat-trading/internal/service/trading_state_gate_test.go` (package `service`):
```go
package service

import (
    "context"
    "testing"

    "google.golang.org/grpc"
    "google.golang.org/grpc/codes"
    grpcstatus "google.golang.org/grpc/status"

    commonv1 "github.com/xstockstrat/contracts/gen/go/common/v1"
    portfoliov1 "github.com/xstockstrat/contracts/gen/go/portfolio/v1"
    tradingv1 "github.com/xstockstrat/contracts/gen/go/trading/v1"
    "github.com/xstockstrat/trading/internal/config"
)

// ── parseTradingState ────────────────────────────────────────────────────
func TestParseTradingState(t *testing.T) {
    cases := map[string]tradingState{
        "ACTIVE":      tradingStateActive,
        "REDUCE_ONLY": tradingStateReduceOnly,
        "HALTED":      tradingStateHalted,
        "":            tradingStateHalted,
        "garbage":     tradingStateHalted,
        "active":      tradingStateHalted, // case-sensitive: lowercase is unrecognized
    }
    for raw, want := range cases {
        if got := parseTradingState(raw); got != want {
            t.Errorf("parseTradingState(%q) = %v, want %v", raw, got, want)
        }
    }
}

// ── isExposureIncreasing ─────────────────────────────────────────────────
func TestIsExposureIncreasing(t *testing.T) {
    buy, sell := tradingv1.OrderSide_ORDER_SIDE_BUY, tradingv1.OrderSide_ORDER_SIDE_SELL
    cases := []struct {
        side        tradingv1.OrderSide
        existingQty float64
        want        bool
    }{
        {buy, 0, true},    // flat -> BUY opens exposure
        {sell, 0, true},   // flat -> SELL opens exposure (short)
        {buy, 10, true},   // long -> BUY increases
        {sell, 10, false}, // long -> SELL reduces
        {sell, -10, true}, // short -> SELL increases
        {buy, -10, false}, // short -> BUY reduces (covers)
    }
    for _, c := range cases {
        if got := isExposureIncreasing(c.side, c.existingQty); got != c.want {
            t.Errorf("isExposureIncreasing(%v, %v) = %v, want %v", c.side, c.existingQty, got, c.want)
        }
    }
}

// ── isReplaceRiskReducing ────────────────────────────────────────────────
func TestIsReplaceRiskReducing(t *testing.T) {
    cases := []struct {
        currentQty, requestedQty float64
        want                     bool
    }{
        {100, 0, true},   // 0 = unchanged -> safe
        {100, 50, true},  // decreasing -> safe
        {100, 100, true}, // equal -> safe
        {100, 150, false}, // increasing -> blocked
    }
    for _, c := range cases {
        if got := isReplaceRiskReducing(c.currentQty, c.requestedQty); got != c.want {
            t.Errorf("isReplaceRiskReducing(%v, %v) = %v, want %v", c.currentQty, c.requestedQty, got, c.want)
        }
    }
}

// ── currentTradingState wiring: default fail-closed on an unset key ─────
func TestCurrentTradingState_UnsetKey_FailsClosedToHalted(t *testing.T) {
    s := &TradingService{cfgW: &config.Watcher{}}
    if got := s.currentTradingState(); got != tradingStateHalted {
        t.Errorf("currentTradingState() with an unset key = %v, want tradingStateHalted", got)
    }
}

// ── checkTradingStateForPlaceOrder: HALTED blocks without calling portfolio ─
type fakePortfolioClient struct {
    portfoliov1.PortfolioServiceClient
    getPositionFn func(ctx context.Context, req *portfoliov1.GetPositionRequest) (*portfoliov1.Position, error)
    called        bool
}

func (f *fakePortfolioClient) GetPosition(ctx context.Context, req *portfoliov1.GetPositionRequest, opts ...grpc.CallOption) (*portfoliov1.Position, error) {
    f.called = true
    return f.getPositionFn(ctx, req)
}

func TestCheckTradingStateForPlaceOrder_Active_NeverCallsPortfolio(t *testing.T) {
    fake := &fakePortfolioClient{getPositionFn: func(context.Context, *portfoliov1.GetPositionRequest) (*portfoliov1.Position, error) {
        t.Fatal("GetPosition must not be called when ACTIVE")
        return nil, nil
    }}
    s := &TradingService{cfgW: &config.Watcher{}, portfolio: fake}
    // ACTIVE requires a snapshot; use REDUCE_ONLY/HALTED default-proof cases below instead —
    // this case exercises the ACTIVE branch by constructing tradingState directly via a thin
    // wrapper if the zero-Watcher can't yield ACTIVE (it always yields HALTED by default).
    // Exercise the pure switch directly instead:
    if err := (&TradingService{cfgW: &config.Watcher{}, portfolio: fake}).checkTradingStateForPlaceOrder(
        context.Background(), "u1", "AAPL", commonv1.TradingMode_TRADING_MODE_PAPER, tradingv1.OrderSide_ORDER_SIDE_BUY,
    ); err == nil {
        t.Fatal("expected HALTED (the zero-Watcher default) to block")
    } else if grpcstatus.Code(err) != codes.FailedPrecondition {
        t.Errorf("got code %v, want FailedPrecondition", grpcstatus.Code(err))
    }
    if fake.called {
        t.Error("GetPosition must not be called when the state resolves to HALTED")
    }
    _ = s
}

func TestCheckTradingStateForReplace_HaltedBlocksWithoutTouchingPortfolio(t *testing.T) {
    order := &tradingv1.Order{OrderId: "o1", Qty: 100}
    req := &tradingv1.ReplaceOrderRequest{OrderId: "o1", Qty: 50}
    s := &TradingService{cfgW: &config.Watcher{}} // zero-Watcher -> HALTED default
    err := s.checkTradingStateForReplace(order, req)
    if err == nil {
        t.Fatal("expected HALTED (the zero-Watcher default) to block a replace")
    }
    if grpcstatus.Code(err) != codes.FailedPrecondition {
        t.Errorf("got code %v, want FailedPrecondition", grpcstatus.Code(err))
    }
}
```
Note for the execute-time author: `TestCheckTradingStateForPlaceOrder_Active_NeverCallsPortfolio`'s
name is aspirational but the zero-value `config.Watcher` cannot be made to yield `ACTIVE` (it has no
exported snapshot setter — confirmed above), so this case necessarily exercises the HALTED default
path, not a true ACTIVE case. Rename it at execute time to
`TestCheckTradingStateForPlaceOrder_DefaultHalted_NeverCallsPortfolio` and delete the dead
first-half `fake`/comment block, keeping only the second `checkTradingStateForPlaceOrder` call and
its assertions — this is a spec-authoring artifact to clean up, not a design ambiguity (per **F-09**,
record this cleanup in the Deviation Log rather than treating it as a scope change). Add one more
case directly exercising the REDUCE_ONLY branch by calling
`(&TradingService{portfolio: fake}).checkTradingStateForPlaceOrder(...)` is not possible without a
real `ACTIVE`/`REDUCE_ONLY` snapshot; instead, test the REDUCE_ONLY exposure logic through
`isExposureIncreasing` (already covered above) plus a **direct call** to the REDUCE_ONLY branch's
body by temporarily factoring the GetPosition-calling logic into a lower-level exported-for-test
function if execute finds the switch-based structure impractical to unit test in isolation — prefer
this over skipping REDUCE_ONLY coverage; note the final shape in the Deviation Log.

**Verification**:
```bash
cd services/xstockstrat-trading && GOWORK=off go test ./internal/service/... -race -count=1 -v -run 'TestParseTradingState|TestIsExposureIncreasing|TestIsReplaceRiskReducing|TestCurrentTradingState|TestCheckTradingStateFor'
# All cases pass. internal/service is excluded from the CI coverage-threshold measurement
# (COVERPKGS regex), so no percentage gate applies — a clean `go test` run is the bar.
GOWORK=off golangci-lint run --modules-download-mode=mod
```

---

### Step 9 — service: reason-capture `<Input>` in the `/config-ui` namespace editor (C-14 consumer surface)

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/config-ui/[namespace]/page.tsx` — modify

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, Connect-RPC call safety

**Codebase Evidence**:
- Hardcoded reason confirmed at `page.tsx:88`: `reason: 'Updated via config-ui'` — the exact gap
  design.md's Chosen Approach names as "the only actual gap" for AC-4 (actor/reason/timestamp), since
  `SetConfigRequest.reason` (`packages/proto/config/v1/config.proto:93`) and `config.config_audit`'s
  `reason` column (`001_config_tables.up.sql:33`) already exist end-to-end.
- `handleSave` (`page.tsx:73-94`) and the edit-mode `<Input>` (`page.tsx:134-152`, using
  `editValue`/`setEditValue`) are the exact places to add a parallel `editReason`/`setEditReason`
  state and a second `<Input>`, following the existing float-map per-key special case
  (`meta?.validation?.valueType === 1` at `page.tsx:75`) as the precedent for a key-specific branch
  inside `handleSave`.
- The "Edit" button (`page.tsx:162-171`) already seeds `editValue` on click
  (`setEditValue(k.defaultValue)`) — the same click handler is where `editReason` must reset to `''`.
- No consumer-surface gap: this **is** the named UI surface from product-spec.md's
  `## Consumer Surface(s)` (`[x] UI`) — the existing `/config-ui` segment's editor, not a new page.

**TDD**: `red-green required`

**Instructions**:
1. Add `const [editReason, setEditReason] = useState('');` alongside the existing `editingKey`/`editValue`/`validationError` state declarations (`page.tsx:55-57`).
2. In `handleSave` (`page.tsx:73-94`), after the existing float-map validation block and before `setConfigMutate(...)`, add a required-reason check scoped to `platform.trading_state`:
   ```ts
   if (key === 'platform.trading_state' && !editReason.trim()) {
     setValidationError('A reason is required when changing platform.trading_state');
     return; // no SetConfig call when a required reason is missing
   }
   ```
   Then change the `reason` field in the `setConfigMutate` call from the hardcoded literal to:
   ```ts
   reason: editReason.trim() || 'Updated via config-ui',
   ```
   and reset `editReason` in the existing `onSuccess` callback (`page.tsx:92`): `setEditingKey(null); setValidationError(null); setEditReason('');`.
3. In the "Edit" button's `onClick` (`page.tsx:166`), reset the reason field alongside the value: `onClick={() => { setEditingKey(k.key); setEditValue(k.defaultValue); setEditReason(''); }}`.
4. In the edit-mode cell (`page.tsx:134-152`), add a second `<Input>` immediately after the existing value `<Input>` (inside the same `editingKey === k.key ? (<>...)` branch), bound to `editReason`/`setEditReason`, with a `placeholder="Reason for this change"` — reuse the same `Input` component already imported (`page.tsx:9`), no new import needed.
5. Do not touch `validateFloatMap`, `envToProto`/`modeToProto`, or the read-only display branch — this is additive only.

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm run lint
grep -n "editReason" src/app/config-ui/\[namespace\]/page.tsx
# Confirm editReason is declared, reset on Edit-click and onSuccess, required for
# platform.trading_state, and forwarded as the mutation's reason (with the existing
# hardcoded fallback preserved for every other key).
```

---

### Step 10 — test: reason-capture e2e — generic forwarding + required-for-`platform.trading_state`

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify (add a `platform.trading_state` fixture entry)
- `services/xstockstrat-ui/e2e/config-ui/reason-capture.spec.ts` — create

**Reviewers**: `xstockstrat-ui` owner — config mutation safety, Connect-RPC call safety

**Codebase Evidence**:
- `listKeys()` mock (`e2e/mock-backend.ts:792-833`) returns a fixed key array regardless of the
  requested namespace — the pattern this repo's existing config-ui e2e specs already rely on
  (`namespace-nav.spec.ts` navigates to different namespace URLs against the same fixed mock list).
- `waitForRequest`/`postData()` assertion pattern: direct precedent at
  `e2e/config-ui/sources.spec.ts:193-208` ("editing a source without a new secret sends a mask...") —
  intercepts the outbound `POST` and asserts on its body, the exact mechanism needed here to confirm
  the typed reason (not the hardcoded literal) is what's sent.
- `BASE_URL` + `addAuthCookie`/`addAdminCookie` imports: `e2e/helpers/auth.ts:21,61` — same helpers
  `api-smoke.spec.ts` and `sources.spec.ts` already use; `SetConfig` requires an admin cookie
  (`api-smoke.spec.ts:141-143`, "config writes require the ADMIN scope bit").
- **No existing e2e test exercises the actual Edit/Save click flow on the generic namespace
  editor** — confirmed via `grep -n "Edit\|Save" e2e/config-ui/*.spec.ts`: the only Edit/Save hits are
  in `sources.spec.ts`, which is a *different* page (`/config-ui/sources`, the signal-sources UI).
  This is a genuinely new test, not a modification of an existing one.

**TDD**: `red-green required` (paired with Step 9 — must fail against the pre-Step-9 tree, since
`editReason` does not exist and the reason sent is always the hardcoded literal)

**Instructions**:
1. In `services/xstockstrat-ui/e2e/mock-backend.ts`, inside the config-ui `listKeys()` handler's returned `keys` array (`mock-backend.ts:794-831`), add one more entry alongside the existing `platform.log_level`/`platform.maintenance_mode` fixtures:
   ```ts
   {
     key: 'platform.trading_state',
     description: 'Richer halt state: ACTIVE | REDUCE_ONLY | HALTED',
     defaultValue: 'ACTIVE',
     isSecret: false,
     consumingService: 'xstockstrat-trading',
     environment: 1,
     tradingMode: 1,
   },
   ```
2. Create `services/xstockstrat-ui/e2e/config-ui/reason-capture.spec.ts`:
   ```ts
   import { test, expect } from '@playwright/test';
   import { addAdminCookie, BASE_URL } from '../helpers/auth';

   const PLATFORM_NAMESPACE_PAGE = `${BASE_URL}/config-ui/platform?env=dev&mode=paper`;

   test.describe('Feature 100 — config-ui reason capture', () => {
     test('a typed reason for platform.log_level is forwarded instead of the hardcoded default', async ({ page }) => {
       await addAdminCookie(page);
       await page.goto(PLATFORM_NAMESPACE_PAGE);
       await page.getByText('platform.log_level').waitFor();

       const row = page.locator('tr', { hasText: 'platform.log_level' });
       await row.getByRole('button', { name: 'Edit' }).click();
       await row.getByPlaceholder('Reason for this change').fill('routine debug toggle — TICKET-999');

       const reqPromise = page.waitForRequest(
         (r) => r.url().includes('/SetConfig') && r.method() === 'POST',
       );
       await row.getByRole('button', { name: 'Save' }).click();
       const body = (await reqPromise).postData() ?? '';
       expect(body).toContain('routine debug toggle');
       expect(body).not.toContain('Updated via config-ui');
     });

     test('an empty reason falls back to the default literal for a non-required key', async ({ page }) => {
       await addAdminCookie(page);
       await page.goto(PLATFORM_NAMESPACE_PAGE);
       await page.getByText('platform.log_level').waitFor();

       const row = page.locator('tr', { hasText: 'platform.log_level' });
       await row.getByRole('button', { name: 'Edit' }).click();
       // Leave the reason field blank.

       const reqPromise = page.waitForRequest(
         (r) => r.url().includes('/SetConfig') && r.method() === 'POST',
       );
       await row.getByRole('button', { name: 'Save' }).click();
       const body = (await reqPromise).postData() ?? '';
       expect(body).toContain('Updated via config-ui');
     });

     test('platform.trading_state requires a non-empty reason before Save is allowed to call SetConfig', async ({ page }) => {
       await addAdminCookie(page);
       await page.goto(PLATFORM_NAMESPACE_PAGE);
       await page.getByText('platform.trading_state').waitFor();

       const row = page.locator('tr', { hasText: 'platform.trading_state' });
       await row.getByRole('button', { name: 'Edit' }).click();
       // Leave the reason field blank.

       let sawSetConfig = false;
       page.on('request', (r) => {
         if (r.url().includes('/SetConfig')) sawSetConfig = true;
       });
       await row.getByRole('button', { name: 'Save' }).click();
       await expect(page.getByText('A reason is required when changing platform.trading_state')).toBeVisible();
       expect(sawSetConfig).toBe(false);
     });
   });
   ```

**Verification**:
```bash
cd services/xstockstrat-ui && pnpm test:e2e -- e2e/config-ui/reason-capture.spec.ts
# All 3 cases pass. No coverage threshold applies to xstockstrat-ui per
# reference/spec-template.md — existing E2E coverage is the bar.
```

---

### Step 11 — docs: `xstockstrat-trading` CLAUDE.md — document `platform.trading_state`

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Existing Config Keys Consumed table row for `platform.maintenance_mode` (already read above):
  `| platform.maintenance_mode | bool | false | Platform-wide halt (the real halt key; there is no trading.maintenance_mode) |`
  — the new row follows immediately below it, same table, same format.
- Root `CLAUDE.md` § Config Governance Rules rule 7: "Default values must be declared in each
  service's CLAUDE.md under 'Config Keys'" — the binding rule this step satisfies.

**TDD**: `N/A (docs-only)`

**Instructions**:
In `services/xstockstrat-trading/CLAUDE.md`'s Config Keys Consumed table, add a new row immediately
after the `platform.maintenance_mode` row:
```markdown
| `platform.trading_state` | string | `ACTIVE` | Richer halt state (`ACTIVE`/`REDUCE_ONLY`/`HALTED`), independent of `platform.maintenance_mode`. `HALTED` blocks `PlaceOrder`/`ReplaceOrder`; `REDUCE_ONLY` blocks only exposure-increasing orders (verified via `PortfolioService.GetPosition` for `PlaceOrder`, a local qty comparison for `ReplaceOrder`). `CancelOrder` is deliberately ungated. Unrecognized/unset values fail closed to `HALTED`. Seeded per `trading_mode` (feature 100). |
```

**Verification**:
```bash
grep -n "platform.trading_state" services/xstockstrat-trading/CLAUDE.md
```

---

### Step 12 — docs: `docs/patterns/config-governance.md` — global key table + Per-Feature Registered Keys log

**Status**: `done`
**Service**: `docs/`
**Files**:
- `docs/patterns/config-governance.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- Global Config Keys table (`config-governance.md:16-26`) already lists `platform.maintenance_mode`
  — the new key is a sibling `platform.*` global key, same table, per root `CLAUDE.md` C-05.
- Per-Feature Registered Keys log (`config-governance.md:35-`): append-only, newest-first, one entry
  per feature that registered new keys — this feature's entry follows the exact format of the
  existing `feature 097`/`feature 083`/etc. entries (table with Key/Type/Default/Description columns).

**TDD**: `N/A (docs-only)`

**Instructions**:
1. In the Global Config Keys table (`config-governance.md:16-26`), add a row after `platform.maintenance_mode`:
   ```markdown
   | `platform.trading_state` | string | ACTIVE | Richer halt state (`ACTIVE`/`REDUCE_ONLY`/`HALTED`), independent of `platform.maintenance_mode`; seeded per `trading_mode` |
   ```
2. In the Per-Feature Registered Keys log, add a new entry **at the top** (newest first, per the file's own ordering convention — confirm this against the actual existing entries' date order at execute time, since this planning session read the file in an order that may not exactly match "newest first" placement; insert wherever the file's own convention dictates):
   ```markdown
   ### feature 100 — account-trading-halt-and-kill-switch (`xstockstrat-trading`, `xstockstrat-config`)

   A new parallel config key, independent of the existing `platform.maintenance_mode` boolean
   (which stays untouched — widening it in place was rejected as a confirmed fail-open bug on a
   proto oneof type mismatch). Seeded per `trading_mode` (paper/live independently), not `all`, so
   an operator can halt live trading during an incident while paper testing continues unaffected.

   | Key | Type | Default | Description |
   |---|---|---|---|
   | `platform.trading_state` | string | `ACTIVE` | `ACTIVE` \| `REDUCE_ONLY` \| `HALTED`. Enforced in `xstockstrat-trading`'s `PlaceOrder`/`ReplaceOrder`; `CancelOrder` deliberately ungated. Write-time validated to the three literals in `xstockstrat-config`'s `SetConfig`. |
   ```

**Verification**:
```bash
grep -n "platform.trading_state" docs/patterns/config-governance.md
```

---

### Step 13 — docs: correct product-spec.md's approval-gate checkbox (design.md Open Risk)

**Status**: `done`
**Service**: `docs/`
**Files**:
- `docs/roadmap/features/100-account-trading-halt-and-kill-switch/product-spec.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- product-spec.md's `## Feature Workflow Notes` (already read above) currently reads:
  `- [x] 1 service owner approval (non-breaking proto or config change) — sufficient if /sdd-design picks the "extend existing key" path; re-verify against root CLAUDE.md § Approval Flow's "New config key: owner + config team" rule if /sdd-design instead picks the parallel-key (platform.trading_state) path`
  — design.md § Chosen Approach confirms the parallel-key path (`platform.trading_state`) was
  chosen, which is exactly the branch this checkbox's own conditional flags as needing re-verification.
- Root `CLAUDE.md` § Approval Flow: "New config key: owner + config team" — the binding rule this
  step reconciles the checkbox against.
- design.md § Open Risks: "Product-spec's approval-gate checkbox must be flipped from '1 service
  owner approval' to 'service owner + config team,' per root CLAUDE.md § Approval Flow's 'New config
  key' rule — the parallel-key path was chosen, and product-spec's own conditional already
  anticipated this re-check."

**TDD**: `N/A (docs-only)`

**Instructions**:
In `docs/roadmap/features/100-account-trading-halt-and-kill-switch/product-spec.md`'s
`## Feature Workflow Notes` section, replace the checkbox line to resolve its own conditional now
that the parallel-key path is confirmed:
```markdown
- [x] Service owner + config team approval (new config key `platform.trading_state`, non-breaking) —
  per root `CLAUDE.md` § Approval Flow's "New config key: owner + config team" rule. The
  parallel-key path was chosen at `/sdd-design` (see `design.md` § Chosen Approach); the original
  "1 service owner" checkbox above was conditional on the now-rejected "extend existing key" path
  and has been superseded by this line.
```
Leave the original checkbox line in place below it (struck through or annotated "superseded"), rather
than deleting it, so the spec's own decision history stays legible — this document is not subject to
F-09's step-body immutability (that applies only to `implementation-spec.md`).

**Verification**:
```bash
grep -n "config team" docs/roadmap/features/100-account-trading-halt-and-kill-switch/product-spec.md
```

---

## Deviation Log

_Populated by /sdd-execute as implementation proceeds._
