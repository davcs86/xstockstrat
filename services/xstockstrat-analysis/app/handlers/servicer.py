"""
AnalysisServicer — strategy backtesting and scoring.

RunBacktest implements a real SMA crossover engine that:
  1. Fetches OHLCV bars from xstockstrat-marketdata
  2. Computes SMA indicators via xstockstrat-indicators
  3. Optionally fetches newsletter signals from xstockstrat-ingest for signal-weighted strategies
  4. Simulates trades bar-by-bar and computes performance metrics

ScoreStrategy grades backtests using Sharpe ratio, max drawdown, and win rate.
"""

import asyncio
import hashlib
import json
import logging
import math
import uuid
from datetime import UTC, datetime, timedelta

import asyncpg
import grpc
import numpy as np
from gen.analysis.v1 import analysis_pb2, analysis_pb2_grpc
from gen.common.v1 import common_pb2
from gen.indicators.v1 import indicators_pb2, indicators_pb2_grpc
from gen.ingest.v1 import ingest_pb2, ingest_pb2_grpc
from gen.ledger.v1 import ledger_pb2, ledger_pb2_grpc
from gen.marketdata.v1 import marketdata_pb2, marketdata_pb2_grpc
from gen.notify.v1 import notify_pb2_grpc
from gen.portfolio.v1 import portfolio_pb2, portfolio_pb2_grpc
from gen.trading.v1 import trading_pb2, trading_pb2_grpc
from google.protobuf import json_format
from google.protobuf.timestamp_pb2 import Timestamp

from app.config.watcher import ConfigWatcher
from app.repositories.backtest_details import BacktestDetailsRepository
from app.repositories.backtest_run_symbols import BacktestRunSymbolsRepository
from app.repositories.backtest_runs import BacktestRunsRepository
from app.repositories.opportunities import OpportunitiesRepository
from app.repositories.opportunity_actions import OpportunityActionsRepository
from app.repositories.strategies import StrategiesRepository
from app.repositories.strategy_scores import StrategyScoresRepository
from app.services import scoring, warmup
from app.services.cooldown import effective_cooldown_days, is_cooldown_active
from app.services.evaluator import (
    FormulaExecutionError,
    StrategyEvaluator,
    _empty_readiness,
    _validate_definition,
    align_indicator_points,
    referenced_refs,
)
from app.services.screener import ScreenerEngine

# Backward-compat alias: the source-weighted signal math moved to app.services.scoring
# (feature 060). Re-exported so existing imports of `_compute_signal_score` from this
# module stay valid.
_compute_signal_score = scoring.compute_signal_score

log = logging.getLogger(__name__)


def _deleted_formula_warning(name: str, formula_id: str) -> str:
    """Feature 086: the single, shared wording for a soft-deleted-formula run/status warning."""
    return (
        f"Formula '{name}' ({formula_id}) referenced by this strategy has been deleted; "
        f"the run used its last-saved definition."
    )


class _InsufficientData(Exception):
    """Raised by a per-symbol backtest when there are too few bars to run it.

    Carries the data needed to build an ``analysis_pb2.CoverageGap`` instead of silently
    fabricating a flat-equity "success" (feature 053, FR-2 / AC-2).
    """

    def __init__(self, symbol: str, bars_have: int, bars_need: int, gap_range=None):
        super().__init__(f"{symbol}: have {bars_have} bars, need {bars_need}")
        self.symbol = symbol
        self.bars_have = bars_have
        self.bars_need = bars_need
        # feature 071: for a pre-window warm-up shortfall the actionable backfill span is the
        # PREFIX (start - warmup … start), not the caller's window — the window itself may be
        # fully covered. None → the caller's requested range, as before.
        self.gap_range = gap_range


# feature 071: marketdata's GetBars defaults to a 500-bar page and orders ASC, so an
# unpaginated request silently drops the NEWEST bars once a range exceeds that. A 730-day
# range is already ~504 trading days, so the default path has been quietly truncated all
# along; pre-window warm-up would make it worse. `_fetch_bars_paged` below pages properly.
_BAR_PAGE_SIZE = 1000

# Backstop against a non-advancing cursor. 32 pages x 1000 bars ~= 128 years of daily data,
# unreachable by legitimate data under the max_range_days cap. Exhausting it RAISES rather
# than returning what it has: silently truncating here would reintroduce the very bug this
# helper exists to fix, and would do so as a function of a config value.
_MAX_BAR_PAGES = 32

# feature 083 — opportunity queue / readiness.
# Recent-bar lookback for EvaluateReadiness: ~400 calendar days ≈ 280 trading bars, enough
# to warm up long indicators (e.g. SMA/EMA up to ~200 periods) for a last-bar readiness read.
_READINESS_LOOKBACK_DAYS = 400
# Backstop for draining paginated QuerySignals / ListPositions in ListOpportunities.
_MAX_DRAIN_PAGES = 50
# Default queue page size when the request omits one.
_DEFAULT_OPP_PAGE_SIZE = 50


class _BarFetchError(Exception):
    """Raised when bar pagination cannot complete safely (non-advancing cursor, page cap)."""


