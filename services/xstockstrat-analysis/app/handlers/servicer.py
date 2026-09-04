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
import random
import uuid
from dataclasses import dataclass, field
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
from app.engine.durable_schedule import DurableSchedule, seconds_until_hour_utc
from app.repositories.backtest_details import BacktestDetailsRepository
from app.repositories.backtest_run_symbols import BacktestRunSymbolsRepository
from app.repositories.backtest_runs import BacktestRunsRepository
from app.repositories.opportunities import OpportunitiesRepository
from app.repositories.opportunity_actions import OpportunityActionsRepository
from app.repositories.order_snapshots import OrderSnapshotsRepository
from app.repositories.pnl_pattern_samples import PnLPatternSamplesRepository
from app.repositories.pnl_positions import PnLPositionsRepository
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

# Back-compat alias: existing imports of _compute_signal_score from this module must stay valid.
_compute_signal_score = scoring.compute_signal_score

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class BarIntent:
    """Feature 150: per-in-window-bar SIGNAL intent for a symbol — the raw entry/exit signal
    computed *before* any position/cooldown/capital gate, so the portfolio simulator can decide
    execution against a shared pool. This is signal intent, NOT realized execution (a
    capital-skipped entry has no realized action to replay — the reason ``_simulate_portfolio``
    consumes intent rather than ``BarDiagnostic.action``). ``timestamp`` is a proto Timestamp;
    ``close`` the bar close.
    """

    timestamp: Timestamp
    close: float
    entry_intent: bool
    exit_intent: bool
    conviction: float


@dataclass
class _PendingFill:
    """Feature 151: a signal committed on a prior/current bar, awaiting execution at ``fill_idx``.

    ``fill_idx`` is the bar the fill lands on: the signal bar itself in same-bar-close mode, or the
    *next* bar in next-bar-open mode. One slot per simulator — a new signal is never queued while a
    fill is in flight (so a bar-i signal in next-bar mode can't be overwritten before it fills).
    """

    fill_idx: int
    side: str  # "enter" | "exit"


@dataclass
class SimState:
    """Feature 151: the per-symbol simulation state threaded through ``_apply_fill``.

    Holds everything a fill mutates so the deferred-execution state machine is the single place that
    opens/closes positions — the simulator loop stays the sole writer of ``diags[...].action`` and
    the sole appender to ``daily_equity`` (the feature-071 1:1 ``daily_equity[j]↔diags[j]``
    invariant). ``entry_time`` is a proto Timestamp (the fill bar's time); ``last_exit_time`` is
    (the re-entry cooldown clock, feature 069).
    """

    equity: float
    position: float = 0.0
    entry_price: float = 0.0
    entry_time: Timestamp | None = None
    last_exit_time: datetime | None = None
    pending: _PendingFill | None = None
    trades: list = field(default_factory=list)


def _set_pending(
    state: SimState, i: int, entry_signal: bool, exit_signal: bool, fill_model
) -> None:
    """Feature 151: queue a fill from a bar-``i`` signal, if the slot is free and the signal is
    actionable given the current position. ``fill_idx`` is ``i`` in same-bar mode, ``i+1`` in
    next-bar mode. Never overwrites an in-flight pending (a next-bar deferral must fill first).
    """
    if state.pending is not None:
        return
    fill_idx = i + 1 if fill_model == analysis_pb2.FILL_MODEL_NEXT_BAR_OPEN else i
    if state.position == 0.0 and entry_signal:
        state.pending = _PendingFill(fill_idx, "enter")
    elif state.position > 0.0 and exit_signal:
        state.pending = _PendingFill(fill_idx, "exit")


def _apply_fill(
    state: SimState,
    bars,
    i: int,
    fill_model,
    commission: float,
    slippage: float,
    symbol: str,
    cooldown_days: int,
    exit_cooldown_days: int,
):
    """Feature 151: execute a pending fill scheduled for bar ``i`` (deferred-execution machine).

    Returns the fill-bar ``BarAction`` (ENTER_LONG / EXIT_LONG) or ``None`` when nothing fills.
    **Never touches ``diags``** — the caller loop applies the returned action, keeping the loop the
    sole writer of ``diags[...].action`` and the sole appender to ``daily_equity``.

    Fill price: bar ``i``'s close (same-bar-close, legacy) or open (next-bar-open), each ± slippage
    with today's signs (buy ``*(1+slippage)``, sell ``*(1-slippage)``). Byte-identical to the legacy
    inline blocks in same-bar mode (``fill_idx == signal bar``). Cooldown (feature 069/116) is
    pinned to the **fill-bar** time; ``cooldown_days``/``exit_cooldown_days`` 0 disables its gate
    (the SMA path, which has no cooldown, passes 0/0).
    """
    p = state.pending
    if p is None or p.fill_idx != i:
        return None
    bar = bars[i]
    px = bar.open if fill_model == analysis_pb2.FILL_MODEL_NEXT_BAR_OPEN else bar.close
    state.pending = None
    if p.side == "enter":
        # Re-entry cooldown, keyed on the fill-bar time.
        if is_cooldown_active(state.last_exit_time, bar.time.ToDatetime(tzinfo=UTC), cooldown_days):
            return None
        fill_price = px * (1 + slippage)
        shares = (state.equity * 0.95) / fill_price
        cost = shares * fill_price * (1 + commission)
        if cost <= state.equity:
            state.position = shares
            state.entry_price = fill_price
            entry_ts = Timestamp()
            entry_ts.CopyFrom(bar.time)
            state.entry_time = entry_ts
            state.equity -= cost
            return analysis_pb2.BAR_ACTION_ENTER_LONG
        return None
    # Exit cooldown / min-hold, keyed on the fill-bar time vs the entry-bar time.
    entry_dt = state.entry_time.ToDatetime(tzinfo=UTC) if state.entry_time is not None else None
    if is_cooldown_active(entry_dt, bar.time.ToDatetime(tzinfo=UTC), exit_cooldown_days):
        return None
    fill_price = px * (1 - slippage)
    proceeds = state.position * fill_price * (1 - commission)
    pnl = proceeds - (state.position * state.entry_price * (1 + commission))
    exit_ts = Timestamp()
    exit_ts.CopyFrom(bar.time)
    entry_ts = Timestamp()
    entry_ts.CopyFrom(state.entry_time)
    state.trades.append(
        analysis_pb2.TradeRecord(
            symbol=symbol,
            side="long",
            qty=state.position,
            entry_price=state.entry_price,
            exit_price=fill_price,
            pnl=pnl,
            entry_time=entry_ts,
            exit_time=exit_ts,
        )
    )
    state.equity += proceeds
    state.position = 0.0
    state.entry_price = 0.0
    state.entry_time = None
    state.last_exit_time = bar.time.ToDatetime(tzinfo=UTC)  # cooldown clock
    return analysis_pb2.BAR_ACTION_EXIT_LONG


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
        # For a pre-window warm-up shortfall the actionable backfill span is the PREFIX
        # (start - warmup … start), not the caller's window. None → the caller's requested range.
        self.gap_range = gap_range


# marketdata's GetBars defaults to a 500-bar page ordered ASC, so an unpaginated request silently
# drops the NEWEST bars once a range exceeds that (730 days ≈ 504 bars). _fetch_bars_paged pages.
_BAR_PAGE_SIZE = 1000

# Backstop against a non-advancing cursor (32 pages × 1000 bars ≈ 128 years, unreachable under
# max_range_days). Exhausting it RAISES — silently truncating would reintroduce the fixed bug.
_MAX_BAR_PAGES = 32

# Recent-bar lookback for EvaluateReadiness: ~400 calendar days ≈ 280 trading bars, enough to
# warm up long indicators (e.g. SMA/EMA up to ~200 periods) for a last-bar readiness read.
_READINESS_LOOKBACK_DAYS = 400
# Backstop for draining paginated QuerySignals / ListPositions in ListOpportunities.
_MAX_DRAIN_PAGES = 50
# Default queue page size when the request omits one.
_DEFAULT_OPP_PAGE_SIZE = 50


class _BarFetchError(Exception):
    """Raised when bar pagination cannot complete safely (non-advancing cursor, page cap)."""


