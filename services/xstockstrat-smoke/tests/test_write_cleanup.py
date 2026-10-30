"""Phase-2 fixtures, cleanups and the janitor (AC-21, AC-22, AC-23), and the v2 run file across the
runner and the trigger."""

import asyncio
import json

import jsonschema
import pytest
from gen.portfolio.v1 import portfolio_pb2 as pb

from app import fixtures
from app.catalog import from_function
from app.check_api import CheckFailure, check
from app.trigger import pending, record
from tests import _trigger_helpers as th
from tests._helpers import wait_done
from tests._write_helpers import CREATE, DELETE, LIST, FakePortfolio, write_runner
from tests.conftest import SERVICE_ROOT

V1 = json.loads((SERVICE_ROOT / "schema" / "run-file.v1.json").read_text())
V2 = json.loads((SERVICE_ROOT / "schema" / "run-file.v2.json").read_text())


async def _create_with_cleanup(ctx, hint="wl"):
    resp = await ctx.rpc.call(CREATE, pb.CreateWatchlistRequest(name=ctx.fixture(hint)))
    wid = resp.watchlist.watchlist_id

    async def delete():
        await ctx.rpc.call(DELETE, pb.DeleteWatchlistRequest(watchlist_id=wid))

    ctx.on_cleanup(delete)
    return wid


async def _run(checks, backend, **kw):
    runner = write_runner(checks, backend, **kw)
    run_id = await runner.start([c.id for c in checks], triggered_by="xstockstrat-agent")
    done = await wait_done(runner, run_id)
    return run_id, done["records"], done["file"]["body"]


async def test_cleanup_runs_after_timeout():
    @check("w.timeout", feature="f", part="phase-2", timeout_s=1)
    async def run(ctx):
        await _create_with_cleanup(ctx)
        await asyncio.sleep(5)

    backend = FakePortfolio()
    _, (rec,), _ = await _run([from_function(run)], backend)
    assert rec["outcome"] == "TIMEOUT"
    assert rec["cleanup"] == "OK"
    assert backend.names("u-smoke-1") == []
    assert rec["writes_performed"] == [CREATE, DELETE]


@pytest.mark.parametrize("ending", ["pass", "fail", "error"])
async def test_cleanup_runs_after_every_outcome(ending):
    @check("w.end", feature="f", part="phase-2")
    async def run(ctx):
        await _create_with_cleanup(ctx)
        if ending == "fail":
            raise CheckFailure("nope")
        if ending == "error":
            raise RuntimeError("boom")

    backend = FakePortfolio()
    _, (rec,), _ = await _run([from_function(run)], backend)
    assert rec["outcome"] == {"pass": "PASS", "fail": "FAIL", "error": "ERROR"}[ending]
    assert rec["cleanup"] == "OK" and backend.names("u-smoke-1") == []


async def test_cleanup_runs_after_a_lost_hold():
    @check("w.hold", feature="f", part="phase-2", timeout_s=30)
    async def run(ctx):
        await _create_with_cleanup(ctx)
        await asyncio.sleep(5)

    backend = FakePortfolio()
    runner = write_runner([from_function(run)], backend)
    runner._hold_s = 1
    run_id = await runner.start(["w.hold"], triggered_by="xstockstrat-agent")
    (rec,) = (await wait_done(runner, run_id))["records"]
    assert rec["outcome"] == "TIMEOUT" and rec["evidence"]["error"] == "run hold exceeded"
    assert rec["cleanup"] == "OK" and backend.names("u-smoke-1") == []


async def test_failed_cleanup_is_error_and_keeps_original_evidence():
    @check("w.badclean", feature="f", part="phase-2")
    async def run(ctx):
        async def broken():
            raise RuntimeError("delete refused")

        ctx.on_cleanup(broken)
        raise CheckFailure("row missing")

    _, (rec,), _ = await _run([from_function(run)], FakePortfolio())
    assert rec["outcome"] == "ERROR"
    assert rec["cleanup"] == "FAILED"
    assert rec["evidence"]["failure"] == "row missing"
    assert rec["evidence"]["original_outcome"] == "FAIL"
    assert "delete refused" in rec["evidence"]["cleanup_error"]


async def test_cleanup_has_its_own_deadline_and_others_still_run():
    ran = []

    @check("w.slowclean", feature="f", part="phase-2")
    async def run(ctx):
        async def first():
            ran.append("first")

        async def stuck():
            await asyncio.sleep(5)

        ctx.on_cleanup(first)
        ctx.on_cleanup(stuck, deadline_s=0.2)

    _, (rec,), _ = await _run([from_function(run)], FakePortfolio())
    assert rec["outcome"] == "ERROR" and rec["cleanup"] == "FAILED"
    assert "TimeoutError" in rec["evidence"]["cleanup_error"]
    assert ran == ["first"]


