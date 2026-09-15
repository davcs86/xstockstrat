# Context Log: fix-trading-config-key-mismatch

Append-only. Each session appends a new ## Session entry. Never delete or edit prior entries.

---

## Session 2026-09-15 (/sdd-triage)

- Bug reported via defect report `docs/reports/2026-09-15-trading-config-namespace-key-mismatch-defect.md`
  (GitHub Issues disabled on this repo → from-report path; the report is the audit trail).
- Origin: user reported the trader UI rejecting orders with
  `trading halted: platform.trading_state=HALTED` ("Fix halted account", screenshot on a PAPER/Alpaca-test
  account → staging).
- Severity: **SEV-1** (runbook indicator "orders not executing on the live Alpaca API"). Failure mode is
  **fail-safe** (orders blocked, never wrongly executed) → no financial-integrity bleed, only an outage.
- Routed to **Track C (SDD path)** by explicit user decision, over the mechanical SEV-1 → Track A routing.
  Rationale (user-approved): fail-safe failure mode removes the hotfix urgency, and the chosen fix is
  **systemic/cross-service** (shared Go config-watcher contract), which warrants a full design debate; also
  honors the harness branch mandate (`claude/halted-account-94ldka` → main-dev) that Track A (off `main`)
  would violate.
- Created: feature.md, product-spec.md, acceptance.feature (3 regression scenarios), context.md, status.md.
- Affected services: xstockstrat-trading (primary); xstockstrat-portfolio, xstockstrat-marketdata (same
  latent watcher pattern); xstockstrat-config only if the seed-key-migration approach (B) is chosen.
- Root cause (four independent confirmations — live get_config, config-server source, trading reader source,
  constitution CONFIG-9 / insights.md:905): trading subscribes to the single `trading` namespace and reads
  full-dotted getter strings against a snapshot keyed by the raw namespace-relative `key` column, so
  `platform.trading_state` never matches → fail-closed `HALTED`. The same verbatim-snapshot + dotted-read
  gap silently defaults all `trading.*` reads; it only surfaces on `platform.trading_state` because that is
  the one key whose code default (HALTED) diverges from its intended seed (ACTIVE).
- Recommended design depth: **full** → `/sdd-design fix-trading-config-key-mismatch`
  (rationale: ≥2 affected services + a likely seed-key migration + safety-critical contract).
- Candidate fix approaches recorded in product-spec.md (A watcher-prefix + multi-namespace [preferred
  hypothesis], B seed/writer migration, C reader alignment) — **not** pre-committed; the design phase decides
  under adversarial review.

### Interim operational action already taken (this session, before triage)
- Set `platform.trading_state = ACTIVE` in **staging** via `set_config` (author davcs86@gmail.com) to clear
  the incident-time `REDUCE_ONLY` value. This does **not** unblock trading (the reader never sees it) and is
  recorded only so the stored value is not left mid-incident. The code fix is required to actually resolve
  the halt. No code was changed on any branch by the triage.

### Development branch
- `claude/halted-account-94ldka` (harness-assigned; PR targets `main-dev`). SDD skills normally use
  `feature/<slug>`; the harness mandate governs here.

## Session 2026-09-15 — sdd-design

- **Phase 0 Recon:** wrote recon.md from 5 parallel discovery agents (trading/portfolio/marketdata/config
  + scenario-recon) grounded against staging config-service logs (platform broadcasts reach
  `subscribers=0`; my triage-time `platform.trading_state=ACTIVE` write at 07:39:19 reached 0 subscribers —
  runtime proof of the namespace fault). Key reuse patterns: CONFIG-9 seed↔reader match; the
  `lookupScalarBounds` two-operand probe; existing `newTestWatcher` harnesses.