class AnalysisServicer(analysis_pb2_grpc.AnalysisServiceServicer):
    def __init__(
        self,
        config_watcher: ConfigWatcher,
        marketdata_channel,
        indicators_channel,
        ingest_channel,
        ledger_channel,
        db_pool=None,
        notify_channel=None,
        portfolio_channel=None,
        trading_channel=None,
    ):
        self._cfg = config_watcher
        self._marketdata = marketdata_pb2_grpc.MarketDataServiceStub(marketdata_channel)
        self._indicators = indicators_pb2_grpc.IndicatorsServiceStub(indicators_channel)
        self._ingest = ingest_pb2_grpc.IngestServiceStub(ingest_channel)
        self._ledger = ledger_pb2_grpc.LedgerServiceStub(ledger_channel)
        self._notify = notify_pb2_grpc.NotifyServiceStub(notify_channel) if notify_channel else None
        # Trading stub (feature 083) — GetStrategyAnalytics reads ListOrders(strategy_id) for the
        # "taken" count. New analysis→trading edge (non-cyclic; trading does not dial analysis).
        # nil when TRADING_ENDPOINT is not wired (tests).
        self._trading = (
            trading_pb2_grpc.TradingServiceStub(trading_channel) if trading_channel else None
        )
        # Portfolio stub (feature 062) — used by the fundamentals signal producer for the
        # watchlist universe read. nil when PORTFOLIO_ENDPOINT is not wired (tests).
        self._portfolio = (
            portfolio_pb2_grpc.PortfolioServiceStub(portfolio_channel)
            if portfolio_channel
            else None
        )
        self._backtests: dict[str, analysis_pb2.BacktestResult] = {}
        self._strategies: dict[str, analysis_pb2.StrategyScore] = {}
        self._strategies_repo = StrategiesRepository(db_pool) if db_pool else None
        # Durable backup for the in-memory _strategies dict (feature 064). Reads stay
        # in-memory; this persists on score and hydrates it at boot. None in the no-DB
        # test path so make_servicer()-based tests are unaffected.
        self._scores_repo = StrategyScoresRepository(db_pool) if db_pool else None
        # Durable backtest-run history (fixes "cannot see past run results"). RunBacktest
        # appends a summary row here; the ListBacktests RPC reads it back. None in the no-DB
        # test path so make_servicer()-based tests are unaffected.
        self._backtest_runs_repo = BacktestRunsRepository(db_pool) if db_pool else None
        # Full per-run detail (feature 068): OK runs persist their serialized BacktestResult
        # here; GetBacktest reads it back (DB-only — never the in-memory dict). None in the
        # no-DB test path.
        self._backtest_details_repo = BacktestDetailsRepository(db_pool) if db_pool else None
        # Per-symbol evidence cells for the derived headline grade (feature 065). RunBacktest
        # buffers one cell per symbol on an OK run and flushes here; _recompute_headline reads
        # them back. None in the no-DB test path.
        self._backtest_run_symbols_repo = BacktestRunSymbolsRepository(db_pool) if db_pool else None
        # Persisted per-user opportunity dispositions (feature 097). Reuses db_pool (F-06);
        # None in the no-DB test path. Read back by ListOpportunities (Step 12).
        self._opportunity_actions_repo = OpportunityActionsRepository(db_pool) if db_pool else None
        # Materialized per-user opportunity queue (feature 097). ListOpportunities is a pure read
        # of this table; lazy compute-on-read + stale-while-revalidate + a daily refresh keep it
        # fresh. Reuses db_pool (F-06); None in the no-DB test path.
        self._opportunities_repo = OpportunitiesRepository(db_pool) if db_pool else None
        # Per-user compute serialization (OR-A): a lazy asyncio.Lock so two tabs' cold reads
        # don't double-compute; a set marks users with a background recompute already in flight
        # (stale-while-revalidate) so a burst of stale reads kicks exactly one recompute.
        # Single-process protection only (documented, like _recompute_locks).
        self._opportunity_locks: dict[str, asyncio.Lock] = {}
        self._opportunity_recomputing: set[str] = set()
        # Per-strategy recompute serialization (feature 065). asyncio.Lock is non-reentrant, so
        # a trigger already holding the lock calls only _recompute_headline_locked. Single-process
        # protection only (documented). Keyed by strategy_id, created lazily.
        self._recompute_locks: dict[str, asyncio.Lock] = {}
        # Set by main.py after the fundamentals signal loop is constructed (feature 062);
        # RunFundamentalsScan invokes its shared run_once path.
        self._fundsignal_loop = None

    @staticmethod
    def _has_admin_scope(context) -> bool:
        """Role check on the propagated x-access-scope ADMIN bit (0x04).

        Internal services trust the access scope set by the entry points (UI BFF via JWT,
        MCP agent via its OAuth 2.1 Streamable HTTP auth layer) and do a role check at
        most — they do not re-authenticate. Shared by ManageStrategy and (feature 048)
        SetStrategyLive.
        """
        metadata = dict(context.invocation_metadata())
        try:
            access_scope = int(metadata.get("x-access-scope", "0"))
        except (TypeError, ValueError):
            access_scope = 0
        return bool(access_scope & 0x04)

    @staticmethod
    def _caller_user_id(context) -> str:
        """The owning user resolved from the propagated ``x-user-id`` header (feature 133).

        The external edge (UI BFF via JWT, MCP agent via its OAuth layer) injects this header
        after authenticating; internal services trust it. Ownership-scoped strategy RPCs resolve
        the target row against this id and answer a miss (nonexistent or other-owner) with a
        uniform ``PERMISSION_DENIED`` — so a caller can never learn from the response whether a
        ``strategy_id`` exists under someone else's ownership. An empty caller id owns nothing.
        """
        return dict(context.invocation_metadata()).get("x-user-id", "")

    async def _fetch_formula_outputs(self, definition, propagation_meta) -> dict:
        """Map each custom-formula component's formula_id to the set of series it exposes.

        Always includes the implicit "value" series. Used at strategy write time to
        validate dotted ``<ref_name>.<series>`` references against the formula's declared
        outputs. A formula that can't be fetched defaults to {"value"} (strict).
        """
        formula_outputs: dict[str, set[str]] = {}
        for comp in definition.components:
            if comp.kind != analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA:
                continue
            if not comp.formula_id or comp.formula_id in formula_outputs:
                continue
            allowed = {"value"}
            try:
                formula = await self._indicators.GetFormula(
                    indicators_pb2.GetFormulaRequest(formula_id=comp.formula_id),
                    metadata=propagation_meta,
                )
                allowed.update(o.name for o in formula.outputs)
            except grpc.aio.AioRpcError as e:
                log.warning("could not fetch formula %s outputs: %s", comp.formula_id, e)
            formula_outputs[comp.formula_id] = allowed
        return formula_outputs

    async def _deleted_formula_warnings(self, definition, propagation_meta) -> list[str]:
        """Warnings for each custom-formula component whose formula is soft-deleted (feature 086).

        Each referenced formula is fetched once; a fetch failure (e.g. NOT_FOUND) is swallowed —
        only a live ``deleted`` flag is a deletion signal. Used both to flag deletion on read
        (backtest run + GetStrategy live status) and to refuse a new binding on write.
        """
        warnings: list[str] = []
        seen: set[str] = set()
        for comp in definition.components:
            if comp.kind != analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA:
                continue
            if not comp.formula_id or comp.formula_id in seen:
                continue
            seen.add(comp.formula_id)
            try:
                formula = await self._indicators.GetFormula(
                    indicators_pb2.GetFormulaRequest(formula_id=comp.formula_id),
                    metadata=propagation_meta,
                )
            except grpc.aio.AioRpcError:
                continue
            if formula.deleted:
                warnings.append(_deleted_formula_warning(formula.name, comp.formula_id))
        return warnings

    async def _refuse_deleted_bindings(self, definition, context, propagation_meta) -> bool:
        """Write-time guard (feature 086): refuse binding a strategy to a soft-deleted formula.

        Checks the request's own components (not the stored union), so an update that leaves an
        already-deleted binding untouched is not blocked, but no new deleted binding is accepted.
        Returns True if it aborted.
        """
        warnings = await self._deleted_formula_warnings(definition, propagation_meta)
        if warnings:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, warnings[0])
            return True
        return False

    async def _validate_definition_proto(self, definition, context) -> None:
        """Validate a StrategyDefinition; abort INVALID_ARGUMENT on failure."""
        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]
        # Feature 086: refuse binding a strategy to a soft-deleted formula (aborts on the first).
        if await self._refuse_deleted_bindings(definition, context, propagation_meta):
            return
        formula_outputs = await self._fetch_formula_outputs(definition, propagation_meta)
        try:
            _validate_definition(definition, formula_outputs)
        except ValueError as e:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(e))

    async def RunBacktest(self, request, context):
        backtest_id = str(uuid.uuid4())
        commission = self._cfg.get_float("analysis.backtest.default_commission_pct", 0.001)
        slippage = self._cfg.get_float("analysis.backtest.default_slippage_pct", 0.0005)

        log.info(
            "running backtest id=%s strategy=%s symbols=%s",
            backtest_id,
            request.strategy_id,
            list(request.symbols),
        )

        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]
        # Feature 133: the caller owns any registered strategy this run touches (ref branch below)
        # and any headline recompute afterward.
        caller_user_id = self._caller_user_id(context)

        # Emit start event
        from google.protobuf.struct_pb2 import Struct

        payload = Struct()
        payload.update({"backtest_id": backtest_id, "strategy_id": request.strategy_id})
        await self._ledger.AppendEvent(
            ledger_pb2.AppendEventRequest(
                event_type="analysis.backtest.started",
                source_service="xstockstrat-analysis",
                stream_key=f"backtest:{backtest_id}",
                payload=payload,
            ),
            metadata=propagation_meta,
        )

        # Extract strategy params from the Struct
        params = {}
        if request.HasField("strategy_params"):
            params = dict(request.strategy_params.fields)
            params = {k: _unwrap_value(v) for k, v in params.items()}

        fast_period = int(params.get("fast_period", 20))
        slow_period = int(params.get("slow_period", 50))
        min_conviction = float(params.get("min_conviction", 0.0))
        # feature 097 (Option 2): a strategy's backtest score is TECHNICAL-ONLY. The legacy
        # `signal_sources`/`signal_weight`/`technical_weight` blend was retired here — a signal is
        # no longer an input to a strategy's internal score; it is a universe + independent queue
        # ranking axis (ListOpportunities). `scoring.compute_signal_score`/`combine_score` stay for
        # the screener (ScreenSymbols), and `StrategyDefinition.signal_params` (live-loop symbol
        # universe) + the 065 fingerprint are untouched (ANALYSIS-3).

        # Resolve strategy definition: inline takes precedence over strategy_id_ref (FR-7).
        # If neither is supplied, fall through to the legacy SMA-crossover path (FR-8).
        active_definition = None
        executed_row = None
        if request.HasField("inline_definition"):
            active_definition = request.inline_definition
        elif request.strategy_id_ref:
            if self._strategies_repo:
                # Feature 133: a backtest against a REGISTERED strategy is owner-scoped — a caller
                # can only run their own. Inline/legacy runs (no strategy_id_ref) are unaffected.
                row = (
                    await self._strategies_repo.get_by_owner_and_id(
                        caller_user_id, request.strategy_id_ref
                    )
                    if caller_user_id
                    else None
                )
                if row:
                    active_definition = _row_to_strategy_definition(row)
                    executed_row = row
                else:
                    await context.abort(
                        grpc.StatusCode.PERMISSION_DENIED,
                        f"strategy '{request.strategy_id_ref}' not found or not owned",
                    )
                    return

        # feature 065: fingerprint the executed definition only when the run executes the
        # strategy's OWN registered definition (strategy_id == strategy_id_ref). Inline runs,
        # the legacy-SMA fallback, id-mismatches, and unregistered ids leave the cells'
        # fingerprint NULL so they never contribute to that strategy's headline grade. The hash
        # is taken from the DB-returned definition_json (post-_to_dict), never a request dict
        # (design.md § fingerprint — the canonicalization rule the fingerprint fn documents).
        run_fingerprint = None
        if (
            request.strategy_id_ref
            and request.strategy_id == request.strategy_id_ref
            and executed_row is not None
        ):
            run_fingerprint = _definition_fingerprint(executed_row["definition_json"])

        # feature 064 (FR-4b): cap every backtest to `analysis.backtest.max_range_days` (~2 years).
        # Both bounds set + span over the cap → reject (reproducibility, not silent clamp). An unset
        # bound (e.g. the agent sends no range) is defaulted so ALL backtests stay bounded.
        max_range_days = self._cfg.get_int("analysis.backtest.max_range_days", 730)
        cap_seconds = max_range_days * 86_400
        start_set = request.range.start.seconds > 0
        end_set = request.range.end.seconds > 0
        if start_set and end_set:
            span_seconds = request.range.end.seconds - request.range.start.seconds
            if span_seconds > cap_seconds:
                await context.abort(
                    grpc.StatusCode.INVALID_ARGUMENT,
                    f"backtest range span {span_seconds // 86_400} days exceeds the "
                    f"{max_range_days}-day (~2 year) maximum",
                )
                return
        else:
            now_ts = Timestamp()
            now_ts.GetCurrentTime()
            end_sec = request.range.end.seconds if end_set else now_ts.seconds
            start_sec = request.range.start.seconds if start_set else max(end_sec - cap_seconds, 0)
            request.range.start.seconds = start_sec
            request.range.start.nanos = 0
            request.range.end.seconds = end_sec
            request.range.end.nanos = 0

        all_trades: list[analysis_pb2.TradeRecord] = []
        equity = float(request.initial_capital) if request.initial_capital > 0 else 100_000.0
        initial_equity = equity
        daily_equity: list[float] = [equity]
        coverage_gaps: list[analysis_pb2.CoverageGap] = []
        all_diagnostics: list[analysis_pb2.SymbolDiagnostics] = []  # feature 064
        # feature 067: count symbols dropped by a custom-formula execution error. Used by the
        # status gate below so a no-usable-evidence run reports INSUFFICIENT_DATA (never OK+scored).
        formula_errors: int = 0
        # feature 065: one per-symbol evidence cell buffered per traded symbol; flushed on OK.
        symbol_cells: list[dict] = []
        # feature 064: declared formula warm-ups fetched once per run, reused across symbols.
        formula_warmup_cache: dict[str, int] = {}
        # feature 086: deleted-formula warnings captured during that same single fetch per formula.
        formula_deleted_cache: dict[str, str] = {}
        # feature 071: and resolved BEFORE the loop, so symbol 1 sizes its prefix from the same
        # cache symbol N does (see _prefetch_formula_warmups).
        if active_definition is not None and start_set:
            await self._prefetch_formula_warmups(
                active_definition, formula_warmup_cache, propagation_meta, formula_deleted_cache
            )

        for symbol in request.symbols:
            try:
                if active_definition is not None:
                    trades, equity, daily_eq, sym_diag = await self._backtest_symbol_evaluated(
                        symbol=symbol,
                        range_msg=request.range,
                        definition=active_definition,
                        initial_equity=equity,
                        commission=commission,
                        slippage=slippage,
                        propagation_meta=propagation_meta,
                        formula_warmup_cache=formula_warmup_cache,
                        # feature 071 / FR-2: prefix ONLY when the caller supplied an explicit
                        # start. `start_set` is snapshotted before the defaulting block above
                        # mutates request.range in place and destroys the distinction.
                        warmup_prefix=start_set,
                    )
                else:
                    trades, equity, daily_eq, sym_diag = await self._backtest_symbol(
                        symbol=symbol,
                        range_msg=request.range,
                        fast_period=fast_period,
                        slow_period=slow_period,
                        min_conviction=min_conviction,
                        initial_equity=equity,
                        commission=commission,
                        slippage=slippage,
                        propagation_meta=propagation_meta,
                        warmup_prefix=start_set,
                    )
                # feature 065: buffer one evidence cell for this symbol before merging into the
                # aggregate curve. daily_eq[0] is the symbol's own (compounded) starting equity,
                # so the cell metrics are per-symbol, not aggregate. Symbols with no usable curve
                # (<= the seed point) contribute nothing. Zero-trade cells ARE buffered —
                # non-participation is evidence (traded-first dedup keeps it from shadowing).
                if len(daily_eq) > 1:
                    cell_m = _compute_metrics(daily_eq, trades, daily_eq[0])
                    symbol_cells.append(
                        {
                            "symbol": symbol,
                            "sharpe_ratio": cell_m["sharpe_ratio"],
                            "max_drawdown": cell_m["max_drawdown"],
                            "win_rate": cell_m["win_rate"],
                            "total_return": cell_m["total_return"],
                            "total_trades": len(trades),
                            "trading_days": len(daily_eq) - 1,
                        }
                    )
                all_trades.extend(trades)
                daily_equity.extend(daily_eq)
                all_diagnostics.append(sym_diag)
            except _InsufficientData as ins:
                # FR-2: surface a structured coverage gap instead of faking flat equity.
                log.warning(
                    "backtest symbol %s insufficient data: have %d, need %d",
                    ins.symbol,
                    ins.bars_have,
                    ins.bars_need,
                )
                coverage_gaps.append(
                    analysis_pb2.CoverageGap(
                        symbol=ins.symbol,
                        timeframe=common_pb2.Timeframe.TIMEFRAME_1DAY,
                        requested_range=request.range,
                        bars_have=ins.bars_have,
                        bars_need=ins.bars_need,
                        # feature 071: for a warm-up shortfall the actionable backfill span is
                        # the prefix, not the caller's window (which may be fully covered).
                        gap=ins.gap_range if ins.gap_range is not None else request.range,
                    )
                )
                continue
            except FormulaExecutionError as fe:
                # feature 067: a custom-formula component failed to execute / returned an
                # out-of-contract series. Surface it as a distinct, UI-visible reason instead
                # of silently degrading to an all-None series (→ ENTRY_NEVER_TRUE). The
                # indicators resp.error is surfaced via log only (F-04 — no invented proto
                # error field). Stamp the reason DIRECTLY here — this branch is the single
                # site that sets FORMULA_ERROR; _classify_no_trade_reason (which only sees
                # trades/warmup/n) never returns it and this symbol never reaches
                # _finalize_symbol_diagnostics.
                log.warning("backtest symbol %s formula error: %s — skipping", symbol, fe.error)
                all_diagnostics.append(
                    analysis_pb2.SymbolDiagnostics(
                        symbol=symbol,
                        bars=[],
                        no_trade_reason=analysis_pb2.NO_TRADE_REASON_FORMULA_ERROR,
                        bars_total=0,
                        warmup_bars=0,
                    )
                )
                formula_errors += 1
                continue
            except grpc.RpcError as e:
                log.warning("backtest symbol %s failed: %s — skipping", symbol, e)
                continue
            except Exception as e:
                log.warning("backtest symbol %s error: %s — skipping", symbol, e)
                continue

        # Compute aggregate metrics
        metrics = _compute_metrics(daily_equity, all_trades, initial_equity)

        now = Timestamp()
        now.GetCurrentTime()

        result = analysis_pb2.BacktestResult(
            backtest_id=backtest_id,
            strategy_id=request.strategy_id,
            total_return=metrics["total_return"],
            annualized_return=metrics["annualized_return"],
            sharpe_ratio=metrics["sharpe_ratio"],
            max_drawdown=metrics["max_drawdown"],
            win_rate=metrics["win_rate"],
            total_trades=len(all_trades),
            profit_factor=metrics["profit_factor"],
            completed_at=now,
            trades=all_trades,
            # feature 068: the effective seed (100k default when the request omitted it) —
            # required to interpret the persisted equity curve for a historical run.
            initial_capital=initial_equity,
        )
        # FR-2: if every symbol was insufficient (no trades, no usable bars beyond the seed
        # equity point), report INSUFFICIENT_DATA instead of a fabricated flat-equity success.
        # A partial multi-symbol backtest stays OK but still carries the per-symbol gaps.
        # feature 067: an all-failed / single-symbol-failed formula run (no trades, no usable
        # curve) is likewise no-usable-evidence — fold formula_errors into the gate so it does
        # not masquerade as OK and persist a spurious per-run score (feature 053 regression).
        # A partial run where some sibling traded (all_trades non-empty or the curve grew) stays OK.
        if not all_trades and len(daily_equity) <= 1 and (coverage_gaps or formula_errors):
            result.status = analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
        else:
            result.status = analysis_pb2.BACKTEST_STATUS_OK
        if coverage_gaps:
            result.coverage_gaps.extend(coverage_gaps)
        if all_diagnostics:  # feature 064 — per-bar diagnostics for every simulated symbol
            result.diagnostics.extend(all_diagnostics)
        # Feature 086: flag any referenced formula that has been soft-deleted (the run still
        # completed using its last-saved definition). The deletion was detected during the warm-up
        # prefetch's single GetFormula per formula — no extra fetch here.
        if formula_deleted_cache:
            result.warnings.extend(formula_deleted_cache.values())
        self._backtests[backtest_id] = result
        # Index by strategy_id for ScoreStrategy lookup
        self._backtests[request.strategy_id] = result

        # feature 065: the backtest range (always fully set after the defaulting block above) is
        # stamped on the run-history row and on every evidence cell.
        range_start_dt = (
            request.range.start.ToDatetime() if request.range.start.seconds > 0 else None
        )
        range_end_dt = request.range.end.ToDatetime() if request.range.end.seconds > 0 else None

        # feature 065: persist per-symbol evidence cells for OK runs — the breadth+duration base
        # the derived headline grade aggregates over. Best-effort (mirrors the score/history
        # persists): a cells-flush failure never fails the run.
        if result.status == analysis_pb2.BACKTEST_STATUS_OK:
            await self._persist_symbol_cells(
                symbol_cells,
                backtest_id=backtest_id,
                strategy_id=request.strategy_id,
                fingerprint=run_fingerprint,
                range_start=range_start_dt,
                range_end=range_end_dt,
            )

        # Grade THIS run for the run-history row only (feature 065: the headline grade is no
        # longer last-run-wins — it is derived from the strategy's full evidence base below).
        # OK runs earn a per-run score; INSUFFICIENT_DATA runs record history with score = None.
        score = None
        if result.status == analysis_pb2.BACKTEST_STATUS_OK:
            sharpe_weight = self._cfg.get_float("analysis.scoring.sharpe_weight", 0.4)
            drawdown_weight = self._cfg.get_float("analysis.scoring.drawdown_weight", 0.3)
            winrate_weight = self._cfg.get_float("analysis.scoring.win_rate_weight", 0.3)
            score = _score_from_result(
                request.strategy_id, result, sharpe_weight, drawdown_weight, winrate_weight
            )
        await self._persist_backtest_run(
            result,
            list(request.symbols),
            score,
            range_start=range_start_dt,
            range_end=range_end_dt,
        )
        # feature 068: persist the full result (trades + per-bar equity + diagnostics) for
        # OK runs only — INSUFFICIENT runs never get detail (permanent FR-6 state, mirrors
        # the symbol-cells gate above). Best-effort; ordered after the summary insert so the
        # FK (detail ⇒ listed summary) can hold.
        if result.status == analysis_pb2.BACKTEST_STATUS_OK:
            await self._persist_backtest_detail(result)

        # feature 065: recompute the headline grade from the strategy's full evidence base (all
        # eligible cells) now that this run's cells have landed. Best-effort — a recompute failure
        # never fails the run — and ordered BEFORE the completion emit so a subscriber that reads
        # the grade on completion sees the post-run value.
        if result.status == analysis_pb2.BACKTEST_STATUS_OK:
            try:
                await self._recompute_headline(caller_user_id, request.strategy_id)
            except Exception as e:
                log.warning("failed to recompute headline score: %s", e)

        # Emit completion event
        payload2 = Struct()
        payload2.update(
            {
                "backtest_id": backtest_id,
                "total_return": result.total_return,
                "sharpe_ratio": result.sharpe_ratio,
                "max_drawdown": result.max_drawdown,
                "total_trades": result.total_trades,
            }
        )
        await self._ledger.AppendEvent(
            ledger_pb2.AppendEventRequest(
                event_type="analysis.backtest.completed",
                source_service="xstockstrat-analysis",
                stream_key=f"backtest:{backtest_id}",
                payload=payload2,
            ),
            metadata=propagation_meta,
        )

        return result

    async def _fetch_bars_paged(self, symbol, range_msg, propagation_meta):
        """Fetch every bar in ``range_msg``, following marketdata's pagination (feature 071).

        Both engine paths previously issued a single un-paged ``GetBars``, which marketdata
        serves with ``pageSize := 500`` and ``ORDER BY time ASC LIMIT`` — so any range wider
        than 500 bars silently lost its **newest** bars.

        Safety properties (a partial series must never be returned silently):
        - **Strict cursor monotonicity.** Each page must contribute at least one bar strictly
          newer than the last one seen. marketdata falls back to ``cursor = start`` on an
          unparseable page token, re-serving the identical page with the identical token; this
          turns that infinite loop into a loud failure.
        - **Page cap.** ``_MAX_BAR_PAGES`` bounds the loop. Exhausting it raises.

        A full page with an empty ``next_page_token`` is genuine EOF, not a lost tail:
        marketdata queries ``LIMIT pageSize+1`` and only sets a token when it saw the extra
        row, so it cannot both fill a page and forget the cursor.
        """
        bars: list = []
        page_token = ""
        last_seen = None

        for _ in range(_MAX_BAR_PAGES):
            resp = await self._marketdata.GetBars(
                marketdata_pb2.GetBarsRequest(
                    symbol=symbol,
                    timeframe="1d",  # canonical: matches the backfill path's stored "1d" bars
                    timeframe_enum=common_pb2.Timeframe.TIMEFRAME_1DAY,
                    range=range_msg,
                    page=common_pb2.PageRequest(page_size=_BAR_PAGE_SIZE, page_token=page_token),
                ),
                metadata=propagation_meta,
            )
            page = list(resp.bars)

            fresh = [
                b for b in page if last_seen is None or (b.time.seconds, b.time.nanos) > last_seen
            ]
            if not fresh:
                # Either genuine EOF, or a server that re-served an already-consumed page.
                # Both are terminal; neither should loop.
                return bars

            bars.extend(fresh)
            newest = fresh[-1].time
            last_seen = (newest.seconds, newest.nanos)

            page_token = resp.page.next_page_token
            if not page_token:
                return bars

        raise _BarFetchError(
            f"{symbol}: bar pagination exceeded {_MAX_BAR_PAGES} pages "
            f"({len(bars)} bars so far) — refusing to return a truncated series"
        )

    async def _resolve_prefixed_bars(self, symbol, range_msg, required_prefix, propagation_meta):
        """Fetch bars with `required_prefix` bars of pre-window history (feature 071).

        Returns ``(bars, trade_start_idx)`` where ``bars[trade_start_idx]`` is the first bar
        inside the caller's window. Indicators are computed over the whole list so they are
        already warm at that bar; the engine simulates only from ``trade_start_idx`` onward, so
        no trade can open before `start` and the prefix is pure seeding.

        The fetched prefix is truncated to **exactly** `required_prefix` bars. That is what makes
        `prefix_calendar_days`' bars→days conversion sizing-only: an over-estimate is discarded
        deterministically here, and an under-estimate raises below. The conversion can therefore
        never quietly change a result — only over-fetch or report.
        """
        if required_prefix <= 0:
            return await self._fetch_bars_paged(symbol, range_msg, propagation_meta), 0

        prefix_days = warmup.prefix_calendar_days(required_prefix)
        prefixed = common_pb2.TimeRange()
        prefixed.CopyFrom(range_msg)
        prefixed.start.seconds = max(0, range_msg.start.seconds - prefix_days * 86_400)
        prefixed.start.nanos = 0

        bars = await self._fetch_bars_paged(symbol, prefixed, propagation_meta)

        window_start = range_msg.start.seconds
        available = 0
        for bar in bars:
            if bar.time.seconds >= window_start:
                break
            available += 1

        if available < required_prefix:
            gap = common_pb2.TimeRange()
            gap.start.CopyFrom(prefixed.start)
            gap.end.CopyFrom(range_msg.start)
            raise _InsufficientData(symbol, available, required_prefix, gap_range=gap)

        # Discard the surplus so the anchor is a deterministic function of (definition, start).
        return bars[available - required_prefix :], required_prefix

    async def _backtest_symbol(
        self,
        symbol,
        range_msg,
        fast_period,
        slow_period,
        min_conviction,
        initial_equity,
        commission,
        slippage,
        propagation_meta=(),
        *,
        warmup_prefix: bool = False,
    ):
        """Run SMA crossover backtest for a single symbol.

        Returns (trades, final_equity, daily_equity, diagnostics) — feature 064.
        """

        # 1. Fetch OHLCV bars (feature 071: paged, plus a pre-window prefix when the caller
        # supplied an explicit start). The legacy engine's binding lookback is slow_period.
        required_prefix = (
            warmup.builtin_lookback_bars("SMA", {"period": slow_period}) if warmup_prefix else 0
        )
        bars, trade_start_idx = await self._resolve_prefixed_bars(
            symbol, range_msg, required_prefix, propagation_meta
        )
        if len(bars) < slow_period + 2:
            log.warning(
                "symbol %s has insufficient bars (%d < %d)", symbol, len(bars), slow_period + 2
            )
            raise _InsufficientData(symbol, len(bars), slow_period + 2)

        closes = [b.close for b in bars]

        # 2. Compute fast and slow SMAs via indicators service
        fast_resp = await self._indicators.ComputeIndicator(
            indicators_pb2.ComputeIndicatorRequest(
                indicator="SMA",
                values=closes,
                params={"period": float(fast_period)},
                symbol=symbol,
                timeframe="1d",
            ),
            metadata=propagation_meta,
        )
        slow_resp = await self._indicators.ComputeIndicator(
            indicators_pb2.ComputeIndicatorRequest(
                indicator="SMA",
                values=closes,
                params={"period": float(slow_period)},
                symbol=symbol,
                timeframe="1d",
            ),
            metadata=propagation_meta,
        )

        # Build bar-aligned SMA maps (points only available after warm-up period).
        # ComputeIndicator omits warm-up rows without preserving indices, so tail-align
        # the shortened result back onto the bars (same helper as the evaluator path).
        n = len(bars)
        fast_values = {
            i: v
            for i, v in enumerate(align_indicator_points(fast_resp.result, n)["value"])
            if v is not None
        }
        slow_values = {
            i: v
            for i, v in enumerate(align_indicator_points(slow_resp.result, n)["value"])
            if v is not None
        }

        # feature 097 (Option 2): the backtest score is technical-only — no newsletter-signal
        # fetch or blend here. A signal is a universe + queue ranking axis (ListOpportunities),
        # never an input to a strategy's internal score. The QuerySignals fetch + signals_map that
        # used to live here were removed with the blend.

        # feature 064: warm-up = first bar where BOTH SMAs are resolved (observed Option-C).
        warmup_bars = max(min(fast_values, default=n - 1), min(slow_values, default=n - 1))
        # feature 071: warmup_bars indexes the fetched series, which may carry a pre-window
        # prefix. Report it relative to the first in-window bar — a fully-warmed prefixed run
        # legitimately reports 0. On an unprefixed run (k == 0) this is a no-op.
        warmup_bars = max(0, warmup_bars - trade_start_idx)

        # feature 064: one diagnostic row per bar, iterated independently of the trade loop
        # (which starts at index 1) so bar 0 is captured. Present-only indicators map.
        diags = []
        for i in range(trade_start_idx, n):
            indicators = {}
            if i in fast_values:
                indicators["sma_fast"] = fast_values[i]
            if i in slow_values:
                indicators["sma_slow"] = slow_values[i]
            diags.append(
                _build_bar_diagnostic(
                    symbol=symbol,
                    bar_index=i - trade_start_idx,
                    bar=bars[i],
                    indicators=indicators,
                    signal_score=0.0,
                    conviction=0.0,
                    action=analysis_pb2.BAR_ACTION_HOLD_FLAT,
                    warmup=False,
                )
            )

        # 4. Simulate trades bar by bar
        trades = []
        equity = initial_equity
        position = 0.0  # shares held
        entry_price = 0.0
        entry_time = None
        # feature 071: daily_equity[j] pairs with diags[j]. On an unprefixed run (k == 0) index 0
        # is the seed point at bar 0, which is never simulated. With a pre-window prefix the first
        # simulated bar IS bar k, so there is no separate seed row — otherwise the two lists would
        # differ in length by one and every per-bar equity stamp would shift.
        daily_equity = [equity] if trade_start_idx == 0 else []
        buy_threshold = scoring.buy_threshold(min_conviction)
        sell_threshold = scoring.sell_threshold()

        for i in range(max(1, trade_start_idx), n):
            bar = bars[i]
            price = bar.close

            # Skip until both SMAs are available (these are warm-up bars — labelled below)
            if i not in fast_values or i not in slow_values:
                daily_equity.append(equity + position * price)
                continue

            prev_fast = fast_values.get(i - 1)
            prev_slow = slow_values.get(i - 1)
            curr_fast = fast_values[i]
            curr_slow = slow_values[i]

            if prev_fast is None or prev_slow is None:
                daily_equity.append(equity + position * price)
                continue

            # Technical signal: +1 (bullish crossover), -1 (bearish crossover), 0 (no change)
            if prev_fast <= prev_slow and curr_fast > curr_slow:
                tech_signal = 1.0
            elif prev_fast >= prev_slow and curr_fast < curr_slow:
                tech_signal = -1.0
            else:
                tech_signal = 0.0

            # feature 097 (Option 2): technical-only conviction — the pure-technical mapping
            # (-1→0, 0→0.5, +1→1) with no newsletter-signal blend. This is identical to the
            # prior no-signal path (combine_score with signals_present=False), so a run that
            # never weighted signals is byte-for-byte unchanged; only signal-weighted runs move.
            combined = tech_signal * 0.5 + 0.5
            diags[i - trade_start_idx].signal_score = 0.0
            diags[i - trade_start_idx].conviction = combined
            bar_action = (
                analysis_pb2.BAR_ACTION_HOLD_LONG
                if position > 0.0
                else analysis_pb2.BAR_ACTION_HOLD_FLAT
            )

            if position == 0.0 and combined >= buy_threshold:
                # Buy: use 95% of equity (keep 5% as buffer)
                fill_price = price * (1 + slippage)
                shares = (equity * 0.95) / fill_price
                cost = shares * fill_price * (1 + commission)
                if cost <= equity:
                    position = shares
                    entry_price = fill_price
                    entry_time = bar.time
                    equity -= cost
                    # feature 064: label ENTER only when the fill actually happens
                    bar_action = analysis_pb2.BAR_ACTION_ENTER_LONG

            elif position > 0.0 and combined <= sell_threshold:
                # Sell: close position
                fill_price = price * (1 - slippage)
                proceeds = position * fill_price * (1 - commission)
                pnl = proceeds - (position * entry_price * (1 + commission))

                exit_ts = Timestamp()
                exit_ts.CopyFrom(bar.time)
                entry_ts = Timestamp()
                entry_ts.CopyFrom(entry_time)

                trades.append(
                    analysis_pb2.TradeRecord(
                        symbol=symbol,
                        side="long",
                        qty=position,
                        entry_price=entry_price,
                        exit_price=fill_price,
                        pnl=pnl,
                        entry_time=entry_ts,
                        exit_time=exit_ts,
                    )
                )
                equity += proceeds
                position = 0.0
                entry_price = 0.0
                entry_time = None
                bar_action = analysis_pb2.BAR_ACTION_EXIT_LONG

            diags[i - trade_start_idx].action = bar_action
            portfolio_value = equity + position * price
            daily_equity.append(portfolio_value)

        # Close any open position at last bar price
        if position > 0.0 and bars:
            last_bar = bars[-1]
            fill_price = last_bar.close * (1 - slippage)
            proceeds = position * fill_price * (1 - commission)
            pnl = proceeds - (position * entry_price * (1 + commission))
            now_ts = Timestamp()
            now_ts.CopyFrom(last_bar.time)
            entry_ts2 = Timestamp()
            entry_ts2.CopyFrom(entry_time)
            trades.append(
                analysis_pb2.TradeRecord(
                    symbol=symbol,
                    side="long",
                    qty=position,
                    entry_price=entry_price,
                    exit_price=fill_price,
                    pnl=pnl,
                    entry_time=entry_ts2,
                    exit_time=now_ts,
                )
            )
            equity += proceeds
            daily_equity[-1] = equity
            # feature 064: the forced close labels the last bar an exit (AC-3)
            diags[-1].action = analysis_pb2.BAR_ACTION_EXIT_LONG

        symbol_diag = _finalize_symbol_diagnostics(symbol, diags, warmup_bars, trades, daily_equity)
        return trades, equity, daily_equity, symbol_diag

    async def _backtest_symbol_evaluated(
        self,
        symbol,
        range_msg,
        definition,
        initial_equity,
        commission,
        slippage,
        propagation_meta=(),
        formula_warmup_cache=None,
        *,
        warmup_prefix: bool = False,
    ):
        """Run a stored/inline StrategyDefinition for one symbol via the shared evaluator.

        Drives entry/exit from StrategyEvaluator decisions (backtest/live parity).
        Returns (trades, final_equity, daily_equity, diagnostics) — feature 064.
        """
        # feature 071: paged, plus a pre-window prefix when the caller supplied an explicit
        # start. Declared (never observed) — see app/services/warmup.py.
        required_prefix = (
            warmup.required_prefix_bars(definition, formula_warmup_cache) if warmup_prefix else 0
        )
        bars, trade_start_idx = await self._resolve_prefixed_bars(
            symbol, range_msg, required_prefix, propagation_meta
        )
        if len(bars) < 2:
            log.warning("symbol %s has insufficient bars (%d)", symbol, len(bars))
            raise _InsufficientData(symbol, len(bars), 2)

        evaluator = StrategyEvaluator(self._indicators, propagation_meta)
        # feature 064: also capture the computed component series for diagnostics.
        decisions, component_series = await evaluator.evaluate_with_series(definition, bars, None)

        n = len(bars)
        warmup_bars_full = await self._compute_evaluated_warmup(
            definition, component_series, n, formula_warmup_cache, propagation_meta
        )
        # feature 071: that index is into the fetched series, which may carry a pre-window
        # prefix. Report it relative to the first in-window bar — a fully-warmed prefixed run
        # legitimately reports 0. On an unprefixed run (k == 0) this is a no-op.
        warmup_bars = max(0, warmup_bars_full - trade_start_idx)

        # feature 064: per-bar diagnostics (independent of the trade loop → bar 0 captured).
        # Present-only indicators map, dropping the redundant "<ref>.value" alias (the bare
        # ref_name already carries the primary series).
        diags = []
        for i in range(trade_start_idx, n):
            indicators = {
                key: series[i]
                for key, series in component_series.items()
                if not key.endswith(".value") and i < len(series) and series[i] is not None
            }
            diags.append(
                _build_bar_diagnostic(
                    symbol=symbol,
                    bar_index=i - trade_start_idx,
                    bar=bars[i],
                    indicators=indicators,
                    signal_score=0.0,  # evaluator path carries no newsletter signals (FR-4a)
                    conviction=decisions[i].conviction,
                    action=analysis_pb2.BAR_ACTION_HOLD_FLAT,
                    warmup=False,
                )
            )

        trades = []
        equity = initial_equity
        position = 0.0
        entry_price = 0.0
        entry_time = None
        # feature 071: daily_equity[j] pairs with diags[j]. On an unprefixed run (k == 0) index 0
        # is the seed point at bar 0, which is never simulated. With a pre-window prefix the first
        # simulated bar IS bar k, so there is no separate seed row — otherwise the two lists would
        # differ in length by one and every per-bar equity stamp would shift.
        daily_equity = [equity] if trade_start_idx == 0 else []

        # Re-entry cooldown (feature 069). Ephemeral per-RunBacktest state (FR-7): last_exit_time is
        # a plain local, never read from or written to analysis.strategy_cooldowns, so two runs of
        # the same strategy/symbol can never cross-contaminate. Resolved once per symbol-run.
        cooldown_days = effective_cooldown_days(
            definition.cooldown_days if definition.HasField("cooldown_days") else None,
            self._cfg.get_int("analysis.strategy.default_cooldown_days", 31),
        )
        # Exit cooldown (feature 116) — minimum holding period. Ephemeral per-RunBacktest state
        # (FR-5/FR-7), symmetric to the re-entry cooldown above. get_int_present (not get_int) —
        # a configured 0 is a legitimate, meaningful default and must not be zero-trapped.
        exit_cooldown_days = effective_cooldown_days(
            definition.exit_cooldown_days if definition.HasField("exit_cooldown_days") else None,
            self._cfg.get_int_present("analysis.strategy.default_exit_cooldown_days", 0),
        )
        last_exit_time = None

        for i in range(max(1, trade_start_idx), n):
            bar = bars[i]
            price = bar.close
            decision = decisions[i]
            bar_action = (
                analysis_pb2.BAR_ACTION_HOLD_LONG
                if position > 0.0
                else analysis_pb2.BAR_ACTION_HOLD_FLAT
            )

            if (
                position == 0.0
                and decision.entry
                and not is_cooldown_active(
                    last_exit_time, bar.time.ToDatetime(tzinfo=UTC), cooldown_days
                )
            ):
                fill_price = price * (1 + slippage)
                shares = (equity * 0.95) / fill_price
                cost = shares * fill_price * (1 + commission)
                if cost <= equity:
                    position = shares
                    entry_price = fill_price
                    entry_time = bar.time
                    equity -= cost
                    bar_action = analysis_pb2.BAR_ACTION_ENTER_LONG
            elif (
                position > 0.0
                and decision.exit
                and not is_cooldown_active(
                    entry_time.ToDatetime(tzinfo=UTC) if entry_time is not None else None,
                    bar.time.ToDatetime(tzinfo=UTC),
                    exit_cooldown_days,
                )
            ):
                fill_price = price * (1 - slippage)
                proceeds = position * fill_price * (1 - commission)
                pnl = proceeds - (position * entry_price * (1 + commission))
                exit_ts = Timestamp()
                exit_ts.CopyFrom(bar.time)
                entry_ts = Timestamp()
                entry_ts.CopyFrom(entry_time)
                trades.append(
                    analysis_pb2.TradeRecord(
                        symbol=symbol,
                        side="long",
                        qty=position,
                        entry_price=entry_price,
                        exit_price=fill_price,
                        pnl=pnl,
                        entry_time=entry_ts,
                        exit_time=exit_ts,
                    )
                )
                equity += proceeds
                position = 0.0
                entry_price = 0.0
                entry_time = None
                last_exit_time = bar.time.ToDatetime(tzinfo=UTC)  # feature 069: cooldown clock
                bar_action = analysis_pb2.BAR_ACTION_EXIT_LONG

            diags[i - trade_start_idx].action = bar_action
            daily_equity.append(equity + position * price)

        # Close any open position at the last bar price
        if position > 0.0 and bars:
            last_bar = bars[-1]
            fill_price = last_bar.close * (1 - slippage)
            proceeds = position * fill_price * (1 - commission)
            pnl = proceeds - (position * entry_price * (1 + commission))
            now_ts = Timestamp()
            now_ts.CopyFrom(last_bar.time)
            entry_ts2 = Timestamp()
            entry_ts2.CopyFrom(entry_time)
            trades.append(
                analysis_pb2.TradeRecord(
                    symbol=symbol,
                    side="long",
                    qty=position,
                    entry_price=entry_price,
                    exit_price=fill_price,
                    pnl=pnl,
                    entry_time=entry_ts2,
                    exit_time=now_ts,
                )
            )
            equity += proceeds
            daily_equity[-1] = equity
            diags[-1].action = analysis_pb2.BAR_ACTION_EXIT_LONG

        symbol_diag = _finalize_symbol_diagnostics(symbol, diags, warmup_bars, trades, daily_equity)
        return trades, equity, daily_equity, symbol_diag

    async def _compute_evaluated_warmup(
        self, definition, component_series, n, formula_warmup_cache, propagation_meta
    ):
        """Option-C hybrid warm-up length for the evaluator path: the max lookback over the
        components the active entry/exit rules reference. Built-in → observed first-resolved
        index (capped n-1). Custom formula → its *declared* warmup_period via GetFormula
        (cached by formula_id across symbols; never observed, so an all-None formula series
        can't inflate the warm-up — design.md Open Risk mitigation)."""
        entry_rule = json.loads(definition.entry_rule) if definition.entry_rule else None
        exit_rule = json.loads(definition.exit_rule) if definition.exit_rule else None
        refs = referenced_refs(entry_rule) | referenced_refs(exit_rule)
        if not refs:
            return 0
        if formula_warmup_cache is None:
            formula_warmup_cache = {}
        ref_to_comp = {c.ref_name: c for c in definition.components}
        warmup = 0
        for ref in refs:
            comp = ref_to_comp.get(ref)
            if comp is None:
                continue
            if comp.kind == analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA:
                declared = await self._declared_formula_warmup(
                    comp.formula_id, formula_warmup_cache, propagation_meta
                )
                warmup = max(warmup, declared)
            else:
                warmup = max(warmup, _first_resolved_index(component_series.get(ref, []), n))
        return warmup

    async def _declared_formula_warmup(
        self, formula_id, cache, propagation_meta, deleted_cache=None
    ) -> int:
        """Declared `warmup_period` for one formula, memoized in `cache` for the whole run.

        An unreachable formula caches 0 rather than raising: a missing declaration must not
        fail a backtest, and the 0 is cached so one dead formula can't re-issue the failing
        RPC once per symbol. When `deleted_cache` is provided (feature 086), the same single
        fetch also records a soft-delete warning for the formula — no extra GetFormula.
        """
        if formula_id not in cache:
            try:
                formula = await self._indicators.GetFormula(
                    indicators_pb2.GetFormulaRequest(formula_id=formula_id),
                    metadata=propagation_meta,
                )
                cache[formula_id] = int(getattr(formula, "warmup_period", 0) or 0)
                if deleted_cache is not None and getattr(formula, "deleted", False):
                    deleted_cache[formula_id] = _deleted_formula_warning(formula.name, formula_id)
            except grpc.RpcError:
                cache[formula_id] = 0
        return cache[formula_id]

    async def _prefetch_formula_warmups(
        self, definition, cache, propagation_meta, deleted_cache=None
    ) -> None:
        """Fill `cache` for every referenced custom formula BEFORE the symbol loop (feature 071).

        Ordering matters: `warmup.required_prefix_bars` is pure and reads this cache at the
        *top* of each symbol's run, while `_compute_evaluated_warmup` fills it at the *bottom*.
        Without a prefetch the first symbol of a formula-using strategy would size its prefix
        from an empty cache — no prefix, short-warmed — while every later symbol got the full
        one. That makes a run's result depend on symbol order, breaking both FR-4 determinism
        and the per-symbol comparability the feature-065 evidence cells assume.
        """
        entry_rule = json.loads(definition.entry_rule) if definition.entry_rule else None
        exit_rule = json.loads(definition.exit_rule) if definition.exit_rule else None
        refs = referenced_refs(entry_rule) | referenced_refs(exit_rule)
        ref_to_comp = {c.ref_name: c for c in definition.components}
        for ref in refs:
            comp = ref_to_comp.get(ref)
            if comp is not None and comp.kind == analysis_pb2.COMPONENT_KIND_CUSTOM_FORMULA:
                await self._declared_formula_warmup(
                    comp.formula_id, cache, propagation_meta, deleted_cache
                )

    async def ScoreStrategy(self, request, context):
        """Manually recompute a strategy's headline grade from its evidence cells (feature 065).

        Repurposed from the old "re-score the latest in-memory backtest": the headline grade is
        now derived from the strategy's full (symbol × window) evidence base, so this RPC is the
        manual refresh after a scoring-config change (RunBacktest / ManageStrategy UPDATE recompute
        automatically). ``ScoreStrategyRequest.range`` is IGNORED — the evidence base is the whole
        eligible cell set, not a window. Unlike the best-effort trigger path, this RPC surfaces
        errors: unregistered → NOT_FOUND, no eligible evidence → clear stale grade + NOT_FOUND,
        cells/store error → UNAVAILABLE.
        """
        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]
        if self._strategies_repo is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "strategy store unavailable")
            return
        # Feature 133: owner-scoped — uniform PERMISSION_DENIED on a non-owned/missing strategy.
        caller_user_id = self._caller_user_id(context)
        row = (
            await self._strategies_repo.get_by_owner_and_id(caller_user_id, request.strategy_id)
            if caller_user_id
            else None
        )
        if row is None:
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED, "strategy not found or not owned"
            )
            return

        async with self._lock_for(request.strategy_id):
            try:
                score = await self._fetch_and_aggregate(request.strategy_id, row)
            except Exception as e:
                log.warning("failed to read evidence cells for score: %s", e)
                await context.abort(grpc.StatusCode.UNAVAILABLE, "evidence store unavailable")
                return
            if score is None:
                # No eligible evidence: clear any stale grade. Unlike the trigger path this delete
                # is NON-best-effort — a delete failure aborts UNAVAILABLE rather than silently
                # leaving a stale grade behind.
                self._strategies.pop(request.strategy_id, None)
                if self._scores_repo is not None:
                    try:
                        await self._scores_repo.delete(request.strategy_id)
                    except Exception as e:
                        log.warning("failed to clear stale score: %s", e)
                        await context.abort(grpc.StatusCode.UNAVAILABLE, "score store unavailable")
                        return
                await context.abort(
                    grpc.StatusCode.NOT_FOUND, "no eligible evidence — run a backtest"
                )
                return
            await self._persist_strategy_score(score)

        # Emit ledger event
        from google.protobuf.struct_pb2 import Struct

        payload = Struct()
        payload.update(
            {
                "strategy_id": request.strategy_id,
                "overall_score": score.overall_score,
                "rating": score.rating,
            }
        )
        try:
            await self._ledger.AppendEvent(
                ledger_pb2.AppendEventRequest(
                    event_type="analysis.strategy.scored",
                    source_service="xstockstrat-analysis",
                    stream_key=f"strategy:{request.strategy_id}",
                    payload=payload,
                ),
                metadata=propagation_meta,
            )
        except Exception as e:
            log.warning("failed to emit ledger event for score: %s", e)

        return score

    async def _persist_strategy_score(self, score) -> None:
        """Update the in-memory serving dict and best-effort durably persist a score.

        Reads serve from ``self._strategies``, so a swallowed write never loses the caller's
        read-your-writes (feature 064, FR-7). The ``math.isfinite`` filter guards the JSONB
        column against a non-finite component (NaN/Infinity would make Postgres reject it).
        Shared by ScoreStrategy and RunBacktest's auto-scoring so the two never diverge.
        """
        self._strategies[score.strategy_id] = score
        if self._scores_repo is None:
            return
        try:
            components = {k: v for k, v in dict(score.component_scores).items() if math.isfinite(v)}
            await self._scores_repo.upsert(
                score.strategy_id,
                score.overall_score,
                score.rating,
                components,
                n_symbols=score.evidence_symbols,
                total_trading_days=score.evidence_days,
                provisional=score.provisional,
            )
        except Exception as e:
            log.warning("failed to persist strategy score: %s", e)

    def _lock_for(self, strategy_id: str) -> asyncio.Lock:
        """Return the (lazily created) per-strategy recompute lock."""
        lock = self._recompute_locks.get(strategy_id)
        if lock is None:
            lock = asyncio.Lock()
            self._recompute_locks[strategy_id] = lock
        return lock

    def _derive_score_from_cells(self, strategy_id, strategy_row, cells):
        """Pure: score each eligible cell and aggregate into a headline StrategyScore.

        Returns the (unpersisted) StrategyScore with evidence provenance, or ``None`` when the
        cells carry zero evidence weight (``Σ trading_days == 0``). Does not touch the DB.
        """
        sharpe_weight = self._cfg.get_float("analysis.scoring.sharpe_weight", 0.4)
        drawdown_weight = self._cfg.get_float("analysis.scoring.drawdown_weight", 0.3)
        winrate_weight = self._cfg.get_float("analysis.scoring.win_rate_weight", 0.3)
        scored: list[tuple[int, float, dict]] = []
        for c in cells:
            overall, comps = _score_from_metrics(
                c["sharpe_ratio"],
                c["max_drawdown"],
                c["win_rate"],
                sharpe_weight,
                drawdown_weight,
                winrate_weight,
            )
            scored.append((int(c["trading_days"]), overall, comps))
        k = self._cfg.get_int("analysis.scoring.shrinkage_days", 250)
        agg = _aggregate_cells(scored, k)
        if agg is None:
            return None
        overall, components, n_symbols, total_days = agg
        min_symbols = self._cfg.get_int("analysis.scoring.min_evidence_symbols", 3)
        min_days = self._cfg.get_int("analysis.scoring.min_evidence_days", 500)
        provisional = n_symbols < min_symbols or total_days < min_days
        return analysis_pb2.StrategyScore(
            strategy_id=strategy_id,
            overall_score=overall,
            rating=_grade(overall),
            component_scores=components,
            evidence_symbols=n_symbols,
            evidence_days=total_days,
            provisional=provisional,
        )

    async def _fetch_and_aggregate(self, strategy_id, strategy_row):
        """Read eligible cells for the strategy's CURRENT fingerprint and derive a score.

        Returns the derived (unpersisted) StrategyScore, or ``None`` when there is zero eligible
        evidence. Raises on a cells-read error so callers can choose best-effort vs. abort. Does
        NOT mutate in-memory or DB state — pure read + compute.
        """
        fingerprint = _definition_fingerprint(strategy_row["definition_json"])
        cells = await self._backtest_run_symbols_repo.fetch_eligible(strategy_id, fingerprint)
        if not cells:
            return None
        return self._derive_score_from_cells(strategy_id, strategy_row, cells)

    async def _recompute_headline(self, user_id: str, strategy_id: str):
        """Derive + persist a strategy's headline grade from its full evidence base.

        Resolves the strategy row BEFORE taking the lock (no lock leak from ad-hoc/unregistered
        ids → returns None). Best-effort trigger path (RunBacktest / ManageStrategy UPDATE);
        callers wrap it in try/except. Returns the new StrategyScore or None.

        Feature 133: owner-scoped — an empty/wrong owner resolves to None (no-op), so a shared
        strategy_id never recomputes the wrong owner's grade.
        """
        if self._strategies_repo is None:
            return None
        row = await self._strategies_repo.get_by_owner_and_id(user_id, strategy_id)
        if row is None:
            return None
        async with self._lock_for(strategy_id):
            return await self._recompute_headline_locked(strategy_id, row)

    async def _recompute_headline_locked(self, strategy_id, strategy_row):
        """Recompute the headline grade; the caller MUST already hold the strategy's lock.

        Zero eligible evidence → clear any stale grade (in-memory pop + best-effort DB delete),
        return None. Otherwise derive, persist via the shared score funnel, return the score.
        asyncio.Lock is non-reentrant, so triggers already inside the lock call ONLY this variant.
        """
        score = await self._fetch_and_aggregate(strategy_id, strategy_row)
        if score is None:
            self._strategies.pop(strategy_id, None)
            if self._scores_repo is not None:
                try:
                    await self._scores_repo.delete(strategy_id)
                except Exception as e:
                    log.warning("failed to clear stale strategy score: %s", e)
            return None
        await self._persist_strategy_score(score)
        return score

    async def _persist_backtest_run(
        self, result, symbols, score, range_start=None, range_end=None
    ) -> None:
        """Best-effort append of a completed backtest to the durable run-history table.

        Fixes "cannot see past run results": the in-memory ``_backtests`` dict only holds
        the latest run per strategy and is lost on restart, so every run is also recorded
        here (summary metrics + the score it earned). No-op in the no-DB test path. The
        ``range_start``/``range_end`` (feature 065) record the window each run covered.
        """
        if self._backtest_runs_repo is None:
            return
        try:
            await self._backtest_runs_repo.insert(
                backtest_id=result.backtest_id,
                strategy_id=result.strategy_id,
                status=analysis_pb2.BacktestStatus.Name(result.status),
                metrics={
                    "total_return": result.total_return,
                    "annualized_return": result.annualized_return,
                    "sharpe_ratio": result.sharpe_ratio,
                    "max_drawdown": result.max_drawdown,
                    "win_rate": result.win_rate,
                    "total_trades": result.total_trades,
                    "profit_factor": result.profit_factor,
                },
                symbols=symbols,
                overall_score=score.overall_score if score is not None else None,
                rating=score.rating if score is not None else None,
                range_start=range_start,
                range_end=range_end,
            )
        except Exception as e:
            log.warning("failed to persist backtest run history: %s", e)

    async def _persist_backtest_detail(self, result) -> None:
        """Best-effort persist of an OK run's full serialized result (feature 068).

        Stores the exact wire bytes ``GetBacktest`` will serve back ("store what you
        serve") and evicts beyond the newest N per strategy in the same repo call.
        The FK to ``backtest_runs`` makes a failed-summary-insert case fail here too,
        inside the same warning wrapper (C-10(b) existence parity). No-op in the no-DB
        test path; a DB error never fails the run.
        """
        if self._backtest_details_repo is None:
            return
        # Clamp: a negative config value would make the eviction LIMIT raise (and be
        # silently swallowed by the wrapper → unbounded growth). The get_int zero-trap
        # means a stored 0 reads as the default 20 (documented in CLAUDE.md).
        retention = max(1, self._cfg.get_int("analysis.backtest.detail_retention_per_strategy", 20))
        try:
            await self._backtest_details_repo.insert(
                backtest_id=result.backtest_id,
                strategy_id=result.strategy_id,
                completed_at=result.completed_at.ToDatetime(),
                result_pb=result.SerializeToString(),
                retention=retention,
            )
        except Exception as e:
            log.warning("failed to persist backtest detail: %s", e)

    async def _persist_symbol_cells(
        self, cells, *, backtest_id, strategy_id, fingerprint, range_start, range_end
    ) -> None:
        """Best-effort flush of per-symbol evidence cells for an OK run (feature 065).

        One row per traded symbol; stamps the shared backtest_id, strategy_id, definition
        fingerprint, and range. No-op in the no-DB test path or when the buffer is empty. A DB
        error is swallowed (mirrors the score/history persists) so a cells-flush failure never
        fails the run.
        """
        if self._backtest_run_symbols_repo is None or not cells:
            return
        try:
            rows = [
                {
                    "backtest_id": backtest_id,
                    "strategy_id": strategy_id,
                    "symbol": c["symbol"],
                    "sharpe_ratio": c["sharpe_ratio"],
                    "max_drawdown": c["max_drawdown"],
                    "win_rate": c["win_rate"],
                    "total_return": c["total_return"],
                    "total_trades": c["total_trades"],
                    "trading_days": c["trading_days"],
                    "definition_fingerprint": fingerprint,
                    "range_start": range_start,
                    "range_end": range_end,
                }
                for c in cells
            ]
            await self._backtest_run_symbols_repo.insert_many(rows)
        except Exception as e:
            log.warning("failed to persist backtest symbol cells: %s", e)

    async def hydrate_scores(self) -> None:
        """Load persisted scores from the DB into the in-memory serving dict at boot.

        Feature 064: makes ListStrategies/GetStrategyReport survive a restart. No-op when
        there is no DB pool (test path). Called best-effort from main.py; ListStrategies
        and GetStrategyReport stay unchanged (they serve self._strategies).
        """
        if self._scores_repo is None:
            return
        rows = await self._scores_repo.list()
        for r in rows:
            self._strategies[r["strategy_id"]] = _row_to_score(r)

    async def ListStrategies(self, request, context):
        # Feature 133: owner-scoped — return only the caller's own strategy scores. The in-memory
        # _strategies cache is keyed by bare strategy_id, so cross-check ownership against the repo
        # (no strategy_scores re-key; a shared strategy_id's grade value is an accepted limitation).
        if self._strategies_repo is not None:
            caller_user_id = self._caller_user_id(context)
            owned, _ = await self._strategies_repo.list(caller_user_id, include_inactive=True)
            owned_ids = {r["strategy_id"] for r in owned}
            strategies = [v for k, v in self._strategies.items() if k in owned_ids]
        else:
            strategies = list(self._strategies.values())
        return analysis_pb2.ListStrategiesResponse(strategies=strategies)

    async def GetStrategyReport(self, request, context):
        # Feature 133: owner-scoped — uniform PERMISSION_DENIED for a non-owned/missing strategy
        # (the in-memory score/backtest caches are keyed by bare strategy_id).
        if self._strategies_repo is not None:
            caller_user_id = self._caller_user_id(context)
            owned = (
                await self._strategies_repo.get_by_owner_and_id(caller_user_id, request.strategy_id)
                if caller_user_id
                else None
            )
            if owned is None:
                await context.abort(
                    grpc.StatusCode.PERMISSION_DENIED,
                    f"strategy '{request.strategy_id}' not found or not owned",
                )
                return
        score = self._strategies.get(request.strategy_id)
        if score is None:
            await context.abort(
                grpc.StatusCode.NOT_FOUND, f"strategy {request.strategy_id} not found"
            )
            return
        result = self._backtests.get(request.strategy_id)
        return analysis_pb2.StrategyReport(
            strategy_id=request.strategy_id,
            score=score,
            latest_backtest=result,
        )

    async def ListBacktests(self, request, context):
        """Return past backtest-run summaries for a strategy, newest first.

        Reads the durable ``analysis.backtest_runs`` table so past run results survive a
        restart (the in-memory ``_backtests`` dict only holds the latest per strategy). The
        full trades/diagnostics are intentionally not returned — history is a compact summary.
        Returns an empty list in the no-DB test path or on any read error.
        """
        if self._backtest_runs_repo is None:
            return analysis_pb2.ListBacktestsResponse()
        # Feature 133: owner-scoped — resolve ownership before returning another user's run history.
        if self._strategies_repo is not None:
            caller_user_id = self._caller_user_id(context)
            owned = (
                await self._strategies_repo.get_by_owner_and_id(caller_user_id, request.strategy_id)
                if caller_user_id
                else None
            )
            if owned is None:
                await context.abort(
                    grpc.StatusCode.PERMISSION_DENIED,
                    f"strategy '{request.strategy_id}' not found or not owned",
                )
                return
        limit = request.limit if request.limit > 0 else 20
        try:
            rows = await self._backtest_runs_repo.list_by_strategy(request.strategy_id, limit=limit)
        except Exception as e:
            log.warning("failed to read backtest run history: %s", e)
            return analysis_pb2.ListBacktestsResponse()
        return analysis_pb2.ListBacktestsResponse(runs=[_row_to_backtest_summary(r) for r in rows])

    async def GetBacktest(self, request, context):
        """Return the persisted full result of a past run (feature 068).

        DB-only read path (design.md — the in-memory ``_backtests`` dict is never
        consulted: it stores INSUFFICIENT results unconditionally, holds colliding
        strategy_id keys, and never evicts). NOT_FOUND is the single state for legacy,
        evicted, and INSUFFICIENT runs — and for the no-DB/read-error paths, which
        degrade the same way (``ListBacktests`` empty-response precedent). No outbound
        gRPC calls → nothing to propagate; no admin gate (read parity with
        ``ListBacktests``).
        """
        row_bytes = None
        if self._backtest_details_repo is not None:
            try:
                row_bytes = await self._backtest_details_repo.get(request.backtest_id)
            except Exception as e:
                log.warning("failed to read backtest detail: %s", e)
                row_bytes = None
        # Abort OUTSIDE the except block: context.abort raises, and a nested abort would
        # be swallowed by the bare except (impl-spec advisory review note).
        if row_bytes is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, "no detailed data for this run")
            return
        result = analysis_pb2.BacktestResult()
        result.ParseFromString(row_bytes)
        return result

    async def ManageStrategy(self, request, context):
        # Feature 133: ownership-gated (the admin gate was removed — see design decision 4).
        # REGISTER opens to any authenticated caller under their own header-derived user_id;
        # UPDATE/DEACTIVATE/REACTIVATE require ownership. An unauthenticated caller (no x-user-id)
        # can never own a row.
        caller_user_id = self._caller_user_id(context)
        if not caller_user_id:
            await context.abort(grpc.StatusCode.PERMISSION_DENIED, "authenticated caller required")
            return
        if self._strategies_repo is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "strategy store unavailable")
            return

        definition = request.definition
        op = request.operation

        if op == analysis_pb2.STRATEGY_OPERATION_REGISTER:
            await self._validate_definition_proto(definition, context)
            # Feature 133: the owner is server-authoritative — set from the header, never trusted
            # from the request body. Two different users may register the same strategy_id
            # (composite (user_id, strategy_id) PK), so the duplicate check is owner-scoped.
            definition.user_id = caller_user_id
            # Feature 089: strict register. An existing id (active OR deactivated) is a conflict —
            # route the caller to reactivate rather than silently overwrite or crash on the PK.
            if (
                await self._strategies_repo.get_by_owner_and_id(
                    caller_user_id, definition.strategy_id
                )
                is not None
            ):
                await context.abort(
                    grpc.StatusCode.ALREADY_EXISTS,
                    f"strategy '{definition.strategy_id}' already exists; use the reactivate "
                    "operation to bring back a deactivated strategy",
                )
                return
            definition_json = json_format.MessageToDict(
                definition, preserving_proto_field_name=True
            )
            try:
                row = await self._strategies_repo.create(
                    caller_user_id,
                    definition.strategy_id,
                    definition.display_name,
                    definition_json,
                )
            except asyncpg.UniqueViolationError:
                # Atomic backstop for a concurrent duplicate that raced the get_by_id check.
                await context.abort(
                    grpc.StatusCode.ALREADY_EXISTS,
                    f"strategy '{definition.strategy_id}' already exists",
                )
                return
            return _row_to_strategy_definition(row)
        if op == analysis_pb2.STRATEGY_OPERATION_UPDATE:
            # feature 070: an update_mask turns UPDATE into a partial merge. Absent mask keeps the
            # pre-070 full-replace path byte-for-byte, so existing clients are unaffected.
            has_mask = request.HasField("update_mask")
            mask_paths = list(request.update_mask.paths) if has_mask else []
            for path in mask_paths:
                if path in _COLUMN_AUTHORITATIVE_PATHS:
                    await context.abort(
                        grpc.StatusCode.INVALID_ARGUMENT,
                        f"update_mask path '{path}' is column-authoritative and cannot be masked; "
                        f"use the dedicated operation instead",
                    )
                    return
                if path not in _MASKABLE_PATHS:
                    await context.abort(
                        grpc.StatusCode.INVALID_ARGUMENT,
                        f"unknown update_mask path '{path}'. Allowed: {sorted(_MASKABLE_PATHS)}",
                    )
                    return

            propagation_meta = [
                (k, v)
                for k, v in context.invocation_metadata()
                if k in ("x-user-id", "x-access-scope", "x-trace-id")
            ]
            # Pre-fetch formula outputs BEFORE opening the transaction — `apply_fn` runs with the
            # row locked and must not do I/O. Fetch for the union of the request's components and
            # the stored ones, so any merge outcome is covered. A component that somehow escapes
            # the union fails closed: `_validate_definition` treats a missing entry as {"value"}.
            pre = await self._strategies_repo.get_by_owner_and_id(
                caller_user_id, definition.strategy_id
            )
            if pre is None:
                # Uniform PERMISSION_DENIED (feature 133): never reveal whether the id exists
                # under another owner.
                await context.abort(
                    grpc.StatusCode.PERMISSION_DENIED,
                    f"strategy '{definition.strategy_id}' not found or not owned",
                )
                return
            # Feature 086: refuse a new binding to a soft-deleted formula. Checks the request's own
            # components only, so an update that leaves an existing (already-deleted) binding
            # untouched is not blocked.
            if await self._refuse_deleted_bindings(definition, context, propagation_meta):
                return
            union = analysis_pb2.StrategyDefinition()
            union.CopyFrom(_row_to_strategy_definition(pre))
            union.components.extend(definition.components)
            formula_outputs = await self._fetch_formula_outputs(union, propagation_meta)

            async def _apply(current, _defn=definition, _mask=mask_paths, _has=has_mask):
                old_json = current["definition_json"] or {}
                if _has:
                    merged_json = _merge_definition_json(old_json, _defn, _mask)
                    # Rebuild through the shared row→proto mapper so the column-authoritative
                    # overlay stays the single source of that logic — but feed it the merged
                    # display_name, or a masked rename would be overwritten by the stored value.
                    synthetic = {
                        **current,
                        "definition_json": merged_json,
                        "display_name": merged_json.get("display_name", current["display_name"]),
                    }
                    to_write = _row_to_strategy_definition(synthetic)
                    # Persist what was validated, not the raw merged dict: ParseDict drops
                    # unknown keys and coerces map<string,double>, so the two can differ.
                    new_json = json_format.MessageToDict(to_write, preserving_proto_field_name=True)
                    new_name = to_write.display_name
                else:
                    to_write = _defn
                    new_json = json_format.MessageToDict(_defn, preserving_proto_field_name=True)
                    new_name = _defn.display_name

                err = _guard_erasure(old_json, new_json, set(_mask))
                if err is not None:
                    raise _MergeRejected(err)
                try:
                    _validate_definition(to_write, formula_outputs)
                except ValueError as e:
                    raise _MergeRejected(str(e)) from e
                return new_name, new_json

            try:
                row = await self._strategies_repo.update_locked(
                    caller_user_id, definition.strategy_id, _apply
                )
            except _MergeRejected as e:
                await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(e))
                return
            if row is None:
                await context.abort(
                    grpc.StatusCode.NOT_FOUND,
                    f"strategy '{definition.strategy_id}' not found",
                )
                return
            # feature 065: a definition change usually changes the fingerprint, so the old
            # evidence base no longer applies. Under the strategy's lock, unconditionally clear
            # the stale in-memory grade FIRST, then best-effort recompute against the NEW
            # fingerprint (typically empty until a fresh backtest → grade cleared). The UPDATE
            # response never fails on a recompute error. (A display-name-only edit keeps the same
            # fingerprint, so recompute simply reinstates the same grade.)
            sid = definition.strategy_id
            async with self._lock_for(sid):
                self._strategies.pop(sid, None)
                try:
                    await self._recompute_headline_locked(sid, row)
                except Exception as e:
                    log.warning("failed to recompute headline after update: %s", e)
            return _row_to_strategy_definition(row)
        if op == analysis_pb2.STRATEGY_OPERATION_DEACTIVATE:
            row = await self._strategies_repo.deactivate(caller_user_id, definition.strategy_id)
            if row is None:
                await context.abort(
                    grpc.StatusCode.PERMISSION_DENIED,
                    f"strategy '{definition.strategy_id}' not found or not owned",
                )
                return
            return _row_to_strategy_definition(row)
        if op == analysis_pb2.STRATEGY_OPERATION_REACTIVATE:
            # Feature 089: reactivation decoupled from update. Re-validate the STORED definition
            # first (a referenced formula may have gone missing while it was deactivated) so a
            # reactivated strategy satisfies the firing contract, rather than erroring each cycle.
            existing = await self._strategies_repo.get_by_owner_and_id(
                caller_user_id, definition.strategy_id
            )
            if existing is None:
                await context.abort(
                    grpc.StatusCode.PERMISSION_DENIED,
                    f"strategy '{definition.strategy_id}' not found or not owned",
                )
                return
            await self._validate_definition_proto(_row_to_strategy_definition(existing), context)
            row = await self._strategies_repo.reactivate(caller_user_id, definition.strategy_id)
            if row is None:
                await context.abort(
                    grpc.StatusCode.PERMISSION_DENIED,
                    f"strategy '{definition.strategy_id}' not found or not owned",
                )
                return
            return _row_to_strategy_definition(row)
        await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "unknown strategy operation")

    async def GetStrategy(self, request, context):
        if self._strategies_repo is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "strategy store unavailable")
            return
        # Feature 133: owner-scoped read. A non-owner (or unauthenticated caller) gets a uniform
        # PERMISSION_DENIED, never NOT_FOUND — no existence probing via response code.
        caller_user_id = self._caller_user_id(context)
        row = (
            await self._strategies_repo.get_by_owner_and_id(caller_user_id, request.strategy_id)
            if caller_user_id
            else None
        )
        if row is None:
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED,
                f"strategy '{request.strategy_id}' not found or not owned",
            )
            return
        definition = _row_to_strategy_definition(row)
        # Feature 086 (live-status flag): surface a warning if this strategy references a
        # soft-deleted formula. It still evaluates (live and in backtests) on the last-saved
        # definition, but the deletion is flagged to whoever reads the strategy.
        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]
        deleted_warnings = await self._deleted_formula_warnings(definition, propagation_meta)
        if deleted_warnings:
            definition.warnings.extend(deleted_warnings)
        return definition

    async def ListStrategyDefinitions(self, request, context):
        if self._strategies_repo is None:
            return analysis_pb2.ListStrategyDefinitionsResponse()
        # Feature 133: header-derived owner filter (never read ListStrategiesRequest.user_id from
        # the wire). An empty caller id lists nothing.
        caller_user_id = self._caller_user_id(context)
        rows, total = await self._strategies_repo.list(
            caller_user_id,
            include_inactive=request.include_inactive,
            page_size=request.page_size,
            page_offset=request.page_offset,
        )
        return analysis_pb2.ListStrategyDefinitionsResponse(
            definitions=[_row_to_strategy_definition(r) for r in rows],
            total_count=total,
        )

    async def SetStrategyLive(self, request, context):
        # Feature 133: ownership-gated (the admin gate was removed — design decision 4). Any
        # authenticated caller may toggle live on their OWN strategy; a non-owner (or empty caller)
        # gets a uniform PERMISSION_DENIED.
        caller_user_id = self._caller_user_id(context)
        if not caller_user_id:
            await context.abort(grpc.StatusCode.PERMISSION_DENIED, "authenticated caller required")
            return

        if self._strategies_repo is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "strategy store unavailable")
            return

        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]

        # Feature 089 (F-7): enabling live on an inert config stores a flag that never fires. The
        # live loop selects `live_enabled AND active` and skips a strategy with no
        # signal_params.symbols, so reject both at enable time (FAILED_PRECONDITION). Disabling is
        # ALWAYS allowed — even on an inert config — so an operator can always turn live off.
        if request.live_enabled:
            from app.engine.live_loop import strategy_symbols  # noqa: PLC0415 (avoids import cycle)

            existing = await self._strategies_repo.get_by_owner_and_id(
                caller_user_id, request.strategy_id
            )
            if existing is None:
                await context.abort(
                    grpc.StatusCode.PERMISSION_DENIED,
                    f"strategy '{request.strategy_id}' not found or not owned",
                )
                return
            if not existing["active"]:
                await context.abort(
                    grpc.StatusCode.FAILED_PRECONDITION,
                    "cannot enable live evaluation on an inactive strategy; reactivate it first",
                )
                return
            if not strategy_symbols(_row_to_strategy_definition(existing)):
                await context.abort(
                    grpc.StatusCode.FAILED_PRECONDITION,
                    "strategy has no signal_params.symbols; live evaluation would never fire",
                )
                return

        row = await self._strategies_repo.set_live_enabled(
            caller_user_id, request.strategy_id, request.live_enabled
        )
        if row is None:
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED,
                f"strategy '{request.strategy_id}' not found or not owned",
            )
            return

        # Best-effort ledger event (same swallow-exceptions pattern as ScoreStrategy).
        try:
            from google.protobuf.struct_pb2 import Struct

            payload = Struct()
            payload.update(
                {"strategy_id": request.strategy_id, "live_enabled": request.live_enabled}
            )
            await self._ledger.AppendEvent(
                ledger_pb2.AppendEventRequest(
                    event_type="analysis.strategy.live_toggled",
                    source_service="xstockstrat-analysis",
                    stream_key=f"strategy:{request.strategy_id}",
                    payload=payload,
                ),
                metadata=propagation_meta,
            )
        except Exception as e:
            log.warning("failed to emit live_toggled ledger event: %s", e)

        return analysis_pb2.SetStrategyLiveResponse(definition=_row_to_strategy_definition(row))

    async def ScreenSymbols(self, request, context):
        """Screen a symbol universe against weighted criteria (feature 060).

        Delegates to the pure-ish ScreenerEngine, reusing the same source-weighted scoring
        as a backtest (FR-4) and ExecuteFormula invocation (FR-3). Fundamental criteria
        degrade to skipped when marketdata's GetFundamentals is unavailable (FR-5). Does not
        touch RunBacktest/ScoreStrategy (FR-8).
        """
        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]

        # feature 134 (FR-4 genuine replace): source weights now come from
        # ingest.SignalSource.reliability_weight (reject-at-write in [0,1]), not the
        # retained-but-inert analysis.signals.source_weights config key. Both analysis read paths
        # (this + the Opportunities queue) share the one _drain_source_weights helper.
        source_weights = await self._drain_source_weights(propagation_meta)

        engine = ScreenerEngine(
            self._marketdata, self._indicators, self._ingest, self._cfg, source_weights
        )

        # Enforce the overall scan deadline (default 120s).
        deadline = self._cfg.get_int("analysis.screener.max_duration_seconds", 120)
        try:
            resp = await asyncio.wait_for(
                engine.screen(request, propagation_meta), timeout=deadline
            )
        except TimeoutError:
            await context.abort(
                grpc.StatusCode.DEADLINE_EXCEEDED,
                f"screen exceeded {deadline}s deadline",
            )
            return
        except ValueError as e:
            # feature 090: an unknown fundamental metric_name (a typo of a closed field, or an
            # open metric absent from every scanned symbol) surfaces as INVALID_ARGUMENT rather
            # than a silent skip.
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(e))
            return
        # feature 083 (FR-8) — mark rows the caller already holds (best-effort cross-ref).
        user_id = dict(context.invocation_metadata()).get("x-user-id", "")
        held = await self._drain_held_symbols(user_id, propagation_meta)
        for r in resp.results:
            if r.symbol in held:
                r.held = True
        return resp

    async def RunFundamentalsScan(self, request, context):
        """Manually trigger one fundamentals signal producer scan (feature 062, admin-scoped).

        Reuses the producer's single ``run_once`` path so the scheduled loop and the manual
        trigger never diverge. Forwards the caller's propagation metadata to all outbound calls.
        """
        if not self._has_admin_scope(context):
            await context.abort(grpc.StatusCode.PERMISSION_DENIED, "admin scope required")
            return
        if self._fundsignal_loop is None:
            await context.abort(
                grpc.StatusCode.UNAVAILABLE, "fundamentals signal producer not initialized"
            )
            return

        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]
        return await self._fundsignal_loop.run_once(
            force=request.force,
            dry_run=request.dry_run,
            override_symbols=list(request.symbols) or None,
            metadata=propagation_meta,
        )

    # ── Opportunity queue + readiness (feature 083) ─────────────────────────────

    async def EvaluateReadiness(self, request, context):
        """Trace a strategy's entry-rule conditions against recent bars for each requested
        symbol (feature 083). Returns per-symbol PASS/SOFT/FAIL leaves + a deterministic
        conviction ordinal. Propagates the C-03 header tuple on every outbound call."""
        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]
        if self._strategies_repo is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "strategy store unavailable")
            return
        # Feature 133: owner-scoped — uniform PERMISSION_DENIED on a non-owned/missing strategy.
        caller_user_id = self._caller_user_id(context)
        row = (
            await self._strategies_repo.get_by_owner_and_id(caller_user_id, request.strategy_id)
            if caller_user_id
            else None
        )
        if row is None:
            await context.abort(
                grpc.StatusCode.PERMISSION_DENIED,
                f"strategy '{request.strategy_id}' not found or not owned",
            )
            return
        definition = _row_to_strategy_definition(row)
        evaluator = StrategyEvaluator(self._indicators, propagation_meta)
        range_msg = _recent_range(_READINESS_LOOKBACK_DAYS)
        readiness = []
        for symbol in request.symbols:
            try:
                bars = await self._fetch_bars_paged(symbol, range_msg, propagation_meta)
            except Exception as e:  # bar fetch is best-effort per symbol
                log.warning("EvaluateReadiness: bars fetch failed for %s: %s", symbol, e)
                bars = []
            trace = await evaluator.evaluate_conditions_traced(definition, bars, symbol)
            readiness.append(_readiness_to_proto(trace))
        return analysis_pb2.EvaluateReadinessResponse(readiness=readiness)

    async def ListOpportunities(self, request, context):
        """Pure read of the materialized per-user opportunity queue (feature 097). The Universe
        (active signals ∪ held positions ∪ watchlist ``(symbol, strategy)`` bindings) is computed
        and persisted to ``analysis.opportunities`` by ``_compute_opportunities``; this RPC just
        reads it back, LEFT JOIN ``opportunity_actions`` to drop DISMISS + active SNOOZE, ranked
        by ``(1-w)·conviction + w·signal_axis`` (the independent signal axis — Option 2/OR-G).

        Freshness (lazy compute-on-read + stale-while-revalidate — OR-A/OR-B):
        - **Cold** (never materialized): compute **synchronously** under a per-user lock, then read.
        - **Stale** (rows exist but all expired): serve the stale rows immediately and kick a
          background recompute; the UI shows ``computed_at`` as "as of".
        - **Fresh**: read and serve.
        """
        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]
        user_id = dict(context.invocation_metadata()).get("x-user-id", "")

        if self._opportunities_repo is None:  # no-DB test path
            return analysis_pb2.ListOpportunitiesResponse(page=common_pb2.PageResponse())

        w = self._cfg.get_float("analysis.opportunity.signal_rank_weight", 0.3)
        rows = await self._opportunities_repo.read(
            user_id, request.min_conviction, w, include_expired=False
        )
        if not rows:
            if await self._opportunities_repo.count_for_user(user_id) == 0:
                # Cold read: bounded synchronous compute, then serve.
                await self._materialize_opportunities(user_id, propagation_meta)
                rows = await self._opportunities_repo.read(
                    user_id, request.min_conviction, w, include_expired=False
                )
            else:
                # All rows stale: serve stale now, revalidate in the background.
                self._kick_opportunity_recompute(user_id, propagation_meta)
                rows = await self._opportunities_repo.read(
                    user_id, request.min_conviction, w, include_expired=True
                )

        # Simple offset pagination (page_token = integer offset).
        page_size = request.page.page_size if request.page.page_size > 0 else _DEFAULT_OPP_PAGE_SIZE
        try:
            offset = int(request.page.page_token) if request.page.page_token else 0
        except ValueError:
            offset = 0
        window = rows[offset : offset + page_size]
        next_token = str(offset + page_size) if offset + page_size < len(rows) else ""
        return analysis_pb2.ListOpportunitiesResponse(
            opportunities=[_row_to_opportunity(r) for r in window],
            page=common_pb2.PageResponse(next_page_token=next_token),
        )

    # ── Materialized-queue compute (feature 097) ────────────────────────────────

    def _opportunity_lock(self, user_id: str) -> "asyncio.Lock":
        """Lazily-created per-user compute lock (OR-A). asyncio.Lock is non-reentrant."""
        lock = self._opportunity_locks.get(user_id)
        if lock is None:
            lock = asyncio.Lock()
            self._opportunity_locks[user_id] = lock
        return lock

    async def _materialize_opportunities(self, user_id: str, propagation_meta) -> None:
        """Compute the user's Universe and replace their materialized rows, serialized per user.
        Double-checks under the lock so a second waiter behind a cold read doesn't recompute."""
        async with self._opportunity_lock(user_id):
            if await self._opportunities_repo.count_for_user(user_id) > 0:
                return  # another cold reader populated it while we waited
            rows = await self._compute_opportunities(user_id, propagation_meta)
            await self._opportunities_repo.replace_for_user(user_id, rows)

    def _kick_opportunity_recompute(self, user_id: str, propagation_meta) -> None:
        """Fire-and-forget background recompute (stale-while-revalidate). Guarded so a burst of
        stale reads kicks exactly one recompute per user at a time."""
        if user_id in self._opportunity_recomputing:
            return
        self._opportunity_recomputing.add(user_id)

        async def _run():
            try:
                async with self._opportunity_lock(user_id):
                    rows = await self._compute_opportunities(user_id, propagation_meta)
                    await self._opportunities_repo.replace_for_user(user_id, rows)
            except Exception as e:  # a recompute failure never takes down the loop/read
                log.warning("opportunity recompute failed for user=%s: %s", user_id, e)
            finally:
                self._opportunity_recomputing.discard(user_id)

        asyncio.get_event_loop().create_task(_run())

    async def _compute_opportunities(self, user_id: str, propagation_meta) -> list[dict]:
        """Build the user's opportunity Universe and return persistable row dicts (feature 097).

        Universe = active signals (QuerySignals) ∪ held positions (ListPositions) ∪ watchlist
        ``(symbol, strategy)`` bindings (ListWatchlists) — all over already-wired edges; the new
        ``ListWatchlists`` call is a new method on the existing portfolio channel, not a new edge.

        Attribution: a watchlist binding → its ``strategy_id`` (traced); everything else is
        **unattributed** (``strategy_id=""``, no trace, 0/0) — held positions carry no portfolio
        strategy, so none is fabricated (P-03). Readiness uses the entry-rule trace for entry
        candidates and the **exit-rule trace** for held+attributed candidates (FR-8). The signal
        contributes to a candidate exactly once, on the separate ``signal_axis`` — never folded
        into readiness (FR-3/AC-4). Multiple origins for one ``(symbol, strategy)`` collapse into
        a single row whose ``provenance`` lists them all (FR-4/AC-2).
        """
        signals = await self._drain_active_signals(propagation_meta)
        held = await self._drain_held_symbols(user_id, propagation_meta)
        bindings = await self._drain_watchlist_bindings(propagation_meta)
        # feature 134 — per-source reliability weight scales the signal ranking axis below.
        source_weights = await self._drain_source_weights(propagation_meta)

        # Index the origins by normalized symbol.
        watchlist_by_symbol: dict[str, set[str]] = {}
        for sym, strat in bindings:
            watchlist_by_symbol.setdefault(_normalize_symbol(sym), set()).add(strat)
        signals_by_symbol: dict[str, list] = {}
        for sig in signals:
            signals_by_symbol.setdefault(_normalize_symbol(sig.symbol), []).append(sig)
        held_norm = {_normalize_symbol(s) for s in held}

        candidates: dict[tuple[str, str], dict] = {}

        def _candidate(sym: str, strat: str) -> dict:
            key = (sym, strat)
            c = candidates.get(key)
            if c is None:
                c = {
                    "symbol": sym,
                    "strategy_id": strat,
                    "provenance": [],  # ordered, de-duplicated
                    "signal_axis": 0.0,
                    "thesis": "",
                    "is_watchlist": False,
                    "is_held": False,
                    "best_direction": "",
                    "_best_sig_conv": -1.0,
                }
                candidates[key] = c
            return c

        def _add_provenance(c: dict, origin: str) -> None:
            if origin and origin not in c["provenance"]:
                c["provenance"].append(origin)

        # 1. Watchlist bindings — each (symbol, strategy) is a ready-made candidate.
        for sym, strats in watchlist_by_symbol.items():
            for strat in strats:
                c = _candidate(sym, strat)
                c["is_watchlist"] = True
                _add_provenance(c, "watchlist")

        # 2. Held positions — attribute to each watchlist strategy for the symbol if any,
        #    else an unattributed (symbol, "") candidate (no fabricated strategy).
        for sym in held_norm:
            strats = watchlist_by_symbol.get(sym)
            targets = list(strats) if strats else [""]
            for strat in targets:
                c = _candidate(sym, strat)
                c["is_held"] = True
                _add_provenance(c, "position")

        # 3. Signals — merge into every existing candidate for the symbol (collapse); if none
        #    exists, stand alone as an unattributed (symbol, "") candidate.
        for sym, sigs in signals_by_symbol.items():
            targets = [k for k in candidates if k[0] == sym]
            if not targets:
                _candidate(sym, "")
                targets = [(sym, "")]
            for key in targets:
                c = candidates[key]
                for sig in sigs:
                    _add_provenance(c, sig.source)
                    # feature 134 — weight conviction by the source's reliability (neutral 1.0 for
                    # an unknown/unweighted source, mirroring scoring.compute_signal_score).
                    weighted = sig.conviction * source_weights.get(sig.source, 1.0)
                    c["signal_axis"] = max(c["signal_axis"], weighted)
                    if sig.conviction > c["_best_sig_conv"]:
                        c["_best_sig_conv"] = sig.conviction
                        c["best_direction"] = sig.direction
                        if not c["thesis"]:
                            c["thesis"] = sig.headline

        # FR-1: rank watchlist/held (curated) ABOVE the max_universe_size cut so a curated
        # candidate is never truncated; drop only the speculative signal-only tail.
        max_universe = self._cfg.get_int("analysis.opportunity.max_universe_size", 100)
        curated = [c for c in candidates.values() if c["is_watchlist"] or c["is_held"]]
        speculative = [c for c in candidates.values() if not (c["is_watchlist"] or c["is_held"])]
        speculative.sort(key=lambda c: c["signal_axis"], reverse=True)
        budget = max(0, max_universe - len(curated))
        selected = curated + speculative[:budget]

        # Readiness + row assembly. Attributed candidates fetch bars once each and trace; the
        # session date (for valid_until) is the newest bar seen across the whole compute.
        evaluator = StrategyEvaluator(self._indicators, propagation_meta)
        range_msg = _recent_range(_READINESS_LOOKBACK_DAYS)
        strategy_defs: dict[str, object] = {}  # strategy_id → StrategyDefinition | None (cache)
        session_end_seconds = 0
        window_hours = self._cfg.get_int("analysis.opportunity.valid_window_hours", 24)

        rows: list[dict] = []
        for c in selected:
            sym = c["symbol"]
            strat = c["strategy_id"]
            readiness = _empty_readiness(sym)
            exit_fires = False

            if strat:
                definition = await self._load_strategy_definition(user_id, strat, strategy_defs)
                if definition is not None:
                    try:
                        bars = await self._fetch_bars_paged(sym, range_msg, propagation_meta)
                    except Exception as e:  # bar fetch is best-effort per symbol
                        log.warning("_compute_opportunities: bars fetch failed for %s: %s", sym, e)
                        bars = []
                    if bars:
                        newest = bars[-1].time.seconds
                        session_end_seconds = max(session_end_seconds, newest)
                    # Held + attributed → exit-rule trace (FR-8); else entry-rule trace.
                    rule = "exit" if c["is_held"] else "entry"
                    readiness = await evaluator.evaluate_conditions_traced(
                        definition, bars, sym, rule=rule
                    )
                    if c["is_held"]:
                        total = readiness["total_conditions"]
                        exit_fires = total > 0 and readiness["passing_conditions"] == total

            action = _resolve_action_tag(c, exit_fires)
            if action is None:  # speculative sell-with-no-position → not actionable, drop
                continue

            rows.append(
                {
                    "opportunity_key": _opportunity_key(user_id, sym, strat),
                    "symbol": sym,
                    "strategy_id": strat,
                    "action": int(action),
                    "conviction": readiness["conviction"],
                    "readiness_json": readiness,
                    "signal_axis": c["signal_axis"],
                    "provenance": c["provenance"],
                    "thesis": c["thesis"],
                }
            )

        # OR-D: one session date for the whole compute → uniform valid_until. Fall back to now
        # when no bars were fetched (e.g. an all-unattributed Universe). The holiday/crypto
        # mixed-calendar residual is accepted (revalidated on next read + the daily pass).
        if session_end_seconds > 0:
            session_end = datetime.fromtimestamp(session_end_seconds, tz=UTC)
        else:
            session_end = datetime.now(UTC)
        valid_until = session_end + timedelta(hours=window_hours)
        for r in rows:
            r["valid_until"] = valid_until
        return rows

    async def _load_strategy_definition(self, user_id: str, strategy_id: str, cache: dict):
        """Load + cache a StrategyDefinition for the compute (one DB read per distinct strategy).
        Returns None (cached) when the strategy is missing, deactivated, or not live-enabled — a
        dangling or disabled binding stays a candidate but traces to 0/0 rather than fabricating
        readiness for a strategy the operator turned off (mirrors the live loop's own
        `live_enabled AND active` gate, live_loop.py)."""
        if strategy_id in cache:
            return cache[strategy_id]
        definition = None
        if self._strategies_repo is not None:
            # Feature 133: resolve the binding under the computing user's ownership. A watchlist
            # binding to a legacy strategy_id now owned by a different user resolves to None → the
            # candidate falls back to unattributed (strategy_id="", 0/0), never cross-attributing
            # (design decision 10 — an accepted migration-time trade-off).
            row = await self._strategies_repo.get_by_owner_and_id(user_id, strategy_id)
            if row is not None and row.get("active") and row.get("live_enabled"):
                definition = _row_to_strategy_definition(row)
        cache[strategy_id] = definition
        return definition

    async def _drain_watchlist_bindings(self, propagation_meta) -> list[tuple[str, str]]:
        """Drain the user's watchlist ``(symbol, strategy_id)`` bindings across all watchlists
        (paginated). Ownership is taken from the propagated ``x-user-id`` header server-side
        (never from the wire). Best-effort: a portfolio failure yields no bindings.

        Reads ``Watchlist.bindings`` (feature 097) and falls back to the deprecated flat
        ``symbols`` mirror (unbound → ``strategy_id=""``) for old rows (FR-6)."""
        if self._portfolio is None:
            return []
        out: list[tuple[str, str]] = []
        page_token = ""
        for _ in range(_MAX_DRAIN_PAGES):
            try:
                resp = await self._portfolio.ListWatchlists(
                    portfolio_pb2.ListWatchlistsRequest(
                        page=common_pb2.PageRequest(
                            page_size=_BAR_PAGE_SIZE, page_token=page_token
                        ),
                    ),
                    metadata=propagation_meta,
                )
            except grpc.RpcError as e:
                log.warning("_compute_opportunities: ListWatchlists failed: %s", e)
                return out
            for wl in resp.watchlists:
                if wl.bindings:
                    out.extend((b.symbol, b.strategy_id) for b in wl.bindings)
                else:  # legacy row: flat deprecated symbols mirror, unbound
                    out.extend((s, "") for s in wl.symbols)
            page_token = resp.page.next_page_token
            if not page_token:
                break
        return out

    async def run_opportunity_refresh_forever(self):
        """Configured **daily** refresh pass (feature 097, OR-C) — a wall-clock refresh at
        ``analysis.opportunity.refresh_hour_utc``, NOT market close (holiday/DST/early-close
        drift is expected). Recomputes the OR-E known-user set (``opportunities`` ∪
        ``opportunity_actions``); a watchlist-only user who never reads is never materialized here
        (accepted — the live loop owns alerting). Call as a ``create_task`` on this coroutine.
        """
        if self._opportunities_repo is None:
            return
        while True:
            hour = self._cfg.get_int_present("analysis.opportunity.refresh_hour_utc", 0)
            await asyncio.sleep(_seconds_until_hour_utc(hour))
            try:
                user_ids = await self._opportunities_repo.distinct_user_ids()
            except Exception as e:
                log.warning("opportunity daily refresh: user enumeration failed: %s", e)
                continue
            for uid in user_ids:
                # Background path: synthesize the propagation header from the user id so the
                # per-user portfolio/ingest reads resolve ownership (C-03).
                meta = [("x-user-id", uid)]
                try:
                    async with self._opportunity_lock(uid):
                        rows = await self._compute_opportunities(uid, meta)
                        await self._opportunities_repo.replace_for_user(uid, rows)
                except Exception as e:  # one bad user never kills the pass
                    log.warning("opportunity daily refresh failed for user=%s: %s", uid, e)
                await asyncio.sleep(0)  # cooperative pacing point

    async def SetOpportunityAction(self, request, context):
        """Persist a per-user disposition (snooze/dismiss/take) for a queued opportunity
        (feature 097). ``user_id`` comes from the propagated ``x-user-id`` header; the
        ``opportunity_key`` is the server-issued key the client echoes verbatim. Unlike the
        best-effort background writes, this write is user-visible (the UI reports success), so a
        DB failure surfaces as ``UNAVAILABLE`` rather than being swallowed."""
        metadata = dict(context.invocation_metadata())
        user_id = metadata.get("x-user-id", "")
        if not user_id:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "missing user identity")
        if not request.opportunity_key:
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, "opportunity_key required")
        if self._opportunity_actions_repo is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "opportunity store unavailable")

        snooze_until = None
        if request.action == analysis_pb2.OPPORTUNITY_ACTION_SNOOZE:
            if request.HasField("snooze_until"):
                snooze_until = request.snooze_until.ToDatetime(tzinfo=UTC)
            else:
                hours = self._cfg.get_int("analysis.opportunity.snooze_default_hours", 24)
                snooze_until = datetime.now(UTC) + timedelta(hours=hours)

        try:
            await self._opportunity_actions_repo.upsert(
                user_id=user_id,
                opportunity_key=request.opportunity_key,
                action=int(request.action),
                snooze_until=snooze_until,
            )
        except Exception as e:  # noqa: BLE001 — surface any DB failure to the caller
            log.warning("SetOpportunityAction upsert failed: %s", e)
            await context.abort(grpc.StatusCode.UNAVAILABLE, "failed to persist opportunity action")
        return analysis_pb2.SetOpportunityActionResponse()

    async def _drain_active_signals(self, propagation_meta) -> list:
        """Drain all currently-active ingest signals (paginated). Best-effort: an ingest
        failure yields an empty queue rather than aborting."""
        window = _recent_range(0)  # [now, now] — signals whose validity covers now
        out: list = []
        page_token = ""
        for _ in range(_MAX_DRAIN_PAGES):
            try:
                resp = await self._ingest.QuerySignals(
                    ingest_pb2.QuerySignalsRequest(
                        active_window=window,
                        page=common_pb2.PageRequest(
                            page_size=_BAR_PAGE_SIZE, page_token=page_token
                        ),
                    ),
                    metadata=propagation_meta,
                )
            except grpc.RpcError as e:
                log.warning("ListOpportunities: QuerySignals failed: %s", e)
                return out
            out.extend(resp.signals)
            page_token = resp.page.next_page_token
            if not page_token:
                break
        return out

    async def _drain_source_weights(self, propagation_meta) -> dict[str, float]:
        """Drain per-source reliability weights from ingest (feature 134). Single unpaginated
        ListSignalSources call, best-effort (an ingest failure yields an empty map so the caller
        falls back to the neutral 1.0 multiplier), mirroring ``_drain_active_signals``. Returns
        ``{slug: reliability_weight}`` — the shape ``scoring.compute_signal_score`` consumes."""
        try:
            resp = await self._ingest.ListSignalSources(
                ingest_pb2.ListSignalSourcesRequest(include_inactive=True),
                metadata=propagation_meta,
            )
        except grpc.RpcError as e:
            log.warning("_drain_source_weights: ListSignalSources failed: %s", e)
            return {}
        return {src.slug: src.reliability_weight for src in resp.sources}

    async def _drain_held_symbols(self, user_id, propagation_meta) -> set:
        """Drain the set of symbols the user holds across all accounts/modes (paginated).
        ``ListPositions(user_id)`` with ``account_id`` unset + ``TradingMode UNSPECIFIED``
        already returns every held position — no new global-positions RPC needed."""
        if self._portfolio is None:
            return set()
        held: set = set()
        page_token = ""
        for _ in range(_MAX_DRAIN_PAGES):
            try:
                resp = await self._portfolio.ListPositions(
                    portfolio_pb2.ListPositionsRequest(
                        user_id=user_id,
                        page=common_pb2.PageRequest(
                            page_size=_BAR_PAGE_SIZE, page_token=page_token
                        ),
                    ),
                    metadata=propagation_meta,
                )
            except grpc.RpcError as e:
                log.warning("ListOpportunities: ListPositions failed: %s", e)
                return held
            held.update(p.symbol for p in resp.positions)
            page_token = resp.page.next_page_token
            if not page_token:
                break
        return held

    async def GetStrategyAnalytics(self, request, context):
        """Per-strategy analytics for the Engine → Strategies surface (feature 083).

        expectancy / hit-rate / max-DD derive from persisted analysis.backtest_runs (win_rate +
        profit_factor — no per-trade column, no new migration); signals_30d from ingest
        QuerySignals (30-day window); taken from the analysis→trading ListOrders edge, reconciled
        against queue-derived TAKE dispositions (FR-7). queue_share is now real (feature 097) —
        the strategy's share of the user's valid materialized queue. C-03 headers propagate on
        every outbound call."""
        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]
        user_id = dict(context.invocation_metadata()).get("x-user-id", "")
        strategy_id = request.strategy_id

        # Feature 133: owner-scoped analytics. When the strategy store is available, a caller may
        # only read analytics for their OWN strategy — uniform PERMISSION_DENIED otherwise (the
        # no-DB test path, repo is None, is unaffected).
        if self._strategies_repo is not None:
            owned = (
                await self._strategies_repo.get_by_owner_and_id(user_id, strategy_id)
                if user_id
                else None
            )
            if owned is None:
                await context.abort(
                    grpc.StatusCode.PERMISSION_DENIED,
                    f"strategy '{strategy_id}' not found or not owned",
                )
                return

        expectancy = 0.0
        blended_hit_rate = 0.0
        max_drawdown = 0.0
        if self._backtest_runs_repo is not None:
            runs = await self._backtest_runs_repo.list_by_strategy(strategy_id, limit=20)
            ok_runs = [r for r in runs if float(r.get("total_trades") or 0) > 0]
            if ok_runs:
                latest = ok_runs[0]
                expectancy = _expectancy_from_metrics(
                    float(latest.get("win_rate") or 0.0), float(latest.get("profit_factor") or 0.0)
                )
                blended_hit_rate = sum(float(r.get("win_rate") or 0.0) for r in ok_runs) / len(
                    ok_runs
                )
                max_drawdown = max(float(r.get("max_drawdown") or 0.0) for r in ok_runs)

        signals_30d = 0
        try:
            sig_resp = await self._ingest.QuerySignals(
                ingest_pb2.QuerySignalsRequest(active_window=_recent_range(30)),
                metadata=propagation_meta,
            )
            signals_30d = len(sig_resp.signals)
        except grpc.RpcError as e:
            log.warning("GetStrategyAnalytics: QuerySignals failed: %s", e)

        taken = 0
        if self._trading is not None:
            try:
                orders_resp = await self._trading.ListOrders(
                    trading_pb2.ListOrdersRequest(strategy_id=strategy_id, user_id=user_id),
                    metadata=propagation_meta,
                )
                taken = len(orders_resp.orders)
            except grpc.RpcError as e:
                log.warning("GetStrategyAnalytics: ListOrders failed: %s", e)

        # Real queue_share + taken reconciliation over the materialized queue (feature 097, FR-7).
        queue_share = 0.0
        if self._opportunities_repo is not None:
            try:
                queue_share = await self._opportunities_repo.queue_share(user_id, strategy_id)
                # Reconcile the two "taken" sources so they read consistently: a TAKE recorded on
                # the queue but not yet reflected as a filled order still counts.
                taken = max(taken, await self._opportunities_repo.taken_count(user_id, strategy_id))
            except Exception as e:  # analytics is read-only best-effort
                log.warning("GetStrategyAnalytics: queue_share/taken reconcile failed: %s", e)

        return analysis_pb2.StrategyAnalytics(
            strategy_id=strategy_id,
            expectancy=expectancy,
            blended_hit_rate=blended_hit_rate,
            max_drawdown=max_drawdown,
            signals_30d=signals_30d,
            taken=taken,
            queue_share=queue_share,
        )


