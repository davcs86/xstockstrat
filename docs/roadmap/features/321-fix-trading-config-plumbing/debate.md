# Debate Register: fix-trading-config-plumbing

**State**: in-debate
**Mode**: full
**Rounds run**: 1 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-20 | /sdd-design | 6 | 7 | 7 | 12 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | IBKR honours `broker.timeout_ms` live: `IBKRConfig` gains `Timeout func() time.Duration`, fed by the same `brokerCallTimeout` closure Alpaca gets; `NewIBKRClient` builds `&http.Client{}` with no client timeout; the per-request `context.WithTimeout` is applied at `sendSigned` ONLY. `send` (handshake: `mintLST`, `initBrokerage`) stays bounded by the detached handshake context (`ibkr.handshake_timeout_ms`). The nil/≤0 fallback is one package helper shared with Alpaca. | `trading.go:3377`; `alpaca.go:25-26,33,56,75-81`; `ibkr.go:83`; `ibkr_session.go:170,237,284,342,448`; both sides (adversary O-2 = the proposer's own fallback) | settled |
| D-2 | 1 | The `staleThreshold` floor keeps its value (10 s): S = max(T, 10 s) × multiplier, so S at T=1000 stays 30 s. `broker.IBKRRequestTimeout` is deleted (it is no longer IBKR's request timeout); the floor references ONE exported broker constant that `defaultIBKRTiming.HandshakeTimeout` also uses (no third literal). It is a code-side clamp, not a config value. | `order_intent.go:109-117`; `ibkr_session.go:37`; `trading.go:2659`; 347 `@AC-27`; adversary O-5 | settled |
| D-3 | 1 | No getter or accessor change (the three-copy `watchcore.go` is untouched; readers stay on `GetFloat`). Defect 2 closes with a read-path regression test that drives an int row through `flattenAndHalt` on a real snapshot watcher, using a non-default value. | `watchcore.go:393-419`; `check-config-wiring.mjs:646-650`; `configServiceImpl.ts:831-845`; `fails.md:2357-2360` | settled |
| D-4 | 1 | `requires_approval` is bound in `UpsertOrder` from the insert-time status (`o.Status == ORDER_STATUS_PENDING_APPROVAL`) with a ≤2-line constraint comment at the bind; no signature, call-site or proto change. `approved_by` / `approved_at` are out of scope (no Approve RPC). | `trading.go:613-616`; `trading_repo.go:77-93`; adversary O-9 | settled |
| D-5 | 1 | `broker.paper` has a single reader, `environmentIsPaper()` (`resolveTradingMode` calls it), and its fallback is `s.cfg.ApplicationEnv != "production"` instead of `TRADING_MODE`. | `trading.go:2362,2830-2832,3852`; `config.go:31,47,100-105` | settled |
| D-6 | 1 | `broker.paper` is seeded per environment by a hand-written config migration (provisional 056): INSERT-if-absent, staging `true` / production `false`, `ON CONFLICT (namespace, key, environment, COALESCE(user_id, '')) DO NOTHING`, with `description` + `consuming_service`, sentinel `system:config-migration-feature-321`, and a down guarded like 054's. The `config-wiring.json` baseline entry is removed and `config-wiring-stored.json` regenerated. `scripts/config-heal/catalog.tsv` is NOT edited (041's sha-pinned input evidence; 330 R-5 precedent). Conditional on the operator's C-16 sign-off (O-11). | `054_…up.sql:4-13`, `054_…down.sql:4-10`; `check-config-wiring.mjs:629,645,710`; `scripts/config-wiring.json:5-12`; `scripts/config-heal/signoff.md:19-20`; adversary O-6, O-7 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Switch the int-documented keys to `GetInt` | A float-stored operator row would become default + WARN (`watchcore.go:398-402`, trading `@AC-12`); `SetConfig` never retypes a row; not needed since feature 295. | locked |
| R-2 | 1 | Make the getters coerce float → int | Breaks trading `@AC-12` (`fix-config-keys-drift.feature:8`) and edits three byte-identical watcher copies. | locked |
| R-3 | 1 | Drop the `staleThreshold` floor, or couple it to the live `ibkr.handshake_timeout_ms` | Dropping breaks 347 `@AC-27` (S=3 s at T=1000); live coupling changes S whenever the handshake is retuned (YAGNI). | locked |
| R-4 | 1 | Keep `broker.paper` unseeded with its baseline entry | Leaves the every-read-key-is-seeded rule (C-05, platform `@AC-19/20`) unmet and the entry owned by a closed defect. | locked |
| R-5 | 1 | Keep the `TRADING_MODE` fallback for `broker.paper` | Fail-paper scar (`fails.md:3456`); the env axis is the one that already scopes the watcher's rows. | locked |
| R-6 | 1 | A proto field, or an explicit `requiresApproval` param on `UpsertOrder` | Proto change is out of scope; the param churns six call sites and two pinned positional tests for the same result. | locked |
| R-7 | 1 | Per-request deadline on `send` too, or a per-request `max(T, 10 s)` for IBKR | The first double-bounds the handshake and silently caps `ibkr.handshake_timeout_ms` at T; the second defeats the defect (AC-1 needs 2 s). | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | P-03/C-11: undisclosed live change — every signed IBKR request bound drops from 10 s to the stored `broker.timeout_ms` (int 5000 in both environments). More uncertain outcomes / PENDING→UNKNOWN reclaims. Needs to be stated in design.md and signed off by the operator; optional operator action "raise `trading.broker.timeout_ms` before deploy". No code for it. | yes | open |
| O-2 | 1 | The per-request deadline belongs on `sendSigned` only; `send` is already bounded by the handshake context. AC-1 narrows to "each signed IBKR request"; add a test that a slow handshake under `handshake_timeout_ms` still succeeds with a small T. | yes | closed @ round 1 (adopted as D-1 / R-7; AC-1 amendment + handshake test carried into the approach) |
| O-3 | 1 | P-06: the AC-2 mutation evidence is wrong (removing `GetFloat`'s int arm yields default 3 → 4 attempts, not 1). Use the mutation that models the defect (hardwire `maxRetries := 3` at `trading.go:3083`), drive the flatten with definitive rejections (`errBuyingPower`, `trading_flatten_rejection_test.go:133-146`) so each attempt reaches the broker, replace `cfgW: &config.Watcher{}` (`:111`) with `snapshotInts`, cite the fixture lines (`fails.md:4219`), record the no-natural-RED waiver. | yes | open |
| O-4 | 1 | The floor does not guarantee the sweeper never reclaims an in-flight intent: `IBKRClient.do` can chain handshake + T + reinit + T (≥ 20 s + 2T vs S=30 s). Not a regression (HEAD is worse). Record as a known gap; do not widen scope. | no | closed @ round 1 (adopted: design.md Open Risk, no code) |
| O-5 | 1 | C-18 DRY: a new `10*time.Second` literal would be the third copy of the IBKR handshake default. | no | closed @ round 1 (adopted in D-2: one exported broker constant) |
| O-6 | 1 | Do not edit `scripts/config-heal/catalog.tsv` (041 sha-pinned evidence; 330 R-5). Put corrected descriptions in trading CLAUDE.md, the config-governance log and trading findings. | no | closed @ round 1 (adopted in D-6) |
| O-7 | 1 | 056 shape: guarded down, `description` + `consuming_service`, 054's ON CONFLICT target; `docs/patterns/config-governance.md` also names `IBKRRequestTimeout` and needs updating. (Gate assumption "no default-mismatch / readers-disagree" verified.) | no | closed @ round 1 (adopted in D-6 + docs list) |
| O-8 | 1 | Safety disclosure: once seeded, `TRADING_MODE` no longer governs trading's paper/live — `APPLICATION_ENV` alone picks the row; a target pairing `APPLICATION_ENV=production` with `TRADING_MODE=paper` would trade live while marketdata/indicators still read `TRADING_MODE`. A missing `APPLICATION_ENV` still fails paper (`config.go:47`), so "scar removed" is overstated. Seeding also makes the key a one-edit flip in config-ui. Operator to accept; no guard added. | no | open |
| O-9 | 1 | `requires_approval` from status couples the repo to a business rule; edge: the first insert is warn-only (`trading.go:694-696`). Accept with a constraint comment + pgxmock true/false test. | no | closed @ round 1 (adopted in D-4) |
| O-10 | 1 | AC-3 harness: `newConfirmHarness` needs a `brokers` entry, `platformCfgW` `trading_state` and a satisfied risk check for PlaceOrder — cite fixture lines; AC-3 wording uses the code default 500, amend to a non-default threshold. | no | closed @ round 1 (adopted: test plan + AC-3 amendment) |
| O-11 | 1 | C-16: 304 `@AC-14` (`platform.feature:2095`) is CHANGED by D-6 — needs operator sign-off recorded in context.md. | yes | open |
| O-12 | 1 | Scope: under-scope items (056 down, config-governance text, findings resolved) and the halt condition — stop for an operator re-scope if anything pushes toward rewriting stored descriptions or touching `watchcore.go` (the 277 pattern). | no | closed @ round 1 (adopted: items in scope list; halt condition recorded) |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