- **Phase 1 Grilling:** 3 full rounds (proposer↔adversary, mediated).
  - R1 — proposer split the fix into Layer A (platform delivery) + Layer B (key format); adversary
    (NEEDS WORK) surfaced the migration deploy/collision/down hazards and the **behavior-flip blast
    radius** (bracket_orders_enabled prod false vs default true).
  - R2 — operator locked **Layer B = data migration 029** and **preserve prod bracket behavior**;
    adversary (NEEDS WORK) then found **finding #1**: the rename reactivates ALL dormant seeds, not just
    bracket — confirmed prod deltas `approval.require_above_qty` 500→100, `require_above_notional`
    50000→10000, `max_position_pct` 0.05→0.02 (migration 002 `live` rows); plus the SetConfig enum-guard,
    literal-bracket-bump, and non-vacuous-test must-fixes.
  - R3 — operator chose **HONOR the conservative prod seeds** (all tighten toward safety); adversary
    (NEEDS WORK→resolved) found the **new C-14 forward regression**: `/trader/positions` reads bare
    `values['trading_state']` (`page.tsx:120-121`), which the rename silently breaks (banner goes dark) —
    folded into the atomic edit set. Confirmed `page.tsx:120-121` is the only runtime bare-key reader in
    ui/agent.
- **Chosen approach (design.md):** (A) trading watcher variadic multi-namespace + namespace-scoped
  snapshot replace + per-namespace ready latch; (B) migration 029 heals `platform/trading/portfolio/marketdata`
  non-secret bare keys → full-dotted (guarded, `is_secret=false`, `NOT LIKE`) + deterministic prod
  bracket→true; (C) three-part atomic rename edit set (escalateSystemic writer + authz allowlist + SetConfig
  enum guard → `platform.trading_state`); (D) `/trader` frontend reader + e2e to the post-029 shape (C-14).
- **Rejected:** watcher-prefix (leaves storage mixed), reader→bare (@feature-184 CHANGE), server-side
  folding (widens contract), shared Go module (YAGNI).
- **Constitution:** F-01/F-06/F-07 honored; C-08/P-06 (sequenced non-vacuous RED); C-10/C-14 (UI consumer
  surface in scope); C-18 (minimum footprint). **Floor breaches: none.**
- **C-16 CHANGE — operator sign-off (this session):** production `trading.risk.bracket_orders_enabled`
  false→true reverses feature 030's deliberate "false pending feature 103" decision. **User explicitly
  approved** this reversal (preserve current runtime behavior; honoring the seed would turn bracket
  protection OFF). Recorded here per C-16. The honored conservative prod deltas (approval/max_position
  tightening) were likewise operator-approved as intended feature-002 production limits finally activating.
- **Affected services updated:** added `xstockstrat-ui` (C-14 consumer surface) to the original
  trading/portfolio/marketdata/config set.
- **Open Risks carried to /sdd-spec** (see design.md § Open Risks): DOWN reversibility (forward-only vs
  enumerated — needs the blocked DB audit), per-row DB audit, `daily_loss_limit` reader confirmation,
  deploy sequencing/window, concurrency invariants, full bare-key reader re-audit.
- Status: draft → design-approved. Next: `/sdd-spec fix-trading-config-key-mismatch`.

### Interim operational note (unchanged from triage session)
`platform.trading_state=ACTIVE` remains set in staging; it does not unblock trading (the reader never
receives it) and the code fix is required. No service code changed by the design phase.

## Session 2026-09-15 — sdd-spec

