"""
Unit tests for the FundamentalsSignalLoop (feature 062-fundamentals-signal-producer).

Covers the cache-only FMP discipline (FR-2 / Acceptance #2), the day-level idempotency
guard (FR-5 / Acceptance #1), symbol dedup (FR-3 / Acceptance #3), the daily-call-budget
defer path (FR-4 / Acceptance #4), and deterministic score→direction mapping (FR-6).
"""

import inspect
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

import app.engine.fundsignal_loop as fundsignal_module
from app.engine.fundsignal_loop import FundamentalsSignalLoop


def _make_cfg(overrides=None):
    overrides = overrides or {}
    cfg = MagicMock()
    cfg.get_int = MagicMock(side_effect=lambda key, default=0: overrides.get(key, default))
    cfg.get_int_present = MagicMock(side_effect=lambda key, default=0: overrides.get(key, default))
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


class TestSourceRegistrationTolerance:
    """Feature 088: strict register means a restart re-registering gets ALREADY_EXISTS."""

    def _err(self, code):
        import grpc

        return grpc.aio.AioRpcError(code, grpc.aio.Metadata(), grpc.aio.Metadata(), "x")

    @pytest.mark.asyncio
    async def test_already_exists_marks_registered(self):
        import grpc

        loop = _make_loop()
        loop._ingest.ManageSignalSource = AsyncMock(
            side_effect=self._err(grpc.StatusCode.ALREADY_EXISTS)
        )
        loop._source_registered = False
        await loop._ensure_source_registered("fundamentals", [])
        assert loop._source_registered is True  # treated as registered, no per-cycle retry spam

    @pytest.mark.asyncio
    async def test_other_error_is_non_fatal_but_not_registered(self):
        import grpc

        loop = _make_loop()
        loop._ingest.ManageSignalSource = AsyncMock(
            side_effect=self._err(grpc.StatusCode.UNAVAILABLE)
        )
        loop._source_registered = False
        await loop._ensure_source_registered("fundamentals", [])  # non-fatal, does not raise
        assert loop._source_registered is False  # a real failure must not masquerade as registered

    @pytest.mark.asyncio
    async def test_sends_register_enum(self):
        from gen.ingest.v1 import ingest_pb2

        loop = _make_loop()
        loop._source_registered = False
        await loop._ensure_source_registered("fundamentals", [])
        req = loop._ingest.ManageSignalSource.call_args[0][0]
        assert req.operation_enum == ingest_pb2.SIGNAL_SOURCE_OPERATION_REGISTER


# ── Cross-user watchlist universe + FMP-gated truncation (feature 154) ──────────


def _make_md_cfg(provider=""):
    """A marketdata-namespace config watcher stub returning a fixed provider (feature 154)."""
    md = MagicMock()
    md.get_str = MagicMock(
        side_effect=lambda key, default="": (
            provider if key == "marketdata.fundamentals.provider" else default
        )
    )
    return md


def _make_loop_154(overrides=None, provider=""):
    return FundamentalsSignalLoop(
        config_watcher=_make_cfg(overrides),
        db_pool=AsyncMock(),
        marketdata_stub=AsyncMock(),
        ingest_stub=AsyncMock(),
        portfolio_stub=AsyncMock(),
        indicators_stub=AsyncMock(),
        notify_stub=AsyncMock(),
        ledger_stub=AsyncMock(),
        md_config_watcher=_make_md_cfg(provider),
    )