# ── Helpers ───────────────────────────────────────────────────────────────────


# ── Opportunity queue / readiness helpers (feature 083) ─────────────────────────


def _recent_range(lookback_days: int) -> "common_pb2.TimeRange":
    """A ``TimeRange`` ending now and starting ``lookback_days`` before it (0 → a point at
    now). Used for the readiness bar window and the active-signal query window."""
    now_ts = Timestamp()
    now_ts.GetCurrentTime()
    rng = common_pb2.TimeRange()
    rng.end.seconds = now_ts.seconds
    rng.start.seconds = max(0, now_ts.seconds - lookback_days * 86_400)
    return rng


def _readiness_to_proto(trace: dict) -> "analysis_pb2.SymbolReadiness":
    """Map a traced-readiness dict (evaluator._readiness_from_evals shape) to proto."""
    return analysis_pb2.SymbolReadiness(
        symbol=trace["symbol"],
        conviction=trace["conviction"],
        passing_conditions=trace["passing_conditions"],
        total_conditions=trace["total_conditions"],
        conditions=[
            analysis_pb2.ConditionEval(
                ref_name=c["ref_name"],
                lhs_value=c["lhs_value"],
                threshold=c["threshold"],
                fn=c["fn"],
                state=c["state"],
                distance_to_threshold=c["distance_to_threshold"],
            )
            for c in trace["conditions"]
        ],
    )


