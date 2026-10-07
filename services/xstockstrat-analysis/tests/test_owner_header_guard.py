"""Feature 224 CI guard — every analysis→ingest and analysis→indicators stub call carries exactly
one non-empty ``x-user-id`` (a runtime check, not an AST ``metadata=`` scan, which accepts ``()``).

Each enumerated outbound path is driven with ``RecordingStub`` ingest + indicators stubs. The
reserved ``system`` identity is accepted only alongside a stub-level ``x-internal-caller`` grant
(``analysis-fundsignal`` / ``analysis-system-read``); an owner call carries no stub-level grant. The
channel-level ``InternalCallerInterceptor`` (removed in Step 16) sits below the stub, so it is not
visible here. asyncio_mode = auto.
"""

import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from gen.analysis.v1 import analysis_pb2

from app.engine import entry_backfill
from app.engine.fundsignal_loop import FundamentalsSignalLoop
from app.engine.live_loop import LiveEvaluationLoop, resolve_fundamentals_universe
from app.engine.pnl_pattern_consumer import SnapshotComposer
from app.handlers.servicer import _row_to_strategy_definition
from app.services.evaluator import StrategyEvaluator
from tests.conftest import RecordingStub, ctx_with
from tests.test_analysis_servicer import make_servicer
from tests.test_get_attribution import _FakePositionsRepo, _FakeSnapshotsRepo, _sig
from tests.test_pnl_pattern_consumer import ORDER_PAYLOAD, make_consumer, make_event
from tests.test_readiness_opportunities_source_symbol import _real_bars

_SYSTEM_GRANTS = {"analysis-fundsignal", "analysis-system-read"}
_BOB = [("x-user-id", "bob"), ("x-access-scope", "1"), ("x-trace-id", "t-bob")]
_ADMIN = [("x-user-id", "admin-1"), ("x-access-scope", "4"), ("x-trace-id", "t-adm")]
_EOF = SimpleNamespace(next_page_token="")

_DEFINITION_JSON = {
    "components": [
        {
            "ref_name": "a",
            "kind": "COMPONENT_KIND_BUILTIN_INDICATOR",
            "indicator": "SMA",
            "params": {"period": 2.0},
        },
        {"ref_name": "f", "kind": "COMPONENT_KIND_CUSTOM_FORMULA", "formula_id": "f-bob"},
    ],
    "entry_rule": json.dumps({"fn": ">", "lhs": "a", "rhs": 0}),
    "signal_eligible": True,
}


def _row(strategy_id="s-bob", user_id="bob"):
    return {
        "strategy_id": strategy_id,
        "user_id": user_id,
        "display_name": strategy_id,
        "active": True,
        "live_enabled": True,
        "created_at": datetime(2024, 1, 1, tzinfo=UTC),
        "definition_json": dict(_DEFINITION_JSON),
    }


def _signals_resp(*symbols):
    return SimpleNamespace(signals=[SimpleNamespace(symbol=s) for s in symbols], page=_EOF)


def _ingest():
    return RecordingStub(
        {
            "QuerySignals": lambda _r: _signals_resp("MSFT"),
            "ListSignalSources": SimpleNamespace(sources=[]),
        }
    )


def _assert_owner_headers(*stubs):
    calls = [c for s in stubs for c in s.calls]
    assert calls, "the path issued no ingest/indicators call — the guard would be vacuous"
    for method, _req, meta in calls:
        uids = [v for k, v in meta if k == "x-user-id"]
        assert len(uids) == 1 and uids[0], f"{method} sent x-user-id {uids!r}: {meta}"
        grants = [v for k, v in meta if k == "x-internal-caller"]
        if uids[0] == "system":
            assert len(grants) == 1 and grants[0] in _SYSTEM_GRANTS, f"{method}: {meta}"
        else:
            assert not grants, f"{method} carries a stub-level grant as an owner: {meta}"


def _cfg(overrides=None):
    overrides = overrides or {}
    cfg = MagicMock()
    for name in ("get_int", "get_int_present", "get_float", "get_float_present", "get_str"):
        getattr(cfg, name).side_effect = lambda key, default=None, _o=overrides: _o.get(
            key, default
        )
    cfg.get_bool.side_effect = lambda key, default=False: overrides.get(key, default)
    return cfg