async def test_cleanup_grace_extends_the_run_hold():
    gate = asyncio.Event()

    @check("w.grace", feature="f", part="phase-2")
    async def run(ctx):
        async def wait():
            await gate.wait()

        ctx.on_cleanup(wait)

    runner = write_runner([from_function(run)], FakePortfolio())
    runner._hold_s = 0.5
    run_id = await runner.start(["w.grace"], triggered_by="xstockstrat-agent")
    await asyncio.sleep(0.8)
    with pytest.raises(Exception, match="run in progress"):
        await runner.start(["w.grace"], triggered_by="xstockstrat-agent")
    gate.set()
    await wait_done(runner, run_id)


async def test_janitor_sweeps_leftovers_before_body():
    backend = FakePortfolio()
    backend.seed("u-smoke-1", "smoke-r0-wl")
    backend.seed("u-smoke-1", "my-real-list")
    backend.seed("u-other", "smoke-r0-theirs")
    seen = {}

    @check("w.jan", feature="f", part="phase-2", janitor=fixtures.sweep_watchlists)
    async def run(ctx):
        resp = await ctx.rpc.call(LIST, pb.ListWatchlistsRequest())
        seen["names"] = [w.name for w in resp.watchlists]

    _, (rec,), _ = await _run([from_function(run)], backend)
    assert rec["outcome"] == "PASS", rec
    assert seen["names"] == ["my-real-list"]
    assert backend.names("u-other") == ["smoke-r0-theirs"]
    assert rec["writes_performed"] == [DELETE]
    assert rec["evidence"]["janitor_swept"] == 1


async def test_janitor_failure_is_error_and_body_never_runs():
    ran = []

    async def bad_janitor(ctx):
        raise RuntimeError("list failed")

    @check("w.badjan", feature="f", part="phase-2", janitor=bad_janitor)
    async def run(ctx):
        ran.append(1)

    _, (rec,), _ = await _run([from_function(run)], FakePortfolio())
    assert rec["outcome"] == "ERROR" and "janitor" in rec["evidence"]["error"]
    assert ran == []


async def test_runner_emits_v2_run_file():
    @check("w.plain", feature="f", part="phase-1")
    async def run(ctx):
        ctx.evidence("ok", True)

    _, (rec,), body = await _run([from_function(run)], FakePortfolio())
    jsonschema.validate(body, V2)
    assert rec["cleanup"] == "NONE" and rec["writes_performed"] == []
    assert V1["properties"]["schema_version"] == {"const": 1}


def _v2_body(**kw):
    b = th.body(**kw)
    b["schema_version"] = 2
    for r in b["records"]:
        r.update(writes_performed=[], cleanup="NONE")
    return b


def test_trigger_validates_by_schema_version(tmp_path):
    record.write_run_file(tmp_path, th.body(run_id="v1run"))
    record.write_run_file(tmp_path, _v2_body(run_id="v2run"))
    v1_with_v2_fields_missing = _v2_body(run_id="bad")
    del v1_with_v2_fields_missing["records"][0]["cleanup"]
    with pytest.raises(jsonschema.ValidationError):
        record.write_run_file(tmp_path, v1_with_v2_fields_missing)
    with pytest.raises(ValueError, match="schema_version"):
        record.write_run_file(tmp_path, {**th.body(run_id="v9"), "schema_version": 9})


def test_pending_spans_v1_and_v2_files(tmp_path):
    record.write_run_file(tmp_path, th.body(run_id="a", records=[th.rec("c1")]))
    record.write_run_file(
        tmp_path,
        _v2_body(run_id="b", records=[th.rec("c2")], started_at="2026-10-30T04:00:00Z"),
    )
    catalog = [{"id": c, "check_hash": th.HASH_A} for c in ("c1", "c2", "c3")]
    assert pending.pending(catalog, pending.read_recorded(tmp_path), "homelab-staging") == ["c3"]


def test_fixture_name_and_reference_check_excluded_from_catalog():
    from app.catalog import load_catalog
    from app.check_api import CheckContext

    assert CheckContext(db=None, rpc=None, run_id="r1").fixture("wl") == "smoke-r1-wl"
    assert not any(cid.startswith("reference.") for cid in load_catalog().checks)
    assert not any(e.module.startswith("checks._reference") for e in load_catalog().load_errors)


async def test_reference_watchlist_roundtrip_passes_and_leaves_nothing():
    from checks._reference import watchlist_roundtrip

    backend = FakePortfolio()
    backend.seed("u-smoke-1", "smoke-old-wl")
    c = from_function(watchlist_roundtrip.run)
    _, (rec,), _ = await _run([c], backend)
    assert rec["outcome"] == "PASS", rec
    assert rec["cleanup"] == "OK"
    assert backend.names("u-smoke-1") == []
