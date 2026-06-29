# Feature Merge Order

Tracks inter-feature merge dependencies. A feature listed in the **Feature** column
cannot open its final integration PR to `main-dev` until the feature in the
**Must wait for** column has been merged and reached `launched` status.

**Maintained by:**
- `/sdd-review` — auto-proposes entries when overlap detection finds a FAIL-level conflict
  (migration number collision, proto field number collision, duplicate config key). Always
  asks for user confirmation before writing.
- Developers — manual entries when architectural ordering is known before conflicts arise.

> **Coverage note:** this file lists only **hard** ordering constraints — a feature that cannot merge
> until another lands (shared migration number, proto field-number collision, duplicate config key, or a
> consumed RPC/schema that must exist first). Most features have none: ordinary textual overlap rebases
> cleanly and is intentionally **not** listed here. A feature's absence from this table means "no hard
> dependency," not "untracked."

---

## Blocking Dependencies

| Feature | Must wait for | Reason | Resolved |
|---|---|---|---|
| `broker-accounts-ui` | `add-ikbr-account-support` | Consumes proto stubs and backend RPCs (`ListBrokerAccounts`, `ListPortfolios`, `RegisterBrokerAccount`, `DeregisterBrokerAccount`) defined by that feature | Yes |
| `strategy-engine` | `agent-mcp-server` | Steps 8–11 modify `client.py`, `tools.py`, `test_client.py`, `test_tools.py` — all four are **created** by `agent-mcp-server` (feature 009); they must exist before strategy-engine modifies them | Yes |
| `live-strategy-alert-engine` | `strategy-engine` | Hard dependency: requires `StrategyDefinition` model, `analysis.strategies` table, and `StrategyEvaluator` module delivered by `strategy-engine` (feature 047) | No |
| `strategy-creation-flow` | `formula-management-ui` | Consumes `ListFormulas` RPC from `xstockstrat-indicators` (feature 003); formula picker in the component editor depends on this RPC existing in generated stubs | Yes |
| `strategy-creation-flow` | `strategy-engine` | Consumes `ManageStrategy`, `GetStrategy`, `ListStrategyDefinitions`, and `SetStrategyLive` RPCs from `xstockstrat-analysis` (feature 047); all strategy authoring and live toggle RPCs must exist before the UI can call them | Yes |
| `strategy-creation-flow` | `live-strategy-alert-engine` | FR-5 live evaluation toggle calls `SetStrategyLive` and reads `live_enabled` column on `analysis.strategies` — both introduced by feature 048 | Yes |
| `auth2-authorized-apps-ui` | `unify-admin-auth-gates` | Extends 049's OAuth backend (`oauth_clients`/`refresh_tokens` schema, `AGENT_PUBLIC_URL`); 049 shipped the OAuth grant flow + `003_oauth` this feature builds on | Yes |
| `resumable-chunked-backfills` | `durable-observable-backfills` | Builds directly on the `ingest.backfill_jobs` table and `max_concurrent_jobs` gate (FR-2/FR-6); the `ingest.backfill_chunks` migration must run-order after feature 052's migration | No |
| `resumable-chunked-backfills` | `backfill-backtest-coverage` | `GAPS_ONLY` fill mode (FR-4) consumes the `GetDataCoverage` RPC introduced by feature 053 | No |
| `backfill-backtest-coverage` | `durable-observable-backfills` | Both add a field to `BackfillJob` in `packages/proto/ingest/v1/ingest.proto`; 052 takes field `11` (`failed_symbols`), so 053 must re-spec against merged 052 and use field `12` for its `timeframe_enum`. Field-number collision if 053 merges first | No |
| `open-positions-ui` | `orders-management-ui` | Both modify `services/xstockstrat-ui/src/lib/traderBff.ts` (055 adds `replaceOrder`/`streamOrderUpdates`; 056 adds `listPositions`/`queryEvents`) in the same router block — soft/rebase dependency (textual conflict, no shared proto/migration/config). 056 rebases after 055 merges | Yes |
| `screener-engine` | `fundamentals-data-source` | Fundamental screener criteria (FR-5) consume the cached `GetFundamentals`/`GetFundamentalsMulti` RPC introduced by feature 059. 058 and 059 are independent and can build in parallel; 060 follows both | No |
| `screener-agent-tool` | `screener-engine` | Pure consumer of the `ScreenSymbols` RPC introduced by feature 060 | No |
| `fundamentals-signal-producer` | `fundamentals-data-source` | Reads fundamentals only via the cached `GetFundamentalsMulti` RPC (feature 059) — the single FMP chokepoint; never calls FMP directly | No |
| `fundamentals-signal-producer` | `fundamentals-scoring-model` | Maps the composite score from feature 063 to `direction`/`conviction`; a trivial built-in default lets 062 ship if 063 slips | No |
| `fundamentals-scoring-model` | `fundamentals-data-source` | The scoring formula reads the fundamental metric fields (`pe_ratio`, `roe`, …) that feature 059 defines | No |
| `fundamentals-data-source` | `watchlist-management` | **Config-migration ordering** (not a code dep): all three of 058/059/062 add a seed migration to the shared `services/xstockstrat-config/migrations/` dir. To avoid a `006` filename collision the numbers are pre-assigned 058→`006_watchlist_config`, 059→`007_marketdata_fmp`, 062→`008_analysis_fundsignal_keys`. golang-migrate applies in numeric order, so 059's `007` must merge **after** 058's `006`. Seeded namespaces are disjoint (`portfolio`/`marketdata`/`analysis`) — no key conflict, only file ordering | No |
| `fundamentals-signal-producer` | `watchlist-management` | **Config-migration ordering**: 062's pre-assigned `008_analysis_fundsignal_keys` must merge after 058's `006` and 059's `007` in the shared config dir (see row above). Transitively covered by the existing 062→059 dep, but recorded explicitly because 058 is otherwise independent of 062 | No |

