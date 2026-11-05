"""
Unit tests for the FundamentalsSignalLoop (feature 062-fundamentals-signal-producer).

Covers the cache-only FMP discipline (FR-2 / Acceptance #2), the day-level idempotency
guard (FR-5 / Acceptance #1), symbol dedup (FR-3 / Acceptance #3), the daily-call-budget
defer path (FR-4 / Acceptance #4), and deterministic score→direction mapping (FR-6).
"""

import asyncio
import inspect
import logging
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import asyncpg
import pytest

import app.engine.fundsignal_loop as fundsignal_module
from app.engine.fundsignal_loop import FundamentalsSignalLoop
from tests.conftest import fundamentals_row

BUILTIN_SCORER_METRICS = (*fundsignal_module._BUILTIN_BANDS, "eps")


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
        pe_ratio=15.0,
        pb_ratio=2.0,
        roe=0.15,
        debt_to_equity=0.5,
        eps=3.0,
        dividend_yield=0.02,
    )
    base.update(kw)
    return fundamentals_row(symbol, **base)


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
        loop._db.fetch = AsyncMock(
            return_value=[{"symbol": "AAPL", "score": 0.5}, {"symbol": "MSFT", "score": 0.5}]
        )
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
        fetched, deferred, failed, calls = await loop._paced_fetch(symbols, budget=1, metadata=())
        assert failed == []
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


class TestFailedChunk:
    @staticmethod
    def _fail_first_chunk(loop):
        import grpc

        calls = {"n": 0}

        async def _get_multi(request, metadata=()):
            calls["n"] += 1
            if calls["n"] == 1:
                raise _rpc_error(grpc.StatusCode.UNAVAILABLE)
            return SimpleNamespace(fundamentals=[_fund(s) for s in request.symbols])

        loop._marketdata.GetFundamentalsMulti = AsyncMock(side_effect=_get_multi)
        return loop

    @pytest.mark.asyncio
    async def test_ac4_failed_chunk_is_partial_and_deferred(self):
        symbols = [f"S{i}" for i in range(60)]
        loop = self._fail_first_chunk(_make_loop())
        summary = await loop.run_once(override_symbols=symbols)
        assert summary.status == "partial"
        assert summary.deferred_count == 50
        assert summary.symbols_processed == 10
        (update,) = [
            c
            for c in loop._db.execute.await_args_list
            if "UPDATE analysis.fundsignal_runs" in c.args[0]
        ]
        assert update.args[3] == "partial"
        assert update.args[6] == 50

        fresh = self._fail_first_chunk(_make_loop())
        fetched, deferred, failed, calls = await fresh._paced_fetch(symbols, 200, ())
        assert len(failed) == 50
        assert deferred == []
        assert calls == 2

    @pytest.mark.asyncio
    async def test_ac6_failed_chunk_beats_budget_cutoff(self):
        loop = self._fail_first_chunk(_make_loop({"analysis.fundsignal.daily_call_budget": 2}))
        symbols = [f"S{i}" for i in range(120)]
        summary = await loop.run_once(override_symbols=symbols)
        assert summary.status == "partial"
        assert summary.deferred_count == 70
        assert summary.symbols_processed == 50
        assert loop._notify.EmitAlert.await_count == 1
        body = loop._notify.EmitAlert.await_args_list[0].args[0].body
        assert "50" in body and "20" in body


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
        loop._registered_slug = None
        await loop._ensure_source_registered("fundamentals", [])
        assert loop._registered_slug == "fundamentals"  # treated as registered, no retry spam

    @pytest.mark.asyncio
    async def test_other_error_is_non_fatal_but_not_registered(self):
        import grpc

        loop = _make_loop()
        loop._ingest.ManageSignalSource = AsyncMock(
            side_effect=self._err(grpc.StatusCode.UNAVAILABLE)
        )
        loop._registered_slug = None
        await loop._ensure_source_registered("fundamentals", [])  # non-fatal, does not raise
        assert loop._registered_slug is None  # a real failure must not masquerade as registered

    @pytest.mark.asyncio
    async def test_sends_register_enum(self):
        from gen.ingest.v1 import ingest_pb2

        loop = _make_loop()
        loop._registered_slug = None
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


