"""
Unit tests for the FundamentalsSignalLoop (feature 062-fundamentals-signal-producer).

Covers the cache-only FMP discipline (FR-2 / Acceptance #2), the day-level idempotency
guard (FR-5 / Acceptance #1), symbol dedup (FR-3 / Acceptance #3), the daily-call-budget
defer path (FR-4 / Acceptance #4), and deterministic score→direction mapping (FR-6).
"""

import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

import app.engine.fundsignal_loop as fundsignal_module
from app.engine.fundsignal_loop import FundamentalsSignalLoop


def _make_cfg(overrides=None):
    overrides = overrides or {}
    cfg = MagicMock()
    cfg.get_int = MagicMock(side_effect=lambda key, default=0: overrides.get(key, default))
    cfg.get_float = MagicMock(side_effect=lambda key, default=0.0: overrides.get(key, default))
    cfg.get_bool = MagicMock(side_effect=lambda key, default=False: overrides.get(key, default))
    cfg.get_str = MagicMock(side_effect=lambda key, default="": overrides.get(key, default))
    return cfg


def _fund(symbol, **kw):
    base = dict(
        symbol=symbol,
        pe_ratio=15.0,
        pb_ratio=2.0,
        roe=0.15,
        debt_to_equity=0.5,
        eps=3.0,
        dividend_yield=0.02,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _make_loop(overrides=None):
    loop = FundamentalsSignalLoop(
        config_watcher=_make_cfg(overrides),
        db_pool=AsyncMock(),
        marketdata_stub=AsyncMock(),
        ingest_stub=AsyncMock(),
        portfolio_stub=AsyncMock(),
        indicators_stub=AsyncMock(),
        notify_stub=AsyncMock(),
        ledger_stub=AsyncMock(),
    )
    loop._db.execute = AsyncMock()
    loop._db.fetch = AsyncMock(return_value=[])  # nothing already emitted today
    loop._db.fetchrow = AsyncMock(return_value={"symbol": "X"})  # idempotent claim wins

    async def _get_multi(request, metadata=()):
        return SimpleNamespace(fundamentals=[_fund(s) for s in request.symbols])

    loop._marketdata.GetFundamentalsMulti = AsyncMock(side_effect=_get_multi)
    loop._ingest.IngestSignal = AsyncMock(return_value=SimpleNamespace(signal_id=123))
    loop._ingest.ManageSignalSource = AsyncMock(return_value=MagicMock())
    loop._notify.EmitAlert = AsyncMock(return_value=MagicMock())
    loop._ledger.AppendEvent = AsyncMock(return_value=MagicMock())
    return loop


# ── Cache-only FMP discipline (FR-2 / Acceptance #2) ────────────────────────────


class TestCacheOnly:
    def test_no_fmp_imports(self):
        """The producer must read fundamentals only via marketdata's cached RPC — never FMP."""
        src = inspect.getsource(fundsignal_module)
        for forbidden in ("financialmodelingprep", "FMPClient", "fmp_client", "import requests"):
            assert forbidden not in src, f"FR-2 violation: {forbidden} present in producer"
        # Positive: the cache-mediated access path is present.
        assert "GetFundamentalsMulti" in src

    @pytest.mark.asyncio
    async def test_reads_via_get_fundamentals_multi(self):
        loop = _make_loop()
        await loop.run_once(override_symbols=["AAPL", "MSFT", "GOOG"])
        loop._marketdata.GetFundamentalsMulti.assert_awaited()
        # Surviving symbols are emitted through ingest's IngestSignal.
        assert loop._ingest.IngestSignal.await_count == 3


# ── Idempotency (FR-5 / Acceptance #1) ──────────────────────────────────────────


class TestIdempotency:
    @pytest.mark.asyncio
    async def test_already_emitted_skips_fetch_and_emit(self):
        loop = _make_loop()
        # Both symbols already emitted today → zero cache calls, zero emits.
        loop._db.fetch = AsyncMock(return_value=[{"symbol": "AAPL"}, {"symbol": "MSFT"}])
        summary = await loop.run_once(override_symbols=["AAPL", "MSFT"])
        loop._marketdata.GetFundamentalsMulti.assert_not_called()
        loop._ingest.IngestSignal.assert_not_called()
        assert summary.signals_emitted == 0

    @pytest.mark.asyncio
    async def test_conflict_claim_lost_skips_emit(self):
        loop = _make_loop()
        # ON CONFLICT DO NOTHING returns no row → another writer already claimed it.
        loop._db.fetchrow = AsyncMock(return_value=None)
        await loop.run_once(override_symbols=["AAPL"])
        loop._ingest.IngestSignal.assert_not_called()

    @pytest.mark.asyncio
    async def test_dry_run_emits_nothing(self):
        loop = _make_loop()
        summary = await loop.run_once(override_symbols=["AAPL", "MSFT"], dry_run=True)
        loop._marketdata.GetFundamentalsMulti.assert_not_called()
        loop._ingest.IngestSignal.assert_not_called()
        assert summary.calls_spent == 0


# ── Dedup (FR-3 / Acceptance #3) ────────────────────────────────────────────────


class TestDedup:
    def test_dedup_case_insensitive_sorted(self):
        loop = _make_loop()
        assert loop._dedup(["AAPL", "aapl", " msft ", "MSFT"]) == ["AAPL", "MSFT"]

    @pytest.mark.asyncio
    async def test_explicit_universe_parsed(self):
        loop = _make_loop(
            {
                "analysis.fundsignal.universe_source": "explicit",
                "analysis.fundsignal.explicit_symbols": "AAPL, msft , GOOG",
            }
        )
        universe = await loop._resolve_universe(())
        assert universe == ["AAPL", "MSFT", "GOOG"]

    @pytest.mark.asyncio
    async def test_duplicate_symbol_fetched_once(self):
        loop = _make_loop()
        # A symbol appearing twice in the universe is fetched once.
        await loop.run_once(override_symbols=["AAPL", "aapl", "MSFT"])
        # One chunk, GetFundamentalsMulti called with the deduped set.
        req = loop._marketdata.GetFundamentalsMulti.call_args[0][0]
        assert sorted(req.symbols) == ["AAPL", "MSFT"]


# ── Budget defer (FR-4 / Acceptance #4) ─────────────────────────────────────────


class TestBudgetDefer:
    @pytest.mark.asyncio
    async def test_paced_fetch_respects_budget(self):
        loop = _make_loop()
        symbols = [f"S{i}" for i in range(120)]
        fetched, deferred, calls = await loop._paced_fetch(symbols, budget=1, metadata=())
        assert calls == 1
        assert calls <= 1
        assert len(deferred) == 70  # 120 - one 50-symbol chunk
        assert len(fetched) == 50

    @pytest.mark.asyncio
    async def test_run_marks_deferred_and_warns(self):
        loop = _make_loop({"analysis.fundsignal.daily_call_budget": 1})
        symbols = [f"S{i}" for i in range(120)]
        summary = await loop.run_once(override_symbols=symbols)
        assert summary.status == "budget_deferred"
        assert summary.deferred_count == 70
        loop._notify.EmitAlert.assert_awaited()


# ── Score → direction (FR-6) ────────────────────────────────────────────────────


class TestScoreDirection:
    def test_quantile_buckets(self):
        loop = _make_loop()
        scores = {"A": 0.9, "B": 0.5, "C": 0.1}
        directions = loop._map_directions(scores, buy_quantile=0.80, sell_quantile=0.20)
        assert directions["A"] == "buy"
        assert directions["B"] == "hold"
        assert directions["C"] == "sell"

    def test_builtin_score_deterministic(self):
        loop = _make_loop()
        f = _fund("AAPL")
        assert loop._builtin_score(f) == loop._builtin_score(f)
        assert 0.0 <= loop._builtin_score(f) <= 1.0

    @pytest.mark.asyncio
    async def test_below_min_conviction_dropped(self):
        loop = _make_loop({"analysis.fundsignal.min_conviction_to_emit": 1.1})
        await loop.run_once(override_symbols=["AAPL", "MSFT"])
        loop._ingest.IngestSignal.assert_not_called()