def _action_for(direction: str, held: bool):
    """Derive an OpportunityActionTag from a signal's direction × held-position, using real
    data only: buy&!held→ENTER, buy&held→ADD, sell&held→REDUCE. Returns None for the
    non-actionable cases (hold/watchlist, or a sell with no position to reduce)."""
    d = (direction or "").lower()
    if d == "buy":
        return (
            analysis_pb2.OPPORTUNITY_ACTION_TAG_ADD
            if held
            else analysis_pb2.OPPORTUNITY_ACTION_TAG_ENTER
        )
    if d == "sell" and held:
        return analysis_pb2.OPPORTUNITY_ACTION_TAG_REDUCE
    return None


def _normalize_symbol(symbol: str) -> str:
    """Single canonicalizer (feature 097) feeding every Universe drain and the opportunity_key —
    uppercase + trim so `` aapl`` / ``AAPL`` collapse to one candidate/key."""
    return (symbol or "").strip().upper()


def _opportunity_key(user_id: str, symbol: str, strategy_id: str) -> str:
    """Server-authoritative opaque key ``user|symbol_norm|strategy_id`` (feature 097). The action
    is a stored annotation, NOT part of the key, so a snooze survives an ENTER→ADD flip. The
    client echoes this verbatim to SetOpportunityAction and never derives it."""
    return f"{user_id}|{_normalize_symbol(symbol)}|{strategy_id}"


