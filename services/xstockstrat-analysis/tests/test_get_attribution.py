"""
Tests for GetAttribution (feature 029) — per-source trading-performance attribution over closed
positions. The pure ``attribute_trade`` helper carries the winner-takes-all / exact-tie substance
(AC-4/AC-5); the RPC test drives ``AnalysisServicer.GetAttribution`` with fake pnl_positions /
order_snapshots repos + a fake ingest (slug→display_name) and an owner-scoped context. asyncio_mode
= auto.
"""

from unittest.mock import MagicMock

from gen.analysis.v1 import analysis_pb2

from app.handlers.servicer import attribute_trade
from tests.test_analysis_servicer import make_servicer

# ── Fakes ────────────────────────────────────────────────────────────────────


class _FakePositionsRepo:
    """Keyed by user_id so owner-scoping (the handler passes the caller's id) is exercised."""

    def __init__(self, by_user):
        self._by_user = (
            by_user  # {user_id: [ {position_id, symbol, realized_pnl, fees_total}, ... ]}
        )

    async def list_closed_for_attribution(self, *, user_id, start=None, end=None):
        return list(self._by_user.get(user_id, []))


class _FakeSnapshotsRepo:
    def __init__(self, by_position):
        self._by_position = by_position  # {position_id: [ {signals, price, quantity}, ... ]}

    async def attribution_inputs_for_position(self, position_id):
        return list(self._by_position.get(position_id, []))


class _FakeSource:
    def __init__(self, slug, display_name):
        self.slug = slug
        self.display_name = display_name


class _FakeIngest:
    def __init__(self, names):
        self._names = names  # {slug: display_name}

    async def ListSignalSources(self, request, metadata=None):
        resp = MagicMock()
        resp.sources = [_FakeSource(s, n) for s, n in self._names.items()]
        return resp


def _ctx(user_id="u-1"):
    ctx = MagicMock()
    ctx.invocation_metadata = MagicMock(
        return_value=[("x-user-id", user_id), ("x-access-scope", "7"), ("x-trace-id", "t1")]
    )
    return ctx


def _sig(source, value):
    return {"name": source, "value": value, "source": source}


def _wire(servicer, positions_by_user, snaps_by_position, names=None):
    servicer._pnl_positions_repo = _FakePositionsRepo(positions_by_user)
    servicer._order_snapshots_repo = _FakeSnapshotsRepo(snaps_by_position)
    servicer._ingest = _FakeIngest(names or {})
    return servicer


def _get(servicer, user_id="u-1", source_id=""):
    return servicer.GetAttribution(
        analysis_pb2.GetAttributionRequest(source_id=source_id), _ctx(user_id)
    )


def _one(resp, source_id):
    rows = [a for a in resp.attributions if a.source_id == source_id]
    assert len(rows) == 1, f"expected exactly one {source_id} row, got {resp.attributions}"
    return rows[0]


# ── AC-4 / AC-5: the pure winner-takes-all / exact-tie helper ────────────────


def test_ac4_winner_takes_all():
    assert attribute_trade({"form4": 0.7, "news": 0.3}) == {"form4": 1.0}


def test_ac5_exact_tie_splits_equally():
    assert attribute_trade({"form4": 0.5, "news": 0.5}) == {"form4": 0.5, "news": 0.5}


def test_no_signals_is_manual():
    assert attribute_trade({}) == {}


# ── AC-1: per-source metrics reconcile to the underlying rows ────────────────


async def test_ac1_per_source_metrics_and_reconcile():
    # 20 form4-attributed positions; 13 net-positive (+10 each), 7 net-negative (-5 each). No fees.
    positions = []
    snaps = {}
    for i in range(20):
        pid = f"p{i}"
        pnl = 10.0 if i < 13 else -5.0
        positions.append(
            {"position_id": pid, "symbol": "AAPL", "realized_pnl": pnl, "fees_total": 0.0}
        )
        snaps[pid] = [{"signals": [_sig("form4", 0.7)], "price": 100.0, "quantity": 1.0}]
    servicer = _wire(make_servicer(), {"u-1": positions}, snaps, {"form4": "Form 4"})

    resp = await _get(servicer)
    row = _one(resp, "form4")
    assert row.trade_count == 20.0
    assert row.win_count == 13.0
    assert abs(row.win_rate - 0.65) < 1e-9
    assert row.source_name == "Form 4"
    # C-10(b) parity: total_pnl reconciles to the summed net of the underlying rows.
    want_total = 13 * 10.0 + 7 * (-5.0)
    assert abs(row.total_pnl - want_total) < 1e-9


# ── AC-3: no-signal fills are `manual` and excluded ─────────────────────────


async def test_ac3_no_signal_positions_excluded():
    positions = [
        {"position_id": f"f{i}", "symbol": "AAPL", "realized_pnl": 5.0, "fees_total": 0.0}
        for i in range(20)
    ]
    snaps = {
        f"f{i}": [{"signals": [_sig("form4", 0.6)], "price": 10.0, "quantity": 1.0}]
        for i in range(20)
    }
    # 5 more positions with NO signals → manual, excluded.
    for i in range(5):
        positions.append(
            {"position_id": f"m{i}", "symbol": "MSFT", "realized_pnl": 5.0, "fees_total": 0.0}
        )
        snaps[f"m{i}"] = [{"signals": [], "price": 10.0, "quantity": 1.0}]
    servicer = _wire(make_servicer(), {"u-1": positions}, snaps)

    resp = await _get(servicer)
    assert _one(resp, "form4").trade_count == 20.0
    assert not [a for a in resp.attributions if a.source_id in ("", "manual")]