def _marketdata():
    md = MagicMock()
    md.GetBars = AsyncMock(
        return_value=SimpleNamespace(bars=_real_bars("MSFT", [1.0, 2.0, 3.0]), page=_EOF)
    )
    md.GetFundamentalsMulti = AsyncMock(
        return_value=SimpleNamespace(fundamentals=[SimpleNamespace(symbol="MSFT")])
    )
    return md


def _live_loop(ingest, indicators, rows):
    db = MagicMock()
    db.fetch = AsyncMock(return_value=rows)
    portfolio = MagicMock()
    portfolio.ListPositions = AsyncMock(return_value=SimpleNamespace(positions=[], page=_EOF))
    portfolio.ListWatchlists = AsyncMock(return_value=SimpleNamespace(watchlists=[], page=_EOF))
    return LiveEvaluationLoop(
        config_watcher=_cfg(),
        db_pool=db,
        marketdata_stub=_marketdata(),
        ingest_stub=ingest,
        notify_stub=AsyncMock(),
        ledger_stub=AsyncMock(),
        evaluator=StrategyEvaluator(indicators, ()),
        portfolio_stub=portfolio,
    )


# ── background paths (no inbound request to inherit an identity from) ────────────────────────────


async def test_live_loop_cycle_system_and_owner_drains_and_evaluator():
    ingest, indicators = _ingest(), RecordingStub()
    loop = _live_loop(ingest, indicators, [_row()])
    await loop._run_cycle()
    assert indicators.calls, "the owner's pair was never evaluated"
    _assert_owner_headers(ingest, indicators)


async def test_resolve_fundamentals_universe():
    ingest = _ingest()
    await resolve_fundamentals_universe(ingest, _marketdata(), _cfg())
    _assert_owner_headers(ingest)


async def test_entry_backfill_run_once():
    ingest = _ingest()
    loop = _live_loop(ingest, RecordingStub(), [])
    db = MagicMock()
    db.fetch = AsyncMock(return_value=[_row()])
    trading = MagicMock()
    trading.ListOrders = AsyncMock(return_value=SimpleNamespace(orders=[]))
    await entry_backfill.run_once(loop, db, trading, _cfg())
    _assert_owner_headers(ingest)


async def test_pnl_handle_order_event():
    ingest, indicators = _ingest(), RecordingStub()
    md = MagicMock()
    md.GetBars = AsyncMock(return_value=SimpleNamespace(bars=_real_bars("AAPL", [1.0, 2.0, 3.0])))
    consumer, *_ = make_consumer(composer=SnapshotComposer(md, indicators, ingest))
    await consumer.process_event(make_event(1, "order.filled", ORDER_PAYLOAD))
    assert indicators.of("ComputeIndicator") and ingest.of("QuerySignals")
    _assert_owner_headers(ingest, indicators)


_FUND_VALUES = dict(pe_ratio=1, pb_ratio=1, dividend_yield=0, roe=1, debt_to_equity=1, eps=1)


def _fundsignal_loop(ingest, indicators):
    loop = FundamentalsSignalLoop(
        config_watcher=_cfg(
            {
                "analysis.fundsignal.scoring_formula_id": "d1ff-system",
                "analysis.fundsignal.source_slug": "fundamentals",
            }
        ),
        db_pool=MagicMock(),
        marketdata_stub=MagicMock(),
        ingest_stub=ingest,
        portfolio_stub=None,
        indicators_stub=indicators,
        notify_stub=AsyncMock(),
        ledger_stub=AsyncMock(),
    )
    loop._db.execute = AsyncMock()
    loop._db.fetch = AsyncMock(return_value=[])
    loop._db.fetchrow = AsyncMock(return_value={"symbol": "AAPL"})
    loop._marketdata.GetFundamentalsMulti = AsyncMock(
        side_effect=lambda req, metadata=(): SimpleNamespace(
            fundamentals=[SimpleNamespace(symbol=s, **_FUND_VALUES) for s in req.symbols]
        )
    )
    return loop


def _fundsignal_stubs():
    ingest = RecordingStub({"IngestSignal": SimpleNamespace(signal_id="sig-1")})
    indicators = RecordingStub(
        {
            "GetFormula": SimpleNamespace(author="system"),
            "ExecuteFormula": SimpleNamespace(success=True, output={"composite": 0.7}),
        }
    )
    return ingest, indicators


