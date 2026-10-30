"""Phase-2 scoped writes: guards (flag, staging label, allowlist, request predicate), audit, and the
live kill switch (AC-19, AC-20, AC-27, AC-28)."""

from gen.config.v1 import config_pb2
from gen.portfolio.v1 import portfolio_pb2 as pb
from google.protobuf import descriptor_pool

from app import main, policy
from app.catalog import from_function
from app.check_api import check
from tests._helpers import wait_done
from tests._write_helpers import (
    ADD,
    CREATE,
    DELETE,
    GET,
    REMOVE,
    SET_CONFIG,
    SVC,
    UPDATE,
    FakePortfolio,
    write_runner,
)

# Recon "PRIVILEGED / unsafe writes" plus the no-cleanup owner writes: a test oracle, never imported
# by app code.
PRIVILEGED = (
    "xstockstrat.config.v1.ConfigService/SetConfig",
    "xstockstrat.config.v1.ConfigService/GetSecret",
    "xstockstrat.ledger.v1.LedgerService/AppendEvent",
    "xstockstrat.notify.v1.NotifyService/EmitAlert",
    "xstockstrat.notify.v1.NotifyService/AcknowledgeAlert",
    "xstockstrat.marketdata.v1.MarketDataService/BackfillBars",
    "xstockstrat.marketdata.v1.MarketDataService/BackfillFundamentals",
    "xstockstrat.marketdata.v1.MarketDataService/DeleteBackfilledData",
    "xstockstrat.ingest.v1.IngestService/TriggerBackfill",
    "xstockstrat.ingest.v1.IngestService/CancelBackfill",
    "xstockstrat.ingest.v1.IngestService/IngestSignal",
    "xstockstrat.identity.v1.IdentityService/IssueAuthCode",
    "xstockstrat.identity.v1.IdentityService/RevokeAuthorizedApp",
    "xstockstrat.identity.v1.IdentityService/CreateUser",
    "xstockstrat.analysis.v1.AnalysisService/RunFundamentalsScan",
    "xstockstrat.analysis.v1.AnalysisService/ManageTemplate",
    "xstockstrat.analysis.v1.AnalysisService/SetStrategyLive",
    "xstockstrat.trading.v1.TradingService/PlaceOrder",
    SVC + "UpdateWatchlistBinding",
    SVC + "UpdateWatchlistBindings",
    SVC + "EnsureSignalWatchlist",
    SVC + "ListAllWatchlistSymbols",
)


def _create_check(name_hint="wl", request=None):
    @check("w.create", feature="f", part="phase-2")
    async def run(ctx):
        req = request or pb.CreateWatchlistRequest(name=ctx.fixture(name_hint))
        resp = await ctx.rpc.call(CREATE, req)
        ctx.evidence("watchlist", resp.watchlist.name)

    return from_function(run)


async def _run(checks, backend, **kw):
    runner = write_runner(checks, backend, **kw)
    run_id = await runner.start([c.id for c in checks], triggered_by="xstockstrat-agent")
    done = await wait_done(runner, run_id)
    return run_id, done["records"], done["file"]["body"]


async def test_allowlisted_write_allowed_under_every_guard_and_audited():
    backend = FakePortfolio()
    run_id, (rec,), body = await _run([_create_check()], backend)
    assert rec["outcome"] == "PASS", rec
    assert backend.names("u-smoke-1") == [f"smoke-{run_id}-wl"]
    assert rec["rpcs_invoked"] == [CREATE]
    assert rec["writes_performed"] == [CREATE]
    ((path, md),) = backend.calls
    assert path == f"/{CREATE}"
    assert md["x-user-id"] == "u-smoke-1" and md["x-trace-id"] == run_id
    assert int(md["x-access-scope"]) & 0x04 == 0
    assert body["schema_version"] == 2


async def test_write_refused_when_flag_off():
    backend = FakePortfolio()
    _, (rec,), _ = await _run([_create_check()], backend, enabled=False)
    assert rec["outcome"] == "ERROR"
    assert "MutatingRpcRefused" in rec["evidence"]["error"]
    assert "smoke.writes.enabled" in rec["evidence"]["error"]
    assert backend.opened == [] and rec["writes_performed"] == []


async def test_write_refused_outside_staging_label():
    backend = FakePortfolio()
    _, (rec,), _ = await _run([_create_check()], backend, env="production")
    assert rec["outcome"] == "ERROR"
    assert "MutatingRpcRefused" in rec["evidence"]["error"]
    assert backend.opened == []


async def test_privileged_rpc_refused_even_when_enabled():
    @check("w.priv", feature="f", part="phase-2")
    async def run(ctx):
        await ctx.rpc.call(SET_CONFIG, config_pb2.SetConfigRequest())

    backend = FakePortfolio()
    _, (rec,), _ = await _run([from_function(run)], backend)
    assert rec["outcome"] == "ERROR"
    assert "MutatingRpcRefused" in rec["evidence"]["error"]
    assert backend.opened == [] and rec["rpcs_invoked"] == []


