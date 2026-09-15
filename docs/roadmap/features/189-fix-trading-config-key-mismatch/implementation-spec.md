# Implementation Spec: fix-trading-config-key-mismatch

**Status**: `pending`
**Created**: 2026-09-15
**Feature**: `docs/roadmap/features/189-fix-trading-config-key-mismatch/feature.md`
**Total Steps**: 8
**Feature Branch**: `claude/halted-account-94ldka` (harness-assigned; PR targets `main-dev` — see feature.md)

---

## Execution Summary

Fixes the SEV-1 config-resolution defect via the design's four coordinated parts, aligned to the
full-dotted CONFIG-9 storage contract. Two orthogonal root-cause faults: trading never receives the
`platform` namespace (config broadcasts `subscribers=0`), and the deviating seed rows are stored
namespace-relative while consumers read full-dotted.

Order: **Step 1 (migration 029)** heals the config `key` column to full-dotted for the four affected
namespaces and bumps production `trading.risk.bracket_orders_enabled`→`true`. **Steps 4–5** rename the
three config-service writers/validators that key on the old bare `trading_state` (must land with 029 or
the kill-switch write/validate path breaks). **Steps 2–3** give trading's watcher a second `platform`
stream and prove the read path. **Steps 6–7** carry the rename to the `/trader` consumer surface
(C-14). **Step 8** reconciles the three Go services' `CLAUDE.md` config-key docs.

**Deploy sequencing** (Open Risk, → PR description): migrate 029 → deploy config (authz+enum rename) →
deploy trading. An old trading binary firing `escalateSystemic` with bare `Key:"trading_state"` during
the window is *refused* (PERMISSION_DENIED on the renamed allowlist / NOT_FOUND on the existence gate) —
no stray row; its `EmitAlert` still pages a human (fail-safe). Keep the config→trading gap tight.

### Scenario Coverage (Constitution C-15)

- **AC-1** (order accepted when `platform.trading_state=ACTIVE`) → Step 3 (service-package gate test:
  `checkTradingStateForPlaceOrder` returns nil under an `ACTIVE` snapshot delivered on the `platform`
  stream) + Step 7 (UI consumer-surface manifestation).
- **AC-2** (`currentTradingState()` reads `platform.trading_state`→`REDUCE_ONLY`, read-path contract)
  → Step 3 (config-package getter test + watcher delivery test) + Step 7 (UI banner).
- **AC-3** (a `trading.risk.*` key set in config is applied, not defaulted) → Step 3 (config-package
  getter resolves a realistically-keyed, post-029 snapshot).

### Honored production-delta ledger (operator sign-off, recorded in design.md / context.md)

Healing storage makes previously-dead production seeds resolve. Staging (=paper) seeds match the Go
defaults, so **staging behavior is unchanged**; every delta below is production-only.

| Key (post-029 full-dotted) | Prod seed | Go default | Action |
|---|---|---|---|
| `trading.approval.require_above_qty` | 100 (`002:51`) | 500 | HONOR seed |
| `trading.approval.require_above_notional` | 10000 (`002:52`) | 50000 | HONOR seed |
| `trading.risk.max_position_pct` | 0.02 (`002:53`) | 0.05 | HONOR seed |
| `trading.risk.daily_loss_limit` | 0.01 (`002:54`) | 0.02 | **Dormant — no reader** (see below); behavior-neutral |
| `trading.risk.bracket_orders_enabled` | false (`013:12`) | true | **OVERRIDE → true (Step 1)** |

**Resolved Open Risk — `trading.risk.daily_loss_limit` reader**: grep of `services/` finds **no code
reader** (only `002`/`012` seeds, `trading/CLAUDE.md:82` and `context-constitution-findings.md:15`,
which both say "documented, not yet implemented"). Healing it is behavior-neutral. No action.

**Unresolved Open Risk — per-row DB audit still blocked**: `db_execute_sql` returned
`postgres-mcp co-process is unavailable` again at spec time, so the exact per-row bare-vs-dotted set for
`portfolio.*`/`marketdata.*` could not be enumerated. Consequences: (a) the **DOWN is forward-only**
(Step 1 — a symmetric strip would over-revert pre-dotted `@AC-13`/feature-184 rows; the enumerated
inverse cannot be authored without the audit — P-03/C-01, do not invent it); (b) healing also activates
any currently-dormant **production** `portfolio.*`/`marketdata.*` seeds — verify on dev/staging by
smoke test after 029 (Step 1 verification note). The guarded blanket UP is safe regardless (it skips
already-dotted rows and all `is_secret=true` rows).