# ── AC-5 aggregated: an exact tie contributes 0.5 to each tied source ───────


async def test_ac5_tie_split_in_aggregate():
    snaps = {
        "p0": [{"signals": [_sig("form4", 0.5), _sig("news", 0.5)], "price": 10.0, "quantity": 1.0}]
    }
    positions = [{"position_id": "p0", "symbol": "AAPL", "realized_pnl": 8.0, "fees_total": 0.0}]
    servicer = _wire(make_servicer(), {"u-1": positions}, snaps)

    resp = await _get(servicer)
    assert _one(resp, "form4").trade_count == 0.5
    assert _one(resp, "news").trade_count == 0.5
    assert abs(_one(resp, "form4").total_pnl - 4.0) < 1e-9  # half of the +8 net


# ── AC-6 / AC-10 / AC-11: win is net of fees ─────────────────────────────────


async def test_ac6_win_is_net_of_fees():
    positions = [
        {
            "position_id": "loss",
            "symbol": "AAPL",
            "realized_pnl": 12.0,
            "fees_total": 15.0,
        },  # net -3
        {
            "position_id": "win",
            "symbol": "AAPL",
            "realized_pnl": 50.0,
            "fees_total": 10.0,
        },  # net +40
    ]
    snaps = {
        "loss": [{"signals": [_sig("form4", 0.7)], "price": 100.0, "quantity": 1.0}],
        "win": [{"signals": [_sig("form4", 0.7)], "price": 100.0, "quantity": 1.0}],
    }
    servicer = _wire(make_servicer(), {"u-1": positions}, snaps)

    row = _one(await _get(servicer), "form4")
    assert row.trade_count == 2.0
    assert row.win_count == 1.0  # only the net-positive one counts
    assert abs(row.total_pnl - 37.0) < 1e-9  # (-3) + 40


async def test_ac10_and_ac11_net_of_fees():
    positions = [
        {
            "position_id": "a",
            "symbol": "AAPL",
            "realized_pnl": 1.00,
            "fees_total": 1.20,
        },  # AC-10: net -0.20 loss
        {
            "position_id": "b",
            "symbol": "AAPL",
            "realized_pnl": 3.00,
            "fees_total": 0.0,
        },  # AC-11: net == gross win
    ]
    snaps = {
        "a": [{"signals": [_sig("form4", 0.7)], "price": 10.0, "quantity": 1.0}],
        "b": [{"signals": [_sig("form4", 0.7)], "price": 10.0, "quantity": 1.0}],
    }
    servicer = _wire(make_servicer(), {"u-1": positions}, snaps)

    row = _one(await _get(servicer), "form4")
    assert row.win_count == 1.0  # AC-10 loss + AC-11 win
    assert abs(row.total_pnl - 2.80) < 1e-9  # (-0.20) + 3.00


# ── AC-7: source_id filter ───────────────────────────────────────────────────


async def test_ac7_source_filter():
    positions = [
        {"position_id": "a", "symbol": "AAPL", "realized_pnl": 5.0, "fees_total": 0.0},
        {"position_id": "b", "symbol": "MSFT", "realized_pnl": 5.0, "fees_total": 0.0},
    ]
    snaps = {
        "a": [{"signals": [_sig("form4", 0.7)], "price": 10.0, "quantity": 1.0}],
        "b": [{"signals": [_sig("news", 0.7)], "price": 10.0, "quantity": 1.0}],
    }
    servicer = _wire(make_servicer(), {"u-1": positions}, snaps)

    resp = await _get(servicer, source_id="form4")
    assert {a.source_id for a in resp.attributions} == {"form4"}


# ── AC-9: a brand-new slug appears with no handler change ────────────────────


async def test_ac9_new_source_appears():
    positions = [
        {"position_id": f"i{i}", "symbol": "AAPL", "realized_pnl": 5.0, "fees_total": 0.0}
        for i in range(3)
    ]
    snaps = {
        f"i{i}": [{"signals": [_sig("insider8k", 0.9)], "price": 10.0, "quantity": 1.0}]
        for i in range(3)
    }
    # ingest does not know the slug (registered after ship) → falls back to the slug itself.
    servicer = _wire(make_servicer(), {"u-1": positions}, snaps, {"form4": "Form 4"})

    row = _one(await _get(servicer), "insider8k")
    assert row.trade_count == 3.0
    assert row.source_name == "insider8k"  # unknown slug ⇒ the slug (AC-9)


# ── Owner-scoping (anti-IDOR, fail 131) ──────────────────────────────────────


async def test_owner_scoping_isolates_users():
    positions = [{"position_id": "p0", "symbol": "AAPL", "realized_pnl": 9.0, "fees_total": 0.0}]
    snaps = {"p0": [{"signals": [_sig("form4", 0.7)], "price": 10.0, "quantity": 1.0}]}
    servicer = _wire(make_servicer(), {"u-1": positions}, snaps)

    # u-1 sees the row; a different caller sees none of u-1's data.
    assert _one(await _get(servicer, user_id="u-1"), "form4").trade_count == 1.0
    assert list((await _get(servicer, user_id="u-2")).attributions) == []


async def test_no_repo_returns_empty():
    servicer = make_servicer()  # no db → repos None
    resp = await servicer.GetAttribution(analysis_pb2.GetAttributionRequest(), _ctx())
    assert list(resp.attributions) == []