class _StopLoop(BaseException):
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
        assert any("INSERT INTO analysis.job_schedule" in s and "ON CONFLICT" in s for s in sql)
        # And it advanced the schedule after the successful run.
        assert any("UPDATE analysis.job_schedule" in s for s in sql)

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
            if c.args and "UPDATE analysis.job_schedule" in c.args[0]
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
        assert not any("UPDATE analysis.job_schedule" in s for s in _executed_sql(loop))
        # Not a busy-spin: a positive sleep is returned (one interval).
        assert sleep_s == 24 * 3600

    @pytest.mark.asyncio
    async def test_ac6_manual_run_once_does_not_touch_schedule(self):
        # The manual RPC path calls run_once directly — it must never move the scheduled cadence.
        loop = _sched_loop({}, blocked_until_ms=0)
        await loop.run_once(override_symbols=["AAPL", "MSFT"])
        assert not any("job_schedule" in s for s in _executed_sql(loop)), (
            "run_once must not read or write analysis.job_schedule (AC-6)"
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

    @staticmethod
    def _sleep_recorder(monkeypatch, stop_on_call=4):
        sleeps = []

        async def _sleep(s):
            sleeps.append(s)
            if len(sleeps) >= stop_on_call:
                raise _StopLoop

        monkeypatch.setattr(fundsignal_module.asyncio, "sleep", _sleep)
        monkeypatch.setattr(fundsignal_module.random, "uniform", lambda a, b: 0)
        return sleeps

    @pytest.mark.asyncio
    async def test_supervised_loop_survives_schedule_read_error(self, monkeypatch, caplog):
        """@AC-1: a failing schedule read never ends run_forever; the next tick runs."""
        caplog.set_level(logging.ERROR)
        loop = _sched_loop({"analysis.fundsignal.enabled": True}, blocked_until_ms=0)
        next_sleep = AsyncMock(side_effect=[asyncpg.PostgresConnectionError("down"), 0.0, 3600.0])
        monkeypatch.setattr(loop._schedule, "next_sleep_seconds", next_sleep)
        run_once = AsyncMock()
        monkeypatch.setattr(loop, "run_once", run_once)
        monkeypatch.setattr(loop, "_seed_schedule", AsyncMock())
        sleeps = self._sleep_recorder(monkeypatch)
        with pytest.raises(_StopLoop):
            await loop.run_forever()
        assert next_sleep.await_count >= 2
        run_once.assert_awaited()
        assert 30 in sleeps
        assert any(r.levelno == logging.ERROR and "down" in r.getMessage() for r in caplog.records)

    @pytest.mark.asyncio
    async def test_supervised_loop_survives_error_path_advance_failure(self, monkeypatch, caplog):
        """@AC-2: a cycle error whose retry advance also fails is absorbed; a further tick runs."""
        caplog.set_level(logging.ERROR)
        loop = _sched_loop({"analysis.fundsignal.enabled": True}, blocked_until_ms=0)
        monkeypatch.setattr(
            loop._schedule, "next_sleep_seconds", AsyncMock(side_effect=[0.0, 0.0, 3600.0])
        )
        run_once = AsyncMock(side_effect=asyncpg.PostgresConnectionError("down"))
        monkeypatch.setattr(loop, "run_once", run_once)
        monkeypatch.setattr(
            loop,
            "_advance_schedule",
            AsyncMock(side_effect=[asyncpg.PostgresConnectionError("adv"), None]),
        )
        monkeypatch.setattr(loop, "_seed_schedule", AsyncMock())
        sleeps = self._sleep_recorder(monkeypatch)
        with pytest.raises(_StopLoop):
            await loop.run_forever()
        assert run_once.await_count >= 2
        assert 30 in sleeps
        errors = [r.getMessage() for r in caplog.records if r.levelno == logging.ERROR]
        assert any("down" in m for m in errors)
        assert any("adv" in m for m in errors)


# ── Feature 224 — reserved `system` identity, scoring fail-closed (AC-6/AC-36/AC-37) ────────────

_SYSTEM_FORMULA = "d1ff5e6b-6d9c-589d-b95e-defd862c702b"
_ADMIN_META = [("x-user-id", "admin-1"), ("x-access-scope", "4"), ("x-trace-id", "t-adm")]


def _rpc_error(code):
    import grpc

    return grpc.aio.AioRpcError(code, grpc.aio.Metadata(), grpc.aio.Metadata(), "x")


def _identity_loop(overrides=None, author="system", ingest_responses=None):
    from tests.conftest import RecordingStub

    loop = _make_loop(overrides)
    loop._ingest = RecordingStub(
        {"IngestSignal": SimpleNamespace(signal_id="sig-1"), **(ingest_responses or {})}
    )
    get_formula = author if isinstance(author, BaseException) else SimpleNamespace(author=author)
    loop._indicators = RecordingStub(
        {
            "GetFormula": get_formula,
            "ExecuteFormula": SimpleNamespace(success=True, output={"composite": 0.7}),
        }
    )
    return loop


def _emitted_inserts(loop):
    return [
        c for c in loop._db.fetchrow.await_args_list if "fundsignal_emitted" in (c.args or ("",))[0]
    ]


def _alert_severities(loop):
    return [c.args[0].severity for c in loop._notify.EmitAlert.await_args_list]


def _assert_system_identity(meta, trace=None):
    d = dict(meta)
    assert d.get("x-user-id") == "system"
    assert d.get("x-internal-caller") == "analysis-fundsignal"
    assert "x-access-scope" not in d
    assert sum(1 for k, _ in meta if k == "x-user-id") == 1
    if trace is not None:
        assert d.get("x-trace-id") == trace


def _scan_via_rpc(loop, symbols=("AAPL",)):
    from gen.analysis.v1 import analysis_pb2

    from tests.conftest import ctx_with
    from tests.test_analysis_servicer import make_servicer

    svc = make_servicer()
    svc._fundsignal_loop = loop
    return svc.RunFundamentalsScan(
        analysis_pb2.RunFundamentalsScanRequest(symbols=list(symbols)), ctx_with(_ADMIN_META)
    )


class TestSystemIdentity:
    _CFG = {"analysis.fundsignal.scoring_formula_id": _SYSTEM_FORMULA}

    @pytest.mark.asyncio
    async def test_ac6_loop_path_sends_system_identity(self):
        loop = _identity_loop(self._CFG)
        await loop.run_once(override_symbols=["AAPL"])
        for method in ("IngestSignal", "ManageSignalSource"):
            assert loop._ingest.of(method), method
            for _m, _r, meta in loop._ingest.of(method):
                _assert_system_identity(meta)
        (_m, req, meta), *_ = loop._indicators.of("ExecuteFormula")
        assert req.formula_id == _SYSTEM_FORMULA
        _assert_system_identity(meta)

    @pytest.mark.asyncio
    async def test_ac6_manual_path_replaces_caller_identity_and_keeps_trace(self):
        loop = _identity_loop(self._CFG)
        await _scan_via_rpc(loop)
        calls = (
            loop._ingest.of("IngestSignal")
            + loop._ingest.of("ManageSignalSource")
            + loop._indicators.of("ExecuteFormula")
            + loop._indicators.of("GetFormula")
        )
        assert len(calls) == 4
        for _m, _r, meta in calls:
            _assert_system_identity(meta, trace="t-adm")

    @pytest.mark.asyncio
    async def test_marketdata_keeps_caller_metadata(self):
        loop = _identity_loop(self._CFG)
        await loop.run_once(override_symbols=["AAPL"], metadata=_ADMIN_META)
        meta = loop._marketdata.GetFundamentalsMulti.await_args.kwargs["metadata"]
        assert list(meta) == _ADMIN_META

    @pytest.mark.asyncio
    async def test_registration_keyed_on_slug(self):
        loop = _identity_loop()
        await loop.run_once(override_symbols=["AAPL"])
        await loop.run_once(override_symbols=["AAPL"])
        assert len(loop._ingest.of("ManageSignalSource")) == 1  # same slug → registered once
        loop._cfg.get_str.side_effect = lambda key, default="": (
            "macro" if key == "analysis.fundsignal.source_slug" else default
        )
        await loop.run_once(override_symbols=["AAPL"])
        regs = loop._ingest.of("ManageSignalSource")
        assert [r.source.slug for _m, r, _meta in regs] == ["fundamentals", "macro"]


class TestScoringFailClosed:
    _CFG = {"analysis.fundsignal.scoring_formula_id": "f-alice-score"}

    async def _assert_failed_closed(self, loop, summary, builtin):
        assert summary.status == "failed"
        assert loop._ingest.of("IngestSignal") == []
        assert _emitted_inserts(loop) == []
        from gen.notify.v1 import notify_pb2

        assert _alert_severities(loop) == [notify_pb2.AlertSeverity.ALERT_SEVERITY_ERROR]
        builtin.assert_not_called()
        loop._marketdata.GetFundamentalsMulti.assert_not_called()

    @pytest.mark.asyncio
    async def test_ac37_non_system_formula_loop_path(self, monkeypatch):
        loop = _identity_loop(self._CFG, author="alice")
        builtin = MagicMock(return_value=0.5)
        monkeypatch.setattr(loop, "_builtin_score", builtin)
        summary = await loop.run_once(override_symbols=["AAPL"])
        await self._assert_failed_closed(loop, summary, builtin)
        (_m, req, meta), *_ = loop._indicators.of("GetFormula")
        assert req.formula_id == "f-alice-score"
        _assert_system_identity(meta)

    @pytest.mark.asyncio
    async def test_ac37_non_system_formula_manual_path(self, monkeypatch):
        loop = _identity_loop(self._CFG, author="alice")
        builtin = MagicMock(return_value=0.5)
        monkeypatch.setattr(loop, "_builtin_score", builtin)
        summary = await _scan_via_rpc(loop)
        await self._assert_failed_closed(loop, summary, builtin)
        (_m, _req, meta), *_ = loop._indicators.of("GetFormula")
        _assert_system_identity(meta, trace="t-adm")  # system, not the admin caller's id

    @pytest.mark.asyncio
    async def test_ac37_unreadable_formula_fails_closed(self, monkeypatch):
        import grpc

        loop = _identity_loop(self._CFG, author=_rpc_error(grpc.StatusCode.NOT_FOUND))
        builtin = MagicMock(return_value=0.5)
        monkeypatch.setattr(loop, "_builtin_score", builtin)
        summary = await loop.run_once(override_symbols=["AAPL"])
        await self._assert_failed_closed(loop, summary, builtin)

    @pytest.mark.asyncio
    async def test_formula_failure_skips_symbol_without_builtin_fallback(self, monkeypatch):
        import grpc

        loop = _identity_loop({"analysis.fundsignal.scoring_formula_id": _SYSTEM_FORMULA})
        loop._indicators._responses["ExecuteFormula"] = _rpc_error(grpc.StatusCode.INTERNAL)
        builtin = MagicMock(return_value=0.5)
        monkeypatch.setattr(loop, "_builtin_score", builtin)
        summary = await loop.run_once(override_symbols=["AAPL"])
        builtin.assert_not_called()
        assert loop._ingest.of("IngestSignal") == []
        assert summary.signals_emitted == 0

    @pytest.mark.asyncio
    async def test_empty_formula_id_keeps_builtin_scorer(self):
        loop = _identity_loop()
        await loop.run_once(override_symbols=["AAPL"])
        assert loop._indicators.calls == []
        assert len(loop._ingest.of("IngestSignal")) == 1


class TestSystemWriteRejected:
    @pytest.mark.asyncio
    async def test_ac36_register_failed_precondition_aborts_cycle(self):
        import grpc
        from gen.notify.v1 import notify_pb2

        loop = _identity_loop(
            {"analysis.fundsignal.source_slug": "macro-feed"},
            ingest_responses={
                "ManageSignalSource": _rpc_error(grpc.StatusCode.FAILED_PRECONDITION)
            },
        )
        summary = await loop.run_once(override_symbols=["AAPL", "MSFT"])
        assert summary.status == "failed"
        assert loop._ingest.of("IngestSignal") == []
        assert _emitted_inserts(loop) == []
        alerts = loop._notify.EmitAlert.await_args_list
        assert [a.args[0].severity for a in alerts] == [
            notify_pb2.AlertSeverity.ALERT_SEVERITY_ERROR
        ]
        assert "macro-feed" in alerts[0].args[0].body
        assert loop._registered_slug is None

    @pytest.mark.asyncio
    async def test_ingest_not_found_as_system_aborts_cycle(self):
        import grpc
        from gen.notify.v1 import notify_pb2

        loop = _identity_loop(
            ingest_responses={"IngestSignal": _rpc_error(grpc.StatusCode.NOT_FOUND)}
        )
        summary = await loop.run_once(override_symbols=["AAPL", "MSFT"])
        assert summary.status == "failed"
        assert len(loop._ingest.of("IngestSignal")) == 1  # aborted after the first rejection
        alerts = loop._notify.EmitAlert.await_args_list
        assert [a.args[0].severity for a in alerts] == [
            notify_pb2.AlertSeverity.ALERT_SEVERITY_ERROR
        ]
        assert "fundamentals" in alerts[0].args[0].body


# ── Feature 246 — data-less symbols are unscored, real zeros are scored (AC-1/AC-2/AC-3) ────────

_UNSCORED_MARK = "unscored (no fundamentals)"


def _serve_rows(loop, rows):
    async def _get_multi(request, metadata=()):
        return SimpleNamespace(fundamentals=[rows[s] for s in request.symbols if s in rows])

    loop._marketdata.GetFundamentalsMulti = AsyncMock(side_effect=_get_multi)


def _unscored_warns(caplog):
    return [
        r.getMessage()
        for r in caplog.records
        if r.levelname == "WARNING" and _UNSCORED_MARK in r.getMessage()
    ]


class TestUnscoredSymbols:
    @pytest.mark.asyncio
    async def test_ac1_dataless_symbols_not_scored_ranked_or_emitted(self, monkeypatch, caplog):
        loop = _identity_loop()
        etfs = ["SPY", "QQQ", "IWM", "DIA", "VOO"]
        rows = {s: fundamentals_row(s, missing=BUILTIN_SCORER_METRICS) for s in etfs}
        rows["MSFT"] = fundamentals_row(
            "MSFT", pe_ratio=20.0, roe=0.30, eps=10.0, missing=("pb_ratio", "debt_to_equity")
        )
        _serve_rows(loop, rows)
        spy = MagicMock(wraps=loop._map_directions)
        monkeypatch.setattr(loop, "_map_directions", spy)
        with caplog.at_level("WARNING"):
            summary = await loop.run_once(override_symbols=[*etfs, "MSFT"])

        ingested = loop._ingest.of("IngestSignal")
        assert len(ingested) == 1
        assert ingested[0][1].signal.symbol == "MSFT"
        assert [c.args[1] for c in _emitted_inserts(loop)] == ["MSFT"]
        (scores, *_), _kw = spy.call_args
        assert set(scores) == {"MSFT"}
        assert scores["MSFT"] == pytest.approx((0.6 + 1.0 + 1.0) / 3, abs=1e-9)
        warns = _unscored_warns(caplog)
        assert len(warns) == 1
        assert summary.run_id in warns[0]
        assert "5 of 6" in warns[0]
        assert "DIA,IWM,QQQ,SPY,VOO" in warns[0]

    @pytest.mark.asyncio
    async def test_ac2_zero_metric_scored_not_absent(self):
        loop = _identity_loop()
        rows = {
            "ZRO": fundamentals_row(
                "ZRO", pe_ratio=20.0, roe=0.0, missing=("pb_ratio", "debt_to_equity", "eps")
            )
        }
        _serve_rows(loop, rows)
        await loop.run_once(override_symbols=["ZRO"])

        (_m, req, _meta), *rest = loop._ingest.of("IngestSignal")
        assert rest == []
        assert req.signal.conviction == pytest.approx(0.30, abs=1e-9)
        (insert,) = _emitted_inserts(loop)
        assert insert.args[4] == pytest.approx(0.30, abs=1e-9)

    @pytest.mark.asyncio
    async def test_ac3_formula_all_missing_skipped_partial_scored(self):
        loop = _identity_loop({"analysis.fundsignal.scoring_formula_id": _SYSTEM_FORMULA})
        rows = {
            "NODATA": fundamentals_row(
                "NODATA", missing=(*BUILTIN_SCORER_METRICS, "dividend_yield")
            ),
            "DIVONLY": fundamentals_row(
                "DIVONLY", dividend_yield=0.013, missing=BUILTIN_SCORER_METRICS
            ),
        }
        _serve_rows(loop, rows)
        await loop.run_once(override_symbols=["NODATA", "DIVONLY"])

        executed = loop._indicators.of("ExecuteFormula")
        assert len(executed) == 1
        _m, req, meta = executed[0]
        inputs = dict(req.input_data)
        assert inputs["dividend_yield"] == pytest.approx(0.013)
        assert inputs["pe_ratio"] == 0.0
        _assert_system_identity(meta)
        ingested = loop._ingest.of("IngestSignal")
        assert [r.signal.symbol for _m, r, _meta in ingested] == ["DIVONLY"]
        inserts = _emitted_inserts(loop)
        assert [c.args[1] for c in inserts] == ["DIVONLY"]
        assert inserts[0].args[4] == pytest.approx(0.7)

    @pytest.mark.asyncio
    async def test_formula_exception_skip_not_counted_unscored(self, caplog):
        import grpc

        loop = _identity_loop({"analysis.fundsignal.scoring_formula_id": _SYSTEM_FORMULA})
        loop._indicators._responses["ExecuteFormula"] = _rpc_error(grpc.StatusCode.INTERNAL)
        rows = {
            "NODATA": fundamentals_row(
                "NODATA", missing=(*BUILTIN_SCORER_METRICS, "dividend_yield")
            ),
            "AAPL": _fund("AAPL"),
        }
        _serve_rows(loop, rows)
        with caplog.at_level("WARNING"):
            await loop.run_once(override_symbols=["NODATA", "AAPL"])

        warns = _unscored_warns(caplog)
        assert len(warns) == 1
        assert "1 of 2" in warns[0]
        assert "NODATA" in warns[0]
        assert "AAPL" not in warns[0]
        assert any("formula scoring failed for AAPL" in r.getMessage() for r in caplog.records)

    @pytest.mark.asyncio
    async def test_unscored_warn_logged_on_abort_path(self, caplog):
        import grpc

        loop = _identity_loop(
            ingest_responses={"ManageSignalSource": _rpc_error(grpc.StatusCode.FAILED_PRECONDITION)}
        )
        rows = {
            "SPY": fundamentals_row("SPY", missing=BUILTIN_SCORER_METRICS),
            "MSFT": _fund("MSFT"),
        }
        _serve_rows(loop, rows)
        with caplog.at_level("WARNING"):
            summary = await loop.run_once(override_symbols=["SPY", "MSFT"])

        assert summary.status == "failed"
        assert loop._ingest.of("IngestSignal") == []
        warns = _unscored_warns(caplog)
        assert len(warns) == 1
        assert summary.run_id in warns[0]
        assert "1 of 2" in warns[0]
        assert "SPY" in warns[0]

    @pytest.mark.asyncio
    async def test_all_dataless_cycle_completes(self):
        loop = _identity_loop()
        rows = {s: fundamentals_row(s, missing=BUILTIN_SCORER_METRICS) for s in ("SPY", "VOO")}
        _serve_rows(loop, rows)
        summary = await loop.run_once(override_symbols=["SPY", "VOO"])

        assert summary.status == "completed"
        assert summary.signals_emitted == 0
        assert summary.symbols_processed == 2
        assert len(loop._ingest.of("ManageSignalSource")) == 1

    @pytest.mark.parametrize(
        ("metric", "value", "expected"),
        [
            ("pe_ratio", 0.0, 0.0),
            ("pb_ratio", 0.0, 0.0),
            ("roe", 0.0, 0.0),
            ("debt_to_equity", 0.0, 1.0),
            ("eps", 0.0, 0.0),
        ],
    )
    def test_builtin_score_zero_values(self, metric, value, expected):
        row = fundamentals_row(
            "Z", **{metric: value}, missing=[m for m in BUILTIN_SCORER_METRICS if m != metric]
        )
        assert FundamentalsSignalLoop._builtin_score(row) == pytest.approx(expected)

    def test_builtin_score_all_missing_is_none(self):
        row = fundamentals_row("SPY", missing=BUILTIN_SCORER_METRICS)
        assert FundamentalsSignalLoop._builtin_score(row) is None

    def test_warn_unscored_unit(self, caplog):
        with caplog.at_level("WARNING"):
            FundamentalsSignalLoop._warn_unscored("r-1", ["VOO", "SPY"], 3)
        warns = _unscored_warns(caplog)
        assert len(warns) == 1
        assert "r-1" in warns[0]
        assert "2 of 3" in warns[0]
        assert "SPY,VOO" in warns[0]

        caplog.clear()
        with caplog.at_level("WARNING"):
            FundamentalsSignalLoop._warn_unscored("r-1", [], 3)
        assert _unscored_warns(caplog) == []


# ── Feature 260 — claim release, accepted-only count, abort cleanup (AC-1/2/3/5/7) ─────────────


class _EmittedTable:
    """Stateful fake of ``analysis.fundsignal_emitted``; each statement honours only the predicates
    present in its SQL text, so it tracks both the pre-fix and the post-fix statements."""

    def __init__(self, fail_delete=False):
        self.rows = {}
        self.runs = []
        self.fail_delete = fail_delete

    def seed(self, symbol, as_of_date, signal_id=None, run_id="seed-run", score=0.5):
        self.rows[(symbol, "fundamentals", as_of_date)] = {
            "score": score,
            "direction": "buy",
            "run_id": run_id,
            "signal_id": signal_id,
        }

    async def fetchrow(self, sql, *args):
        if "INSERT INTO analysis.fundsignal_emitted" not in sql:
            raise AssertionError(f"unexpected fetchrow: {sql}")
        symbol, source, as_of_date, score, direction, run_id = args
        key = (symbol, source, as_of_date)
        if key in self.rows:
            return None
        self.rows[key] = {
            "score": score,
            "direction": direction,
            "run_id": run_id,
            "signal_id": None,
        }
        return {"symbol": symbol}

    async def fetch(self, sql, *args):
        if "FROM analysis.fundsignal_emitted" not in sql:
            raise AssertionError(f"unexpected fetch: {sql}")
        source, as_of_date = args[:2]
        return [
            {"symbol": s, "score": r["score"]}
            for (s, src, d), r in self.rows.items()
            if src == source and d == as_of_date
        ]

    async def execute(self, sql, *args):
        if "UPDATE analysis.fundsignal_emitted" in sql:
            row = self.rows.get(args[:3])
            if row is None:
                return "UPDATE 0"
            if "run_id=$5" in sql and row["run_id"] != args[4]:
                return "UPDATE 0"
            if "signal_id IS NULL" in sql and row["signal_id"] is not None:
                return "UPDATE 0"
            row["signal_id"] = args[3]
            return "UPDATE 1"
        if "DELETE FROM analysis.fundsignal_emitted" in sql:
            if "symbol=$1" not in sql:
                source, as_of_date = args[:2]
                for key in [k for k in self.rows if k[1] == source and k[2] == as_of_date]:
                    del self.rows[key]
                return "DELETE"
            if self.fail_delete:
                raise RuntimeError("release DELETE failed")
            row = self.rows.get(args[:3])
            if row is None:
                return "DELETE 0"
            if "signal_id IS NULL" in sql and row["signal_id"] is not None:
                return "DELETE 0"
            if "run_id=$4" in sql and row["run_id"] != args[3]:
                return "DELETE 0"
            del self.rows[args[:3]]
            return "DELETE 1"
        self.runs.append((sql, args))
        return "OK"


def _fake_loop(scores, ingest, table=None, overrides=None):
    loop = _identity_loop(overrides, ingest_responses={"IngestSignal": ingest})
    loop._db = table if table is not None else _EmittedTable()
    loop._score = AsyncMock(return_value=(scores, []))
    return loop


def _ingest_by_symbol(responses):
    """IngestSignal response per symbol: a value, an exception to raise, or a callable."""

    def _respond(request):
        resp = responses[request.signal.symbol]
        if isinstance(resp, BaseException):
            raise resp
        return resp() if callable(resp) else resp

    return _respond


def _ingested_symbols(loop):
    return [c[1].signal.symbol for c in loop._ingest.of("IngestSignal")]


class TestEmitAccounting:
    @staticmethod
    def _today():
        return datetime.now(UTC).date()

    @pytest.mark.asyncio
    async def test_ac1_failed_emit_is_retried_same_day(self):
        import grpc

        table = _EmittedTable()
        first = _fake_loop({"AAPL": 0.85}, _rpc_error(grpc.StatusCode.UNAVAILABLE), table)
        await first.run_once(override_symbols=["AAPL"])

        second = _fake_loop({"AAPL": 0.85}, SimpleNamespace(signal_id=777), table)
        await second.run_once(override_symbols=["AAPL"])
        assert _ingested_symbols(second) == ["AAPL"]
        assert table.rows[("AAPL", "fundamentals", self._today())]["signal_id"] == 777

    @pytest.mark.asyncio
    async def test_ac2_signals_emitted_counts_accepted_only(self):
        import grpc

        ingest = _ingest_by_symbol(
            {
                "AAPL": _rpc_error(grpc.StatusCode.UNAVAILABLE),
                "MSFT": SimpleNamespace(signal_id=5),
            }
        )
        loop = _fake_loop({"AAPL": 0.85, "MSFT": 0.90}, ingest)
        summary = await loop.run_once(override_symbols=["AAPL", "MSFT"])
        assert summary.signals_emitted == 1
        assert ("AAPL", "fundamentals", self._today()) not in loop._db.rows
        assert loop._db.rows[("MSFT", "fundamentals", self._today())]["signal_id"] == 5

    @pytest.mark.asyncio
    async def test_ac3_abort_leaves_no_orphan_claim(self):
        import grpc

        loop = _fake_loop({"AAPL": 0.85}, _rpc_error(grpc.StatusCode.NOT_FOUND))
        summary = await loop.run_once(override_symbols=["AAPL"])
        assert summary.status == "failed"
        assert not [
            k for k, r in loop._db.rows.items() if k[0] == "AAPL" and r["signal_id"] is None
        ]

    @pytest.mark.asyncio
    async def test_ac5_abort_keeps_confirmed_rows(self):
        import grpc

        ingest = _ingest_by_symbol(
            {
                "AAPL": SimpleNamespace(signal_id=501),
                "MSFT": _rpc_error(grpc.StatusCode.NOT_FOUND),
            }
        )
        loop = _fake_loop({"AAPL": 0.85, "MSFT": 0.90}, ingest)
        summary = await loop.run_once(override_symbols=["AAPL", "MSFT"])
        assert summary.status == "failed"
        assert summary.signals_emitted == 1
        assert loop._db.rows[("AAPL", "fundamentals", self._today())]["signal_id"] == 501
        assert ("MSFT", "fundamentals", self._today()) not in loop._db.rows

    @pytest.mark.asyncio
    async def test_ac7_confirmed_rows_skip_fetch(self):
        table = _EmittedTable()
        table.seed("AAPL", self._today(), signal_id=11)
        table.seed("MSFT", self._today(), signal_id=12)
        loop = _fake_loop({"AAPL": 0.85, "MSFT": 0.90}, SimpleNamespace(signal_id=1), table)
        summary = await loop.run_once(override_symbols=["AAPL", "MSFT"])
        loop._marketdata.GetFundamentalsMulti.assert_not_called()
        assert loop._ingest.of("IngestSignal") == []
        assert summary.signals_emitted == 0

    @pytest.mark.asyncio
    async def test_confirm_is_scoped_to_own_run_id(self):
        table = _EmittedTable()
        key = ("AAPL", "fundamentals", self._today())

        def _reclaimed_then_accepted():
            table.rows[key]["run_id"] = "other-run"
            return SimpleNamespace(signal_id=9)

        loop = _fake_loop(
            {"AAPL": 0.85}, _ingest_by_symbol({"AAPL": _reclaimed_then_accepted}), table
        )
        summary = await loop.run_once(override_symbols=["AAPL"])
        assert table.rows[key]["signal_id"] is None
        assert table.rows[key]["run_id"] == "other-run"
        assert summary.signals_emitted == 1

    @pytest.mark.asyncio
    async def test_release_failure_is_swallowed_and_abort_still_reported(self):
        import grpc
        from gen.notify.v1 import notify_pb2

        loop = _fake_loop(
            {"AAPL": 0.85},
            _rpc_error(grpc.StatusCode.NOT_FOUND),
            _EmittedTable(fail_delete=True),
        )
        summary = await loop.run_once(override_symbols=["AAPL"])
        assert summary.status == "failed"
        assert _alert_severities(loop) == [notify_pb2.AlertSeverity.ALERT_SEVERITY_ERROR]

    @pytest.mark.asyncio
    async def test_cancelled_emit_releases_claim(self):
        loop = _fake_loop({"AAPL": 0.85}, asyncio.CancelledError())
        with pytest.raises(asyncio.CancelledError):
            await loop.run_once(override_symbols=["AAPL"])
        assert ("AAPL", "fundamentals", self._today()) not in loop._db.rows

    @pytest.mark.asyncio
    async def test_crash_orphan_skipped_then_recovered(self):
        today = self._today()
        key = ("AAPL", "fundamentals", today)
        table = _EmittedTable()
        table.seed("AAPL", today, run_id="crashed-run")

        skipped = _fake_loop({"AAPL": 0.85}, SimpleNamespace(signal_id=31), table)
        await skipped.run_once(override_symbols=["AAPL"])
        assert skipped._ingest.of("IngestSignal") == []
        assert table.rows[key]["run_id"] == "crashed-run"
        assert table.rows[key]["signal_id"] is None

        forced = _fake_loop({"AAPL": 0.85}, SimpleNamespace(signal_id=32), table)
        summary = await forced.run_once(force=True, override_symbols=["AAPL"])
        assert _ingested_symbols(forced) == ["AAPL"]
        assert table.rows[key]["signal_id"] == 32
        assert table.rows[key]["run_id"] == summary.run_id

        yesterday_only = _EmittedTable()
        yesterday_only.seed("AAPL", today - timedelta(days=1), run_id="crashed-run")
        fresh = _fake_loop({"AAPL": 0.85}, SimpleNamespace(signal_id=33), yesterday_only)
        await fresh.run_once(override_symbols=["AAPL"])
        assert _ingested_symbols(fresh) == ["AAPL"]
        assert yesterday_only.rows[key]["signal_id"] == 33


# ── Feature 260 — retry direction stability and the valid_until anchor (AC-8/9/10) ─────────────

_FIXED_NOW = datetime(2026, 10, 21, 15, 30, tzinfo=UTC)


class _FixedClock(datetime):
    @classmethod
    def now(cls, tz=None):
        return _FIXED_NOW


def _ingest_requests(loop, symbol):
    return [c[1] for c in loop._ingest.of("IngestSignal") if c[1].signal.symbol == symbol]


class TestRetryStability:
    @pytest.fixture(autouse=True)
    def _fixed_clock(self, monkeypatch):
        monkeypatch.setattr(fundsignal_module, "datetime", _FixedClock)

    @pytest.mark.asyncio
    async def test_ac8_lost_response_retry_resends_identical_signal(self):
        import grpc

        table = _EmittedTable()
        ingest = _ingest_by_symbol(
            {
                "AAPL": _rpc_error(grpc.StatusCode.UNAVAILABLE),
                "MSFT": SimpleNamespace(signal_id=11),
            }
        )
        first = _fake_loop({"AAPL": 0.85, "MSFT": 0.90}, ingest, table)
        await first.run_once(override_symbols=["AAPL", "MSFT"])

        second = _fake_loop({"AAPL": 0.85}, SimpleNamespace(signal_id=10, deduplicated=True), table)
        summary = await second.run_once(override_symbols=["AAPL", "MSFT"])

        (sent,) = _ingest_requests(first, "AAPL")
        (resent,) = _ingest_requests(second, "AAPL")
        assert resent.signal.direction == sent.signal.direction
        assert resent.signal.conviction == sent.signal.conviction
        assert resent.signal.valid_until == sent.signal.valid_until
        assert resent.signal.valid_until.ToDatetime(tzinfo=UTC) == datetime(2027, 1, 19, tzinfo=UTC)
        assert summary.signals_emitted == 1
        assert table.rows[("AAPL", "fundamentals", _FIXED_NOW.date())]["signal_id"] == 10

    @pytest.mark.asyncio
    async def test_ac9_one_symbol_retry_keeps_day_wide_direction(self):
        table = _EmittedTable()
        today = _FIXED_NOW.date()
        table.seed("MSFT", today, signal_id=21, score=0.90)
        table.seed("NVDA", today, signal_id=22, score=0.70)
        table.seed("GOOG", today, signal_id=23, score=0.50)
        loop = _fake_loop({"AAPL": 0.10}, SimpleNamespace(signal_id=24), table)
        await loop.run_once(override_symbols=["AAPL", "GOOG", "MSFT", "NVDA"])

        calls = loop._ingest.of("IngestSignal")
        assert [c[1].signal.symbol for c in calls] == ["AAPL"]
        assert calls[0][1].signal.direction == "sell"

    def test_map_directions_reference_scores_set_the_cuts(self):
        assert FundamentalsSignalLoop._map_directions(
            {"AAPL": 0.10}, 0.80, 0.20, reference_scores=[0.90, 0.70, 0.50]
        ) == {"AAPL": "sell"}
        assert FundamentalsSignalLoop._map_directions({"AAPL": 0.10}, 0.80, 0.20) == {"AAPL": "buy"}

    @pytest.mark.asyncio
    async def test_ac10_force_keeps_now_anchored_valid_until(self):
        table = _EmittedTable()
        table.seed("AAPL", _FIXED_NOW.date(), signal_id=31)
        loop = _fake_loop({"AAPL": 0.85}, SimpleNamespace(signal_id=32), table)
        await loop.run_once(force=True, override_symbols=["AAPL"])

        (req,) = _ingest_requests(loop, "AAPL")
        valid_until = req.signal.valid_until.ToDatetime(tzinfo=UTC)
        assert valid_until == datetime(2027, 1, 19, 15, 30, tzinfo=UTC)
        assert valid_until != datetime(2027, 1, 19, tzinfo=UTC)