class TestWatchlistUniverse:
    @pytest.mark.asyncio
    async def test_watchlists_source_returns_enumerated_union(self):  # AC-3
        loop = _make_loop_154(
            {
                "analysis.fundsignal.universe_source": "watchlists",
                "analysis.fundsignal.explicit_symbols": "",
            }
        )
        loop._portfolio.ListAllWatchlistSymbols = AsyncMock(
            return_value=SimpleNamespace(symbols=["AAPL", "MSFT", "NVDA"])
        )
        got = await loop._resolve_universe(())
        assert got == ["AAPL", "MSFT", "NVDA"]

    @pytest.mark.asyncio
    async def test_both_source_unions_enumeration_and_explicit(self):  # AC-4
        loop = _make_loop_154(
            {
                "analysis.fundsignal.universe_source": "both",
                "analysis.fundsignal.explicit_symbols": "TSLA, AAPL",
            }
        )
        loop._portfolio.ListAllWatchlistSymbols = AsyncMock(
            return_value=SimpleNamespace(symbols=["AAPL", "MSFT"])
        )
        got = await loop._resolve_universe(())
        # _resolve_universe returns the raw union; run_once's _dedup collapses it.
        assert loop._dedup(got) == ["AAPL", "MSFT", "TSLA"]

    @pytest.mark.asyncio
    async def test_explicit_source_ignores_enumeration(self):  # AC-5
        loop = _make_loop_154(
            {
                "analysis.fundsignal.universe_source": "explicit",
                "analysis.fundsignal.explicit_symbols": "IBM",
            }
        )
        loop._portfolio.ListAllWatchlistSymbols = AsyncMock(
            return_value=SimpleNamespace(symbols=["AAPL", "MSFT"])
        )
        got = await loop._resolve_universe(())
        assert got == ["IBM"]
        loop._portfolio.ListAllWatchlistSymbols.assert_not_called()

    @pytest.mark.asyncio
    async def test_watchlists_outage_returns_empty(self, caplog):  # AC-7
        loop = _make_loop_154({"analysis.fundsignal.universe_source": "watchlists"})
        loop._portfolio.ListAllWatchlistSymbols = AsyncMock(side_effect=RuntimeError("UNAVAILABLE"))
        with caplog.at_level("WARNING"):
            got = await loop._resolve_universe(())
        assert got == []
        assert any("ListAllWatchlistSymbols failed" in r.message for r in caplog.records)

    @pytest.mark.asyncio
    async def test_both_outage_returns_explicit_csv(self):  # AC-8
        loop = _make_loop_154(
            {
                "analysis.fundsignal.universe_source": "both",
                "analysis.fundsignal.explicit_symbols": "TSLA, AAPL",
            }
        )
        loop._portfolio.ListAllWatchlistSymbols = AsyncMock(side_effect=RuntimeError("UNAVAILABLE"))
        got = await loop._resolve_universe(())
        assert loop._dedup(got) == ["AAPL", "TSLA"]

    @pytest.mark.asyncio
    async def test_internal_caller_metadata_appended_not_replaced(self):  # C-03
        loop = _make_loop_154({"analysis.fundsignal.universe_source": "watchlists"})
        captured = {}

        async def _capture(_req, metadata=()):
            captured["meta"] = list(metadata)
            return SimpleNamespace(symbols=["AAPL"])

        loop._portfolio.ListAllWatchlistSymbols = AsyncMock(side_effect=_capture)
        await loop._resolve_universe([("x-trace-id", "t-1"), ("x-user-id", "u-1")])
        assert ("x-internal-caller", "analysis-fundsignal") in captured["meta"]
        assert ("x-trace-id", "t-1") in captured["meta"]  # inbound trace preserved
        assert ("x-user-id", "u-1") in captured["meta"]

    def test_cap_applies_when_fmp_active(self, caplog):  # AC-6
        loop = _make_loop_154(provider="fmp")
        with caplog.at_level("WARNING"):
            kept = loop._apply_symbol_cap(["AAA", "BBB", "CCC"], 2)
        assert len(kept) == 2
        assert set(kept) <= {"AAA", "BBB", "CCC"}
        assert any("dropped 1 of 3" in r.message for r in caplog.records)

    def test_no_cap_when_provider_not_fmp(self):  # AC-9
        loop = _make_loop_154(provider="finnhub")
        kept = loop._apply_symbol_cap(["AAA", "BBB", "CCC"], 2)
        assert kept == ["AAA", "BBB", "CCC"]  # whole union, no truncation

    def test_unknown_provider_caps_conservatively(self):  # FR-7 conservative default
        loop = _make_loop_154(provider="")  # pre-snapshot / unknown
        kept = loop._apply_symbol_cap(["AAA", "BBB", "CCC"], 2)
        assert len(kept) == 2  # unknown → conservative capped path (no provider literal baked in)


