# Design: fix-trading-config-plumbing

**Created**: 2026-11-20
**Rounds**: 3 (full; termination: approved)
**Approved by**: user @ 2026-11-20
**Grounded in**: recon.md
**Debate register**: debate.md

---

## Chosen Approach

One trading change per defect, one config seed migration, one comment-only proto fix. No getter
edit (the three-copy `watchcore.go` is untouched), no trading migration, no wire change. The change is
**internal-only** (C-14): the UI shows only the order status enum and `GetTradingEnvironment`, whose
result is unchanged in all three deployment targets; the agent has no surface for these fields
(recon.md § Dependencies).

**Defect 1 — IBKR honours `broker.timeout_ms` live (D-1, D-2, D-7, D-8, D-12).**
- `broker.IBKRConfig` gains `Timeout func() time.Duration`, fed by one new
  `func (s *TradingService) brokerTimeout() time.Duration` (returns `brokerCallTimeout(s.cfgW)`) that
  also replaces Alpaca's inline closure (recon: `trading.go:3377`, `:2634-2640`).
- `NewIBKRClient` builds `&http.Client{}` with no client timeout (recon: `ibkr.go:83`); the per-request
  `context.WithTimeout` is applied at `sendSigned` **only** (recon: `ibkr_session.go:448`). The
  handshake (`send`: `mintLST`, `initBrokerage`) keeps its own detached bound,
  `ibkr.handshake_timeout_ms`.
- One package helper `callTimeout(fn)` holds the nil / ≤0 → 5 s fallback for both brokers
  (recon: `alpaca.go:33,75-81`).
- `broker.IBKRRequestTimeout` is deleted. The `staleThreshold` floor keeps its value, 10 s, via ONE
  exported broker constant `IBKRDefaultHandshakeTimeout` that `defaultIBKRTiming.HandshakeTimeout`
  also uses: S = max(T, 10 s) × multiplier (recon: `order_intent.go:109-117`).
- A small `s.ibkrClientConfig(rec, creds)` builds the IBKR config for both `instantiateBrokerLocked`
  and the `ibkrAuthService` test helper, so the production `Timeout` and `Timing` wiring is pinned by
  service tests (recon: `trading.go:3355`).
- Tests are RED-first: a scaffold declares the new symbols unwired, so the black-hole test fails by
  waiting ~10 s. `Next` answers the contract lookup and black-holes only the order POST; a live value
  change applies on one client without a rebuild; a slow handshake under `handshake_timeout_ms`
  succeeds with a small T; `callTimeout` is tested in an internal test file.

**Defect 2 — accessor discipline (D-3, D-11).** No production change: since feature 295 `GetFloat`
widens an int row, and migration 041 already seeds the three keys as int (recon § Risks). The fix is
the missing read-path test: `TestFlattenAndHalt_IntRetryRowsSetAttempts_F321_AC2` drives
`flattenAndHalt` on the real harness with a populated `snapshotInts` watcher and definitive
rejections — `max_retries` int 1 → 2 submissions, int 5 → 6 (attempts = 1 + max_retries), elapsed
< 400 ms. It passes at HEAD; discrimination is shown by mutation (`maxRetries := 3` → 4 and 4;
`retryDelay` 500 ms → elapsed fail). **P-06 natural-RED waiver for AC-2: granted by the operator
2026-11-20** (context.md).

**Defect 3 — `requires_approval` (D-4, D-9).** `UpsertOrder` binds `$17` from
`o.Status == ORDER_STATUS_PENDING_APPROVAL` with a ≤2-line constraint comment (recon:
`trading_repo.go:93`, `trading.go:613-616`). `ON CONFLICT` never updates the column, so the first
insert's value sticks. No signature, call-site or proto change; `approved_by` / `approved_at` stay out
of scope (no Approve RPC). Proof: `PlaceOrder` on `auditSvc` with a non-default threshold (float 20,
qty 21) and a pgxmock capture of the bind, plus a repo table test.

**Defect 4 — `broker.paper` (D-5, D-6, D-10, D-14).**
- `environmentIsPaper()` becomes the single reader (`resolveTradingMode` calls it) with fallback
  `s.cfg.ApplicationEnv != "production"` (recon: `trading.go:2831,3852,2362`; `config.go:100-105`).
- Config migration `056` (provisional number) seeds the key per environment in 054's shape:
  INSERT-if-absent, staging `true` / production `false`, `description` + `consuming_service`,
  sentinel `system:config-migration-feature-321`, guarded down. The `scripts/config-wiring.json`
  baseline entry is removed and `scripts/config-wiring-stored.json` regenerated.
  `scripts/config-heal/catalog.tsv` is not edited.