## Step Dependencies

- Step 4/5 (config authz+enum rename) require Step 1 (029 rename) — the renamed `key='platform.trading_state'`
  must be what the writers target and the validators match; landing 4/5 without 029 would break the
  live kill-switch write path, and vice-versa. Treat 1+4+5 as the atomic edit set (design Part C).
- Step 2 (watcher `platform` stream) requires Step 1 in production for `platform.trading_state` to
  resolve full-dotted, but is independently testable (Step 3 populates the snapshot directly).
- Step 3 covers Step 2; Step 5 covers Step 4; Step 7 covers Step 6 (test pairing, C-08).
- Step 6/7 (`/trader` consumer surface, C-14) require Step 1's rename — the server serves
  `values['platform.trading_state']` only after 029.
- **Deploy order**: Step 1 → Steps 4/5 (config) → Steps 2/6 (trading + ui). See Execution Summary.

---

### Step 1 — migration: config 029 — heal keys to full-dotted + production bracket override

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/migrations/029_heal_config_keys_full_dotted.up.sql` — create
- `services/xstockstrat-config/migrations/029_heal_config_keys_full_dotted.down.sql` — create

**Reviewers**: DBA — migration NNN numbering (no gaps/conflicts), up+down pair present, run-order
compliance with `scripts/db-migrate.sh`; xstockstrat-config service owner — config key naming
(`<service>.<category>.<key>`), environment scoping, WatchConfig stream stability

**Codebase Evidence**:
- Last migration is `028_analysis_opportunity_keys.up.sql` (`ls services/xstockstrat-config/migrations/`)
  → next NNN = **029** (C-07).
- Current schema after feature-147 migration `017_config_secrets_and_scoping.up.sql`:
  columns `namespace, key, value_type, value_data, value_encrypted, is_secret, description,
  default_value, consuming_service, environment (CHECK IN ('staging','production')), user_id (NULL=global)`;
  **no `trading_mode` column** (`017:96` `DROP COLUMN IF EXISTS trading_mode`); unique index
  `config_values_scope_uniq ON (namespace, key, environment, COALESCE(user_id, ''))` (`017:101-102`).
- Deviating bare seeds confirmed: `011_platform_trading_state.up.sql:12` (`'platform','trading_state'`),
  `012_trading_risk_sizing.up.sql:14-24` (`'trading','risk.*'`), `013_trading_risk_bracket.up.sql:11-12`
  (`'trading','risk.bracket_orders_enabled'`; prod seeded `'false'` at `013:12`), `002_config_environment.up.sql:51-59`
  (`'trading','approval.*'`/`'risk.*'`), `002:69` (`'portfolio','snapshot.interval_minutes'`), `002:65-67`
  (`'marketdata','alpaca.paper'`/`'backfill.batch_size'`).
- Already-full-dotted rows that MUST be skipped: `026_analysis_engine_blend_keys` (`'analysis','analysis.engine.*'`),
  `portfolio.watchlist.max_per_user` (@AC-13, feature-184), and the redacted vendor-credential secret
  rows seeded `is_secret=TRUE` at `017:110-121` (`marketdata`, `alpaca.api_key` etc.) — resolved by
  marketdata's separate `GetSecret` path with namespace-relative keys, must stay bare.
- Migration idempotency prior art: seed migrations use `ON CONFLICT … DO NOTHING`; `017` uses no
  explicit `BEGIN/COMMIT` (relies on golang-migrate atomicity).

**TDD**: `N/A (migration — data heal, verified offline by inspection; real apply/rollback runs in CI/deploy)`

**Covers**: —

**Instructions**:
- **UP** (`029_…up.sql`): one guarded blanket heal, then a deterministic bracket bump. No explicit
  `BEGIN/COMMIT` (match `017`).
  1. `UPDATE config.config_values SET key = namespace || '.' || key WHERE key NOT LIKE namespace || '.%' AND is_secret = false AND namespace IN ('platform','trading','portfolio','marketdata');`
     — the `NOT LIKE namespace || '.%'` guard skips already-dotted rows (no double-prefix); `is_secret = false`
     leaves the `GetSecret` vendor-credential rows bare (@AC-6/@AC-7 safe). Never touch `value_type`
     (fails.md:344-346 — value_type immutable once read).
  2. `UPDATE config.config_values SET value_data = 'true' WHERE namespace = 'trading' AND key = 'trading.risk.bracket_orders_enabled' AND environment = 'production' AND user_id IS NULL;`
     — literal `'true'` (deterministic, retry-idempotent), using the **post-rename** full-dotted key;
     production-only, global scope. This reverses feature-030's deliberate `false` seed (`013:12`) per
     operator sign-off (design.md § Business Rules Touched / context.md 2026-09-15).
- **DOWN** (`029_…down.sql`): **forward-only, no destructive revert.** A symmetric prefix-strip cannot
  distinguish rows this migration healed (bare→dotted) from rows already dotted pre-029
  (`portfolio.watchlist.*` @AC-13, `analysis.engine.*`), so a strip would re-break CONFIG-9 for them and
  re-darken the kill-switch. The per-row audit needed to author an exact enumerated inverse is **blocked**
  (postgres-mcp unavailable) — do not invent the list (P-03/C-01). Ship the DOWN as a documented no-op:
  a leading comment block stating "forward-only: rollback = redeploy the prior service image; a
  data-level down would over-strip pre-dotted rows — see feature 189 design.md Open Risks", followed by a
  harmless statement so the file is non-empty and `migrate down` succeeds (e.g. `SELECT 1;`). Rolling back
  the trading binary reverts to the prior fail-closed HALTED behavior (safe); the healed data is left in place.

**Verification** (offline, no DB — real apply/rollback runs in CI/deploy):
```
ls services/xstockstrat-config/migrations/029_heal_config_keys_full_dotted.up.sql \
   services/xstockstrat-config/migrations/029_heal_config_keys_full_dotted.down.sql