def _resolve_action_tag(candidate: dict, exit_fires: bool):
    """Derive an OpportunityActionTag for a materialized candidate (feature 097), real data only.

    Priority: (1) a held+attributed position whose exit_rule fires → REDUCE (FR-8a, signal-free);
    (2) a signal's ``direction × held`` via ``_action_for`` (feature-083 semantics, FR-8b);
    (3) a curated candidate with no actionable signal → ADD if held (a monitored holding), else
    ENTER (a curated entry candidate). A *speculative* signal-only candidate with no actionable
    signal (e.g. a sell with no position) returns None → the caller drops it (matches the
    pre-097 behavior where such a signal produced no row)."""
    held = candidate["is_held"]
    if held and exit_fires:
        return analysis_pb2.OPPORTUNITY_ACTION_TAG_REDUCE
    if candidate["best_direction"]:
        a = _action_for(candidate["best_direction"], held)
        if a is not None:
            return a
    if candidate["is_watchlist"] or candidate["is_held"]:
        return (
            analysis_pb2.OPPORTUNITY_ACTION_TAG_ADD
            if held
            else analysis_pb2.OPPORTUNITY_ACTION_TAG_ENTER
        )
    return None


def _primary_source(provenance: list[str]) -> str:
    """The single ``Opportunity.source`` string (kept for back-compat) = the first signal-source
    origin in ``provenance``, skipping the ``"watchlist"``/``"position"`` structural markers.
    ``provenance`` carries the full origin list."""
    for origin in provenance:
        if origin not in ("watchlist", "position"):
            return origin
    return ""