- **Operator-accepted consequence (D-14):** `APPLICATION_ENV` alone decides trading's paper/live.
  `TRADING_MODE` has no behavioural effect in any service after this change (marketdata's `Paper` flag
  has no reader; trading's `Watcher.tradingMode` is a dead field). A target pairing
  `APPLICATION_ENV=production` with `TRADING_MODE=paper` labels registrations and orders paper at HEAD
  and live after. A missing `APPLICATION_ENV` resolves paper and reads staging config. The seeded key
  is a one-edit config-ui row: existing accounts keep routing by their persisted `is_paper`, so a
  production flip would label live-routed orders PAPER.

**Proto (D-15).** Comment-only fix of the stale `TRADING_MODE env` wording at
`packages/proto/trading/v1/trading.proto:263-265` (field number, type and `[deprecated = true]`
unchanged), verified with `buf lint`, `buf breaking … subdir=packages/proto`, `./scripts/buf-gen.sh`.

**Pre-deploy operator action (D-13, D-16, D-20).** Before 321 deploys, in BOTH environments:
1. set `trading.broker.timeout_ms` to **10000** (keeps IBKR signed requests at today's 10 s), and
2. set `trading.order_intent.stale_multiplier` to **4.0** (S = 40 s, Alpaca 429 budget B = 20 s —
   keeps Alpaca retry and pacing, and covers the 40 s IBKR call chain).

It is an operator-only step in the implementation spec whose pass condition is stored state,
evaluable at any time: `broker.timeout_ms` is an int ≥ 10000 and `order_intent.stale_multiplier` is
≥ 4.0 in staging and production, each with a `config.config_audit` row, audit timestamps recorded in
context.md. The integration PR is opened as a draft and leaves draft only once this is recorded, with
the stored values re-checked just before.

**Build order (D-18).** U1a RED scaffold → U1b IBKR wiring → U2 AC-2 characterization → U3
`requires_approval` → U4+U5 as one atomic unit (fallback change + migration 056 + baseline removal +
stored-JSON regeneration; reviewers: trading owner, config owner, DBA) → U6 proto comment + stubs
(Proto Reviewer + trading owner) → U7 docs (trading CLAUDE.md key table / Paper vs live / Approval
Flow / Adaptive rate limit table, `docs/patterns/config-governance.md`, trading findings, root
findings `:23`).

**Spec amendments carried to /sdd-spec.** product-spec: defect 2 premise and "no seed row" are stale;
Fix Scope → proto comment-only, config migration yes; Open Questions answered; add the pre-deploy
action; line refs refreshed. acceptance.feature (IDs unchanged): `@AC-1` signed requests within the
live bound + handshake unaffected; `@AC-2` Scenario Outline, 1 + n submissions; `@AC-3` threshold 20 /
qty 21; `@AC-4` per-environment seed + `APPLICATION_ENV` fallback + clean gate.

## Rejected Alternatives

- `R-1` Switch the int-documented keys to `GetInt` — a float-stored operator row would become default + WARN; not needed since feature 295.
- `R-2` Make the getters coerce float → int — breaks trading `@AC-12` and edits three watcher copies.
- `R-3` Drop the `staleThreshold` floor, or couple it to the live handshake key — breaks 347 `@AC-27`; YAGNI.
- `R-4` Keep `broker.paper` unseeded with its baseline entry — leaves the every-read-key-is-seeded rule unmet.
- `R-5` Keep the `TRADING_MODE` fallback — fail-paper scar; the env axis already scopes the watcher's rows.
- `R-6` A proto field or an explicit `requiresApproval` param on `UpsertOrder` — out of scope / churns six call sites for the same result.
- `R-7` Per-request deadline on `send` too, or per-request `max(T, 10 s)` — double-bounds the handshake / defeats the defect.
- `R-8` Source-level grep pin of the `Timeout` wiring, or leaving it unpinned — brittle / invisible regression; superseded by D-12.
- `R-9` A guarded reseed of `broker.timeout_ms` inside migration 056 — rewrites an operator-owned value in a migration.

## Open Risks

- [ ] Pre-deploy action missed or reverted: IBKR signed requests run at the stored 5 s until edited (uncertain outcomes; a timed-out flatten halts the account with the position possibly open). Recovery is one live edit. — operator step + draft PR, at the integration PR.
- [ ] At T = 10 s with multiplier 4.0: orphaned PENDING intents reclaim after 40 s (was 30 s); CancelOrder worst case 50 s; every Alpaca call's timeout is 10 s; black-holed poller/reconciliation ticks take twice as long. An early edit also lengthens IBKR read-only reconciliation/position polls 5 → 10 s. — accepted (D-13, D-20).
- [ ] IBKR call chain (handshake + T + reinit + T = 40 s) equals S = 40 s with no margin; a conid-lookup timeout leaves the order PENDING though nothing was sent. — known gap, not widened.
- [ ] Credential poller uses a hardcoded 5 s (`trading.go:2837`), ignoring the key. — recorded as a trading finding in U7.
- [ ] No check asserts the `APPLICATION_ENV` pairing for the DigitalOcean app specs (homelab asserts it). — out of scope; recorded.
- [ ] Migration number 056 is provisional (feature 317's spec also claims it); regenerate `config-wiring-stored.json` after every main-dev merge. — merge checklist at U4+U5 and the integration PR.
- [ ] Stored config descriptions go stale (`stale_multiplier` names `IBKRRequestTimeout`; `broker.timeout_ms` says Alpaca-only). — findings entries in U7 (D-19); `cfg.TradingMode` dead plumbing left to feature 322.
- [ ] `&config.Config{}` test harnesses move from LIVE to PAPER under the new fallback. — full-suite run in U4+U5.
- [ ] 277 halt condition: stop for an operator re-scope if anything pushes toward rewriting stored descriptions or touching `watchcore.go`. — every step.

## Constitution Rules Touched

- `C-01` / `F-04` — honored by: every claim cites recon.md or verified `path:line`; nothing invented.
- `C-05` — honored by: `broker.paper` becomes a seeded read key; the baseline exception is removed.
- `C-07` / `F-01` — honored by: a new config migration (last + 1, provisional); no applied migration or `catalog.tsv` is edited.
- `C-08` / `P-06` — honored by: RED-first tests per unit; the AC-2 natural-RED waiver is operator-granted and recorded.
- `C-09` — honored by: the proto step runs buf lint, buf breaking (with `subdir=`) and buf-gen.
- `C-10` / `C-14` — honored by: docs updated in U7; consumer surface stated as internal.
- `C-11` / `P-04` — honored by: three debate rounds, operator rulings recorded in context.md.
- `C-13` — honored by: tests reuse `snapshotInts`, `newFlattenHarness`, `auditSvc`, `rowCapture`, `lenientIBKRClient`.
- `C-15` / `C-16` — honored by: `@AC-1..4` amended with IDs kept; 304 `@AC-14` superseded with sign-off.
- `C-18` — honored by: one timeout helper, one floor constant, one config builder; no getter generality.
- `F-07` — honored by: timeouts read live via the watcher; the 10 s floor and 5 s fallback are code-side clamps, not config values.
- `P-03` — honored by: every live behaviour change disclosed and signed (D-13, D-14, D-20).

## Business Rules Touched (C-16)

- PRESERVE trading `@AC-12` "A type-mismatched or absent value follows the uniform getter rule" (`services/xstockstrat-trading/acceptance/fix-config-keys-drift.feature`) — not regressed by: no getter change.
- EXTEND trading `@AC-17` "The broker HTTP timeout changes for existing broker clients without a restart" — new case added: IBKR signed requests read the key live.
- PRESERVE 347 `@AC-27`, `@AC-28`, `@AC-23/26/34/35/36` (`services/xstockstrat-trading/acceptance/alpaca-adaptive-rate-limit.feature`) — not regressed by: the 10 s floor is kept; tests run at fixture T values.
- PRESERVE `@AC-4`, `@AC-8` (`fix-ibkr-request-signing.feature`) and `@AC-4/5/7/8/9` (`fix-trading-order-state-audit.feature`) — not regressed by: timeouts stay uncertain outcomes; reclaim semantics unchanged.
- PRESERVE config `@AC-14`, `@AC-24`, `@AC-3/4/5/28`, `@AC-1` (296), `@AC-10/12` (147) — not regressed by: an idempotent per-environment seed that keeps operator values and uses the relative key.
- EXTEND config `@AC-29` "A key whose readers disagree on the default is not seeded" — new case added: 321 `@AC-4` seeds the environment-correct value per environment.
- PRESERVE platform `@AC-22`, `@AC-18`, `@AC-29` (rendered `TRADING_MODE`), `@AC-19`, `@AC-20`, 278 `@AC-3` — not regressed by: no render change; the key becomes seeded.
- CHANGE 304 `@AC-14` "The broker.paper defect entry is respelled and stays owned by its defect" (`docs/sdd/business-rules/platform.feature:2095`) — superseded by 321 `@AC-4`; signed off by user @ 2026-11-20 (context.md). At promotion a "Superseded by @feature-321" comment goes above it; its text is not rewritten.
- EXTEND 295 `@AC-27` "Every language's getters follow the uniform rule" — new case added: an int row through the trading Go read path (AC-2 test).
- PRESERVE UI paper/live display (`strategy-performance-dashboard.feature`, `fix-ui-trader-feedback.feature`) — not regressed by: `GetTradingEnvironment` resolves the same mode in all three targets.