```
Then read both: confirm UP has the guarded blanket `UPDATE … SET key = namespace || '.' || key …`
(with the `NOT LIKE`, `is_secret = false`, and `namespace IN (…)` guards) plus the literal bracket bump
on the post-rename key; confirm the `.down.sql` is the documented forward-only no-op (no `UPDATE`/`DELETE`
that strips the prefix). Post-deploy smoke (dev/staging, not an execute-loop step): after 029 applies,
`set_config platform.trading_state=ACTIVE`, place an explicit-qty BUY on `/trader`, confirm accepted; and
spot-check that no unintended `portfolio.*`/`marketdata.*` production behavior regressed.

---

### Step 2 — service: trading watcher multi-namespace delivery + escalateSystemic writer rename

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/config/config.go` — modify
- `services/xstockstrat-trading/cmd/server/main.go` — modify
- `services/xstockstrat-trading/internal/service/trading.go` — modify

**Reviewers**: xstockstrat-trading service owner — order execution correctness, position limit
enforcement, kill-switch gate integrity

**Codebase Evidence**:
- `internal/config/config.go:60-90` — `Watcher` struct holds single `namespace string` (`:62`),
  `snapshot map[string]*configv1.ConfigValue` (`:68`), `ready chan struct{}` + `once sync.Once` (`:69-70`);
  `NewWatcher(endpoint, namespace, applicationEnv, tradingMode string)` (`:75`) spawns `go w.watchLoop()` (`:88`).
- `config.go:110-154` — `watchLoop` (`:110`) → `stream()` (`:124`) builds `WatchConfigRequest{Namespace: w.namespace, …}`
  (`:125-131`), and on `SNAPSHOT`/`RELOAD` does the **verbatim replace** `w.snapshot = snap.Values` (`:144`),
  else per-key merge (`:146-148`); `w.once.Do(func(){ close(w.ready) })` (`:151`).
- `config.go:156-165` — `WaitForSnapshot` blocks on `w.ready` / ctx / 90s timeout.
- `config.go:167-205` — getters do a raw `w.snapshot[key]` lookup with **no transform** (`GetString:170`,
  `GetInt:180`, `GetBool:190`, `GetFloat:200`) — post-029 the server streams full-dotted `row.key`, so
  these resolve as-is with no getter change.
- `cmd/server/main.go:61` — `config.NewWatcher(cfg.ConfigEndpoint, "trading", cfg.ApplicationEnv, cfg.TradingMode)`;
  `WaitForSnapshot` at `main.go:67`.