def _row_to_opportunity(row: dict) -> "analysis_pb2.Opportunity":
    """Map a materialized ``analysis.opportunities`` row (LEFT JOIN read) to an ``Opportunity``
    proto (feature 097). This is the producer↔reader↔UI contract point the OR-F descriptor-parity
    test pins — every ``Opportunity`` field is populated here, so a newly-added proto field fails
    the parity test until it is carried."""
    readiness = row.get("readiness_json") or {}
    provenance = list(row.get("provenance") or [])
    opp = analysis_pb2.Opportunity(
        symbol=row["symbol"],
        action=int(row["action"]),
        conviction=float(row.get("conviction") or 0.0),
        passing_conditions=int(readiness.get("passing_conditions", 0)),
        total_conditions=int(readiness.get("total_conditions", 0)),
        thesis=row.get("thesis", ""),
        strategy_id=row.get("strategy_id", ""),
        source=_primary_source(provenance),
        opportunity_key=row["opportunity_key"],
        provenance=provenance,
    )
    valid_until = row.get("valid_until")
    if valid_until is not None:
        opp.valid_until.FromDatetime(valid_until)
    return opp


def _seconds_until_hour_utc(hour: int) -> float:
    """Seconds from now until the next occurrence of ``hour``:00 UTC (feature 097 daily refresh).
    Always returns a positive delay (a full day when we're already at/past the hour today), so the
    refresh fires once per calendar day."""
    hour = hour % 24
    now = datetime.now(UTC)
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= now:
        target = target + timedelta(days=1)
    return (target - now).total_seconds()