def test_privileged_rpcs_never_in_allowlist():
    assert set(policy.SCOPED_WRITES) == {CREATE, UPDATE, ADD, REMOVE, DELETE}
    assert not set(PRIVILEGED) & set(policy.SCOPED_WRITES)
    pool = main.load_descriptors()
    writes = policy.WritePolicy(enabled=True, env="do-dev")
    for method in PRIVILEGED:
        service, _, name = method.partition("/")
        assert pool.FindServiceByName(service).FindMethodByName(name) is not None, method
        assert not policy.decide(method, descriptors=pool, writes=writes).allowed, method


def test_scoped_writes_resolve_to_real_unannotated_portfolio_methods():
    pool = descriptor_pool.Default()
    for method in policy.SCOPED_WRITES:
        service, _, name = method.partition("/")
        assert pool.FindServiceByName(service).FindMethodByName(name) is not None


def test_strategy_id_bindings_are_refused_by_the_request_predicate():
    pool = descriptor_pool.Default()
    writes = policy.WritePolicy(enabled=True, env="homelab-staging")
    bound = pb.WatchlistBinding(symbol="AAPL", strategy_id="s-1")
    bare = pb.WatchlistBinding(symbol="AAPL")
    refused = [
        (CREATE, pb.CreateWatchlistRequest(name="smoke-x", bindings=[bound])),
        (CREATE, pb.CreateWatchlistRequest(name="smoke-x", default_strategy_id="s-1")),
        (UPDATE, pb.UpdateWatchlistRequest(watchlist_id="w", bindings=[bare, bound])),
        (UPDATE, pb.UpdateWatchlistRequest(watchlist_id="w", default_strategy_id="s-1")),
        (ADD, pb.AddWatchlistSymbolsRequest(watchlist_id="w", bindings=[bound])),
    ]
    for method, req in refused:
        d = policy.decide(method, descriptors=pool, writes=writes, request=req)
        assert not d.allowed and "strategy_id" in d.reason, (method, req)
    allowed = [
        (CREATE, pb.CreateWatchlistRequest(name="smoke-x", symbols=["AAPL"], bindings=[bare])),
        (UPDATE, pb.UpdateWatchlistRequest(watchlist_id="w", name="smoke-y")),
        (ADD, pb.AddWatchlistSymbolsRequest(watchlist_id="w", symbols=["MSFT"])),
        (REMOVE, pb.RemoveWatchlistSymbolsRequest(watchlist_id="w", symbols=["MSFT"])),
        (DELETE, pb.DeleteWatchlistRequest(watchlist_id="w")),
    ]
    for method, req in allowed:
        d = policy.decide(method, descriptors=pool, writes=writes, request=req)
        assert d.allowed and d.write, (method, d.reason)


def test_write_refused_without_a_write_policy_or_request():
    pool = descriptor_pool.Default()
    assert not policy.decide(CREATE, descriptors=pool).allowed
    writes = policy.WritePolicy(enabled=True, env="do-dev")
    assert not policy.decide(CREATE, descriptors=pool, writes=writes).allowed


def test_annotated_reads_are_not_writes():
    d = policy.decide(GET, descriptors=descriptor_pool.Default())
    assert d.allowed and not d.write


async def test_kill_switch_flip_takes_effect_on_the_next_call():
    state = {"on": True}

    @check("w.flip", feature="f", part="phase-2")
    async def run(ctx):
        await ctx.rpc.call(CREATE, pb.CreateWatchlistRequest(name=ctx.fixture("a")))
        state["on"] = False
        await ctx.rpc.call(CREATE, pb.CreateWatchlistRequest(name=ctx.fixture("b")))

    backend = FakePortfolio()
    run_id, (rec,), _ = await _run([from_function(run)], backend, enabled=lambda: state["on"])
    assert rec["outcome"] == "ERROR" and "smoke.writes.enabled" in rec["evidence"]["error"]
    assert backend.names("u-smoke-1") == [f"smoke-{run_id}-a"]
    assert rec["writes_performed"] == [CREATE]


def test_kill_switch_reads_false_until_the_config_row_says_true():
    from gen.config.v1 import config_pb2 as cpb

    from app.config.watcher import ConfigWatcher

    w = object.__new__(ConfigWatcher)
    w._snapshot = None
    assert w.get_bool("smoke.writes.enabled") is False
    w._snapshot = cpb.ConfigSnapshot()
    assert w.get_bool("smoke.writes.enabled") is False
    w._snapshot.values["smoke.writes.enabled"].bool_val = True
    assert w.get_bool("smoke.writes.enabled") is True