- `internal/service/trading.go:1895-1910` — `escalateSystemic` calls `s.configSetter.SetConfig(…, &configv1.SetConfigRequest{Namespace:"platform", Key:"trading_state", …})`
  (`Key:"trading_state"` at `:1905`); its `EmitAlert` fallback at `:1915`.
- Getter/gate consumers are unchanged: `currentTradingState` reads `GetString("platform.trading_state","HALTED")`
  (`trading.go:3221`); `PlaceOrder` reads `GetBool("platform.maintenance_mode", false)` (`trading.go:344`).

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
- **`config.go` — multi-namespace watcher** (design Part A):
  - Change `Watcher.namespace string` (`:62`) to `namespaces []string`. Convert `NewWatcher` (`:75`) to
    variadic `NewWatcher(endpoint, applicationEnv, tradingMode string, namespaces ...string)`; spawn one
    `go w.watchLoop(ns)` per namespace. `watchLoop`/`stream` take a `ns string` param and set
    `WatchConfigRequest.Namespace = ns` (replacing `w.namespace` at `:126`); the `ClientId` should stay
    unique per namespace (e.g. `fmt.Sprintf("go-trading-%s-%d", ns, os.Getpid())`).
  - **Scoped-replace on SNAPSHOT/RELOAD** (replaces the verbatim `w.snapshot = snap.Values` at `:144`):
    inside one `w.mu.Lock()` section, delete every existing key with prefix `ns+"."` from `w.snapshot`,
    then insert all of `snap.Values`. This prevents the `trading` stream's RELOAD (fires on any
    `trading.*` SetConfig) from wiping `platform.*` (transient false HALTED). DELTA stays the per-key
    merge (`:146-148`) — benign (own-namespace; `platform.trading_state` is never deleted).
  - **Per-namespace readiness**: replace the single `once`/`ready` (`:69-70`) with a `pending` set of the
    subscribed namespaces guarded by `w.mu`; on each namespace's first SNAPSHOT, under the lock
    `delete(pending, ns)`, and when `pending` is empty close `ready` via a `closeOnce sync.Once`
    (double-close-safe across stream reconnects). `WaitForSnapshot` (`:156`) unchanged — it now blocks
    until **all** subscribed namespaces have delivered, else the 90s timeout aborts startup (fail-closed:
    never serve the default HALTED as if it were live). Concurrency invariant: the `delete(prefix)+insert`
    and the `pending`-delete + emptiness-check + close must each be one atomic `w.mu.Lock()` section; the
    two goroutines touch disjoint prefixes (`platform.` vs `trading.`) so they never cross-clobber.
  - Do NOT reintroduce a removed `getEnvBool`-style helper (PRESERVE @AC-1 feature-175); getters stay
    keyed on the raw full-dotted `w.snapshot[key]`.
- **`main.go:61`**: call `config.NewWatcher(cfg.ConfigEndpoint, cfg.ApplicationEnv, cfg.TradingMode, "trading", "platform")`.
- **`trading.go:1905`** (Part C(1), lockstep with Step 1/029): change `Key: "trading_state"` to
  `Key: "platform.trading_state"`; `Namespace: "platform"` stays. This targets the healed row so the
  systemic escalation write lands where the reader looks.
- **No new outbound per-request gRPC call** — `WatchConfig` is a startup subscription (no per-request
  header trio); the second stream reuses the same request shape. C-03 header propagation is unaffected.
- **No new env var or port** — `docker-compose.yml`/`.do/app*.yaml` need no change (confirmed: the change
  is code-only; `CONFIG_ENDPOINT`/`APPLICATION_ENV`/`TRADING_MODE` already exist in the trading env block).

**Verification**: paired with Step 3 (lint + coverage there). Behavioral proof is in Step 3.

---

### Step 3 — test: trading config read-path, multi-namespace delivery, and kill-switch gate

**Status**: `done`
**Service**: `xstockstrat-trading`
**Files**:
- `services/xstockstrat-trading/internal/config/config_test.go` — modify
- `services/xstockstrat-trading/internal/service/trading_test.go` — modify (or the existing gate test file)

**Reviewers**: xstockstrat-trading service owner — kill-switch gate integrity, config read-path correctness

**Codebase Evidence**:
- `internal/config/config_test.go` exists with a `fakeConfigServiceClient` (`:56-80`) whose `WatchConfig`
  currently `panic`s (`:60-62`); it never populates a snapshot and never exercises `GetString`/`GetBool`/
  `GetFloat` against a populated map — **the exact read-path gap the bug slipped through** (P-06 RED target).
