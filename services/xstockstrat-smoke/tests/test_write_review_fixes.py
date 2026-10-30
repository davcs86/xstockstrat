"""Regressions for the Task-10 review: request-type confusion, unknown fields, map values, name
prefix, bounded cleanup grace, cleanup deadline validation, audit on a record-build failure, and the
kill switch turned off mid-check."""

import asyncio

import pytest
from gen.common.v1 import common_pb2
from gen.portfolio.v1 import portfolio_pb2 as pb
from google.protobuf import descriptor_pb2, descriptor_pool, message_factory

from app import policy, runner
from app.catalog import from_function
from app.check_api import CLEANUP_DEADLINE_S, CheckContext, check
from app.trigger import client as trigger_client
from tests._helpers import wait_done
from tests._write_helpers import CREATE, DELETE, UPDATE, FakePortfolio, write_runner

WRITES = policy.WritePolicy(enabled=True, env="do-dev")
POOL = descriptor_pool.Default()


def _decide(method, request):
    return policy.decide(method, descriptors=POOL, writes=WRITES, request=request)


def test_wrong_request_type_is_refused():
    d = _decide(CREATE, pb.Watchlist(name="x", symbols=["strat-123"]))
    assert not d.allowed and "request type" in d.reason
    d = _decide(DELETE, pb.CreateWatchlistRequest(name="smoke-x"))
    assert not d.allowed and "request type" in d.reason


def test_wrong_request_type_refused_for_reads_too():
    d = policy.decide(
        "xstockstrat.portfolio.v1.PortfolioService/GetWatchlist",
        descriptors=POOL,
        request=pb.DeleteWatchlistRequest(watchlist_id="w"),
    )
    assert not d.allowed and "request type" in d.reason


def test_unknown_fields_are_refused_at_any_depth():
    smuggled = pb.Watchlist(name="smoke-x", default_strategy_id="s-1").SerializeToString()
    top = pb.CreateWatchlistRequest.FromString(smuggled)
    top.ClearField("default_strategy_id")
    top.ClearField("symbols")
    top.name = "smoke-x"
    top.MergeFromString(b"\xa8\x06\x01")  # field 101 varint: unknown to CreateWatchlistRequest
    d = _decide(CREATE, top)
    assert not d.allowed and "unknown fields" in d.reason

    nested = pb.CreateWatchlistRequest(name="smoke-x")
    nested.bindings.add(symbol="AAPL").MergeFromString(b"\xa8\x06\x01")
    d = _decide(CREATE, nested)
    assert not d.allowed and "unknown fields" in d.reason


def _map_pool():
    f = descriptor_pb2.FileDescriptorProto(
        name="synth/mapwrite.proto", package="xstockstrat.synthmap.v1", syntax="proto3"
    )
    b = f.message_type.add(name="Binding")
    b.field.add(name="strategy_id", number=1, type=descriptor_pb2.FieldDescriptorProto.TYPE_STRING)
    req = f.message_type.add(name="Req")
    entry = req.nested_type.add(name="ByNameEntry")
    entry.options.map_entry = True
    entry.field.add(name="key", number=1, type=descriptor_pb2.FieldDescriptorProto.TYPE_STRING)
    entry.field.add(
        name="value",
        number=2,
        type=descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE,
        type_name=".xstockstrat.synthmap.v1.Binding",
    )
    req.field.add(
        name="by_name",
        number=1,
        label=descriptor_pb2.FieldDescriptorProto.LABEL_REPEATED,
        type=descriptor_pb2.FieldDescriptorProto.TYPE_MESSAGE,
        type_name=".xstockstrat.synthmap.v1.Req.ByNameEntry",
    )
    f.message_type.add(name="Resp")
    f.service.add(name="SynthService").method.add(
        name="Write",
        input_type=".xstockstrat.synthmap.v1.Req",
        output_type=".xstockstrat.synthmap.v1.Resp",
    )
    pool = descriptor_pool.DescriptorPool()
    pool.AddSerializedFile(f.SerializeToString())
    return pool


def test_predicate_covers_map_valued_message_fields():
    pool = _map_pool()
    method = "xstockstrat.synthmap.v1.SynthService/Write"
    writes = policy.WritePolicy(
        enabled=True,
        env="do-dev",
        allowlist={method: policy.ScopedWrite(policy.no_strategy_bindings)},
    )
    Req = message_factory.GetMessageClass(pool.FindMessageTypeByName("xstockstrat.synthmap.v1.Req"))
    bound = Req()
    bound.by_name["a"].strategy_id = "s-1"
    d = policy.decide(method, descriptors=pool, writes=writes, request=bound)
    assert not d.allowed and "strategy_id" in d.reason
    clean = Req()
    clean.by_name["a"].strategy_id = ""
    assert policy.decide(method, descriptors=pool, writes=writes, request=clean).allowed


@pytest.mark.parametrize(
    "method,request_",
    [
        (CREATE, pb.CreateWatchlistRequest(name="my-list")),
        (UPDATE, pb.UpdateWatchlistRequest(watchlist_id="w", name="renamed")),
    ],
)
def test_create_and_update_names_must_carry_the_fixture_prefix(method, request_):
    d = _decide(method, request_)
    assert not d.allowed and "smoke-" in d.reason


