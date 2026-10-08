"""Feature 224 — owner-keyed analysis state (AC-21) and the strategy admin read (AC-28).

Two users may each own a ``mean_reversion`` strategy: scores, run history, run details and
evidence cells are keyed by ``(user_id, strategy_id)``, so one owner's backtest never touches
the other's state. An ADMIN may read another owner's strategy through the ``owner_user_id``
selector; every such read emits ``audit.admin_read`` (1 admin-stream + K owner-stream events) and
fails closed with ``UNAVAILABLE`` when the ledger append fails.
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest
from gen.analysis.v1 import analysis_pb2
from gen.common.v1 import common_pb2
from gen.ingest.v1 import ingest_pb2

from app import admin_audit
from app.admin_audit import audit_admin_read
from app.handlers import servicer as servicer_mod
from app.handlers.servicer import AnalysisServicer
from tests.conftest import RecordingStub, ctx_with

_SID = "mean_reversion"


def _servicer() -> AnalysisServicer:
    cfg = MagicMock()
    cfg.get_float = MagicMock(side_effect=lambda key, default=0.0: default)
    cfg.get_str = MagicMock(side_effect=lambda key, default="": default)
    cfg.get_int = MagicMock(side_effect=lambda key, default=0: default)
    cfg.get_bool = MagicMock(side_effect=lambda key, default=False: default)
    cfg.get_int_present = MagicMock(side_effect=lambda key, default: default)
    cfg.get_float_present = MagicMock(side_effect=lambda key, default: default)
    return AnalysisServicer(
        cfg,
        marketdata_channel=MagicMock(),
        indicators_channel=MagicMock(),
        ingest_channel=MagicMock(),
        ledger_channel=MagicMock(),
    )


def _user(uid, scope="1"):
    return ctx_with([("x-user-id", uid), ("x-access-scope", scope), ("x-trace-id", f"t-{uid}")])


def _admin(extra=()):
    # x-access-scope 7 carries the ADMIN bit (0x04); the extra header must NOT reach the ledger.
    return ctx_with(
        [("x-user-id", "admin"), ("x-access-scope", "7"), ("x-trace-id", "t-adm"), *extra]
    )


def _row(owner, sid=_SID):
    return {
        "strategy_id": sid,
        "user_id": owner,
        "display_name": f"{owner} {sid}",
        "active": True,
        "live_enabled": False,
        "definition_json": {"entry_rule": f"rule-{owner}"},
    }


class _FakeStrategies:
    """Owner-keyed strategies store: alice and bob each own ``mean_reversion``."""

    def __init__(self, owners=("alice", "bob")):
        self.rows = {(o, _SID): _row(o) for o in owners}
        self.get_by_owner_and_id = AsyncMock(side_effect=self._get)
        self.list = AsyncMock(side_effect=self._list)

    async def _get(self, user_id, strategy_id):
        return self.rows.get((user_id, strategy_id))

    async def _list(self, user_id, include_inactive=False, page_size=0, page_offset=0):
        rows = [r for (u, _), r in self.rows.items() if u == user_id]
        return rows, len(rows)


class _FakeRuns:
    def __init__(self):
        self.rows = []
        self.insert = AsyncMock(side_effect=self._insert)
        self.list_by_strategy = AsyncMock(side_effect=self._list)

    async def _insert(self, **kw):
        self.rows.append(kw)
        return kw

    async def _list(self, user_id, strategy_id, limit=20):
        return [
            {**r, "completed_at": None, "annualized_return": 0.0, "profit_factor": 0.0}
            for r in self.rows
            if r.get("user_id") == user_id and r["strategy_id"] == strategy_id
        ][:limit]


class _FakeDetails:
    def __init__(self):
        self.rows = {}
        self.insert = AsyncMock(side_effect=self._insert)
        self.get = AsyncMock(side_effect=self._get)

    async def _insert(self, *, backtest_id, result_pb, user_id, **_kw):
        self.rows[backtest_id] = (result_pb, user_id)

    async def _get(self, backtest_id):
        return self.rows.get(backtest_id)


def _cells():
    return [
        {
            "symbol": s,
            "sharpe_ratio": 2.0,
            "max_drawdown": 0.05,
            "win_rate": 0.9,
            "total_return": 0.2,
            "total_trades": 4,
            "trading_days": 300,
        }
        for s in ("AAPL", "MSFT", "NVDA")
    ]


def _wired():
    svc = _servicer()
    svc._ledger = RecordingStub()
    svc._indicators = RecordingStub()
    svc._strategies_repo = _FakeStrategies()
    svc._backtest_runs_repo = _FakeRuns()
    svc._backtest_details_repo = _FakeDetails()
    svc._scores_repo = AsyncMock()
    svc._backtest_run_symbols_repo = AsyncMock()

    # Evidence cells exist for alice only; an owner-blind read would leak them to bob.
    async def _eligible(user_id, strategy_id, fingerprint):
        return _cells() if user_id == "alice" else []

    svc._backtest_run_symbols_repo.fetch_eligible = AsyncMock(side_effect=_eligible)
    return svc


def _backtest_req():
    req = MagicMock()
    req.strategy_id = _SID
    req.symbols = ["AAPL"]
    req.initial_capital = 100_000.0
    req.strategy_id_ref = ""
    req.HasField = MagicMock(return_value=False)
    req.range = common_pb2.TimeRange()
    req.fill_model = analysis_pb2.FILL_MODEL_UNSPECIFIED
    return req


def _code(ctx):
    return ctx.abort.await_args.args[0]


class TestAC21SameStrategyIdTwoOwners:
    @pytest.mark.asyncio
    async def test_alice_backtest_leaves_bob_score_runs_and_details_untouched(self):
        svc = _wired()
        bob_score = analysis_pb2.StrategyScore(strategy_id=_SID, overall_score=0.4, rating="D")
        svc._strategies[("bob", _SID)] = bob_score

        result = await svc.RunBacktest(_backtest_req(), context=_user("alice"))
        assert result.status == analysis_pb2.BACKTEST_STATUS_OK

        # Persist paths carry alice's owner.
        assert [r["user_id"] for r in svc._backtest_runs_repo.rows] == ["alice"]
        assert svc._backtest_details_repo.rows[result.backtest_id][1] == "alice"
        # Alice's headline was recomputed from HER evidence only, under her owner key.
        assert svc._backtest_run_symbols_repo.fetch_eligible.await_args.args[0] == "alice"
        assert svc._strategies[("alice", _SID)].evidence_symbols == 3
        assert svc._scores_repo.upsert.await_args.args[:2] == ("alice", _SID)

        # bob's ListStrategies score is unchanged.
        resp = await svc.ListStrategies(MagicMock(), context=_user("bob"))
        assert [s.overall_score for s in resp.strategies] == [0.4]

        # bob's ListBacktests("mean_reversion") is empty.
        req = MagicMock(strategy_id=_SID, limit=0)
        runs = await svc.ListBacktests(req, context=_user("bob"))
        assert list(runs.runs) == []
        assert svc._backtest_runs_repo.list_by_strategy.await_args.args[:2] == ("bob", _SID)

        # bob's GetBacktest(alice's id) → PERMISSION_DENIED.
        ctx = _user("bob")
        with pytest.raises(Exception, match="aborted"):
            await svc.GetBacktest(MagicMock(backtest_id=result.backtest_id), ctx)
        assert _code(ctx) == grpc.StatusCode.PERMISSION_DENIED
        # A non-admin foreign read emits no audit event.
        assert all(c[1].event_type != "audit.admin_read" for c in svc._ledger.of("AppendEvent"))

    @pytest.mark.asyncio
    async def test_owner_reads_own_backtest(self):
        svc = _wired()
        result = await svc.RunBacktest(_backtest_req(), context=_user("alice"))
        got = await svc.GetBacktest(MagicMock(backtest_id=result.backtest_id), _user("alice"))
        assert got.backtest_id == result.backtest_id

    @pytest.mark.asyncio
    async def test_ownerless_detail_is_denied(self):
        svc = _wired()
        svc._backtest_details_repo.rows["bt-x"] = (b"", None)
        ctx = _user("bob")
        with pytest.raises(Exception, match="aborted"):
            await svc.GetBacktest(MagicMock(backtest_id="bt-x"), ctx)
        assert _code(ctx) == grpc.StatusCode.PERMISSION_DENIED

    @pytest.mark.asyncio
    async def test_admin_foreign_get_backtest_is_denied(self):
        # FR-13's admin read view covers formulas/strategies/sources/signals, not backtests
        # (operator decision 2026-10-07): an admin is denied like any other non-owner.
        svc = _wired()
        result = await svc.RunBacktest(_backtest_req(), context=_user("alice"))
        before = len(svc._ledger.of("AppendEvent"))
        ctx = _admin()
        with pytest.raises(Exception, match="aborted"):
            await svc.GetBacktest(MagicMock(backtest_id=result.backtest_id), ctx)
        assert ctx.abort.call_args[0][0] == grpc.StatusCode.PERMISSION_DENIED
        assert svc._ledger.of("AppendEvent")[before:] == []

    @pytest.mark.asyncio
    async def test_get_strategy_report_reads_owner_key(self):
        svc = _wired()
        svc._strategies[("alice", _SID)] = analysis_pb2.StrategyScore(
            strategy_id=_SID, overall_score=0.9
        )
        ctx = _user("bob")
        with pytest.raises(Exception, match="aborted"):
            await svc.GetStrategyReport(MagicMock(strategy_id=_SID), ctx)
        assert _code(ctx) == grpc.StatusCode.NOT_FOUND  # bob owns it but has no score

    @pytest.mark.asyncio
    async def test_get_strategy_analytics_reads_owner_scoped_runs(self):
        svc = _wired()
        svc._ingest = RecordingStub({"QuerySignals": ingest_pb2.QuerySignalsResponse()})
        await svc.GetStrategyAnalytics(MagicMock(strategy_id=_SID), _user("bob"))
        assert svc._backtest_runs_repo.list_by_strategy.await_args.args[:2] == ("bob", _SID)

    @pytest.mark.asyncio
    async def test_hydrate_keys_scores_by_owner(self):
        svc = _wired()
        svc._scores_repo.list = AsyncMock(
            return_value=[
                {"user_id": u, "strategy_id": _SID, "overall_score": s, "rating": "C"}
                for u, s in (("alice", 0.9), ("bob", 0.4))
            ]
        )
        await svc.hydrate_scores()
        assert svc._strategies[("alice", _SID)].overall_score == 0.9
        assert svc._strategies[("bob", _SID)].overall_score == 0.4


class TestAC28StrategyAdminRead:
    @pytest.mark.asyncio
    async def test_admin_get_strategy_reads_owner_and_appends_two_events(self):
        svc = _wired()
        ctx = _admin(extra=[("x-internal-caller", "spoof")])
        req = analysis_pb2.GetStrategyRequest(strategy_id=_SID, owner_user_id="alice")

        got = await svc.GetStrategy(req, ctx)

        assert got.display_name == "alice mean_reversion"
        appends = svc._ledger.of("AppendEvent")
        assert len(appends) == 2
        by_stream = {c[1].stream_key: c[1] for c in appends}
        assert set(by_stream) == {"user:admin", "user:alice"}
        assert by_stream["user:admin"].user_id == "admin"
        assert by_stream["user:alice"].user_id == "alice"
        for _name, ev, meta in appends:
            assert ev.event_type == "audit.admin_read"
            assert ev.payload["admin_id"] == "admin"
            assert ev.payload["object_kind"] == "strategy"
            assert list(ev.payload["object_ids"]) == [_SID]
            # C-03: exactly the inbound trio is forwarded.
            assert sorted(k for k, _ in meta) == ["x-access-scope", "x-trace-id", "x-user-id"]

    @pytest.mark.asyncio
    async def test_admin_audit_failure_fails_closed_unavailable(self):
        svc = _wired()
        svc._ledger = RecordingStub({"AppendEvent": RuntimeError("ledger down")})
        ctx = _admin()
        req = analysis_pb2.GetStrategyRequest(strategy_id=_SID, owner_user_id="alice")
        with pytest.raises(Exception, match="aborted"):
            await svc.GetStrategy(req, ctx)
        assert _code(ctx) == grpc.StatusCode.UNAVAILABLE

    @pytest.mark.asyncio
    async def test_non_admin_owner_selector_is_ignored(self):
        svc = _wired()
        req = analysis_pb2.GetStrategyRequest(strategy_id=_SID, owner_user_id="alice")
        got = await svc.GetStrategy(req, _user("bob"))
        assert got.display_name == "bob mean_reversion"
        assert svc._strategies_repo.get_by_owner_and_id.await_args.args == ("bob", _SID)
        assert svc._ledger.of("AppendEvent") == []

    @pytest.mark.asyncio
    async def test_admin_selecting_self_emits_nothing(self):
        svc = _wired()
        svc._strategies_repo.rows[("admin", _SID)] = _row("admin")
        req = analysis_pb2.GetStrategyRequest(strategy_id=_SID, owner_user_id="admin")
        await svc.GetStrategy(req, _admin())
        assert svc._ledger.of("AppendEvent") == []

    @pytest.mark.asyncio
    async def test_admin_list_definitions_one_plus_k(self):
        svc = _wired()
        req = analysis_pb2.ListStrategyDefinitionsRequest(owner_user_id="alice")
        resp = await svc.ListStrategyDefinitions(req, _admin())
        assert [d.display_name for d in resp.definitions] == ["alice mean_reversion"]
        assert sorted(c[1].stream_key for c in svc._ledger.of("AppendEvent")) == [
            "user:admin",
            "user:alice",
        ]

    @pytest.mark.asyncio
    async def test_admin_list_definitions_audit_failure_unavailable(self):
        svc = _wired()
        svc._ledger = RecordingStub({"AppendEvent": RuntimeError("ledger down")})
        ctx = _admin()
        req = analysis_pb2.ListStrategyDefinitionsRequest(owner_user_id="alice")
        with pytest.raises(Exception, match="aborted"):
            await svc.ListStrategyDefinitions(req, ctx)
        assert _code(ctx) == grpc.StatusCode.UNAVAILABLE

    @pytest.mark.asyncio
    async def test_non_admin_list_selector_ignored(self):
        svc = _wired()
        req = analysis_pb2.ListStrategyDefinitionsRequest(owner_user_id="alice")
        resp = await svc.ListStrategyDefinitions(req, _user("bob"))
        assert [d.display_name for d in resp.definitions] == ["bob mean_reversion"]
        assert svc._ledger.of("AppendEvent") == []


class TestAuditAdminRead:
    _META = [("x-user-id", "admin"), ("x-access-scope", "7"), ("x-trace-id", "t"), ("x-z", "1")]

    @pytest.mark.asyncio
    async def test_one_admin_event_plus_one_per_owner(self):
        ledger = RecordingStub()
        await audit_admin_read(
            ledger, "admin", "strategy", {"alice": ["a1", "a2"], "bob": ["b1"]}, self._META
        )
        evs = {c[1].stream_key: c[1] for c in ledger.of("AppendEvent")}
        assert set(evs) == {"user:admin", "user:alice", "user:bob"}
        assert sorted(evs["user:admin"].payload["object_ids"]) == ["a1", "a2", "b1"]
        assert list(evs["user:bob"].payload["object_ids"]) == ["b1"]
        for _n, _e, meta in ledger.of("AppendEvent"):
            assert ("x-z", "1") not in meta

    @pytest.mark.asyncio
    async def test_all_own_emits_nothing(self):
        ledger = RecordingStub()
        await audit_admin_read(ledger, "admin", "strategy", {}, self._META)
        await audit_admin_read(ledger, "admin", "strategy", {"admin": ["x"]}, self._META)
        assert ledger.calls == []

    @pytest.mark.asyncio
    async def test_append_concurrency_is_bounded(self):
        in_flight = 0
        peak = 0

        async def _append(request, metadata=None):
            nonlocal in_flight, peak
            in_flight += 1
            peak = max(peak, in_flight)
            await asyncio.sleep(0.01)
            in_flight -= 1

        ledger = MagicMock()
        ledger.AppendEvent = AsyncMock(side_effect=_append)
        owners = {f"u{i}": [f"s{i}"] for i in range(9)}
        await audit_admin_read(ledger, "admin", "strategy", owners, self._META)
        assert ledger.AppendEvent.await_count == 10
        assert peak == admin_audit._AUDIT_APPEND_CONCURRENCY == 4

    @pytest.mark.asyncio
    async def test_owner_count_above_ceiling_raises_before_appending(self):
        ledger = RecordingStub()
        owners = {f"u{i}": ["s"] for i in range(admin_audit._AUDIT_MAX_OWNERS_PER_PAGE + 1)}
        with pytest.raises(admin_audit.AdminAuditError):
            await audit_admin_read(ledger, "admin", "strategy", owners, self._META)
        assert ledger.calls == []

    @pytest.mark.asyncio
    async def test_any_append_failure_raises(self):
        ledger = RecordingStub({"AppendEvent": RuntimeError("down")})
        with pytest.raises(admin_audit.AdminAuditError):
            await audit_admin_read(ledger, "admin", "strategy", {"alice": ["a"]}, self._META)


class TestBootRecomputeOfAmbiguousPairs:
    @pytest.mark.asyncio
    async def test_pairs_beyond_cap_are_deferred_to_next_pass(self):
        svc = _wired()
        pairs = [(f"u{i}", _SID) for i in range(60)]
        svc._scores_repo.list_unscored_pairs = AsyncMock(return_value=pairs)
        svc._recompute_headline = AsyncMock(return_value=None)

        done = await svc.recompute_unscored_pairs()

        assert servicer_mod._BOOT_RECOMPUTE_MAX_PAIRS == 50
        assert svc._scores_repo.list_unscored_pairs.await_args.kwargs["limit"] == 50
        assert done == 50
        recomputed = [c.args for c in svc._recompute_headline.await_args_list]
        assert recomputed == pairs[:50]

    @pytest.mark.asyncio
    async def test_one_pair_failure_does_not_stop_the_pass(self):
        svc = _wired()
        svc._scores_repo.list_unscored_pairs = AsyncMock(
            return_value=[("alice", _SID), ("bob", _SID)]
        )
        svc._recompute_headline = AsyncMock(side_effect=[RuntimeError("db"), None])
        assert await svc.recompute_unscored_pairs() == 2
        assert svc._recompute_headline.await_count == 2

    @pytest.mark.asyncio
    async def test_noop_without_db(self):
        svc = _servicer()
        assert await svc.recompute_unscored_pairs() == 0