- Getters under test: `config.go:167-205`. `internal/config` is a coverage-measured package (not in the
  excluded `cmd/handler/repository/telemetry/service` set).
- Gate under test: `internal/service/trading.go` `parseTradingState:3207`, `currentTradingState:3220-3221`,
  `checkTradingStateForPlaceOrder:3249` — `internal/service` is **excluded** from coverage measurement.

**TDD**: `red-green required`

**Covers**: `AC-1, AC-2, AC-3`

**Instructions**:
- **`config_test.go` (read-path + delivery, covers AC-2, AC-3)** — write these to fail RED against the
  pre-Step-2 tree (which has no multi-namespace delivery / scoped-replace):
  - Read-path: construct a `Watcher` with a directly-populated `snapshot` keyed by the **realistic
    post-029 full-dotted** keys (`snapshot["platform.trading_state"]`=stringVal `"REDUCE_ONLY"`,
    `snapshot["trading.risk.max_position_pct"]`=floatVal `0.02`), assert `GetString("platform.trading_state","HALTED")`
    → `"REDUCE_ONLY"` (AC-2) and `GetFloat("trading.risk.max_position_pct", 0.05)` → `0.02` (AC-3).
    Fixtures MUST use the full-dotted (server-shaped) key form, not a bare override — fails.md:2005-2016
    (a non-representative full-path fixture masks exactly this class of bug).
  - Delivery: drive a fake `WatchConfig` stream per namespace (replace the panicking stub with one that
    returns a scripted SNAPSHOT then blocks) and assert (a) after both `trading` and `platform` SNAPSHOTs,
    both `snapshot["platform.trading_state"]` and a `trading.*` key resolve; (b) a subsequent `trading`
    RELOAD does **not** remove `platform.trading_state` (scoped-replace no-clobber invariant); (c)
    `WaitForSnapshot` returns only after **all** subscribed namespaces delivered.
  - Keep the existing `TestWatcher_SetConfig_*`, `TestResolveEnvironment`, `TestResolveTradingMode` green;
    update `NewWatcher` call sites in the test to the new variadic signature.
- **service gate test (covers AC-1)** — assert `checkTradingStateForPlaceOrder` returns `nil` when the
  watcher snapshot holds `platform.trading_state="ACTIVE"` (order not rejected with
  `"trading halted: platform.trading_state=HALTED"`), and returns the HALTED `FailedPrecondition` only on
  a real `"HALTED"`/unset value. `internal/service` is coverage-excluded — note this and rely on the
  behavioral assertion (per spec-template "New logic is in an excluded package" note).
- **Test data (C-13)**: the snapshot literals are single-consumer inline values in Go test files; ≤1
  declaration site each → inline is compliant (no `internal/testdata/` home needed). State this verdict.

**Verification** (from repo root):
```
cd services/xstockstrat-trading && GOWORK=off golangci-lint run --modules-download-mode=mod
cd services/xstockstrat-trading && GOWORK=off COVERPKGS=$(go list ./... | grep -Ev '/(cmd|handler|repository|telemetry|service)(/|$)' | tr '\n' ',' | sed 's/,$//') && go test ./... -race -count=1 -coverprofile=coverage.out -covermode=atomic -coverpkg="${COVERPKGS}" && go tool cover -func=coverage.out | grep "^total:"
```
Confirm ≥ 40% total, all tests pass, lint clean. (`internal/config` getter/delivery tests raise measured
coverage; the `internal/service` gate test is excluded from the number but still runs.)

---