def bucket_pnl_factors(samples, *, min_sample, bucket_count):
    """Query-time bucketing for QueryPnLPatterns (feature 042, design § 3). Pure — no I/O.

    ``samples`` are pnl_pattern_samples rows (dicts: factor_name, factor_type, indicator_value,
    signal_present, realized_pnl). Indicator factors split into ``bucket_count`` quantile buckets
    (data-dependent boundaries); signal factors are grouped by presence. A bucket/group with fewer
    than ``min_sample`` samples is dropped. Returns a list of ``analysis_pb2.PnLPatternFactor``.
    """
    by_factor: dict[tuple, list[dict]] = {}
    for s in samples:
        by_factor.setdefault((s["factor_name"], s["factor_type"]), []).append(s)

    factors = []
    for (name, ftype), rows in by_factor.items():
        if ftype == "indicator":
            valued = sorted(
                (r for r in rows if r.get("indicator_value") is not None),
                key=lambda r: float(r["indicator_value"]),
            )
            if not valued:
                continue
            n_buckets = max(1, int(bucket_count))
            size = max(1, len(valued) // n_buckets)
            # Contiguous quantile buckets of ~equal count; the last bucket absorbs the remainder.
            i = 0
            while i < len(valued):
                bucket = valued[i : i + size]
                # Fold a trailing short bucket into the previous one to avoid a tiny tail bucket.
                if 0 < len(valued) - (i + size) < size:
                    bucket = valued[i:]
                    i = len(valued)
                else:
                    i += size
                if len(bucket) < min_sample:
                    continue
                vals = [float(b["indicator_value"]) for b in bucket]
                pnls = [float(b["realized_pnl"]) for b in bucket]
                factors.append(
                    analysis_pb2.PnLPatternFactor(
                        factor_name=name,
                        factor_type=analysis_pb2.FACTOR_TYPE_INDICATOR,
                        value_range_low=min(vals),
                        value_range_high=max(vals),
                        sample_count=len(bucket),
                        avg_pnl_impact=sum(pnls) / len(pnls),
                    )
                )
        else:  # signal
            present = [r for r in rows if r.get("signal_present")]
            if len(present) < min_sample:
                continue
            pnls = [float(r["realized_pnl"]) for r in present]
            factors.append(
                analysis_pb2.PnLPatternFactor(
                    factor_name=name,
                    factor_type=analysis_pb2.FACTOR_TYPE_SIGNAL,
                    sample_count=len(present),
                    avg_pnl_impact=sum(pnls) / len(pnls),
                )
            )
    return factors


def attribute_trade(source_values: dict[str, float]) -> dict[str, float]:
    """Winner-takes-all signal attribution for one closed position (feature 029, FR-3).

    ``source_values`` maps each contributing signal source (slug) to its highest conviction across
    the position's snapshots. The source(s) holding the top value split weight 1.0: a clear winner
    gets 1.0 (AC-4); an exact tie splits equally — a two-way tie is 0.5/0.5 (AC-5, the only V1
    fractional case). A position with no signals yields ``{}`` → the trade is ``manual`` and is
    excluded from per-source metrics (AC-3)."""
    if not source_values:
        return {}
    top = max(source_values.values())
    winners = [s for s, v in source_values.items() if v == top]
    share = 1.0 / len(winners)
    return {s: share for s in winners}


def _parse_signals(raw) -> list[dict]:
    """Normalize an order_snapshot's `signals` JSONB (a JSON string from asyncpg, or an
    already-parsed list in tests) to a list of {name, value, source} dicts; else []."""
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (TypeError, ValueError):
            return []
    return raw if isinstance(raw, list) else []


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
        # Raw asyncpg pool: the servicer otherwise keeps db_pool only inside its repos, but
        # DurableSchedule (the opportunity refresh) needs the raw pool. None in the no-DB test path.
        self._db_pool = db_pool
        self._marketdata = marketdata_pb2_grpc.MarketDataServiceStub(marketdata_channel)
        self._indicators = indicators_pb2_grpc.IndicatorsServiceStub(indicators_channel)
        self._ingest = ingest_pb2_grpc.IngestServiceStub(ingest_channel)
        self._ledger = ledger_pb2_grpc.LedgerServiceStub(ledger_channel)
        self._notify = notify_pb2_grpc.NotifyServiceStub(notify_channel) if notify_channel else None
        # Trading stub — GetStrategyAnalytics reads ListOrders for the "taken" count (non-cyclic
        # analysis→trading edge). None when TRADING_ENDPOINT is not wired (tests).
        self._trading = (
            trading_pb2_grpc.TradingServiceStub(trading_channel) if trading_channel else None
        )
        # Portfolio stub — watchlist/held reads. None when PORTFOLIO_ENDPOINT is not wired (tests).
        self._portfolio = (
            portfolio_pb2_grpc.PortfolioServiceStub(portfolio_channel)
            if portfolio_channel
            else None
        )
        self._backtests: dict[str, analysis_pb2.BacktestResult] = {}
        self._strategies: dict[str, analysis_pb2.StrategyScore] = {}
        self._strategies_repo = StrategiesRepository(db_pool) if db_pool else None
        # Process-lifetime singleton semaphore bounding cross-request GetIndicatorSeries compute so
        # a busy Symbol page can't starve the live loop. max(1, …) guards a negative config value.
        self._component_series_sem = asyncio.Semaphore(
            max(1, self._cfg.get_int("analysis.series.max_concurrent_components", 4))
        )
        # Process-lifetime singleton semaphore bounding cross-request _compute_opportunities bars
        # fetches (TimescaleDB OOM fix); per-call semaphores would bound nothing across users.
        self._bars_fetch_sem = asyncio.Semaphore(
            max(1, self._cfg.get_int("analysis.opportunity.max_concurrent_bars_fetches", 2))
        )
        # Durable backup for the in-memory _strategies dict: reads stay in-memory, this persists on
        # score and hydrates at boot. None in the no-DB test path.
        self._scores_repo = StrategyScoresRepository(db_pool) if db_pool else None
        # Durable backtest-run history: RunBacktest appends a summary row, ListBacktests reads it
        # back. None in the no-DB test path.
        self._backtest_runs_repo = BacktestRunsRepository(db_pool) if db_pool else None
        # Full per-run detail: OK runs persist their serialized BacktestResult here; GetBacktest
        # reads it back (DB-only, never the in-memory dict). None in the no-DB test path.
        self._backtest_details_repo = BacktestDetailsRepository(db_pool) if db_pool else None
        # Per-symbol evidence cells for the derived headline grade: RunBacktest buffers one cell
        # per symbol on an OK run, _recompute_headline reads them back. None in the no-DB test path.
        self._backtest_run_symbols_repo = BacktestRunSymbolsRepository(db_pool) if db_pool else None
        # Persisted per-user opportunity dispositions, read by ListOpportunities. None in no-DB.
        self._opportunity_actions_repo = OpportunityActionsRepository(db_pool) if db_pool else None
        # Materialized per-user opportunity queue: ListOpportunities is a pure read of this table,
        # kept fresh by compute-on-read + stale-while-revalidate + a daily refresh. None in no-DB.
        self._opportunities_repo = OpportunitiesRepository(db_pool) if db_pool else None
        # P&L pattern attribution samples: written by the pnl_pattern_consumer, read here by
        # QueryPnLPatterns with query-time quantile bucketing.
        self._pnl_samples_repo = PnLPatternSamplesRepository(db_pool) if db_pool else None
        # Signal-performance attribution reads: closed positions (net = realized - fees_total) +
        # their order-snapshot signal inputs. None in tests.
        self._pnl_positions_repo = PnLPositionsRepository(db_pool) if db_pool else None
        self._order_snapshots_repo = OrderSnapshotsRepository(db_pool) if db_pool else None
        # Per-user compute serialization: a lazy Lock so two tabs' cold reads don't double-compute;
        # the set marks users with a background recompute in flight. Single-process protection only.
        self._opportunity_locks: dict[str, asyncio.Lock] = {}
        self._opportunity_recomputing: set[str] = set()
        # Per-strategy recompute serialization: asyncio.Lock is non-reentrant, so a trigger already
        # holding it calls only _recompute_headline_locked. Single-process only, by strategy_id.
        self._recompute_locks: dict[str, asyncio.Lock] = {}
        # Set by main.py after the fundamentals signal loop is constructed; RunFundamentalsScan
        # invokes its shared run_once path.
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
        # Refuse binding a strategy to a soft-deleted formula (aborts on the first).
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
        # Resolve the effective fill model: request wins, else config default, else legacy. The
        # get_int zero-trap is INTENTIONAL — an absent key and a configured 0 both mean legacy.
        effective_fill_model = (
            request.fill_model
            if request.fill_model != analysis_pb2.FILL_MODEL_UNSPECIFIED
            else self._cfg.get_int("analysis.backtest.default_fill_model", 0)
        )
        if effective_fill_model == analysis_pb2.FILL_MODEL_UNSPECIFIED:
            effective_fill_model = analysis_pb2.FILL_MODEL_SAME_BAR_CLOSE

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
        # The caller owns any registered strategy this run touches and any headline recompute after.
        caller_user_id = self._caller_user_id(context)

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

        params = {}
        if request.HasField("strategy_params"):
            params = dict(request.strategy_params.fields)
            params = {k: _unwrap_value(v) for k, v in params.items()}

        fast_period = int(params.get("fast_period", 20))
        slow_period = int(params.get("slow_period", 50))
        min_conviction = float(params.get("min_conviction", 0.0))
        # A strategy's backtest score is TECHNICAL-ONLY — a signal is a separate queue ranking axis,
        # never an input to the score (compute_signal_score/combine_score stay for the screener).

        # Resolve strategy definition: inline takes precedence over strategy_id_ref; if neither is
        # supplied, fall through to the legacy SMA-crossover path.
        active_definition = None
        executed_row = None
        if request.HasField("inline_definition"):
            active_definition = request.inline_definition
        elif request.strategy_id_ref:
            if self._strategies_repo:
                # A backtest against a REGISTERED strategy is owner-scoped — a caller can only run
                # their own. Inline/legacy runs (no strategy_id_ref) are unaffected.
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

        # Fingerprint the executed definition only when the run executes the strategy's OWN
        # registered definition; the hash is from the DB definition_json, never a request dict.
        run_fingerprint = None
        if (
            request.strategy_id_ref
            and request.strategy_id == request.strategy_id_ref
            and executed_row is not None
        ):
            run_fingerprint = _definition_fingerprint(executed_row["definition_json"])

        # Cap every backtest to analysis.backtest.max_range_days: both bounds set + span over cap
        # → reject (not silent clamp); an unset bound is defaulted so ALL backtests stay bounded.
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
        all_diagnostics: list[analysis_pb2.SymbolDiagnostics] = []
        # Count symbols dropped by a custom-formula execution error, so the status gate reports
        # INSUFFICIENT_DATA (never OK+scored) on a no-usable-evidence run.
        formula_errors: int = 0
        # One per-symbol evidence cell buffered per traded symbol; flushed on OK.
        symbol_cells: list[dict] = []
        # Per-symbol signal-intent lists, buffered for the optional portfolio simulator. Populated
        # in both modes but only consumed on the portfolio branch; legacy metrics are unaffected.
        symbol_intents: dict[str, list[BarIntent]] = {}
        # Declared formula warm-ups fetched once per run, reused across symbols.
        formula_warmup_cache: dict[str, int] = {}
        # Deleted-formula warnings captured during that same single fetch per formula.
        formula_deleted_cache: dict[str, str] = {}
        # Resolved BEFORE the loop, so symbol 1 sizes its prefix from the same cache symbol N
        # does (see _prefetch_formula_warmups).
        if active_definition is not None and start_set:
            await self._prefetch_formula_warmups(
                active_definition, formula_warmup_cache, propagation_meta, formula_deleted_cache
            )

        # Benchmark (source_symbol) bars preloaded ONCE per run, shared across evaluated symbols.
        # A benchmark warmup shortfall is a run-wide coverage gap → INSUFFICIENT_DATA (AC-4).
        benchmark_bars = None
        symbols_to_run = list(request.symbols)
        if active_definition is not None:
            try:
                benchmark_bars = await self._load_benchmark_bars(
                    active_definition,
                    request.range,
                    formula_warmup_cache,
                    propagation_meta,
                    warmup_prefix=start_set,
                )
            except _InsufficientData as ins:
                log.warning(
                    "backtest benchmark %s insufficient data: have %d, need %d",
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
                        gap=ins.gap_range if ins.gap_range is not None else request.range,
                    )
                )
                # No evaluated symbol can resolve the benchmark gate — skip the loop; the
                # status gate below reports INSUFFICIENT_DATA.
                symbols_to_run = []

        for symbol in symbols_to_run:
            try:
                if active_definition is not None:
                    (
                        trades,
                        equity,
                        daily_eq,
                        sym_diag,
                        sym_intent,
                    ) = await self._backtest_symbol_evaluated(
                        symbol=symbol,
                        range_msg=request.range,
                        definition=active_definition,
                        initial_equity=equity,
                        commission=commission,
                        slippage=slippage,
                        propagation_meta=propagation_meta,
                        formula_warmup_cache=formula_warmup_cache,
                        # Prefix ONLY when the caller supplied an explicit start; `start_set` is
                        # snapshotted before the defaulting block mutates request.range in place.
                        warmup_prefix=start_set,
                        fill_model=effective_fill_model,  # feature 151
                        benchmark_bars=benchmark_bars,  # feature 152
                    )
                else:
                    (
                        trades,
                        equity,
                        daily_eq,
                        sym_diag,
                        sym_intent,
                    ) = await self._backtest_symbol(
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
                        fill_model=effective_fill_model,  # feature 151
                    )
                # Buffer intent for the optional portfolio simulator.
                symbol_intents[symbol] = sym_intent
                # Buffer one per-symbol evidence cell (metrics from daily_eq[0], the symbol's own
                # start). Zero-trade cells ARE buffered — non-participation is evidence.
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
                        # For a warm-up shortfall the actionable backfill span is the prefix,
                        # not the caller's window (which may be fully covered).
                        gap=ins.gap_range if ins.gap_range is not None else request.range,
                    )
                )
                continue
            except FormulaExecutionError as fe:
                # A custom-formula execution/contract error stamps FORMULA_ERROR directly here —
                # the single site that sets it (_classify_no_trade_reason never returns it).
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

        # Resolve capital-allocation model: LEGACY → serial per-symbol path; PORTFOLIO → shared-pool
        # simulator. A completed run always records LEGACY or PORTFOLIO, never UNSPECIFIED.
        sizing_mode = (
            analysis_pb2.SIZING_MODE_PORTFOLIO
            if request.sizing_mode == analysis_pb2.SIZING_MODE_PORTFOLIO
            else analysis_pb2.SIZING_MODE_LEGACY
        )

        # Annualize over the real window span, not the concatenated multi-symbol curve length.
        # Order-independent, so the portfolio path reuses the same span.
        _span_seconds = request.range.end.seconds - request.range.start.seconds
        _period_years = (_span_seconds / 86_400.0) / 365.25 if _span_seconds > 0 else None

        portfolio_equity_curve: list = []
        capital_skips: list = []
        resolved_position_weight: float | None = None
        resolved_max_concurrent: int | None = None
        if sizing_mode == analysis_pb2.SIZING_MODE_PORTFOLIO:
            # Resolve sizing params once (zero-trap helpers: a stored 0 disables the portfolio →
            # default; max_concurrent clamped ≥ 1 so a stored negative can't reach the sim).
            resolved_position_weight = self._cfg.get_float(
                "analysis.backtest.portfolio_position_weight", 0.10
            )
            resolved_max_concurrent = max(
                1, self._cfg.get_int("analysis.backtest.portfolio_max_concurrent", 9)
            )
            # Cooldown days: strategy-level (uniform across symbols), resolved exactly as the
            # evaluated serial path does (servicer cooldown block); SMA path has no cooldown → 0.
            if active_definition is not None:
                port_cooldown_days = effective_cooldown_days(
                    active_definition.cooldown_days
                    if active_definition.HasField("cooldown_days")
                    else None,
                    self._cfg.get_int("analysis.strategy.default_cooldown_days", 31),
                )
                port_exit_cooldown_days = effective_cooldown_days(
                    active_definition.exit_cooldown_days
                    if active_definition.HasField("exit_cooldown_days")
                    else None,
                    self._cfg.get_int_present("analysis.strategy.default_exit_cooldown_days", 0),
                )
            else:
                port_cooldown_days = 0
                port_exit_cooldown_days = 0
            (
                portfolio_equity_curve,
                capital_skips,
                portfolio_trades,
            ) = await self._simulate_portfolio(
                symbol_intents,
                initial_capital=initial_equity,
                position_weight=resolved_position_weight,
                max_concurrent=resolved_max_concurrent,
                commission=commission,
                slippage=slippage,
                cooldown_days=port_cooldown_days,
                exit_cooldown_days=port_exit_cooldown_days,
            )
            # Aggregate metrics come from the order-independent portfolio curve (FR-1). The
            # per-symbol evidence cells + diagnostics above stay byte-identical (FR-4/AC-5).
            _port_curve_floats = [p.equity for p in portfolio_equity_curve]
            metrics = _compute_metrics(
                _port_curve_floats, portfolio_trades, initial_equity, _period_years
            )
            agg_trades = portfolio_trades
        else:
            metrics = _compute_metrics(daily_equity, all_trades, initial_equity, _period_years)
            agg_trades = all_trades

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
            total_trades=len(agg_trades),
            profit_factor=metrics["profit_factor"],
            completed_at=now,
            trades=agg_trades,
            # The effective seed (100k default when omitted) — required to interpret the
            # persisted equity curve for a historical run.
            initial_capital=initial_equity,
            # The mode actually used (never UNSPECIFIED on a completed run).
            sizing_mode=sizing_mode,
            # The effective fill model the run used (never UNSPECIFIED — normalized above), so
            # the echoed value always equals what routed the sim.
            fill_model=effective_fill_model,
        )
        # Portfolio-only outputs (empty in legacy mode — additive; a legacy run's persisted bytes
        # are unchanged apart from the new sizing_mode field 17).
        if capital_skips:
            result.capital_skips.extend(capital_skips)
        if portfolio_equity_curve:
            result.portfolio_equity_curve.extend(portfolio_equity_curve)
        # No trades + no usable curve (all symbols insufficient, or all formula-failed) →
        # INSUFFICIENT_DATA, never a fabricated flat-equity success. A partial run stays OK.
        if not all_trades and len(daily_equity) <= 1 and (coverage_gaps or formula_errors):
            result.status = analysis_pb2.BACKTEST_STATUS_INSUFFICIENT_DATA
        else:
            result.status = analysis_pb2.BACKTEST_STATUS_OK
        if coverage_gaps:
            result.coverage_gaps.extend(coverage_gaps)
        if all_diagnostics:  # per-bar diagnostics for every simulated symbol
            result.diagnostics.extend(all_diagnostics)
        # Flag any referenced formula that was soft-deleted (run completed on its last-saved
        # definition). Detected during the warm-up prefetch's GetFormula — no extra fetch here.
        if formula_deleted_cache:
            result.warnings.extend(formula_deleted_cache.values())
        self._backtests[backtest_id] = result
        self._backtests[request.strategy_id] = result

        # The backtest range (fully set after defaulting) is stamped on the run-history row and
        # every evidence cell.
        range_start_dt = (
            request.range.start.ToDatetime() if request.range.start.seconds > 0 else None
        )
        range_end_dt = request.range.end.ToDatetime() if request.range.end.seconds > 0 else None

        # Persist per-symbol evidence cells for OK runs (the base the derived headline grade
        # aggregates over). Best-effort — a cells-flush failure never fails the run.
        if result.status == analysis_pb2.BACKTEST_STATUS_OK:
            await self._persist_symbol_cells(
                symbol_cells,
                backtest_id=backtest_id,
                strategy_id=request.strategy_id,
                fingerprint=run_fingerprint,
                range_start=range_start_dt,
                range_end=range_end_dt,
            )

        # Grade THIS run for the run-history row only — the headline grade is derived from the
        # strategy's full evidence base below. INSUFFICIENT_DATA runs record score = None.
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
            # Record the resolved sizing model + params (None on the legacy branch).
            position_weight=resolved_position_weight,
            max_concurrent=resolved_max_concurrent,
        )
        # Persist full result (trades + equity + diagnostics) for OK runs only. Best-effort;
        # ordered after the summary insert so the FK (detail ⇒ listed summary) can hold.
        if result.status == analysis_pb2.BACKTEST_STATUS_OK:
            await self._persist_backtest_detail(result)

        # Recompute the headline grade from the strategy's full evidence base. Best-effort;
        # ordered BEFORE the completion emit so a subscriber sees the post-run grade.
        if result.status == analysis_pb2.BACKTEST_STATUS_OK:
            try:
                await self._recompute_headline(caller_user_id, request.strategy_id)
            except Exception as e:
                log.warning("failed to recompute headline score: %s", e)

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
        fill_model=analysis_pb2.FILL_MODEL_SAME_BAR_CLOSE,
    ):
        """Run SMA crossover backtest for a single symbol.

        Returns (trades, final_equity, daily_equity, diagnostics, intents).
        ``fill_model`` (feature 151) selects same-bar-close (legacy) vs next-bar-open execution;
        it defaults to legacy so existing callers/tests are byte-for-byte unchanged.
        """

        # 1. Fetch OHLCV bars (paged, plus a pre-window prefix when the caller supplied an explicit
        # start). The legacy engine's binding lookback is slow_period.
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

        # Tail-align SMA maps: ComputeIndicator omits warm-up rows without preserving indices,
        # so map the shortened result back onto the bars (same helper as the evaluator path).
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

        # The backtest score is technical-only — no newsletter-signal fetch or blend. A signal is
        # a queue ranking axis, never an input to a strategy's internal score.

        # Warm-up = first bar where BOTH SMAs are resolved.
        warmup_bars = max(min(fast_values, default=n - 1), min(slow_values, default=n - 1))
        # warmup_bars indexes the fetched series (may carry a pre-window prefix); report it
        # relative to the first in-window bar. On an unprefixed run (k == 0) this is a no-op.
        warmup_bars = max(0, warmup_bars - trade_start_idx)

        # One diagnostic row per bar, iterated independently of the trade loop (starts at index 1)
        # so bar 0 is captured. Present-only indicators map.
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

        # 4. Simulate trades bar by bar (shared deferred-execution state machine; SMA path has no
        # cooldown, so it passes 0/0 gates — byte-identical to legacy inline blocks in same-bar).
        state = SimState(equity=initial_equity)
        # daily_equity[j] pairs 1:1 with diags[j]. Unprefixed (k == 0): index 0 is the bar-0 seed;
        # prefixed: bar k is the first simulated bar with no separate seed row (else lengths drift).
        daily_equity = [state.equity] if trade_start_idx == 0 else []
        # Per-in-window-bar signal intent (independent of position/capital), consumed only by the
        # portfolio simulator; the legacy return/flow below is unchanged.
        intents: list[BarIntent] = []
        buy_threshold = scoring.buy_threshold(min_conviction)
        sell_threshold = scoring.sell_threshold()

        for i in range(max(1, trade_start_idx), n):
            bar = bars[i]
            price = bar.close

            # (A) Execute any pending fill due THIS bar BEFORE the warm-up continue, so a fill is
            # never skipped. Inert in same-bar mode (state.pending is always None here).
            action = _apply_fill(state, bars, i, fill_model, commission, slippage, symbol, 0, 0)

            # Skip until both SMAs are available (these are warm-up bars — labelled below)
            if i not in fast_values or i not in slow_values:
                if (
                    action is not None
                ):  # unreachable in practice; keep the loop the sole diag writer
                    diags[i - trade_start_idx].action = action
                daily_equity.append(state.equity + state.position * price)
                intents.append(BarIntent(bar.time, price, False, False, 0.0))
                continue

            prev_fast = fast_values.get(i - 1)
            prev_slow = slow_values.get(i - 1)
            curr_fast = fast_values[i]
            curr_slow = slow_values[i]

            if prev_fast is None or prev_slow is None:
                if action is not None:
                    diags[i - trade_start_idx].action = action
                daily_equity.append(state.equity + state.position * price)
                intents.append(BarIntent(bar.time, price, False, False, 0.0))
                continue

            # Technical signal: +1 (bullish crossover), -1 (bearish crossover), 0 (no change)
            if prev_fast <= prev_slow and curr_fast > curr_slow:
                tech_signal = 1.0
            elif prev_fast >= prev_slow and curr_fast < curr_slow:
                tech_signal = -1.0
            else:
                tech_signal = 0.0

            # Technical-only conviction: the pure-technical mapping (-1→0, 0→0.5, +1→1) with no
            # newsletter-signal blend.
            combined = tech_signal * 0.5 + 0.5
            diags[i - trade_start_idx].signal_score = 0.0
            diags[i - trade_start_idx].conviction = combined
            # Signal intent, independent of the position/capital gate below
            intents.append(
                BarIntent(
                    bar.time,
                    price,
                    combined >= buy_threshold,
                    combined <= sell_threshold,
                    combined,
                )
            )
            # (B) Detect a new signal → queue a pending fill; (C) execute it if due this bar
            # (same-bar mode). Next-bar mode defers the fill to (A) next iteration.
            _set_pending(
                state, i, combined >= buy_threshold, combined <= sell_threshold, fill_model
            )
            action2 = _apply_fill(state, bars, i, fill_model, commission, slippage, symbol, 0, 0)
            if action2 is not None:
                action = action2

            bar_action = (
                action
                if action is not None
                else (
                    analysis_pb2.BAR_ACTION_HOLD_LONG
                    if state.position > 0.0
                    else analysis_pb2.BAR_ACTION_HOLD_FLAT
                )
            )
            diags[i - trade_start_idx].action = bar_action
            daily_equity.append(state.equity + state.position * price)

        # Close any open position at last bar price
        if state.position > 0.0 and bars:
            last_bar = bars[-1]
            fill_price = last_bar.close * (1 - slippage)
            proceeds = state.position * fill_price * (1 - commission)
            pnl = proceeds - (state.position * state.entry_price * (1 + commission))
            now_ts = Timestamp()
            now_ts.CopyFrom(last_bar.time)
            entry_ts2 = Timestamp()
            entry_ts2.CopyFrom(state.entry_time)
            state.trades.append(
                analysis_pb2.TradeRecord(
                    symbol=symbol,
                    side="long",
                    qty=state.position,
                    entry_price=state.entry_price,
                    exit_price=fill_price,
                    pnl=pnl,
                    entry_time=entry_ts2,
                    exit_time=now_ts,
                )
            )
            state.equity += proceeds
            daily_equity[-1] = state.equity
            # The forced close labels the last bar an exit (AC-3)
            diags[-1].action = analysis_pb2.BAR_ACTION_EXIT_LONG

        symbol_diag = _finalize_symbol_diagnostics(
            symbol, diags, warmup_bars, state.trades, daily_equity
        )
        # intents is the additive 5th element; legacy callers ignore it.
        return state.trades, state.equity, daily_equity, symbol_diag, intents

    async def _load_benchmark_bars(
        self,
        definition,
        range_msg,
        formula_warmup_cache,
        propagation_meta,
        warmup_prefix: bool,
    ):
        """Feature 152 — preload bars for every distinct ``source_symbol`` referenced by a
        component, each fetched over the same window plus its own warmup prefix (so the
        benchmark indicator/formula is warmed from before ``start`` exactly like the
        evaluated symbol — the reproducible-window guarantee).

        Returns ``{source_symbol: [bars]}`` or ``None`` when no component sets a
        ``source_symbol`` (the common case — the evaluate path then skips all benchmark
        work). A benchmark warmup shortfall propagates as ``_InsufficientData(source_symbol,
        …)`` so the caller reports a ``CoverageGap`` naming the benchmark.
        """
        source_symbols = sorted({c.source_symbol for c in definition.components if c.source_symbol})
        if not source_symbols:
            return None
        out: dict = {}
        for sym in source_symbols:
            # Slice the definition to this symbol's components (keep the rules) so warmup sizes on
            # the benchmark's own components; the ref-walk tolerates missing non-benchmark refs.
            sliced = analysis_pb2.StrategyDefinition()
            sliced.CopyFrom(definition)
            del sliced.components[:]
            sliced.components.extend(c for c in definition.components if c.source_symbol == sym)
            required_prefix = (
                warmup.required_prefix_bars(sliced, formula_warmup_cache) if warmup_prefix else 0
            )
            bars, _trade_start_idx = await self._resolve_prefixed_bars(
                sym, range_msg, required_prefix, propagation_meta
            )
            out[sym] = bars
        return out

    async def _load_benchmark_bars_windowed(
        self, definition, range_msg, propagation_meta, *, cache=None, sem=None
    ):
        """Feature 152 — benchmark (source_symbol) bars for the readiness / opportunities
        surfaces, fetched over the SAME fixed window as the evaluated symbol (those surfaces
        use a plain lookback with no warm-up prefix, so the benchmark matches — no
        prefix-widening here, unlike the backtest ``_load_benchmark_bars``).

        ``cache`` dedups benchmark loads across an opportunities compute pass — one VOO fetch
        for every evaluated symbol that references it. ``sem`` bounds fetch concurrency
        (feature 141's ``_bars_fetch_sem``). A failed fetch caches ``[]`` (→ the benchmark
        reads as a gap → hold), never raising. Returns ``{source_symbol: [bars]}`` or ``None``.
        """
        source_symbols = sorted({c.source_symbol for c in definition.components if c.source_symbol})
        if not source_symbols:
            return None
        out: dict = {}
        for sym in source_symbols:
            if cache is not None and sym in cache:
                bars = cache[sym]
            else:
                try:
                    if sem is not None:
                        async with sem:
                            bars = await self._fetch_bars_paged(sym, range_msg, propagation_meta)
                    else:
                        bars = await self._fetch_bars_paged(sym, range_msg, propagation_meta)
                except Exception as e:  # noqa: BLE001 — benchmark fetch is best-effort
                    log.warning("benchmark bars fetch failed for %s: %s", sym, e)
                    bars = []
                if cache is not None:
                    cache[sym] = bars
            if bars:
                out[sym] = bars
        return out or None

    async def _benchmark_series_bars(self, comp, times, evaluator, propagation_meta):
        """Feature 152 — fetch a single benchmark component's bars for GetIndicatorSeries,
        covering the caller's chart window (``times``) widened by that component's warmup
        (builtin lookback or the declared formula ``warmup_period`` via
        ``evaluator.declared_formula_warmups``). Best-effort: on any fetch error return ``[]``
        so the chart degrades to a warm-up/gap head rather than failing the component."""
        if not times:
            return []
        sliced = analysis_pb2.StrategyDefinition(
            components=[comp],
            entry_rule=json.dumps({"fn": ">", "lhs": comp.ref_name, "rhs": 0}),
        )
        formula_cache = await evaluator.declared_formula_warmups(sliced)
        required_prefix = warmup.required_prefix_bars(sliced, formula_cache)
        extra_days = warmup.prefix_calendar_days(required_prefix) if required_prefix else 0
        range_msg = common_pb2.TimeRange()
        range_msg.start.seconds = max(0, times[0].seconds - extra_days * 86_400)
        range_msg.end.CopyFrom(times[-1])
        try:
            return await self._fetch_bars_paged(comp.source_symbol, range_msg, propagation_meta)
        except Exception as e:  # noqa: BLE001 — chart benchmark fetch is best-effort
            log.warning(
                "GetIndicatorSeries benchmark fetch failed for %s: %s", comp.source_symbol, e
            )
            return []

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
        fill_model=analysis_pb2.FILL_MODEL_SAME_BAR_CLOSE,
        benchmark_bars=None,
    ):
        """Run a stored/inline StrategyDefinition for one symbol via the shared evaluator.

        Drives entry/exit from StrategyEvaluator decisions (backtest/live parity).
        Returns (trades, final_equity, daily_equity, diagnostics, intents).
        ``fill_model`` (feature 151) selects same-bar-close (legacy) vs next-bar-open execution;
        defaults to legacy so existing callers/tests are byte-for-byte unchanged.
        """
        # Paged, plus a pre-window prefix when the caller supplied an explicit start.
        # Declared (never observed) — see app/services/warmup.py.
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
        # Capture the computed component series for diagnostics. benchmark_bars (preloaded once
        # per run, shared across symbols) resolve source_symbol components via the evaluator.
        decisions, component_series = await evaluator.evaluate_with_series(
            definition, bars, None, benchmark_bars
        )

        n = len(bars)
        warmup_bars_full = await self._compute_evaluated_warmup(
            definition, component_series, n, formula_warmup_cache, propagation_meta
        )
        # That index is into the fetched series (may carry a pre-window prefix); report it
        # relative to the first in-window bar. On an unprefixed run (k == 0) this is a no-op.
        warmup_bars = max(0, warmup_bars_full - trade_start_idx)

        # Per-bar diagnostics (independent of the trade loop → bar 0 captured). Present-only
        # indicators map, dropping the redundant "<ref>.value" alias.
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

        # Shared deferred-execution state machine (byte-identical to legacy inline blocks in
        # same-bar mode); _apply_fill is the sole opener/closer.
        state = SimState(equity=initial_equity)
        # daily_equity[j] pairs 1:1 with diags[j]. Unprefixed (k == 0): index 0 is the bar-0 seed;
        # prefixed: bar k is the first simulated bar with no separate seed row (else lengths drift).
        daily_equity = [state.equity] if trade_start_idx == 0 else []
        # Per-in-window-bar signal intent (independent of position/cooldown/capital), consumed
        # only by the portfolio simulator; the legacy return/flow below is unchanged.
        intents: list[BarIntent] = []

        # Re-entry cooldown: ephemeral per-RunBacktest state — last_exit_time is a plain local,
        # never persisted to analysis.strategy_cooldowns, so two runs can't cross-contaminate.
        cooldown_days = effective_cooldown_days(
            definition.cooldown_days if definition.HasField("cooldown_days") else None,
            self._cfg.get_int("analysis.strategy.default_cooldown_days", 31),
        )
        # Exit cooldown (min holding period), ephemeral per-RunBacktest state. get_int_present
        # (not get_int) — a configured 0 is legitimate and must not be zero-trapped.
        exit_cooldown_days = effective_cooldown_days(
            definition.exit_cooldown_days if definition.HasField("exit_cooldown_days") else None,
            self._cfg.get_int_present("analysis.strategy.default_exit_cooldown_days", 0),
        )

        for i in range(max(1, trade_start_idx), n):
            bar = bars[i]
            price = bar.close
            decision = decisions[i]
            # Signal intent, independent of the position/cooldown/capital gate below
            intents.append(
                BarIntent(
                    bar.time,
                    price,
                    decision.entry,
                    decision.exit,
                    decision.conviction,
                )
            )
            # (A) Execute a pending fill due this bar; inert in same-bar mode. Cooldown is pinned
            # to the fill-bar time inside _apply_fill (byte-identical to legacy when signal==fill).
            action = _apply_fill(
                state,
                bars,
                i,
                fill_model,
                commission,
                slippage,
                symbol,
                cooldown_days,
                exit_cooldown_days,
            )
            # (B) Detect this bar's signal → queue a pending fill; (C) execute if due this bar. The
            # cooldown gate lives in _apply_fill, which rejects a cooldown-blocked fill.
            _set_pending(state, i, decision.entry, decision.exit, fill_model)
            action2 = _apply_fill(
                state,
                bars,
                i,
                fill_model,
                commission,
                slippage,
                symbol,
                cooldown_days,
                exit_cooldown_days,
            )
            if action2 is not None:
                action = action2

            bar_action = (
                action
                if action is not None
                else (
                    analysis_pb2.BAR_ACTION_HOLD_LONG
                    if state.position > 0.0
                    else analysis_pb2.BAR_ACTION_HOLD_FLAT
                )
            )
            diags[i - trade_start_idx].action = bar_action
            daily_equity.append(state.equity + state.position * price)

        # Close any open position at the last bar price
        if state.position > 0.0 and bars:
            last_bar = bars[-1]
            fill_price = last_bar.close * (1 - slippage)
            proceeds = state.position * fill_price * (1 - commission)
            pnl = proceeds - (state.position * state.entry_price * (1 + commission))
            now_ts = Timestamp()
            now_ts.CopyFrom(last_bar.time)
            entry_ts2 = Timestamp()
            entry_ts2.CopyFrom(state.entry_time)
            state.trades.append(
                analysis_pb2.TradeRecord(
                    symbol=symbol,
                    side="long",
                    qty=state.position,
                    entry_price=state.entry_price,
                    exit_price=fill_price,
                    pnl=pnl,
                    entry_time=entry_ts2,
                    exit_time=now_ts,
                )
            )
            state.equity += proceeds
            daily_equity[-1] = state.equity
            diags[-1].action = analysis_pb2.BAR_ACTION_EXIT_LONG

        symbol_diag = _finalize_symbol_diagnostics(
            symbol, diags, warmup_bars, state.trades, daily_equity
        )
        # intents is the additive 5th element; legacy callers ignore it.
        return state.trades, state.equity, daily_equity, symbol_diag, intents

    async def _simulate_portfolio(
        self,
        symbol_intents: dict[str, list["BarIntent"]],
        initial_capital: float,
        position_weight: float,
        max_concurrent: int,
        commission: float,
        slippage: float,
        cooldown_days: int,
        exit_cooldown_days: int,
    ):
        """Feature 150: portfolio sizing — one shared cash pool, concurrent positions, one equity
        curve. Consumes the per-symbol signal intent already built in-process by the simulators
        (adds NO new gRPC/DB edge, reuses their fetched bars). Returns
        ``(portfolio_equity_curve, capital_skips, portfolio_trades)``.

        Design contract (design.md / implementation-spec Step 5):
        - Shared calendar = union of every symbol's intent timestamps, ascending.
        - Mark-to-market a symbol with no bar on a union date at its **last on-or-before** close
          (forward-fill — provably past-only, no look-ahead). A terminal/held symbol freezes at its
          last close; never a synthetic sell.
        - Per union date, ascending: process EXITS first (free cash), then entry-intent symbols not
          already held, ordered by **symbol ASC** (documented-arbitrary deterministic tiebreak given
          binary conviction), opening each while ``len(positions) < max_concurrent`` AND
          ``cash >= position_weight * initial_capital``; else record a ``PortfolioCapitalSkip`` and
          open nothing (FR-5/AC-6 — never a zero-sized fill).
        - Cooldown parity (FR-6): reuse ``effective_cooldown_days`` + ``is_cooldown_active`` against
          **portfolio-local** ephemeral per-symbol last-exit / entry anchors (never touches
          ``analysis.strategy_cooldowns``). Gate order per entry: cooldown first, capital second;
          mutate anchors only on an actual fill.
        - Per-bar equity = ``cash + Σ(shares × marked-to-market close)`` over open positions (AC-2).
        - Terminal policy: on the final union date, force-close every open position at its
          last-known close (realized semantics, matching the serial forced-close), one
          ``TradeRecord`` per close.

        v1 caveats (design Open Risks, kept as inline documentation):
        - Forward-filling a halted/missing symbol holds equity flat then jumps, so a mid-gap
          ``max_drawdown`` is understated — legacy-realized parity is chosen over gap fidelity here.
        - The symbol-ASC entry tiebreak is a systematic bias, not neutral.
        """
        # Build per-symbol close/intent maps keyed by tz-aware-UTC datetime, and the union calendar.
        close_maps: dict[str, dict[datetime, float]] = {}
        intent_maps: dict[str, dict[datetime, BarIntent]] = {}
        all_dts: set[datetime] = set()
        for sym, sym_intents in symbol_intents.items():
            cmap: dict[datetime, float] = {}
            imap: dict[datetime, BarIntent] = {}
            for it in sym_intents:
                d = it.timestamp.ToDatetime(tzinfo=UTC)
                cmap[d] = it.close
                imap[d] = it
                all_dts.add(d)
            close_maps[sym] = cmap
            intent_maps[sym] = imap
        calendar = sorted(all_dts)

        cash = float(initial_capital)
        alloc = position_weight * initial_capital  # cash committed per concurrent position
        positions: dict[str, dict] = {}  # symbol -> {shares, entry_price, entry_ts, entry_dt}
        last_close: dict[str, float] = {}  # forward-fill state (updated on-or-before each date)
        last_exit: dict[str, datetime] = {}  # portfolio-local re-entry anchor (FR-6)

        equity_curve: list = []
        capital_skips: list = []
        trades: list = []

        for idx, d in enumerate(calendar):
            is_terminal = idx == len(calendar) - 1
            ts_d = Timestamp()
            ts_d.FromDatetime(d)

            # 1. Advance forward-fill: any symbol with a bar exactly on d updates its last close.
            for sym, cmap in close_maps.items():
                if d in cmap:
                    last_close[sym] = cmap[d]

            # 2. Exits first (free cash). Only symbols with a bar (intent) on d can act.
            for sym in sorted(positions.keys()):
                intent = intent_maps[sym].get(d)
                if intent is None or not intent.exit_intent:
                    continue
                if is_cooldown_active(positions[sym]["entry_dt"], d, exit_cooldown_days):
                    continue  # min-hold not satisfied yet
                pos = positions.pop(sym)
                fill_price = intent.close * (1 - slippage)
                proceeds = pos["shares"] * fill_price * (1 - commission)
                pnl = proceeds - (pos["shares"] * pos["entry_price"] * (1 + commission))
                cash += proceeds
                last_exit[sym] = d
                exit_ts = Timestamp()
                exit_ts.CopyFrom(intent.timestamp)
                trades.append(
                    analysis_pb2.TradeRecord(
                        symbol=sym,
                        side="long",
                        qty=pos["shares"],
                        entry_price=pos["entry_price"],
                        exit_price=fill_price,
                        pnl=pnl,
                        entry_time=pos["entry_ts"],
                        exit_time=exit_ts,
                    )
                )

            # 3. Entries: symbols signaling entry, not held, symbol-ASC. Cooldown, then capital.
            for sym in sorted(intent_maps.keys()):
                intent = intent_maps[sym].get(d)
                if intent is None or not intent.entry_intent or sym in positions:
                    continue
                if is_cooldown_active(last_exit.get(sym), d, cooldown_days):
                    continue  # re-entry cooldown active; not a capital skip
                if len(positions) >= max_concurrent or cash < alloc:
                    capital_skips.append(
                        analysis_pb2.PortfolioCapitalSkip(
                            symbol=sym,
                            timestamp=intent.timestamp,
                            intended_weight=alloc,
                            available_cash=cash,
                        )
                    )
                    continue  # never a zero-sized fill (FR-5/AC-6)
                fill_price = intent.close * (1 + slippage)
                if fill_price <= 0.0:
                    continue
                shares = alloc / (fill_price * (1 + commission))
                cost = shares * fill_price * (1 + commission)
                cash -= cost
                entry_ts = Timestamp()
                entry_ts.CopyFrom(intent.timestamp)
                positions[sym] = {
                    "shares": shares,
                    "entry_price": fill_price,
                    "entry_ts": entry_ts,
                    "entry_dt": d,
                }

            # 4. Terminal force-close (realized semantics; matches the serial forced-close).
            if is_terminal:
                for sym in sorted(positions.keys()):
                    pos = positions.pop(sym)
                    close_px = last_close.get(sym, pos["entry_price"])
                    fill_price = close_px * (1 - slippage)
                    proceeds = pos["shares"] * fill_price * (1 - commission)
                    pnl = proceeds - (pos["shares"] * pos["entry_price"] * (1 + commission))
                    cash += proceeds
                    trades.append(
                        analysis_pb2.TradeRecord(
                            symbol=sym,
                            side="long",
                            qty=pos["shares"],
                            entry_price=pos["entry_price"],
                            exit_price=fill_price,
                            pnl=pnl,
                            entry_time=pos["entry_ts"],
                            exit_time=ts_d,
                        )
                    )

            # 5. Per-bar equity = cash + Σ marked-to-market open positions (AC-2).
            mtm = sum(
                pos["shares"] * last_close.get(sym, pos["entry_price"])
                for sym, pos in positions.items()
            )
            equity_curve.append(analysis_pb2.EquityPoint(timestamp=ts_d, equity=cash + mtm))

        return equity_curve, capital_skips, trades

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
        # Owner-scoped — uniform PERMISSION_DENIED on a non-owned/missing strategy.
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
                # No eligible evidence: clear any stale grade. This delete is NON-best-effort —
                # a failure aborts UNAVAILABLE rather than leaving a stale grade behind.
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
        self,
        result,
        symbols,
        score,
        range_start=None,
        range_end=None,
        position_weight=None,
        max_concurrent=None,
    ) -> None:
        """Best-effort append of a completed backtest to the durable run-history table.

        Fixes "cannot see past run results": the in-memory ``_backtests`` dict only holds
        the latest run per strategy and is lost on restart, so every run is also recorded
        here (summary metrics + the score it earned). No-op in the no-DB test path. The
        ``range_start``/``range_end`` (feature 065) record the window each run covered.

        feature 150: the resolved sizing model + params are persisted so a run is reproducible
        despite WatchConfig drift. ``sizing_mode`` is the enum **name** (mirrors the ``status``
        column); ``position_weight``/``max_concurrent`` are None on the legacy branch (NULL rows).
        feature 151: ``fill_model`` is likewise the effective enum **name** read from the result.
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
                sizing_mode=analysis_pb2.SizingMode.Name(result.sizing_mode),
                position_weight=position_weight,
                max_concurrent=max_concurrent,
                fill_model=analysis_pb2.FillModel.Name(result.fill_model),
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
        # Clamp: a negative config value makes the eviction LIMIT raise (swallowed → unbounded
        # growth). get_int zero-trap: a stored 0 reads as the default 20.
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
        # Owner-scoped — return only the caller's own scores. The _strategies cache is keyed by
        # bare strategy_id, so cross-check ownership against the repo.
        if self._strategies_repo is not None:
            caller_user_id = self._caller_user_id(context)
            owned, _ = await self._strategies_repo.list(caller_user_id, include_inactive=True)
            owned_ids = {r["strategy_id"] for r in owned}
            strategies = [v for k, v in self._strategies.items() if k in owned_ids]
        else:
            strategies = list(self._strategies.values())
        return analysis_pb2.ListStrategiesResponse(strategies=strategies)

    async def GetStrategyReport(self, request, context):
        # Owner-scoped — uniform PERMISSION_DENIED for a non-owned/missing strategy (the in-memory
        # score/backtest caches are keyed by bare strategy_id).
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
        # Owner-scoped — resolve ownership before returning another user's run history.
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
        # Abort OUTSIDE the except block: context.abort raises, and a nested abort would be
        # swallowed by the bare except.
        if row_bytes is None:
            await context.abort(grpc.StatusCode.NOT_FOUND, "no detailed data for this run")
            return
        result = analysis_pb2.BacktestResult()
        result.ParseFromString(row_bytes)
        return result

    async def ManageStrategy(self, request, context):
        # Ownership-gated (no admin gate). REGISTER opens to any authenticated caller under their
        # own user_id; UPDATE/DEACTIVATE/REACTIVATE require ownership. No x-user-id owns nothing.
        caller_user_id = self._caller_user_id(context)
        if not caller_user_id:
            await context.abort(grpc.StatusCode.PERMISSION_DENIED, "authenticated caller required")
            return
        if self._strategies_repo is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "strategy store unavailable")
            return

        definition = request.definition
        op = request.operation

        # Normalize benchmark source_symbol server-side (uppercase/trim, empty → unset) on every
        # write path before serialization — never client-side (bypassable) and never two sites.
        _normalize_source_symbols(definition)

        if op == analysis_pb2.STRATEGY_OPERATION_REGISTER:
            await self._validate_definition_proto(definition, context)
            # Owner is server-authoritative — set from the header, never the request body. Two
            # users may share a strategy_id (composite PK), so the duplicate check is owner-scoped.
            definition.user_id = caller_user_id
            # Strict register: an existing id (active OR deactivated) is a conflict — route the
            # caller to reactivate rather than silently overwrite or crash on the PK.
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
            # An update_mask turns UPDATE into a partial merge; an absent mask keeps the
            # full-replace path byte-for-byte, so existing clients are unaffected.
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
            # Pre-fetch formula outputs BEFORE the txn — `apply_fn` runs row-locked and must not do
            # I/O. Fetch the union of request + stored components; a missing entry fails closed.
            pre = await self._strategies_repo.get_by_owner_and_id(
                caller_user_id, definition.strategy_id
            )
            if pre is None:
                # Uniform PERMISSION_DENIED: never reveal whether the id exists under another owner.
                await context.abort(
                    grpc.StatusCode.PERMISSION_DENIED,
                    f"strategy '{definition.strategy_id}' not found or not owned",
                )
                return
            # Refuse a new binding to a soft-deleted formula. Checks the request's own components
            # only, so an update leaving an existing (already-deleted) binding is not blocked.
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
                    # Rebuild through the shared row→proto mapper (single source of the overlay),
                    # but feed it the merged display_name or a masked rename would be lost.
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
            # A definition change usually changes the fingerprint, so clear the stale in-memory
            # grade FIRST, then best-effort recompute; the UPDATE never fails on a recompute error.
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
            # Reactivation re-validates the STORED definition first (a referenced formula may have
            # gone missing while deactivated) so it satisfies the firing contract.
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
        # Owner-scoped read. A non-owner gets a uniform PERMISSION_DENIED, never NOT_FOUND —
        # no existence probing via response code.
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
        # Surface a warning if this strategy references a soft-deleted formula; it still evaluates
        # on the last-saved definition, but the deletion is flagged to whoever reads it.
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
        # Header-derived owner filter (never read ListStrategiesRequest.user_id from the wire).
        # An empty caller id lists nothing.
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
        # Ownership-gated (no admin gate). Any authenticated caller may toggle live on their OWN
        # strategy; a non-owner (or empty caller) gets a uniform PERMISSION_DENIED.
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

        # Enabling live on an inactive strategy is rejected FAILED_PRECONDITION; disabling is
        # ALWAYS allowed. An empty allowlist is valid (fires the whole owner union), not rejected.
        if request.live_enabled:
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

        # Source weights come from ingest.SignalSource.reliability_weight ([0,1]). Both analysis
        # read paths share the one _drain_source_weights helper.
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
            # An unknown fundamental metric_name surfaces as INVALID_ARGUMENT rather than a
            # silent skip.
            await context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(e))
            return
        # Mark rows the caller already holds (best-effort cross-ref).
        user_id = dict(context.invocation_metadata()).get("x-user-id", "")
        held = await self._drain_held_symbols(user_id, propagation_meta)
        for r in resp.results:
            # _drain_held_symbols keys by normalized symbol, so normalize the membership test
            # (no-op for uppercase broker tickers; correct for mixed case).
            if _normalize_symbol(r.symbol) in held:
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
        """Trace a strategy's entry- or exit-rule conditions against recent bars for each requested
        symbol (feature 083). Returns per-symbol PASS/SOFT/FAIL leaves + a deterministic
        conviction ordinal. Propagates the C-03 header tuple on every outbound call.

        feature 138: ``request.rule`` selects which rule tree to trace — ``READINESS_RULE_EXIT``
        traces the ``exit_rule`` (so a held REDUCE/ADD opportunity's readiness panel explains the
        exit rule that actually fired, matching the queue's exit-derived conviction); UNSPECIFIED
        and ENTRY trace the ``entry_rule`` (the back-compat default — watchlist readiness relies on
        it)."""
        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]
        if self._strategies_repo is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "strategy store unavailable")
            return
        # Owner-scoped — uniform PERMISSION_DENIED on a non-owned/missing strategy.
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
        # Trace the exit rule only when explicitly requested (held REDUCE/ADD panel); UNSPECIFIED/
        # ENTRY keep the entry-rule default so watchlist readiness is unchanged.
        rule = "exit" if request.rule == analysis_pb2.READINESS_RULE_EXIT else "entry"
        evaluator = StrategyEvaluator(self._indicators, propagation_meta)
        range_msg = _recent_range(_READINESS_LOOKBACK_DAYS)
        # One benchmark load for the whole request (shared across request.symbols).
        benchmark_bars = await self._load_benchmark_bars_windowed(
            definition, range_msg, propagation_meta
        )
        readiness = []
        for symbol in request.symbols:
            fetch_ok = True
            try:
                bars = await self._fetch_bars_paged(symbol, range_msg, propagation_meta)
            except Exception as e:  # bar fetch is best-effort per symbol
                log.warning("EvaluateReadiness: bars fetch failed for %s: %s", symbol, e)
                bars = []
                fetch_ok = False
            if fetch_ok and not bars:
                # A successful-but-empty fetch is WARN-logged; request-bounded loop, so a per-symbol
                # WARN is rate-safe (unlike the live loop / screener, which summarize).
                log.warning(
                    "EvaluateReadiness: no 1d bars for %s (strategy %s) — readiness will be empty",
                    symbol,
                    request.strategy_id,
                )
            trace = await evaluator.evaluate_conditions_traced(
                definition, bars, symbol, rule=rule, benchmark_bars=benchmark_bars
            )
            readiness.append(_readiness_to_proto(trace))
        return analysis_pb2.EvaluateReadinessResponse(readiness=readiness)

    async def QueryPnLPatterns(self, request, context):
        """Ranked P&L-attribution factors (feature 042). Reads the raw pnl_pattern_samples for the
        symbol (optionally narrowed by strategy/time) and buckets at QUERY time (design § 3):
        indicator
        factors into quantile buckets, signal factors by presence; drops buckets below
        ``analysis.patterns.min_sample_count``; splits positive/negative by ``avg_pnl_impact``,
        ranking each by |impact| desc under ``request.limit``. DB-only read."""
        if self._pnl_samples_repo is None:
            return analysis_pb2.QueryPnLPatternsResponse()

        from_ts = request.from_ts.ToDatetime() if request.HasField("from_ts") else None
        to_ts = request.to_ts.ToDatetime() if request.HasField("to_ts") else None
        samples = await self._pnl_samples_repo.query(
            symbol=request.symbol,
            strategy_id=request.strategy_id,
            from_ts=from_ts,
            to_ts=to_ts,
        )

        min_sample = self._cfg.get_int("analysis.patterns.min_sample_count", 5)
        bucket_count = self._cfg.get_int("analysis.patterns.indicator_bucket_count", 5)
        factors = bucket_pnl_factors(samples, min_sample=min_sample, bucket_count=bucket_count)

        positive = sorted(
            (f for f in factors if f.avg_pnl_impact > 0),
            key=lambda f: abs(f.avg_pnl_impact),
            reverse=True,
        )
        negative = sorted(
            (f for f in factors if f.avg_pnl_impact < 0),
            key=lambda f: abs(f.avg_pnl_impact),
            reverse=True,
        )
        limit = request.limit or len(factors)
        return analysis_pb2.QueryPnLPatternsResponse(
            positive_factors=positive[:limit],
            negative_factors=negative[:limit],
        )

    async def _resolve_source_names(self, propagation_meta) -> dict[str, str]:
        """Best-effort slug → display_name from ingest ListSignalSources (feature 029). An ingest
        failure yields {} so every slug falls back to itself — which also satisfies AC-9 (a source
        registered after ship, unknown to this map, still appears keyed by its slug)."""
        try:
            resp = await self._ingest.ListSignalSources(
                ingest_pb2.ListSignalSourcesRequest(include_inactive=True),
                metadata=propagation_meta,
            )
        except grpc.RpcError as e:
            log.warning("_resolve_source_names: ListSignalSources failed: %s", e)
            return {}
        return {src.slug: (src.display_name or src.slug) for src in resp.sources}

    async def GetAttribution(self, request, context):
        """Per-source attribution over closed positions (feature 029). Aggregates
        042's analysis.pnl_positions (net = realized_pnl - fees_total) + order_snapshots.signals
        (winner-takes-all conviction). Owner-scoped via x-user-id; read-only, DB-only."""
        caller = self._caller_user_id(context)
        if not caller or self._pnl_positions_repo is None or self._order_snapshots_repo is None:
            return analysis_pb2.GetAttributionResponse()

        start = request.start.ToDatetime() if request.HasField("start") else None
        end = request.end.ToDatetime() if request.HasField("end") else None
        rows = await self._pnl_positions_repo.list_closed_for_attribution(
            user_id=caller, start=start, end=end
        )

        trade_count: dict[str, float] = {}
        win_count: dict[str, float] = {}
        total_pnl: dict[str, float] = {}
        return_sum: dict[str, float] = {}
        return_weight: dict[str, float] = {}

        for row in rows:
            inputs = await self._order_snapshots_repo.attribution_inputs_for_position(
                row["position_id"]
            )
            # Collapse the position's snapshot signals to each source's peak conviction.
            source_values: dict[str, float] = {}
            for snap in inputs:
                for sig in _parse_signals(snap.get("signals")):
                    src = sig.get("source") or ""
                    if not src:
                        continue
                    val = float(sig.get("value") or 0.0)
                    if src not in source_values or val > source_values[src]:
                        source_values[src] = val
            weights = attribute_trade(source_values)
            if not weights:
                continue  # manual / no-signal trade — excluded from per-source metrics (AC-3)
            net = float(row.get("realized_pnl") or 0.0) - float(row.get("fees_total") or 0.0)
            win = net > 0.0  # net of fees (AC-6/AC-10/AC-11)
            # Approximate cost basis: |earliest snapshot price × quantity| (v1 approximation).
            cost_basis = 0.0
            if inputs:
                first = inputs[0]
                cost_basis = abs(
                    float(first.get("price") or 0.0) * float(first.get("quantity") or 0.0)
                )
            for src, w in weights.items():
                trade_count[src] = trade_count.get(src, 0.0) + w
                if win:
                    win_count[src] = win_count.get(src, 0.0) + w
                total_pnl[src] = total_pnl.get(src, 0.0) + w * net
                if (
                    cost_basis > 0.0
                ):  # a 0 cost basis (degraded snapshot) is excluded from the mean only
                    return_sum[src] = return_sum.get(src, 0.0) + w * (net / cost_basis)
                    return_weight[src] = return_weight.get(src, 0.0) + w

        source_filter = request.source_id or ""  # optional slug filter (AC-7)
        surviving = [s for s in trade_count if not source_filter or s == source_filter]

        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]
        names = await self._resolve_source_names(propagation_meta) if surviving else {}

        attributions = []
        for src in surviving:
            tc = trade_count[src]
            wc = win_count.get(src, 0.0)
            rw = return_weight.get(src, 0.0)
            attributions.append(
                analysis_pb2.SourceAttribution(
                    source_id=src,
                    source_name=names.get(src, src),
                    trade_count=tc,
                    win_count=wc,
                    win_rate=(wc / tc) if tc > 0 else 0.0,
                    avg_return=(return_sum.get(src, 0.0) / rw) if rw > 0 else 0.0,
                    total_pnl=total_pnl.get(src, 0.0),
                )
            )
        return analysis_pb2.GetAttributionResponse(attributions=attributions)

    async def GetIndicatorSeries(self, request, context):
        """Per-component historical indicator series for a strategy over the caller's own bar window
        (feature 125, FR-6). Reuses ``StrategyEvaluator._compute_component`` per declared component
        in this handler's OWN loop — never the shared ``evaluate_conditions_traced`` that
        ``ListOpportunities`` depends on — under a process-lifetime semaphore, with per-component
        fault isolation: a component that fails to compute populates ``ComponentSeries.error`` and
        never fails the whole RPC. ``None`` points (warm-up head / NaN / gap) round-trip as an unset
        ``DoubleValue``, never a fabricated ``0.0`` (AC-4a / P-03). Owner-scoped like
        ``EvaluateReadiness`` (feature 133)."""
        propagation_meta = [
            (k, v)
            for k, v in context.invocation_metadata()
            if k in ("x-user-id", "x-access-scope", "x-trace-id")
        ]
        if self._strategies_repo is None:
            await context.abort(grpc.StatusCode.UNAVAILABLE, "strategy store unavailable")
            return
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
        closes = list(request.closes)
        component_series = []
        # Sequential loop (no gather) so the singleton semaphore bounds cross-request compute.
        # Benchmark components compute on the benchmark's own bars, aligned onto request.times.
        eval_dates = (
            [t.ToDatetime(tzinfo=UTC).date() for t in request.times]
            if any(c.source_symbol for c in definition.components)
            else None
        )
        for comp in definition.components:
            try:
                async with self._component_series_sem:
                    if comp.source_symbol:
                        bench_bars = await self._benchmark_series_bars(
                            comp, list(request.times), evaluator, propagation_meta
                        )
                        series_map = await evaluator._assemble_component_series(
                            comp,
                            closes,
                            eval_dates,
                            {comp.source_symbol: bench_bars} if bench_bars else {},
                        )
                    else:
                        series_map = await evaluator._compute_component(comp, closes)
                named = [
                    analysis_pb2.NamedSeries(
                        name=name,
                        # A None point (warm-up head / NaN / gap) → an IndicatorValue with `value`
                        # UNSET (proto3 explicit presence), never a fabricated 0.0 (AC-4a / P-03).
                        values=[
                            analysis_pb2.IndicatorValue(value=v)
                            if v is not None
                            else analysis_pb2.IndicatorValue()
                            for v in series
                        ],
                    )
                    for name, series in series_map.items()
                ]
                component_series.append(
                    analysis_pb2.ComponentSeries(
                        ref_name=comp.ref_name, kind=comp.kind, series=named
                    )
                )
            # Per-component fault isolation: catches FormulaExecutionError + any sandbox/RPC error
            # (broad by design — one bad component must not fail the whole RPC).
            except Exception as e:  # noqa: BLE001
                component_series.append(
                    analysis_pb2.ComponentSeries(
                        ref_name=comp.ref_name, kind=comp.kind, error=str(e)
                    )
                )
        return analysis_pb2.GetIndicatorSeriesResponse(
            times=request.times, components=component_series
        )

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
        opps = [_row_to_opportunity(r) for r in window]
        # Read-time live-market enrichment, AFTER ranking, so the live quote never enters the
        # conviction/ORDER BY path.
        await self._enrich_opportunities_live(opps, propagation_meta)
        return analysis_pb2.ListOpportunitiesResponse(
            opportunities=opps,
            page=common_pb2.PageResponse(next_page_token=next_token),
        )

    async def _enrich_opportunities_live(self, opps, propagation_meta) -> None:
        """Attach live_price / change_pct / sparkline to already-ranked Opportunities (feature 095).

        Read-time only — never called from _compute_opportunities, so the live quote is never a
        ranking input (FR-8/AC-14). Fan-out is bounded by the existing _bars_fetch_sem and deduped
        per symbol per pass; prev_close/bars are served from marketdata's cache/DB. A GetLatestPrice
        / GetBars miss or RPC error leaves the live fields UNSET (AC-11) and never aborts the read.
        A SparklinePoint with an unset close models a warm-up/absent bar, never NaN/0 (AC-4/P-03).
        """
        if not opps:
            return
        sparkline_bars = max(1, self._cfg.get_int("analysis.opportunity.sparkline_bars", 20))
        # Dedup the marketdata reads per symbol — several opportunities can share one symbol.
        by_symbol: dict[str, list] = {}
        for opp in opps:
            by_symbol.setdefault(opp.symbol, []).append(opp)

        async def _enrich_symbol(symbol: str, targets: list) -> None:
            last_price = None
            prev_close = None
            spark: list | None = None
            try:
                async with self._bars_fetch_sem:
                    lp = await self._marketdata.GetLatestPrice(
                        marketdata_pb2.GetLatestPriceRequest(symbol=symbol),
                        metadata=propagation_meta,
                    )
                if lp.HasField("last_price"):
                    last_price = lp.last_price
                if lp.HasField("prev_close"):
                    prev_close = lp.prev_close
            except Exception as e:  # live price is best-effort; leave unset on any failure (AC-11)
                log.warning(
                    "_enrich_opportunities_live: GetLatestPrice failed for %s: %s", symbol, e
                )
            try:
                async with self._bars_fetch_sem:
                    resp = await self._marketdata.GetBars(
                        marketdata_pb2.GetBarsRequest(
                            symbol=symbol,
                            timeframe="1d",
                            timeframe_enum=common_pb2.Timeframe.TIMEFRAME_1DAY,
                            page=common_pb2.PageRequest(page_size=sparkline_bars),
                        ),
                        metadata=propagation_meta,
                    )
                spark = list(resp.bars)
            except Exception as e:  # sparkline is best-effort; leave unset on any failure (AC-11)
                log.warning("_enrich_opportunities_live: GetBars failed for %s: %s", symbol, e)
            for opp in targets:
                if last_price is not None:
                    opp.live_price = last_price
                    if prev_close is not None and prev_close != 0.0:
                        opp.change_pct = (last_price - prev_close) / prev_close
                if spark is not None:
                    del opp.sparkline[:]
                    for b in spark:
                        # Finite close → set it; a warm-up/missing bar → unset close (never NaN/0).
                        pt = analysis_pb2.SparklinePoint()
                        if b.close == b.close and b.close not in (float("inf"), float("-inf")):
                            pt.close = b.close
                        opp.sparkline.append(pt)

        await asyncio.gather(*(_enrich_symbol(sym, targets) for sym, targets in by_symbol.items()))

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
        # One reference instant per compute pass, captured right after the signals await — else a
        # concurrently-ingested signal could carry ingested_at > now, yielding a negative age.
        now_utc = datetime.now(UTC)
        half_life = self._cfg.get_float_present(
            "analysis.scoring.signal_decay_half_life_hours", 24.0
        )
        missing_ingested_at_count = 0
        total_signal_count = len(signals)
        held_value_by_symbol = await self._drain_held_symbols(user_id, propagation_meta)
        bindings = await self._drain_watchlist_bindings(propagation_meta)
        # Per-source reliability weight scales the signal ranking axis below.
        source_weights = await self._drain_source_weights(propagation_meta)

        # Index the origins by normalized symbol.
        watchlist_by_symbol: dict[str, set[str]] = {}
        for sym, strat in bindings:
            watchlist_by_symbol.setdefault(_normalize_symbol(sym), set()).add(strat)
        signals_by_symbol: dict[str, list] = {}
        for sig in signals:
            signals_by_symbol.setdefault(_normalize_symbol(sig.symbol), []).append(sig)
        held_norm = set(held_value_by_symbol)  # keys already normalized

        # Live-strategy symbol coverage: a held/signal symbol covered by a live strategy surfaces
        # that strategy's trace. list_live_enabled is owner-scoped (no cross-user attribution).
        live_by_symbol: dict[str, set[str]] = {}
        created_at_by_strategy: dict[str, object] = {}
        # (sym, strat) pairs where sym is deny-listed AND within pre-deny coverage become muted
        # rows below (held+denied keeps its exit; non-held gets a 0/0 placeholder).
        denied_covered: list[tuple[str, str]] = []
        if self._strategies_repo is not None:
            from app.engine.live_loop import (  # noqa: PLC0415 (avoids import cycle)
                resolve_universe,
            )

            # resolve_universe.union is the strategy's pre-deny coverage (allowlist override, else
            # watchlist ∪ held ∪ signals-iff-eligible), already normalized.
            wl_set = set(watchlist_by_symbol)
            sig_set = set(signals_by_symbol)
            for row in await self._strategies_repo.list_live_enabled(user_id):
                definition = _row_to_strategy_definition(row)
                resolved = resolve_universe(definition, wl_set, held_norm, sig_set)
                for sym in resolved.union:
                    live_by_symbol.setdefault(sym, set()).add(row["strategy_id"])
                created_at_by_strategy[row["strategy_id"]] = row["created_at"]
                for sym in resolved.denied & resolved.union:
                    denied_covered.append((sym, row["strategy_id"]))

        # Per-symbol live-attribution fan-out cap, applied ONLY at candidate-CREATION sites. The
        # exclude-before-slice order is LOAD-BEARING so the budget goes to genuinely-new strategies.
        max_live_strats = self._cfg.get_int(
            "analysis.opportunity.max_live_strategies_per_symbol", 5
        )

        def _capped_live(sym: str, exclude=frozenset()) -> list[str]:
            return sorted(
                live_by_symbol.get(sym, set()) - exclude,
                key=lambda s: created_at_by_strategy[s],
            )[:max_live_strats]

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
                    "is_live": False,
                    "muted": False,  # on the strategy's deny list
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
                # Tag (never cap) a watchlist strategy that is also live-covered.
                if strat in live_by_symbol.get(sym, set()):
                    c["is_live"] = True
                    _add_provenance(c, "live_strategy")

        # 2. Held positions — attribute to each watchlist strategy, plus bounded live-covered
        #    strategies; else an unattributed (symbol, "") row. Every held symbol yields ≥1 row.
        max_live_held = self._cfg.get_int(
            "analysis.opportunity.max_live_held_symbols_per_compute", 20
        )
        live_eligible_held = [
            sym
            for sym in held_norm
            if _capped_live(sym, exclude=watchlist_by_symbol.get(sym, set()))
        ]
        ranked_held = sorted(
            live_eligible_held,
            key=lambda sym: (-held_value_by_symbol.get(sym, 0.0), sym),
        )
        held_live_budget = set(ranked_held[:max_live_held])
        for sym in held_norm:
            watch = watchlist_by_symbol.get(sym, set())
            live_all = live_by_symbol.get(sym, set())
            live_new = _capped_live(sym, exclude=watch) if sym in held_live_budget else []
            targets = list(watch | set(live_new)) if (watch or live_new) else [""]
            for strat in targets:
                c = _candidate(sym, strat)
                c["is_held"] = True
                _add_provenance(c, "position")
                if strat in live_all:
                    c["is_live"] = True
                    _add_provenance(c, "live_strategy")

        # 2b. Live-only symbols — distinct NON-held symbols with both an active signal and live
        #     coverage get a new live-attributed row, bounded per compute. Pre-seeds the row.
        def _new_live_strats(sym: str) -> list[str]:
            # _capped_live with no exclude — exclude-before-slice would breach the per-symbol cap.
            return [s for s in _capped_live(sym) if (sym, s) not in candidates]

        # The − held_norm exclusion is load-bearing: a held symbol here would produce a wrongly
        # entry-traced duplicate (held symbols already got their exit-traced rows above).
        live_signal_symbols = (signals_by_symbol.keys() & live_by_symbol.keys()) - held_norm
        competitive_pool = [sym for sym in live_signal_symbols if _new_live_strats(sym)]
        max_live_only = self._cfg.get_int(
            "analysis.opportunity.max_live_only_symbols_per_compute", 20
        )
        ranked_live_only = sorted(
            competitive_pool,
            key=lambda sym: (-max(sig.conviction for sig in signals_by_symbol[sym]), sym),
        )[:max_live_only]
        for sym in ranked_live_only:
            for strat in _new_live_strats(sym):
                c = _candidate(sym, strat)
                c["is_live"] = True
                _add_provenance(c, "live_strategy")

        # 3. Signals — merge into every existing candidate for the symbol (collapse); if none
        #    exists, stand alone as an unattributed (symbol, "") candidate.
        for sym, sigs in signals_by_symbol.items():
            targets = [k for k in candidates if k[0] == sym]
            if not targets:
                _candidate(sym, "")
                targets = [(sym, "")]

            # Decay + source weighting computed ONCE per signal, hoisted above the targets loop so
            # a symbol bound to multiple strategies does not re-decay/re-count the same signal.
            sig_contribs = []
            for sig in sigs:
                raw_conviction = sig.conviction
                # Per-source reliability weight (neutral 1.0 for an unknown/unweighted source,
                # mirroring scoring.compute_signal_score).
                source_weight = source_weights.get(sig.source, 1.0)
                if sig.HasField("ingested_at"):
                    ingested_dt = sig.ingested_at.ToDatetime(tzinfo=UTC)
                    raw_age_hours = (now_utc - ingested_dt).total_seconds() / 3600
                    age_hours = max(0.0, raw_age_hours)  # defensive clamp (race / clock skew)
                    age_clamped = raw_age_hours < 0.0
                    age_known = True
                else:
                    age_hours = None
                    age_clamped = False
                    age_known = False
                    missing_ingested_at_count += 1
                # Age-derivation branches on HasField(ingested_at); decay on half_life. Neither
                # gates the other, so all log-referenced names are bound in every combination.
                decay_multiplier = (
                    math.exp(-math.log(2) / half_life * age_hours)
                    if (half_life > 0 and age_known)
                    else 1.0
                )
                effective_conviction = raw_conviction * source_weight * decay_multiplier
                if not math.isfinite(effective_conviction):
                    effective_conviction = 0.0  # explicit guard (future-refactor insurance)
                log.debug(
                    "signal_axis decay: symbol=%s source=%s raw_conviction=%s source_weight=%s "
                    "age_hours=%s age_known=%s age_clamped=%s decay_multiplier=%s "
                    "effective_conviction=%s",
                    sym,
                    sig.source,
                    raw_conviction,
                    source_weight,
                    age_hours,
                    age_known,
                    age_clamped,
                    decay_multiplier,
                    effective_conviction,
                )
                sig_contribs.append((sig, effective_conviction))

            for key in targets:
                c = candidates[key]
                for sig, effective_conviction in sig_contribs:
                    _add_provenance(c, sig.source)
                    c["signal_axis"] = max(c["signal_axis"], effective_conviction)  # decayed
                    if sig.conviction > c["_best_sig_conv"]:  # thesis/direction on RAW conviction
                        c["_best_sig_conv"] = sig.conviction
                        c["best_direction"] = sig.direction
                        if not c["thesis"]:
                            c["thesis"] = sig.headline

        # One aggregated WARNING per compute pass (never one-per-signal — it would scale as
        # signals × users). Signals missing ingested_at are treated as fresh.
        if missing_ingested_at_count > 0:
            log.warning(
                "%d of %d signals missing ingested_at this compute pass; treated as fresh "
                "(decay_multiplier=1.0)",
                missing_ingested_at_count,
                total_signal_count,
            )

        # Muted (deny-listed) rows: one per denied (sym, strat). Held+denied flags its exit-traced
        # row; non-held gets a 0/0 placeholder. muted rides the "denied" provenance marker.
        for sym, strat in denied_covered:
            c = _candidate(sym, strat)
            if sym in held_norm:
                c["is_held"] = True  # keep the exit trace on the held+denied row
                _add_provenance(c, "position")
            _add_provenance(c, "denied")
            c["muted"] = "denied" in c["provenance"]

        # Rank curated (watchlist/held/live) ABOVE the max_universe_size cut so it is never
        # truncated; a muted_only bucket ranks above the speculative tail too.
        max_universe = self._cfg.get_int("analysis.opportunity.max_universe_size", 100)

        def _sel(c: dict) -> bool:
            return c["is_watchlist"] or c["is_held"] or c["is_live"]

        curated = [c for c in candidates.values() if _sel(c)]
        muted_only = [c for c in candidates.values() if c["muted"] and not _sel(c)]
        speculative = [c for c in candidates.values() if not (_sel(c) or c["muted"])]
        speculative.sort(key=lambda c: c["signal_axis"], reverse=True)
        budget = max(0, max_universe - len(curated) - len(muted_only))
        selected = curated + muted_only + speculative[:budget]

        # Readiness + row assembly. Attributed candidates fetch bars once each and trace; the
        # session date (for valid_until) is the newest bar seen across the whole compute.
        evaluator = StrategyEvaluator(self._indicators, propagation_meta)
        range_msg = _recent_range(_READINESS_LOOKBACK_DAYS)
        strategy_defs: dict[str, object] = {}  # strategy_id → StrategyDefinition | None (cache)
        # Per-pass symbol-keyed bars dedup — one fetch per unique symbol. A failed fetch caches []
        # and is not retried this pass; every candidate still resolves to a trace or 0/0 fallback.
        bars_by_symbol: dict[str, list] = {}
        # Benchmark (source_symbol) bars deduped once per compute pass — one fetch shared across
        # evaluated symbols/strategies, bounded by _bars_fetch_sem.
        benchmark_bars_cache: dict[str, list] = {}
        session_end_seconds = 0
        window_hours = self._cfg.get_int("analysis.opportunity.valid_window_hours", 24)

        rows: list[dict] = []
        for c in selected:
            sym = c["symbol"]
            strat = c["strategy_id"]
            readiness = _empty_readiness(sym)
            exit_fires = False

            # A muted NON-held row is a deny-listed placeholder — skip the bars-fetch/trace and
            # emit 0/0 (a held+denied row still traces its exit, since deny is entry-only).
            if strat and not (c["muted"] and not c["is_held"]):
                definition = await self._load_strategy_definition(user_id, strat, strategy_defs)
                if definition is not None:
                    if sym in bars_by_symbol:
                        bars = bars_by_symbol[sym]
                    else:
                        async with self._bars_fetch_sem:
                            try:
                                bars = await self._fetch_bars_paged(
                                    sym, range_msg, propagation_meta
                                )
                            except Exception as e:  # bar fetch is best-effort per symbol
                                log.warning(
                                    "_compute_opportunities: bars fetch failed for %s: %s", sym, e
                                )
                                bars = []
                        bars_by_symbol[sym] = bars
                    if bars:
                        newest = bars[-1].time.seconds
                        session_end_seconds = max(session_end_seconds, newest)
                    # Benchmark bars for this definition, deduped once per pass.
                    benchmark_bars = await self._load_benchmark_bars_windowed(
                        definition,
                        range_msg,
                        propagation_meta,
                        cache=benchmark_bars_cache,
                        sem=self._bars_fetch_sem,
                    )
                    # Held + attributed → exit-rule trace (FR-8); else entry-rule trace.
                    rule = "exit" if c["is_held"] else "entry"
                    readiness = await evaluator.evaluate_conditions_traced(
                        definition, bars, sym, rule=rule, benchmark_bars=benchmark_bars
                    )
                    if c["is_held"]:
                        total = readiness["total_conditions"]
                        exit_fires = total > 0 and readiness["passing_conditions"] == total
                    # Persist strategy-derived target/stop from signal_params into readiness JSONB
                    # (no new column); present → store, absent → nothing (never fabricated).
                    _sp = json_format.MessageToDict(definition.signal_params)
                    for _key, _dst in (("target", "target_price"), ("stop", "stop_price")):
                        _val = _sp.get(_key)
                        if isinstance(_val, (int, float)) and not isinstance(_val, bool):
                            readiness[_dst] = float(_val)

            action = _resolve_action_tag(c, exit_fires)
            if action is None:
                if c["muted"]:
                    # A muted, otherwise-non-actionable row is informational — keep it (UNSPECIFIED
                    # tag), never drop it. The mute is the signal.
                    action = analysis_pb2.OPPORTUNITY_ACTION_TAG_UNSPECIFIED
                else:
                    continue  # speculative sell-with-no-position → not actionable, drop

            # Carry the raw max ExternalSignal.conviction via readiness_json (no column).
            # _best_sig_conv stays -1.0 with no signal → leave unset, never a fabricated 0.0.
            if c["_best_sig_conv"] >= 0.0:
                readiness["signal_confidence"] = c["_best_sig_conv"]

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

        # One session date for the whole compute → uniform valid_until; fall back to now when no
        # bars were fetched. The mixed-calendar residual is accepted (revalidated on next read).
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
            # Resolve the binding under the computing user's ownership; a binding to a strategy_id
            # owned by another user resolves to None → unattributed, never cross-attributing.
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

    def _opportunity_refresh_hour(self) -> int:
        """The wall-clock anchor hour for the daily opportunity refresh (read presence-aware —
        `0` = midnight is legitimate). Passed as DurableSchedule's zero-arg anchor callable."""
        return self._cfg.get_int_present("analysis.opportunity.refresh_hour_utc", 0)

    async def _opportunity_refresh_tick(self, schedule: DurableSchedule) -> float:
        """One scheduler iteration for the opportunity refresh. Returns the seconds run_forever
        should sleep afterward. When due, runs one pass and advances the wall-clock schedule.

        Enumeration failure raises → retry soon (feature 158, @AC-9 — the deliberate change from the
        old skip-to-tomorrow `continue`). Per-user failures stay swallowed, so a completed pass
        (even with some users failing) advances to the next wall-clock hour.
        """
        sleep_s = await schedule.next_sleep_seconds()
        if sleep_s > 0:
            return sleep_s
        # Due. Enumerate the known-user set; a failure retries after retry_seconds (clamped ≥ 1).
        try:
            user_ids = await self._opportunities_repo.distinct_user_ids()
        except Exception as e:
            log.warning("opportunity daily refresh: user enumeration failed: %s", e)
            retry = max(1, self._cfg.get_int_present("analysis.opportunity.retry_seconds", 300))
            await schedule.advance(retry)
            return 0.0
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
        # A completed pass advances to the next wall-clock hour.
        await schedule.advance(seconds_until_hour_utc(self._opportunity_refresh_hour()))
        return 0.0

    async def run_opportunity_refresh_forever(self):
        """Configured **daily** refresh pass (feature 097, OR-C) — a wall-clock refresh at
        ``analysis.opportunity.refresh_hour_utc``, NOT market close (holiday/DST/early-close
        drift is expected). Recomputes the OR-E known-user set (``opportunities`` ∪
        ``opportunity_actions``); a watchlist-only user who never reads is never materialized here
        (accepted — the live loop owns alerting). Call as a ``create_task`` on this coroutine.

        Feature 158: the schedule is now durable (compute-sleep-until-due, re-anchor across
        redeploys, prompt re-run after a crash) via the shared DurableSchedule (wall-clock mode),
        with a bounded one-shot startup jitter. `instance_count:1` → no lease/CAS fencing.
        """
        if self._opportunities_repo is None:
            return
        schedule = DurableSchedule(
            self._db_pool,
            "opportunity",
            "wallclock",
            anchor_hour=self._opportunity_refresh_hour,
        )
        await schedule.seed()
        # One-shot bounded startup jitter to stagger concurrent redeploys (mirror fundsignal_loop).
        jitter = self._cfg.get_int_present("analysis.opportunity.startup_jitter_seconds", 30)
        await asyncio.sleep(random.uniform(0, max(0, jitter)))
        while True:
            await asyncio.sleep(await self._opportunity_refresh_tick(schedule))

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

    async def _drain_held_symbols(self, user_id, propagation_meta) -> "dict[str, float]":
        """Drain the user's held symbols across all accounts/modes (paginated), keyed by
        **normalized** symbol and valued by summed ``abs(Position.market_value)``.
        ``ListPositions(user_id)`` with ``account_id`` unset + ``TradingMode UNSPECIFIED``
        already returns every held position — no new global-positions RPC needed.

        Feature 131: normalized at construction (not the read site) — the opportunity ranking reads
        ``held_value_by_symbol.get(sym, 0.0)`` where ``sym`` iterates the already-normalized
        ``held_norm``, so a raw key would silently rank a real held symbol at 0.0."""
        if self._portfolio is None:
            return {}
        held: dict[str, float] = {}
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
            for p in resp.positions:
                norm = _normalize_symbol(p.symbol)
                held[norm] = held.get(norm, 0.0) + abs(p.market_value)
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

        # Owner-scoped analytics: a caller may only read analytics for their OWN strategy — uniform
        # PERMISSION_DENIED otherwise (the no-DB test path, repo is None, is unaffected).
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

        # Real queue_share + taken reconciliation over the materialized queue.
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


def _normalize_source_symbols(definition) -> None:
    """Feature 152 — canonicalize every component's ``source_symbol`` in place: trimmed +
    uppercased, empty-after-trim collapses to ``""`` (unset → evaluated-symbol behavior).

    Server-authoritative: applied on every ManageStrategy write path (REGISTER + UPDATE) so a
    benchmark written as ``"voo "`` and ``"VOO"`` can never fingerprint as two different
    strategies, and a whitespace-only value never persists as a bogus benchmark. Reuses the
    ``_normalize_symbol`` canonicalizer so it stays identical to the universe/opportunity-key
    normalization."""
    for comp in definition.components:
        comp.source_symbol = _normalize_symbol(comp.source_symbol)


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
        if origin not in ("watchlist", "position", "denied"):
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
        # muted is derived from the "denied" provenance marker (analysis.opportunities has no
        # muted column), so it survives the DB round-trip.
        muted=("denied" in provenance),
    )
    valid_until = row.get("valid_until")
    if valid_until is not None:
        opp.valid_until.FromDatetime(valid_until)
    # Compute-time strategy enrichment persisted in readiness_json. conditions = the already-traced
    # leaves (no recompute); target_price/stop_price carried ONLY when present, never fabricated.
    for cond in readiness.get("conditions") or []:
        opp.conditions.append(
            analysis_pb2.ConditionEval(
                ref_name=cond.get("ref_name", ""),
                lhs_value=float(cond.get("lhs_value", 0.0)),
                threshold=float(cond.get("threshold", 0.0)),
                fn=cond.get("fn", ""),
                state=int(cond.get("state", 0)),
                distance_to_threshold=float(cond.get("distance_to_threshold", 0.0)),
            )
        )
    target_price = readiness.get("target_price")
    if target_price is not None:
        opp.target_price = float(target_price)
    stop_price = readiness.get("stop_price")
    if stop_price is not None:
        opp.stop_price = float(stop_price)
    # The raw max ExternalSignal.conviction, carried from readiness_json as explicit-presence
    # (unset when the symbol had no active signal — never a fabricated 0.0).
    signal_confidence = readiness.get("signal_confidence")
    if signal_confidence is not None:
        opp.signal_confidence = float(signal_confidence)
    return opp


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
    # The two lists must stay 1:1 — `diags[j].equity = daily_equity[j]` is positional. The two
    # engine paths build them differently, so assert it here to fail loudly on any drift.
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
    # sizing_mode stored as the enum name; a null/legacy row → UNSPECIFIED.
    try:
        sizing_mode = analysis_pb2.SizingMode.Value(row.get("sizing_mode") or "")
    except ValueError:
        sizing_mode = analysis_pb2.SIZING_MODE_UNSPECIFIED
    # fill_model stored as the enum name; a null/pre-151 row → UNSPECIFIED.
    try:
        fill_model = analysis_pb2.FillModel.Value(row.get("fill_model") or "")
    except ValueError:
        fill_model = analysis_pb2.FILL_MODEL_UNSPECIFIED
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
        sizing_mode=sizing_mode,
        fill_model=fill_model,
    )
    completed = row.get("completed_at")
    if completed is not None:
        ts = Timestamp()
        ts.FromDatetime(completed)
        summary.completed_at.CopyFrom(ts)
    return summary


