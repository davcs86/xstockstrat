# Debate Register: fix-retired-surface-proto-cleanup

**State**: in-debate
**Mode**: full
**Rounds run**: 2 (round numbers continue across runs; the mode's 2–5 / 1 bounds count this run only)

## Rounds

| Round | Date | Run by | +D | +R | O closed | +O | Petitions | Progress |
|---|---|---|---|---|---|---|---|---|
| 1 | 2026-11-11 | /sdd-batch | 8 | 4 | 0 | 3 | 0 | yes |
| 2 | 2026-11-11 | /sdd-batch | 2 | 2 | 2 | 0 | 0 | yes |

## Settled Decisions

<!-- Status: settled → superseded by D-m (only after a user-approved REOPEN) -->
| ID | Round | Decision | Evidence | Status |
|---|---|---|---|---|
| D-1 | 1 | BatchGetBars: the marketdata server reads timeframe_enum first via timeframe.Resolve, and all three producers (analysis servicer.py:5675, portfolio offline_valuation.go:170-176, UI useOhlcBars.ts:23-25) send both timeframe='1d' and timeframe_enum=TIMEFRAME_1DAY during the deprecation window. | marketdata_service.go:267-269 precedent and :787-788; services/xstockstrat-ui/src/hooks/useOhlcBars.ts:23-25; e2e/mock-backend.ts:153-154,188-189 | settled |
| D-2 | 1 | ComputeIndicatorRequest gets timeframe_enum = 7 in the contract only, with an 'ignored by server' comment and no caller switch. | 322 acceptance.feature:28 (AC-3); indicators servicer.py:214-241 | settled |
| D-3 | 1 | trading_mode option (a): delete the watcher resolvers and send in all 10 services plus the marketdata Paper vestige; keep trading Config.TradingMode (config.go:46) as the 321-owned broker.paper fallback, and name that consumer in trading CLAUDE.md. | trading.go:2730,3743; AC-1 'unless it names the consumer' | settled |
| D-4 | 1 | No config migration 048. Migration 046 already prunes both keys. AC-1's alpaca.paper clause is verified by a dev and prod launch-gate query of config_keys_report_296 for unmatched-signed-tuple plus a config_values count. | 046_config_dead_rows_prune.up.sql:11-14,18-22; scripts/migration-rerun.sh:543-566 | settled |
| D-5 | 1 | The Python watcher regression test asserts trading_mode == TRADING_MODE_UNSPECIFIED with TRADING_MODE patched (not HasField). Go watchers get a recorded P-06 waiver. | packages/proto/config/v1/config.proto:43 (non-optional enum); analysis watcher.py:32,47,63 | settled |
| D-6 | 1 | SA1019 nolint directives are added only where golangci-lint flags them after buf-gen, including _test.go files. | handler/trading.go:90; trading_offline_test.go:679,1396-1405 | settled |
| D-7 | 1 | The agent parity guard excludes deprecated descriptor fields, and that contract is stated in the module docstring. | services/xstockstrat-agent/tests/test_opportunity_projection.py:3-8,51-65 | settled |
| D-8 | 1 | Docs scope: config-governance.md:153-154,311,416,549-550 only. No analysis CLAUDE.md step (there is no row). Do not touch config-wiring-stored.json or the governance :422,473 live_enrich_ttl rows (owned by feature 330). | grep of docs/patterns/config-governance.md; scripts/config-wiring-stored.json:946,958 | settled |
| D-9 | 2 | SnapshotOfflinePositions keeps the deprecated user_id as the in-process carrier. The handler write at trading.go:90 keeps its own scoped nolint. The service hoists one `userID := req.UserId //nolint:staticcheck // SA1019…` at :1174, and the reads at :1178,1196,1274,1276,1284 use it. The :1193-1194 ownership comment is rewritten to name the local. The ListOrders/GetOrder reads at :1646,1652,1730 are untouched. The signature does not change. | grep of services/xstockstrat-trading/internal/service/trading.go and internal/handler/trading.go:90-91 (round 2) | settled |
| D-10 | 2 | Go P-06: update the test call sites first, then capture the test-package compile failure against the old NewWatcher/NewLiveClient signatures as RED. Record it as 'compile-only RED; no assertion-level RED because trading_mode is already omitted', or as a P-06 deviation if the tdd-gate rejects a compile RED. Never record it as 'no RED possible'. | trading config.go:87-93; portfolio config.go:74-80; .claude/skills/sdd-execute/reference/tdd-gate.md:35,56-59 | settled |

## Rejected Alternatives (locked)

<!-- Status: locked → reopened @ round N (user, context.md <ISO>) -->
| ID | Round | Alternative | Why rejected | Status |
|---|---|---|---|---|
| R-1 | 1 | Switching BatchGetBars producers to an enum-only request in the same PR as the server read. | The deploy is not atomic, so an old server resolves an empty timeframe (fails 2026-07-29/080). Sending both fields is strictly better. | locked |
| R-2 | 1 | Leaving BatchGetBars producers on the string only. | The enum would ship with no producer, recreating the stalled-deprecation drift (fails.md:1334). | locked |
| R-3 | 1 | Adding a duplicate migration 048 for sparkline_bars and alpaca.paper. | Migration 046 already prunes both under evidence gating. | locked |
| R-4 | 1 | Using HasField('trading_mode') in the Python regression test. | It raises ValueError on a non-optional proto3 enum. | locked |
| R-5 | 2 | Treating operator silence as acceptance of the O-1 keep-enum default. | Silent guess. C-11 and CLAUDE.md behaviour 1 require a recorded operator answer. | locked |
| R-6 | 2 | Deferring the choice between per-line nolint and a hoisted local to /sdd-spec. | The directive count (five service reads plus the handler write) is already known, so leaving it open hands design's decision to the implementer (F-09). | locked |

## Objections

<!-- Status: open → closed @ round N (<how>) | waived @ round N (user) | reopened @ round N (user) -->
| ID | Round | Objection | Blocking | Status |
|---|---|---|---|---|
| O-1 | 1 | ComputeIndicatorRequest.timeframe_enum has no reader or producer (C-18). It is kept only for AC-3, and dropping it needs an operator-sanctioned AC-3 amendment. | no | open |
| O-2 | 1 | Trading keeps deprecated SnapshotOfflinePositionsRequest.user_id as the internal identity carrier under nolint. The alternative is an explicit userID parameter. | no | closed @ round 2 (Settled with one hoisted local under a scoped nolint at trading.go:1174, plus the handler :90 directive. The explicit userID parameter is the recorded fallback, deferred to the field-removal follow-up.) |
| O-3 | 1 | Go watchers have no failing-first test, covered by a P-06 waiver instead of a guard. | no | closed @ round 2 (Waived with an accurate record: compile-failure RED captured after updating the test call sites first, with the compile-time signature removal as the guard. A P-06 deviation is logged if the tdd-gate rejects a compile RED.) |

## Reopen Petitions

<!-- Verdict: dropped (evidence not new — already on record at <ID>) | pending user | user reopened | user declined -->
| ID | Round | Target | New evidence | Verdict |
|---|---|---|---|---|