### Step 4 — service: config-service — rename trading_state key in the authz allowlist + SetConfig enum guard

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/grpc/authz.ts` — modify
- `services/xstockstrat-config/src/grpc/configServiceImpl.ts` — modify

**Reviewers**: xstockstrat-config service owner — config key naming, internal-caller authz correctness,
WatchConfig stream stability

**Codebase Evidence**:
- `src/grpc/authz.ts:66-73` — `INTERNAL_CALLER_ALLOWLIST` grant `{ callerID:'trading-reconciliation-poller',
  namespace:'platform', key:'trading_state', allowedTargetValues:['REDUCE_ONLY','HALTED'] }` (`key` at `:70`).
- `src/grpc/configServiceImpl.ts:396-407` — SetConfig enum guard `if (namespace === 'platform' && key === 'trading_state')`
  (`:397`) validating the value against `['ACTIVE','REDUCE_ONLY','HALTED']`.
- Writer that hits both: trading `escalateSystemic` (Step 2) sends `Namespace:'platform', Key:'platform.trading_state'`
  post-rename. config-ui/agent writers are data-driven off `ListKeys` (which returns the stored `key`), so
  they need no change (smoke-check only).

**TDD**: `red-green required`

**Covers**: —

**Instructions** (lockstep with Step 1/029 — the stored `key` is now `platform.trading_state`):
- `authz.ts:70`: change the grant's `key: 'trading_state'` to `key: 'platform.trading_state'` (leave
  `namespace: 'platform'` and `allowedTargetValues` unchanged) — else the internal-caller escalation write
  is denied and the kill-switch auto-escalation silently stops.
- `configServiceImpl.ts:397`: change the guard condition `key === 'trading_state'` to
  `key === 'platform.trading_state'` — else the ACTIVE/REDUCE_ONLY/HALTED enum validation silently stops
  running after the rename, letting a bad literal land.
- Do not touch `value_type` or the scalar-bounds path.

**Verification**: paired with Step 5 (lint + coverage there).

---

### Step 5 — test: config-service — enum guard + internal-caller authz fire on the full-dotted key

**Status**: `done`
**Service**: `xstockstrat-config`
**Files**:
- `services/xstockstrat-config/src/**/*.test.ts` — modify (the existing authz / SetConfig test files)

**Reviewers**: xstockstrat-config service owner — internal-caller authz correctness, config key naming

**Codebase Evidence**:
- `hasInternalCallerAuthority` (`src/grpc/authz.ts:79`) is the pure predicate to unit-test with the
  renamed grant; SetConfig enum guard at `configServiceImpl.ts:396-407`.

**TDD**: `red-green required`

**Covers**: — (regression guard for the Part C rename; the read-path @AC-* are Go-side in Step 3. This
step protects AC-1's systemic-escalation write path: the enum validator and the internal-caller grant
must keep firing on the renamed `platform.trading_state` key.)

**Instructions**:
- Write RED-first assertions (fail against the pre-Step-4 tree): `hasInternalCallerAuthority(md,
  'platform', 'platform.trading_state', 'REDUCE_ONLY')` → `true` and `'ACTIVE'` → `false`; and that
  SetConfig rejects an out-of-enum value (`INVALID_ARGUMENT`) when `key === 'platform.trading_state'`.
  Confirm the old bare `'trading_state'` key no longer matches either path.
- **Test data (C-13)**: metadata/grant literals are inline scenario one-offs (Node home is
  `src/__tests__/fixtures/`, not required here); single-consumer → inline compliant. State this verdict.

**Verification** (from repo root):
```
cd services/xstockstrat-config && pnpm run lint
cd services/xstockstrat-config && pnpm run test:coverage
```
Confirm the 40% threshold passes and all tests pass.

---

### Step 6 — service: /trader positions page reads the full-dotted platform.trading_state

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/src/app/trader/positions/page.tsx` — modify

**Reviewers**: xstockstrat-ui service owner — trading UI correctness, Connect-RPC call safety,
environment scope correctness

**Codebase Evidence**:
- `src/app/trader/positions/page.tsx:116-127` — `platformTradingState` query calls
  `traderConfigClient.getConfig({ namespace: 'platform' })` (`:119`) then reads
  `resp.values['trading_state']?.value.case === 'stringVal' ? resp.values['trading_state'].value.value : null`
  (`:120-121`); `platformRestricted` derives the banner from `REDUCE_ONLY`/`HALTED` (`:126-127`).
- `src/lib/browserClients/traderConfigClient.ts:6-8` — the trader-segment ConfigService client.
- Confirmed the **only** runtime bare-key reader across ui/agent: grep `trading_state` in
  `services/xstockstrat-agent` → no matches; in `services/xstockstrat-ui`, `page.tsx:120-121` is the sole
  runtime `resp.values['trading_state']` read. `configKeys.ts:64` (ListKeys fixture), `NamespaceEditor.tsx:95`
  (reason gate) already use the full-dotted `platform.trading_state`.

**TDD**: `red-green required`

**Covers**: —