# ── Partial strategy update ───────────────────────────────────────────────────
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
        "denied_symbols",  # entry-only deny list (rides definition_json)
        "signal_eligible",  # gates the platform-wide active-signal universe term
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
        # Evidence provenance; pre-007 rows lack these keys → defaults.
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
    # live_enabled column absent on rows predating that migration.
    definition.live_enabled = bool(row.get("live_enabled", False))
    # The user_id column is authoritative — a migrated row carries its owner only on the column;
    # the live loop keys its state by this value (must match the cooldown rows).
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


# The module-level alias near the imports preserves the old _compute_signal_score name for callers.


def _compute_metrics(
    daily_equity: list[float],
    trades: list,
    initial_equity: float,
    period_years: float | None = None,
) -> dict:
    """Compute backtest performance metrics from daily equity curve and trade list.

    ``period_years`` (feature 149): annualize ``annualized_return`` over the run's real
    window span rather than the equity-curve length. The aggregate ``daily_equity`` is a
    concatenation of N per-symbol curves (RunBacktest threads one running equity serially
    through each symbol and extends the curve), so ``len(daily_equity)-1`` is ~N× the true
    trading-day count and under-scaled the old ``252/n_days`` exponent by ~N. When
    ``period_years`` is None (per-symbol evidence cells, which pass a single-symbol curve
    whose length ≈ the window) the legacy curve-length behaviour is preserved, keeping the
    feature-065 derived grade unchanged.
    """
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
    if period_years is not None and period_years > 0:
        annualized_return = (1 + total_return) ** (1.0 / period_years) - 1
    else:
        n_days = len(daily_equity) - 1
        annualized_return = (
            (1 + total_return) ** (252.0 / max(n_days, 1)) - 1 if n_days > 0 else 0.0
        )

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