def _expectancy_from_metrics(win_rate: float, profit_factor: float) -> float:
    """Closed-form expectancy (in avg-loss units) from a run's win_rate + profit_factor —
    no per-trade column needed (feature 083). profit_factor = (wins·avg_win)/(losses·avg_loss),
    so payoff_ratio = profit_factor·(1−win_rate)/win_rate and
    expectancy = win_rate·payoff_ratio − (1−win_rate). Guards win_rate ∈ {0, 1}."""
    if win_rate <= 0.0:
        return 0.0
    if win_rate >= 1.0:
        # All wins: no losing side to normalize against; expectancy is the whole win_rate.
        return win_rate
    payoff_ratio = profit_factor * (1.0 - win_rate) / win_rate
    return win_rate * payoff_ratio - (1.0 - win_rate)


# ── Backtest per-bar diagnostics helpers (feature 064-backtest-debug-info) ───────


def _build_bar_diagnostic(
    symbol, bar_index, bar, indicators, signal_score, conviction, action, warmup
):
    """Assemble one BarDiagnostic row. Shared by both backtest paths (DRY — avoids the
    jscpd block-clone). ``bar.time`` (the marketdata Bar timestamp field) is copied into
    ``timestamp``; ``indicators`` is present-only (unresolved series omitted)."""
    diag = analysis_pb2.BarDiagnostic(
        symbol=symbol,
        bar_index=bar_index,
        open=bar.open,
        high=bar.high,
        low=bar.low,
        close=bar.close,
        volume=bar.volume,
        vwap=bar.vwap,
        signal_score=signal_score,
        conviction=conviction,
        action=action,
        warmup=warmup,
    )
    diag.timestamp.CopyFrom(bar.time)
    for key, value in indicators.items():
        diag.indicators[key] = value
    return diag