# ── Durable crash-safe scheduler (feature 156: AC-1..AC-7) ──────────────────────


class _StopLoop(Exception):
    """Sentinel to break run_forever's infinite loop in a test after N iterations."""


def _sched_loop(overrides=None, blocked_until_ms=None):
    """A loop wired for scheduler tests: schedule read via fetchval is controllable and
    every _db.execute SQL is recorded on loop._db.execute.await_args_list."""
    loop = _make_loop(overrides)
    loop._db.fetchval = AsyncMock(return_value=blocked_until_ms)
    return loop


def _executed_sql(loop):
    return [c.args[0] for c in loop._db.execute.await_args_list if c.args]


class TestScheduler:
    @pytest.mark.asyncio
    async def test_ac1_seeds_and_runs_promptly_on_fresh_deploy(self, monkeypatch):
        # Fresh deploy: no row yet → fetchval None (seed treats as due=0), enabled.
        loop = _sched_loop({"analysis.fundsignal.enabled": True}, blocked_until_ms=None)
        run_once = AsyncMock()
        monkeypatch.setattr(loop, "run_once", run_once)
        await loop._seed_schedule()
        sleep_s = await loop._tick()
        # Due immediately — the first cycle runs without a full-interval wait.
        run_once.assert_awaited_once()
        assert sleep_s == 0.0
        sql = _executed_sql(loop)
        assert any(
            "INSERT INTO analysis.fundsignal_schedule" in s and "ON CONFLICT" in s for s in sql
        )
        # And it advanced the schedule after the successful run.
        assert any("UPDATE analysis.fundsignal_schedule" in s for s in sql)

    @pytest.mark.asyncio
    async def test_ac2_redeploy_within_interval_does_not_reset(self, monkeypatch):
        # An existing row with a future due-time → sleep only the remainder, do not run.
        now_ms = int(datetime.now(UTC).timestamp() * 1000)
        future = now_ms + 6 * 3600 * 1000  # 6h out
        loop = _sched_loop(
            {"analysis.fundsignal.enabled": True, "analysis.fundsignal.run_interval_hours": 24},
            blocked_until_ms=future,
        )
        run_once = AsyncMock()
        monkeypatch.setattr(loop, "run_once", run_once)
        sleep_s = await loop._tick()
        run_once.assert_not_awaited()
        # ≈ remaining 6h, NOT a fresh 24h interval.
        assert 6 * 3600 - 60 <= sleep_s <= 6 * 3600 + 60

    @pytest.mark.asyncio
    async def test_ac3_hard_crash_row_still_due_reruns_promptly(self, monkeypatch):
        # Row left in the past (a crash never advanced it) → due → runs now.
        now_ms = int(datetime.now(UTC).timestamp() * 1000)
        past = now_ms - 3600 * 1000
        loop = _sched_loop({"analysis.fundsignal.enabled": True}, blocked_until_ms=past)
        run_once = AsyncMock()
        monkeypatch.setattr(loop, "run_once", run_once)
        sleep_s = await loop._tick()
        run_once.assert_awaited_once()
        assert sleep_s == 0.0

    @pytest.mark.asyncio
    async def test_ac4_caught_error_retries_after_retry_seconds(self, monkeypatch):
        loop = _sched_loop(
            {
                "analysis.fundsignal.enabled": True,
                "analysis.fundsignal.retry_seconds": 300,
                "analysis.fundsignal.run_interval_hours": 24,
            },
            blocked_until_ms=0,  # due
        )
        monkeypatch.setattr(loop, "run_once", AsyncMock(side_effect=RuntimeError("boom")))
        before_ms = int(datetime.now(UTC).timestamp() * 1000)
        await loop._tick()
        # The advance UPDATE set blocked_until_ms ~ now + retry_seconds*1000, not a full interval.
        advance = [
            c
            for c in loop._db.execute.await_args_list
            if c.args and "UPDATE analysis.fundsignal_schedule" in c.args[0]
        ]
        assert advance, "expected a schedule advance after a caught error"
        new_blocked = advance[-1].args[1]
        assert before_ms + 300_000 - 5000 <= new_blocked <= before_ms + 300_000 + 5000
        # Definitely not the 24h interval advance.
        assert new_blocked < before_ms + 3600 * 1000

    @pytest.mark.asyncio
    async def test_ac5_disabled_neither_runs_nor_advances_nor_spins(self, monkeypatch):
        loop = _sched_loop(
            {"analysis.fundsignal.enabled": False, "analysis.fundsignal.run_interval_hours": 24},
            blocked_until_ms=0,  # due, but disabled
        )
        run_once = AsyncMock()
        monkeypatch.setattr(loop, "run_once", run_once)
        sleep_s = await loop._tick()
        run_once.assert_not_awaited()
        # No schedule advance while disabled.
        assert not any("UPDATE analysis.fundsignal_schedule" in s for s in _executed_sql(loop))
        # Not a busy-spin: a positive sleep is returned (one interval).
        assert sleep_s == 24 * 3600

    @pytest.mark.asyncio
    async def test_ac6_manual_run_once_does_not_touch_schedule(self):
        # The manual RPC path calls run_once directly — it must never move the scheduled cadence.
        loop = _sched_loop({}, blocked_until_ms=0)
        await loop.run_once(override_symbols=["AAPL", "MSFT"])
        assert not any("fundsignal_schedule" in s for s in _executed_sql(loop)), (
            "run_once must not read or write analysis.fundsignal_schedule (AC-6)"
        )

    @pytest.mark.asyncio
    async def test_ac7_startup_jitter_is_bounded(self, monkeypatch):
        captured = {}

        def fake_uniform(a, b):
            captured["args"] = (a, b)
            return b

        monkeypatch.setattr(fundsignal_module.random, "uniform", fake_uniform)
        monkeypatch.setattr(fundsignal_module.asyncio, "sleep", AsyncMock())

        loop = _sched_loop({"analysis.fundsignal.startup_jitter_seconds": 45}, blocked_until_ms=0)
        monkeypatch.setattr(loop, "_seed_schedule", AsyncMock())
        # Break out of the infinite loop right after the one-shot jitter sleep.
        monkeypatch.setattr(loop, "_tick", AsyncMock(side_effect=_StopLoop))
        with pytest.raises(_StopLoop):
            await loop.run_forever()
        assert captured["args"] == (0, 45)  # bound is [0, N]

    @pytest.mark.asyncio
    async def test_ac7_zero_jitter_is_zero(self, monkeypatch):
        # Teeth: N=0 must yield exactly 0 (bound not vacuous).
        captured = {}
        monkeypatch.setattr(
            fundsignal_module.random, "uniform", lambda a, b: captured.setdefault("v", (a, b)) or 0
        )
        monkeypatch.setattr(fundsignal_module.asyncio, "sleep", AsyncMock())
        loop = _sched_loop({"analysis.fundsignal.startup_jitter_seconds": 0}, blocked_until_ms=0)
        monkeypatch.setattr(loop, "_seed_schedule", AsyncMock())
        monkeypatch.setattr(loop, "_tick", AsyncMock(side_effect=_StopLoop))
        with pytest.raises(_StopLoop):
            await loop.run_forever()
        assert captured["v"] == (0, 0)