async def test_fundsignal_loop_path():
    ingest, indicators = _fundsignal_stubs()
    await _fundsignal_loop(ingest, indicators).run_once(override_symbols=["AAPL"])
    assert ingest.of("IngestSignal") and indicators.of("ExecuteFormula")
    _assert_owner_headers(ingest, indicators)


async def test_fundsignal_manual_run_fundamentals_scan():
    ingest, indicators = _fundsignal_stubs()
    svc = make_servicer()
    svc._fundsignal_loop = _fundsignal_loop(ingest, indicators)
    await svc.RunFundamentalsScan(
        analysis_pb2.RunFundamentalsScanRequest(symbols=["AAPL"]), ctx_with(_ADMIN)
    )
    assert ingest.of("IngestSignal") and indicators.of("ExecuteFormula")
    _assert_owner_headers(ingest, indicators)


# ── request paths (inherit the caller's header) ──────────────────────────────────────────────────


def _svc():
    svc = make_servicer()
    svc._ingest, svc._indicators = _ingest(), RecordingStub()
    svc._marketdata = MagicMock()
    svc._marketdata.GetBars = AsyncMock(
        return_value=SimpleNamespace(bars=_real_bars("MSFT", [1.0, 2.0, 3.0]), page=_EOF)
    )
    svc._portfolio = None
    return svc


async def test_list_opportunities_compute_drains():
    svc = _svc()
    try:
        await svc._compute_opportunities("bob", list(_BOB))
    except Exception:  # noqa: BLE001 — only the recorded outbound headers matter here
        pass
    _assert_owner_headers(svc._ingest, svc._indicators)


async def test_get_attribution():
    svc = _svc()
    svc._pnl_positions_repo = _FakePositionsRepo(
        {"bob": [{"position_id": "p0", "realized_pnl": 1.0, "fees_total": 0.0}]}
    )
    svc._order_snapshots_repo = _FakeSnapshotsRepo(
        {"p0": [{"signals": [_sig("bob-feed", 0.7)], "price": 1.0, "quantity": 1.0}]}
    )
    await svc.GetAttribution(analysis_pb2.GetAttributionRequest(), ctx_with(_BOB))
    assert svc._ingest.of("ListSignalSources")
    _assert_owner_headers(svc._ingest)
    assert {dict(m)["x-user-id"] for _n, _r, m in svc._ingest.calls} == {"bob"}  # AC-12


async def test_get_strategy_analytics():
    svc = _svc()
    await svc.GetStrategyAnalytics(
        analysis_pb2.GetStrategyAnalyticsRequest(strategy_id="s-bob"), ctx_with(_BOB)
    )
    _assert_owner_headers(svc._ingest)


async def test_screen_symbols():
    svc = _svc()
    req = analysis_pb2.ScreenSymbolsRequest(symbols=["MSFT"])
    try:
        await svc.ScreenSymbols(req, ctx_with(_BOB))
    except Exception:  # noqa: BLE001 — only the recorded outbound headers matter here
        pass
    _assert_owner_headers(svc._ingest, svc._indicators)
    calls = svc._ingest.calls + svc._indicators.calls
    assert {dict(m)["x-user-id"] for _n, _r, m in calls} == {"bob"}  # AC-29


async def test_readiness_materializer():
    svc = _svc()
    svc._portfolio = MagicMock()
    wl = SimpleNamespace(bindings=[SimpleNamespace(symbol="MSFT", strategy_id="s-bob")], symbols=[])
    svc._portfolio.ListWatchlists = AsyncMock(
        return_value=SimpleNamespace(watchlists=[wl], page=_EOF)
    )
    try:
        await svc._materialize_readiness_for_owner("bob", {"s-bob": _row()})
    except Exception:  # noqa: BLE001 — only the recorded outbound headers matter here
        pass
    assert svc._indicators.calls
    _assert_owner_headers(svc._indicators)


async def test_write_time_formula_reads():
    svc = _svc()
    definition = _row_to_strategy_definition(_row())
    await svc._fetch_formula_outputs(definition, list(_BOB))
    await svc._deleted_formula_warnings(definition, list(_BOB))
    _assert_owner_headers(svc._indicators)


async def test_backtest_formula_prefetch():
    svc = _svc()
    definition = _row_to_strategy_definition(_row())
    await svc._declared_formula_warmup("f-bob", {}, list(_BOB))
    await svc._formula_fundamentals(definition, list(_BOB))
    _assert_owner_headers(svc._indicators)