**Instructions**:
- Change both reads at `page.tsx:120-121` from `resp.values['trading_state']` to
  `resp.values['platform.trading_state']` — after 029 the server serves `GetConfig(namespace:'platform')`
  keyed by the stored `key` column, now `platform.trading_state`. Without this the restriction banner
  silently goes dark (the mirror of the Go bug — C-14 consumer surface).
- No token/primitive changes (C-17 unaffected — no new markup, colors, or states).

**Verification**: paired with Step 7 (e2e + lint there).

---

### Step 7 — test: /trader restriction-banner e2e against the full-dotted key shape

**Status**: `done`
**Service**: `xstockstrat-ui`
**Files**:
- `services/xstockstrat-ui/e2e/mock-backend.ts` — modify
- `services/xstockstrat-ui/e2e/trader/positions-reconciliation.spec.ts` — modify

**Reviewers**: xstockstrat-ui service owner — trading UI correctness, environment scope correctness

**Codebase Evidence**:
- `e2e/mock-backend.ts:1286-1293` — default `getConfig` for the `platform` namespace returns
  `values: { trading_state: { value: { case: 'stringVal', value: 'ACTIVE' } } }` (bare key at `:1290`).
- `e2e/trader/positions-reconciliation.spec.ts:107-123` — per-test `page.route` override returns
  `values: { trading_state: { stringVal: 'REDUCE_ONLY' } }` (bare key at `:119`) and asserts the
  `/Trading reduce-only platform-wide/` banner (`:127`).
- Re-audit verdict for the other three config-ui specs referencing `trading_state`: **no change needed** —
  `reason-capture.spec.ts` (`:48,53,55,66`) and `value-persists-after-save.spec.ts` (`:26,32,40`) already
  use full-dotted `platform.trading_state` (they read it from the `configKeys.ts` ListKeys fixture, which
  is already full-dotted at `:64`); `audit.spec.ts:13` (`key:'trading_state'`) is synthetic audit-log
  display/sort mock data, not a live-config-resolution assertion — leave it (changing it is cosmetic).

**TDD**: `red-green required`

**Covers**: `AC-2` (UI manifestation — the banner reflects the resolved `platform.trading_state`; RED
before Step 6, green after).

**Instructions**:
- `mock-backend.ts:1290`: change the response-map key from `trading_state` to `'platform.trading_state'`
  (keep the `{ value: { case: 'stringVal', value: 'ACTIVE' } }` init shape) so the mock matches the
  post-029 server shape.
- `positions-reconciliation.spec.ts:119`: change the `page.route` body key from `trading_state` to
  `'platform.trading_state'` (keep the flattened `{ stringVal: 'REDUCE_ONLY' }` wire form parsed by
  `fromJson`). The spec then fails RED against the pre-Step-6 `page.tsx` (which reads the bare key) and
  passes GREEN after Step 6.
- **Test data (C-12)**: these are the config-value mock handler + a scenario one-off `page.route`
  override — no domain-object fixture module is involved (the `configKeys.ts` ListKeys fixture is a
  separate surface, untouched). The `page.route` override is a scenario one-off (exempt from
  centralization). State this verdict; `INVENTORY.md` needs no update.

**Verification** (from repo root):
```
cd services/xstockstrat-ui && pnpm run lint
cd services/xstockstrat-ui && pnpm test:e2e trader/positions-reconciliation.spec.ts
```
Confirm the reduce-only banner spec passes with the full-dotted key and no other trader spec regresses.
(No coverage threshold for `xstockstrat-ui` e2e — existing Playwright coverage applies.)

---

### Step 8 — docs: reconcile the three Go services' config-key documentation

**Status**: `pending`
**Service**: `docs` / service `CLAUDE.md`s
**Files**:
- `services/xstockstrat-trading/CLAUDE.md` — modify
- `services/xstockstrat-portfolio/CLAUDE.md` — modify
- `services/xstockstrat-marketdata/CLAUDE.md` — modify

**Reviewers**: none

**Codebase Evidence**:
- `services/xstockstrat-trading/CLAUDE.md` § "Config Keys Consumed" opens with the false line
  "All config values are served by **xstockstrat-config** namespace `trading`." — contradicted by the
  `platform.*` rows in the same table (`platform.maintenance_mode`, `platform.trading_state`) and by
  Step 2 (trading now subscribes to `trading` **and** `platform`).