def test_update_without_a_name_and_prefixed_names_are_allowed():
    assert _decide(UPDATE, pb.UpdateWatchlistRequest(watchlist_id="w", description="d")).allowed
    assert _decide(CREATE, pb.CreateWatchlistRequest(name="smoke-r1-wl")).allowed


def test_page_request_nested_message_is_not_a_false_positive():
    req = pb.ListWatchlistsRequest(page=common_pb2.PageRequest(page_size=5))
    d = policy.decide(
        "xstockstrat.portfolio.v1.PortfolioService/ListWatchlists", descriptors=POOL, request=req
    )
    assert d.allowed


@pytest.mark.parametrize("bad", [0, -1, float("nan"), "5", True, None])
def test_on_cleanup_rejects_invalid_deadlines(bad):
    ctx = CheckContext(db=None, rpc=None, run_id="r")

    async def fn():
        pass

    with pytest.raises(ValueError):
        ctx.on_cleanup(fn, deadline_s=bad)


def test_on_cleanup_caps_the_deadline():
    ctx = CheckContext(db=None, rpc=None, run_id="r")

    async def fn():
        pass

    ctx.on_cleanup(fn, deadline_s=10_000)
    assert ctx.cleanups == [(fn, CLEANUP_DEADLINE_S)]


async def test_cleanup_grace_holds_the_lock_but_never_funds_a_later_body():
    gate = asyncio.Event()

    @check("g.first", feature="f", part="phase-2")
    async def first(ctx):
        async def wait():
            await gate.wait()

        ctx.on_cleanup(wait)

    @check("g.second", feature="f", part="phase-2", timeout_s=30)
    async def second(ctx):
        await asyncio.sleep(5)

    r = write_runner([from_function(first), from_function(second)], FakePortfolio())
    r._hold_s = 0.5
    run_id = await r.start(["g.first", "g.second"], triggered_by="xstockstrat-agent")
    await asyncio.sleep(0.8)
    with pytest.raises(runner.RunInProgress) as e:
        await r.start(["g.first"], triggered_by="xstockstrat-agent")
    assert e.value.retry_after_s <= runner.RUN_LOCK_HOLD_S + runner.CLEANUP_GRACE_MAX_S
    gate.set()
    recs = (await wait_done(r, run_id))["records"]
    assert recs[1]["outcome"] == "TIMEOUT" and recs[1]["evidence"]["error"] == "run hold exceeded"
    assert recs[1]["duration_ms"] < 500


async def test_cleanup_grace_is_bounded_per_run(monkeypatch):
    monkeypatch.setattr(runner, "CLEANUP_GRACE_MAX_S", 0.3)

    @check("g.slow", feature="f", part="phase-2")
    async def slow(ctx):
        async def stuck():
            await asyncio.sleep(5)

        ctx.on_cleanup(stuck)

    r = write_runner([from_function(slow)], FakePortfolio())
    r._hold_s = 0.1
    loop = asyncio.get_running_loop()
    t0 = loop.time()
    run_id = await r.start(["g.slow"], triggered_by="xstockstrat-agent")
    (rec,) = (await wait_done(r, run_id))["records"]
    assert rec["cleanup"] == "FAILED" and loop.time() - t0 < 2


def test_trigger_waits_for_hold_plus_grace():
    assert trigger_client.CLEANUP_GRACE_MAX_S == runner.CLEANUP_GRACE_MAX_S
    assert trigger_client.RUN_WAIT_S == runner.RUN_LOCK_HOLD_S + runner.CLEANUP_GRACE_MAX_S


async def test_record_build_failure_keeps_the_write_audit(monkeypatch):
    real = runner.sanitize
    calls = []

    def flaky(evidence):
        calls.append(1)
        if len(calls) == 1:
            raise ValueError("boom")
        return real(evidence)

    monkeypatch.setattr(runner, "sanitize", flaky)

    @check("a.write", feature="f", part="phase-2")
    async def run(ctx):
        await ctx.rpc.call(CREATE, pb.CreateWatchlistRequest(name=ctx.fixture("wl")))

    r = write_runner([from_function(run)], FakePortfolio())
    (rec,) = (await wait_done(r, await r.start(["a.write"], triggered_by="a")))["records"]
    assert rec["outcome"] == "ERROR" and "record build failed" in rec["evidence"]["error"]
    assert rec["writes_performed"] == [CREATE] and rec["rpcs_invoked"] == [CREATE]


async def test_flag_off_mid_check_fails_cleanup_and_leaves_the_fixture():
    state = {"on": True}

    @check("k.off", feature="f", part="phase-2")
    async def run(ctx):
        resp = await ctx.rpc.call(CREATE, pb.CreateWatchlistRequest(name=ctx.fixture("wl")))
        wid = resp.watchlist.watchlist_id

        async def delete():
            await ctx.rpc.call(DELETE, pb.DeleteWatchlistRequest(watchlist_id=wid))

        ctx.on_cleanup(delete)
        state["on"] = False

    backend = FakePortfolio()
    r = write_runner([from_function(run)], backend, enabled=lambda: state["on"])
    run_id = await r.start(["k.off"], triggered_by="a")
    (rec,) = (await wait_done(r, run_id))["records"]
    assert rec["outcome"] == "ERROR" and rec["cleanup"] == "FAILED"
    assert rec["evidence"]["original_outcome"] == "PASS"
    assert "MutatingRpcRefused" in rec["evidence"]["cleanup_error"]
    assert backend.names("u-smoke-1") == [f"smoke-{run_id}-wl"]