- Generated implementation-spec.md with 8 steps. Status → implementation-ready.
- Key codebase findings:
  - Next config migration = **029** (last is `028_analysis_opportunity_keys`). Current schema (post
    feature-147 `017`) has **no `trading_mode` column**; unique index is
    `(namespace, key, environment, COALESCE(user_id, ''))`; env CHECK is `('staging','production')`.
    The design's guarded blanket UP (`key = namespace||'.'||key WHERE key NOT LIKE namespace||'.%'
    AND is_secret=false AND namespace IN (...)`) and the literal production bracket bump are valid
    against this schema. `is_secret=true` guard protects the `017:110-121` vendor-credential rows
    (GetSecret path, namespace-relative keys — must stay bare).
  - Open Risk RESOLVED — `trading.risk.daily_loss_limit` has **no code reader** (grep: only 002/012
    seeds + trading/CLAUDE.md:82 + findings.md:15, both "documented, not yet implemented"). Healing it
    is behavior-neutral. Honored-delta ledger updated accordingly.
  - Open Risk PARTIALLY RESOLVED — per-row DB audit STILL BLOCKED (`db_execute_sql` →
    "postgres-mcp co-process is unavailable" again at spec time). Decision: **DOWN is forward-only**
    (documented no-op; rollback = redeploy prior image) since an enumerated exact-inverse strip cannot
    be authored without the audit and a symmetric strip would over-revert pre-dotted @AC-13/feature-184
    rows (P-03/C-01 — not invented). Also flagged: healing activates dormant production `portfolio.*`/
    `marketdata.*` seeds — verify by dev/staging smoke test (Step 1 note).
  - Open Risk RESOLVED — bare-key reader re-audit: `page.tsx:120-121` (`resp.values['trading_state']`)
    is the **sole** runtime bare-key reader across ui/agent (agent grep = no matches). `configKeys.ts:64`
    (ListKeys fixture) + `NamespaceEditor.tsx:95` already full-dotted. Of the 3 config-ui specs touching
    `trading_state`: `reason-capture`/`value-persists-after-save` already full-dotted (read from the
    ListKeys fixture) → no change; `audit.spec.ts:13` is synthetic audit-display mock data → leave it.
    Only `mock-backend.ts:1290` + `positions-reconciliation.spec.ts:119` (GetConfig response maps) need
    the bare→full-dotted key change (Step 7).
  - Grounded the Part C atomic edit set: authz grant `authz.ts:70` + SetConfig enum guard
    `configServiceImpl.ts:397` (both key `'trading_state'`→`'platform.trading_state'`) + escalateSystemic
    writer `trading.go:1905` (`Key:"trading_state"`→`"platform.trading_state"`; namespace stays `platform`).
  - Trading watcher `internal/config/config.go` confirmed: single-namespace `NewWatcher` (`:75`),
    verbatim `w.snapshot = snap.Values` (`:144`), raw getters (`:167-205`), `once`/`ready` (`:69-70`).
    `config_test.go` `fakeConfigServiceClient.WatchConfig` panics (`:60-62`) — no populated-snapshot
    read-path test exists (the P-06 RED target for Step 3).

## Session 2026-09-15 — sdd-execute (sequential mode)

Toolchain confirmed: Go 1.27.0 at /usr/local/go/bin (matches go.mod; PATH-exported per command),
golangci-lint 2.5.0 (vs pinned 2.13.1 — minor, CI uses pinned), Node v22.22.2 (vs pinned 24 — used
for config/ui lint+test), pnpm 9.15.9, uv 0.8.17, ruff 0.15.8, docker 29.3.1 (daemon startable).
Spec re-validated against live tree at boot — all Codebase Evidence resolves; no re-spec needed.

### Step 1 — migration: config 029 heal keys to full-dotted + prod bracket override [done]
- Created `029_heal_config_keys_full_dotted.up.sql` (guarded blanket key heal for platform/trading/
  portfolio/marketdata non-secret bare rows → full-dotted, `NOT LIKE`+`is_secret=false` guards; then
  deterministic `value_data='true'` bump of the production `trading.risk.bracket_orders_enabled` row
  on the post-rename key) and `029_..down.sql` (forward-only no-op `SELECT 1;` + rationale — a
  symmetric strip would over-revert pre-dotted rows; rollback = redeploy prior image).
- Verified offline (HARD CONSTRAINT: no DB started): both files present, NNN 028→029 no gap,
  value_type never touched. Real apply/rollback runs in CI/deploy.
- Files modified: `services/xstockstrat-config/migrations/029_heal_config_keys_full_dotted.{up,down}.sql`
- Deviations: none.

### Step 2 — service: trading watcher multi-namespace delivery + escalateSystemic writer rename [done]
- config.go: `Watcher.namespace string` → `namespaces []string`; `NewWatcher` now variadic
  `NewWatcher(endpoint, applicationEnv, tradingMode, namespaces ...string)` spawning one `watchLoop(ns)`
  per namespace; SNAPSHOT/RELOAD is now a NAMESPACE-SCOPED replace (delete `ns.`-prefix keys then insert)
  in one mu.Lock section; single `once`/`ready` → per-namespace `pending` set + `closeOnce` latch so
  WaitForSnapshot blocks until ALL namespaces deliver. Added `NewSnapshotWatcher` test-support ctor
  (snapshot field unexported → external gate test needs it). main.go:61 subscribes ("trading","platform").
  trading.go:1905 escalateSystemic writer Key "trading_state"→"platform.trading_state" (Part C, lockstep
  with 029).
- Verified paired with Step 3.
- Files modified: `internal/config/config.go`, `cmd/server/main.go`, `internal/service/trading.go`
- Deviations: none in Step 2 itself (see Step 3 for the reconciliation-test key update).

### Step 3 — test: trading config read-path, multi-namespace delivery, kill-switch gate [done]
- config_test.go: added a scripted WatchConfig streaming fake + read-path (AC-2 GetString
  platform.trading_state, AC-3 GetFloat trading.risk.max_position_pct, full-dotted fixtures),
  multi-namespace delivery, scoped-replace no-clobber, and per-namespace latch tests.
  trading_state_gate_test.go: AC-1 checkTradingStateForPlaceOrder returns nil under ACTIVE, blocks
  under HALTED (via config.NewSnapshotWatcher).
- TDD red→green (P-06): RED — with the pre-fix wholesale-replace + single-latch, the three behavioral
  tests FAILED for the right reasons (MultiNamespaceDelivery/ScopedReplace: platform.trading_state="HALTED"
  wiped by the trading stream; WaitForSnapshot: ready closed after only 1 of 2 namespaces). GREEN — with
  the namespace-scoped replace + per-namespace latch they pass; `go test ./internal/config ./internal/service
  -race` OK; internal/config coverage 57.1% (≥40%); `go vet` clean.
- Files modified: `internal/config/config_test.go`, `internal/service/trading_state_gate_test.go`,
  `internal/service/trading_reconciliation_test.go` (deviation — writer-rename regression assertion).
- Deviations: 2 (reconciliation-test key update; golangci-lint→go vet CI-equivalent) — see Deviation Log.

### Step 4 — service: config authz allowlist + SetConfig enum guard key rename [done]
- authz.ts:70 INTERNAL_CALLER_ALLOWLIST grant key 'trading_state'→'platform.trading_state';
  configServiceImpl.ts:397 SetConfig enum guard `key === 'trading_state'`→`'platform.trading_state'`.
  Lockstep with Step 1/029 + Step 2's writer.
- Files modified: `src/grpc/authz.ts`, `src/grpc/configServiceImpl.ts`. Verified with Step 5.

### Step 5 — test: config enum guard + internal-caller authz on the full-dotted key [done]
- Updated internalCallerAuthz.test.ts / tradingStateValidation.test.ts / internalCallerSetConfig.test.ts
  to the full-dotted `platform.trading_state`; added a regression test that the pre-189 bare
  `trading_state` is no longer authorized.
- TDD red→green: RED — reverting Step 4 to the bare key made 7 tests fail (authz REDUCE_ONLY/HALTED,
  the bare-key-denied regression, the SetConfig enum-reject + internal-caller write). GREEN — with the
  rename applied all 108 config tests pass; `pnpm run lint` 0 errors (143 pre-existing any-warnings),
  `pnpm run test:coverage` 81.03% lines (≥40%).
- Files modified: `src/__tests__/{internalCallerAuthz,tradingStateValidation,internalCallerSetConfig}.test.ts`
- Deviations: none.

### Step 6 — service: /trader positions page reads full-dotted platform.trading_state [done]
- page.tsx:120-121 `resp.values['trading_state']` → `resp.values['platform.trading_state']` (both reads).
  Without it the platform restriction banner silently goes dark post-029 (C-14). Verified with Step 7.
- Files modified: `src/app/trader/positions/page.tsx`. Deviations: none.

### Step 7 — test: /trader restriction-banner e2e on the full-dotted key shape [done]
- mock-backend.ts:1290 + positions-reconciliation.spec.ts:119 key `trading_state` → `platform.trading_state`.
- Verification: `pnpm run lint` clean; changed files type-consistent. Playwright spec could not run locally
  (host next-dev SSR-warmup timeout ×2; Docker e2e image build impractical) → CI-equivalent (Dockerfile.e2e
  runs it on PR #1141). RED structurally guaranteed. See Deviation Log.
- Files modified: `e2e/mock-backend.ts`, `e2e/trader/positions-reconciliation.spec.ts`. Deviations: 1.