def _first_resolved_index(series, n) -> int:
    """First index where ``series`` has a non-None value (observed built-in warm-up length),
    capped at ``n-1``. An all-None series yields ``n-1``."""
    for i, v in enumerate(series):
        if v is not None:
            return min(i, max(n - 1, 0))
    return max(n - 1, 0)


def _classify_no_trade_reason(trades, warmup_bars, n):
    """FR-6: reason a symbol produced 0 trades. Only meaningful when ``trades`` is empty;
    a traded symbol is UNSPECIFIED. INSUFFICIENT_CAPITAL is defined but not emitted (design.md)."""
    if trades:
        return analysis_pb2.NO_TRADE_REASON_UNSPECIFIED
    if warmup_bars >= n:
        return analysis_pb2.NO_TRADE_REASON_ENTIRE_RANGE_WARMUP
    return analysis_pb2.NO_TRADE_REASON_ENTRY_NEVER_TRUE


def _finalize_symbol_diagnostics(symbol, diags, warmup_bars, trades, daily_equity):
    """Apply the Option-C warm-up override pass (bar < warmup_bars → warmup=True, action=WARMUP)
    and classify no_trade_reason, then wrap the rows in a SymbolDiagnostics.

    Also stamps per-bar equity (feature 068): ``daily_equity`` is aligned 1:1 with ``diags``
    by construction (seed point + one append per simulated bar, forced-close patch included),
    and this shared finalize pass is the single stamping point for both engine paths — the
    shared builder ``_build_bar_diagnostic`` runs before the simulation loop computes equity,
    so it cannot carry the value (context.md, sdd-spec session).
    """
    n = len(diags)
    # feature 071: the two lists must stay 1:1 — `diags[j].equity = daily_equity[j]` below is
    # positional. The two engine paths build them differently (the legacy loop has two
    # continue-with-append branches, the evaluator appends unconditionally), which is exactly the
    # shape of ledger fail 056 "fixed one path, forgot the second". Assert it in the shared pass
    # so a drift in either path fails loudly instead of silently shifting every equity stamp.
    assert n == len(daily_equity), (
        f"diags/daily_equity length mismatch for {symbol}: {n} vs {len(daily_equity)} — "
        f"the per-bar equity stamps would be misaligned"
    )
    for i in range(min(n, len(daily_equity))):
        diags[i].equity = daily_equity[i]
    for i in range(n):
        if i < warmup_bars:
            diags[i].warmup = True
            diags[i].action = analysis_pb2.BAR_ACTION_WARMUP
    return analysis_pb2.SymbolDiagnostics(
        symbol=symbol,
        bars=diags,
        no_trade_reason=_classify_no_trade_reason(trades, warmup_bars, n),
        bars_total=n,
        warmup_bars=warmup_bars,
    )


def _score_from_metrics(
    sharpe_ratio: float,
    max_drawdown: float,
    win_rate: float,
    sharpe_weight: float,
    drawdown_weight: float,
    winrate_weight: float,
) -> tuple[float, dict]:
    """Blend raw performance metrics into ``(overall, component_scores)``.

    Extracted from ``_score_from_result`` (feature 065) so a single BacktestResult and a
    per-symbol evidence cell grade through exactly one code path — the derived headline scores
    each cell with this before aggregating.
    """
    sharpe_component = min(max(sharpe_ratio / 2.0, 0.0), 1.0)
    drawdown_component = max(1.0 - (max_drawdown / 0.5), 0.0)
    winrate_component = min(max(win_rate, 0.0), 1.0)
    overall = (
        sharpe_weight * sharpe_component
        + drawdown_weight * drawdown_component
        + winrate_weight * winrate_component
    )
    return overall, {
        "sharpe": sharpe_component,
        "drawdown": drawdown_component,
        "win_rate": winrate_component,
    }


def _grade(overall: float) -> str:
    """Map an overall score in [0, 1] to a letter grade (A/B/C/D/F)."""
    if overall >= 0.8:
        return "A"
    if overall >= 0.65:
        return "B"
    if overall >= 0.5:
        return "C"
    if overall >= 0.35:
        return "D"
    return "F"


def _aggregate_cells(
    scored_cells: list[tuple[int, float, dict]], k: int
) -> tuple[float, dict, int, int] | None:
    """Aggregate per-symbol scored evidence cells into a shrunk headline score.

    ``scored_cells`` is ``[(trading_days, cell_overall, cell_components), ...]``. Evidence
    weights are ``wᵢ = trading_days`` (weight by evidence, never by outcome). The overall is an
    empirical-Bayes shrinkage toward a neutral 0.5 prior:
    ``overall = (Σ wᵢ·sᵢ + 0.5·k) / (Σ wᵢ + k)`` where ``k`` (``analysis.scoring.shrinkage_days``)
    is the pseudo-count in trading days. Each component is shrunk identically (same k, same 0.5
    prior) over its weighted mean (weights renormalized wᵢ/Σw), and non-finite aggregated
    components are dropped (mirrors ``_persist_strategy_score``'s isfinite guard). ``Σw == 0``
    (zero evidence) → ``None`` — never an equal-weighted fallback. Returns
    ``(overall, components, n_symbols, total_days)``.
    """
    total_w = sum(days for days, _s, _c in scored_cells)
    if total_w <= 0:
        return None
    kf = float(k)
    prior = 0.5
    denom = total_w + kf

    weighted_overall = sum(days * s for days, s, _c in scored_cells)
    overall = (weighted_overall + prior * kf) / denom

    comp_keys: set[str] = set()
    for _d, _s, comps in scored_cells:
        comp_keys.update(comps.keys())
    components: dict[str, float] = {}
    for key in comp_keys:
        weighted_c = sum(
            days * comps[key]
            for days, _s, comps in scored_cells
            if key in comps and math.isfinite(comps[key])
        )
        shrunk = (weighted_c + prior * kf) / denom
        if math.isfinite(shrunk):
            components[key] = shrunk

    return overall, components, len(scored_cells), int(total_w)


def _score_from_result(
    strategy_id: str,
    result: "analysis_pb2.BacktestResult",
    sharpe_weight: float,
    drawdown_weight: float,
    winrate_weight: float,
) -> "analysis_pb2.StrategyScore":
    """Grade a single backtest into a StrategyScore (Sharpe / drawdown / win-rate blend).

    Keeps its signature and delegates to ``_score_from_metrics`` / ``_grade`` (feature 065) so
    the per-run history score and the derived headline share one scoring code path.
    """
    overall, components = _score_from_metrics(
        result.sharpe_ratio,
        result.max_drawdown,
        result.win_rate,
        sharpe_weight,
        drawdown_weight,
        winrate_weight,
    )
    return analysis_pb2.StrategyScore(
        strategy_id=strategy_id,
        overall_score=overall,
        rating=_grade(overall),
        component_scores=components,
    )


def _row_to_backtest_summary(row: dict) -> "analysis_pb2.BacktestRunSummary":
    """Convert an analysis.backtest_runs row to a BacktestRunSummary proto.

    ``status`` is stored as the enum name (e.g. "BACKTEST_STATUS_OK"); an unknown/blank value
    maps to UNSPECIFIED. A null score persists as 0 / "" (proto3 scalars have no null).
    """
    try:
        status = analysis_pb2.BacktestStatus.Value(row.get("status") or "")
    except ValueError:
        status = analysis_pb2.BACKTEST_STATUS_UNSPECIFIED
    summary = analysis_pb2.BacktestRunSummary(
        backtest_id=row.get("backtest_id", ""),
        strategy_id=row.get("strategy_id", ""),
        status=status,
        total_return=float(row.get("total_return") or 0.0),
        annualized_return=float(row.get("annualized_return") or 0.0),
        sharpe_ratio=float(row.get("sharpe_ratio") or 0.0),
        max_drawdown=float(row.get("max_drawdown") or 0.0),
        win_rate=float(row.get("win_rate") or 0.0),
        total_trades=int(row.get("total_trades") or 0),
        profit_factor=float(row.get("profit_factor") or 0.0),
        symbols=list(row.get("symbols") or []),
        overall_score=float(row["overall_score"]) if row.get("overall_score") is not None else 0.0,
        rating=row.get("rating") or "",
    )
    completed = row.get("completed_at")
    if completed is not None:
        ts = Timestamp()
        ts.FromDatetime(completed)
        summary.completed_at.CopyFrom(ts)
    return summary


# ── Feature 070: partial strategy update ─────────────────────────────────────
#
# Top-level StrategyDefinition paths an update_mask may name. Deliberately flat and closed —
# a mask is an authorization-shaped input and an open path set invites surprises.
_MASKABLE_PATHS = frozenset(
    {
        "display_name",
        "components",
        "entry_rule",
        "exit_rule",
        "signal_params",
        "cooldown_days",
        "exit_cooldown_days",
    }
)

# These live in real columns and are overlaid at read time by _row_to_strategy_definition, so
# masking them would write a value that the next read silently discards. Rejected outright.
_COLUMN_AUTHORITATIVE_PATHS = frozenset({"strategy_id", "active", "live_enabled"})


class _MergeRejected(Exception):
    """A merged definition failed validation or the erasure guard — abort INVALID_ARGUMENT."""


def _merge_definition_json(stored_json: dict, definition, mask_paths) -> dict:
    """AIP-161 field-mask merge of `definition` onto the stored JSON (feature 070).

    One uniform rule for every path — deliberately NOT "scalars from the proto object, repeated
    and message fields from the dict". `MessageToDict` omits default-valued no-presence fields,
    so a two-rule merge silently no-ops three of the six maskable paths: a masked
    ``components: []`` never appears in the dict (component clear does nothing), and a
    masked-unset ``signal_params`` read off the proto persists ``{}`` where the key was
    previously absent — changing the JSONB key set and therefore the definition fingerprint.

    So: **masked path present in the request → overwrite; masked path absent → clear.** That
    "absent means clear" half is the only way to express erasure at all, because proto3 gives
    ``components`` / ``entry_rule`` / ``exit_rule`` no field presence.
    """
    full = json_format.MessageToDict(definition, preserving_proto_field_name=True)
    merged = dict(stored_json or {})
    for path in mask_paths:
        if path in full:
            merged[path] = full[path]
        else:
            merged.pop(path, None)
    return merged


def _guard_erasure(old_json: dict, new_json: dict, mask_paths: set) -> str | None:
    """Reject a write that would strip an existing strategy's components or rules (FR-2b).

    "Explicitly requested" means the path is named in the mask. This deliberately applies to a
    **maskless** UPDATE too, so the reported incident fails closed even against a completely
    unpatched client — the server alone stops the data loss. No legitimate caller trips it: the
    StrategyWizard's own step gates require a non-empty component list and non-blank rules
    before it can submit.

    Returns an error message, or None when the write is safe.
    """
    old_json = old_json or {}
    new_json = new_json or {}

    if old_json.get("components") and not new_json.get("components"):
        if "components" not in mask_paths:
            return (
                "refusing to clear 'components' on an existing strategy: the request carried no "
                "components and did not name it in update_mask. To erase deliberately, include "
                "'components' in update_mask."
            )

    for rule in ("entry_rule", "exit_rule"):
        if old_json.get(rule) and not new_json.get(rule) and rule not in mask_paths:
            return (
                f"refusing to blank '{rule}' on an existing strategy: the request carried no "
                f"{rule} and did not name it in update_mask. To erase deliberately, include "
                f"'{rule}' in update_mask."
            )
    return None


_FINGERPRINT_EXCLUDED_KEYS = frozenset({"display_name", "active", "live_enabled"})


def _definition_fingerprint(definition_json: dict) -> str:
    """sha256 of a strategy's scoring-relevant definition — the evidence-cell eligibility key.

    Canonicalization rule (design.md § fingerprint, open-risk mitigation): only ever hash a
    DB-returned ``strategies`` row's ``definition_json`` (post-``StrategiesRepository._to_dict``),
    never a request proto dict — ``_row_to_strategy_definition`` overlays the column-authoritative
    fields (strategy_id/display_name/active/live_enabled) at read time, so a request dict would not
    canonicalize to the same bytes. ``display_name``/``active``/``live_enabled`` are excluded so a
    rename or a live-toggle never invalidates a strategy's accumulated evidence; a change to the
    entry/exit rules or components (which DO change scoring behavior) yields a new fingerprint and a
    fresh evidence base. ``None``/``{}`` hash identically.
    """
    filtered = {
        k: v for k, v in (definition_json or {}).items() if k not in _FINGERPRINT_EXCLUDED_KEYS
    }
    canonical = json.dumps(filtered, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _row_to_score(row: dict) -> "analysis_pb2.StrategyScore":
    """Convert an analysis.strategy_scores row to a StrategyScore proto (feature 064).

    Decodes the ``component_scores`` map (NOT ``definition_json`` — the copy-trap the design
    called out); the repo's _to_dict already JSON-decodes the JSONB column to a plain dict.
    """
    return analysis_pb2.StrategyScore(
        strategy_id=row["strategy_id"],
        overall_score=row["overall_score"],
        rating=row["rating"],
        component_scores=row.get("component_scores") or {},
        # Evidence provenance (feature 065); pre-007 rows lack these keys → defaults.
        evidence_symbols=int(row.get("n_symbols") or 0),
        evidence_days=int(row.get("total_trading_days") or 0),
        provisional=bool(row.get("provisional") or False),
    )


def _row_to_strategy_definition(row: dict) -> "analysis_pb2.StrategyDefinition":
    """Convert an analysis.strategies row (definition_json JSONB) to a StrategyDefinition proto."""
    definition_json = row.get("definition_json") or {}
    definition = json_format.ParseDict(
        definition_json, analysis_pb2.StrategyDefinition(), ignore_unknown_fields=True
    )
    # Column values are authoritative over the embedded JSON copy.
    definition.strategy_id = row["strategy_id"]
    definition.display_name = row["display_name"]
    definition.active = row["active"]
    # live_enabled column added by feature 048 (absent on rows predating that migration).
    definition.live_enabled = bool(row.get("live_enabled", False))
    # feature 133: the user_id column is authoritative — a migrated row carries its owner only on
    # the column, not in the embedded definition_json, and the live loop keys its state by this
    # value (so it must match the cooldown rows hydrated by the same column).
    definition.user_id = row.get("user_id", "") or ""
    return definition


def _unwrap_value(v):
    """Unwrap a google.protobuf.Value to a Python scalar."""
    kind = v.WhichOneof("kind")
    if kind == "number_value":
        return v.number_value
    if kind == "string_value":
        return v.string_value
    if kind == "bool_value":
        return v.bool_value
    if kind == "list_value":
        return [_unwrap_value(i) for i in v.list_value.values]
    if kind == "struct_value":
        return {k: _unwrap_value(vv) for k, vv in v.struct_value.fields.items()}
    return None


# _compute_signal_score moved to app.services.scoring.compute_signal_score (feature 060);
# the module-level alias near the imports preserves the old name for existing callers/tests.


def _compute_metrics(daily_equity: list[float], trades: list, initial_equity: float) -> dict:
    """Compute backtest performance metrics from daily equity curve and trade list."""
    if len(daily_equity) < 2:
        return {
            "total_return": 0.0,
            "annualized_return": 0.0,
            "sharpe_ratio": 0.0,
            "max_drawdown": 0.0,
            "win_rate": 0.0,
            "profit_factor": 1.0,
        }

    equity = np.array(daily_equity, dtype=float)
    returns = np.diff(equity) / equity[:-1]
    returns = returns[np.isfinite(returns)]

    total_return = (equity[-1] - initial_equity) / initial_equity
    n_days = len(daily_equity) - 1
    annualized_return = (1 + total_return) ** (252.0 / max(n_days, 1)) - 1 if n_days > 0 else 0.0

    mean_r = float(np.mean(returns)) if len(returns) > 0 else 0.0
    std_r = float(np.std(returns)) if len(returns) > 1 else 1e-9
    sharpe_ratio = (mean_r / max(std_r, 1e-9)) * math.sqrt(252)

    # Max drawdown via cumulative high-water mark
    cummax = np.maximum.accumulate(equity)
    drawdowns = (equity - cummax) / cummax
    max_drawdown = float(abs(np.min(drawdowns))) if len(drawdowns) > 0 else 0.0

    pnls = [t.pnl for t in trades]
    win_rate = (sum(1 for p in pnls if p > 0) / len(pnls)) if pnls else 0.0
    gross_profit = sum(p for p in pnls if p > 0)
    gross_loss = abs(sum(p for p in pnls if p < 0))
    profit_factor = (
        (gross_profit / gross_loss) if gross_loss > 0 else (1.0 if gross_profit == 0 else 999.0)
    )

    return {
        "total_return": float(total_return),
        "annualized_return": float(annualized_return),
        "sharpe_ratio": float(sharpe_ratio),
        "max_drawdown": float(max_drawdown),
        "win_rate": float(win_rate),
        "profit_factor": float(profit_factor),
    }