**Screener initiative build order**: `058 watchlist-management` ∥ `059 fundamentals-data-source`
(independent to *build*, but their `xstockstrat-config` seed migrations **merge** in number order
058 `006` → 059 `007` → 062 `008` — see the config-migration-ordering rows above) →
`060 screener-engine` (+ optional `061 screener-agent-tool`); and
`059` → `063 fundamentals-scoring-model` → `062 fundamentals-signal-producer`. Feature 059 is the
single FMP free-tier (250 req/day) chokepoint — both 060 and 062 read fundamentals only through its
cache, and 062 reserves call-budget headroom (200/250) for 060's interactive scans.

> **Note on `analysis.proto` (060 + 062) and shared UI/service files:** 060 (`ScreenSymbols`) and 062
> (`RunFundamentalsScan`) both append an RPC to the `AnalysisService` block and a method to
> `xstockstrat-analysis` `servicer.py`; 058 + 060 both edit `xstockstrat-ui` `insightsBff.ts` (distinct
> router blocks). These are **rebase-only textual** overlaps — no field-number, message-name, or config-key
> collision — so per the Coverage note above they are intentionally **not** listed as hard ordering rows;
> whichever lands second simply rebases.

---

## How to add an entry manually

1. Add a row to the table above.
2. Set **Resolved** to `No` while the blocking feature is still in-flight.
3. Update **Resolved** to `Yes` once the blocking feature is `launched` (merged to `main-dev`
   and deployed). You may then also remove the row — it serves no further purpose.

## How `/sdd-execute` uses this file

Before creating the **final integration PR** (feature branch → `main-dev`), `/sdd-execute`
reads this file. If the current feature appears in the Feature column and the blocking feature
has not yet reached `launched` status, it warns the user and asks for confirmation before
proceeding with the PR.

Per-step PRs (step branch → feature branch) are not affected by this file.