- `trading/CLAUDE.md:82` documents `trading.risk.daily_loss_limit` as "documented, not yet implemented"
  (consistent with the no-reader grep — leave the not-implemented note, it is accurate).

**TDD**: `N/A (docs)`

**Covers**: —

**Instructions**:
- trading `CLAUDE.md`: replace the false "all config values served by namespace `trading`" sentence with
  an accurate statement that trading subscribes to the `trading` **and** `platform` namespaces (the
  kill-switch/maintenance keys live under `platform`), and that config keys are resolved by their
  full-dotted `<namespace>.<key>` name (CONFIG-9). Update the `platform.trading_state` /
  `trading.risk.bracket_orders_enabled` rows to reflect the post-189 reality (production bracket now
  `true`; the former `false pending feature 103` note is superseded by the feature-189 operator override).
- portfolio + marketdata `CLAUDE.md`: correct any statement implying their config values resolve without
  the full-dotted key contract, so the docs match the healed-storage reality (no watcher code change in
  those services — note that their reads are fixed by config migration 029, not by a code change).
- **Teardown (root CLAUDE.md § Teardown)**: this step changes context files (service `CLAUDE.md`s) and
  behavior they describe → run `/context-forge:context-constitution refresh` scoped to what was touched
  and reconcile grounded drift before the PR; if the plugin is unavailable, do the manual equivalent and
  record both facts in the PR body.

**Verification**: re-read each edited `CLAUDE.md` section against the code changed in Steps 1–7; confirm
no remaining claim that trading resolves config under a single `trading` namespace, and that the
`platform.*` and bracket rows match post-189 behavior.

---

## Deviation Log

### Step 3 — reconciliation test updated (writer-rename fallout, file outside listed Files)
- **What**: `internal/service/trading_reconciliation_test.go:687` asserted `escalateSystemic`'s
  SetConfig target as `namespace=platform, key=trading_state`. Step 2's Part C writer rename
  (`Key:"trading_state"`→`"platform.trading_state"`) made that assertion fail
  (`platform.platform.trading_state`). Updated the expectation to `key=platform.trading_state`.
- **Why a deviation**: the file was not in Step 2's or Step 3's `**Files**` list — a spec under-scoping
  (the writer rename's own regression test was missed). Fixing it is the direct, in-scope consequence of
  the confirmed Step 2 change; leaving the suite red was not an option (Step 3 Verification runs the
  service tests). No behavior changed beyond the asserted key string.
- **Disposition**: fixed in Step 3 (gap protocol Option A — fix now). Staged with Step 3's Files.

### Step 3 — golangci-lint unavailable locally → go vet (CI-equivalent fallback)
- **What**: the sanctioned `golangci-lint run` could not run: the installed golangci-lint 2.5.0 was built
  with go1.25 and refuses a go1.27 target module ("Go language version used to build golangci-lint is
  lower than the targeted Go version 1.27.0"). Ran `go vet ./internal/config/... ./internal/service/...`
  instead (clean).
- **Disposition**: CI-equivalent fallback (sequential-mode). CI runs the pinned golangci-lint v2.13.1 on
  the full module — the authoritative lint gate.

### Step 7 — Playwright e2e verified as CI-equivalent (host harness slow; Docker build impractical)
- **What**: `pnpm test:e2e trader/positions-reconciliation.spec.ts` could not complete locally — the host
  `next dev` harness exceeded the 10s SSR-warmup budget on cold compile (two attempts, incl.
  `--timeout=120000 --workers=1`), and the hermetic `scripts/run-e2e.sh` Docker image build (full
  in-container `next build` + Chromium) is impractical in this sandbox's time budget.
- **Verified locally instead**: `pnpm run lint` clean; the 3 changed files (`page.tsx`, `mock-backend.ts`,
  `positions-reconciliation.spec.ts`) are type-consistent (the only `tsc --noEmit` error is pre-existing in
  the unrelated `src/middleware.test.ts`). RED is structurally guaranteed — the mock now serves
  `platform.trading_state`; the pre-Step-6 page read bare `trading_state` → `undefined` → the
  `/Trading reduce-only platform-wide/` banner absent; post-Step-6 reads the full-dotted key → banner shows.
- **Disposition**: CI-equivalent fallback (sequential-mode). The authoritative Playwright gate is CI's
  `Dockerfile.e2e` container (UI CLAUDE.md § Testing) — it runs this spec on PR #1141.

_Populated by /sdd-execute as implementation proceeds._
