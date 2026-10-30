import asyncio
import json
import threading
import time

import httpx
import pytest

from app import main, watchdog
from app.catalog import from_function
from app.check_api import CheckFailure, check
from app.evidence import EVIDENCE_CAP_BYTES, sanitize
from app.runner import RunInProgress
from tests._helpers import make_runner, wait_done, with_peer
from tests.conftest import SERVICE_ROOT

SCHEMA = json.loads((SERVICE_ROOT / "schema" / "run-file.v1.json").read_text())


@check("c.pass", feature="f", part="p")
async def c_pass(ctx):
    ctx.evidence("rows", 3)


@check("c.fail", feature="f", part="p")
async def c_fail(ctx):
    raise CheckFailure("expected 3 rows, got 2")


@check("c.hang", feature="f", part="p", timeout_s=1)
async def c_hang(ctx):
    await asyncio.sleep(5)


@check("c.slow", feature="f", part="p", timeout_s=5)
async def c_slow(ctx):
    await asyncio.sleep(5)


@check("c.boom", feature="f", part="p")
async def c_boom(ctx):
    raise RuntimeError("password=hunter2 Bearer abc.def.ghi")


@check("c.leaky", feature="f", part="p")
async def c_leaky(ctx):
    ctx.evidence("api_token", "abc123")
    ctx.evidence("blob", "x" * 10000)


CHECKS = [from_function(f) for f in (c_pass, c_fail, c_hang, c_slow, c_boom, c_leaky)]


def assert_run_file(body):
    for field in SCHEMA["required"]:
        assert field in body, field
    assert body["schema_version"] == 1
    for rec in body["records"]:
        for field in SCHEMA["$defs"]["record"]["required"]:
            assert field in rec, field
        assert rec["outcome"] in ("PASS", "FAIL", "ERROR", "TIMEOUT")
        assert all(
            isinstance(v, str | int | float | bool | type(None)) for v in rec["evidence"].values()
        )


async def test_outcomes_pass_fail_timeout():
    runner = make_runner(CHECKS)
    run_id = await runner.start(["c.pass", "c.fail", "c.hang"], triggered_by="xstockstrat-agent")
    run = await wait_done(runner, run_id)
    assert [r["outcome"] for r in run["records"]] == ["PASS", "FAIL", "TIMEOUT"]
    assert "expected 3 rows, got 2" in run["records"][1]["evidence"]["failure"]
    assert run["records"][0]["evidence"] == {"rows": 3}
    body = run["file"]["body"]
    assert_run_file(body)
    assert body["records"] == run["records"]
    assert body["run_id"] == run_id
    assert body["triggered_by"] == "xstockstrat-agent"
    assert body["deployed_sha"] == "a1b2c3d"
    assert body["env"] == "homelab-staging"
    stamp = body["started_at"][:19].replace("-", "").replace(":", "")
    assert run["file"]["path"] == f"smoke-results/homelab-staging/{stamp}Z-{run_id}.json"


async def test_error_message_is_redacted():
    runner = make_runner(CHECKS)
    run = await wait_done(runner, await runner.start(["c.boom"], triggered_by="a"))
    (rec,) = run["records"]
    assert rec["outcome"] == "ERROR"
    assert rec["evidence"]["error"].startswith("RuntimeError")
    assert "hunter2" not in rec["evidence"]["error"]
    assert "abc.def.ghi" not in rec["evidence"]["error"]


async def test_second_run_409_with_retry_after():
    runner = make_runner(CHECKS)
    app = with_peer(main.build_app(runner=runner, catalog=runner.catalog, deployed_sha="a1b2c3d"))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://t") as c:
        r1 = await c.post("/runs", json={"checks": ["c.hang"]})
        assert r1.status_code == 202
        r2 = await c.post("/runs", json={"checks": ["c.pass"]})
        assert r2.status_code == 409
        body = r2.json()
        assert body["error"] == "run_in_progress"
        assert 0 < body["retry_after_s"] <= 900
        assert r2.headers["Retry-After"] == str(body["retry_after_s"])
        assert set(body) == {"error", "retry_after_s"}
        run = await wait_done(runner, r1.json()["run_id"])
        assert [r["outcome"] for r in run["records"]] == ["TIMEOUT"]


async def test_runs_api_validation():
    runner = make_runner(CHECKS)
    app = with_peer(main.build_app(runner=runner, catalog=runner.catalog, deployed_sha="a1b2c3d"))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://t") as c:
        assert (await c.post("/runs", json={"checks": []})).status_code == 400
        assert (await c.post("/runs", content=b"nope")).status_code == 400
        assert (await c.post("/runs", json={"checks": "c.pass"})).status_code == 400
        r = await c.post("/runs", json={"checks": ["c.pass", "nope", "zz"]})
        assert r.status_code == 404
        assert r.json()["unknown"] == ["nope", "zz"]
        r = await c.post("/runs", json={"checks": ["c.pass"]})
        run_id = r.json()["run_id"]
        await wait_done(runner, run_id)
        r = await c.get(f"/runs/{run_id}")
        assert r.json()["status"] == "done"


async def test_lost_run_404():
    runner = make_runner(CHECKS)
    app = with_peer(main.build_app(runner=runner, catalog=runner.catalog, deployed_sha="a1b2c3d"))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://t") as c:
        assert (await c.get("/runs/r-9")).status_code == 404


async def test_hold_timeout_releases_lock():
    runner = make_runner(CHECKS, hold_s=0.5)
    run_id = await runner.start(["c.slow", "c.slow", "c.pass"], triggered_by="a")
    run = await wait_done(runner, run_id)
    assert [r["outcome"] for r in run["records"]] == ["TIMEOUT"] * 3
    assert all(r["evidence"]["error"] == "run hold exceeded" for r in run["records"])
    assert await runner.start(["c.pass"], triggered_by="a")


async def test_lock_released_even_if_check_ignores_cancellation():
    @check("c.stubborn", feature="f", part="p", timeout_s=1)
    async def stubborn(ctx):
        for _ in range(50):
            try:
                await asyncio.sleep(0.1)
            except asyncio.CancelledError:
                pass

    runner = make_runner([from_function(stubborn), *CHECKS], hold_s=0.3)
    await runner.start(["c.stubborn"], triggered_by="a")
    with pytest.raises(RunInProgress) as e:
        await runner.start(["c.pass"], triggered_by="a")
    assert 1 <= e.value.retry_after_s <= 1
    await asyncio.sleep(0.4)
    assert await runner.start(["c.pass"], triggered_by="a")


async def test_buffer_keeps_last_50_runs():
    runner = make_runner(CHECKS)
    ids = []
    for _ in range(52):
        ids.append(await runner.start(["c.pass"], triggered_by="a"))
        await wait_done(runner, ids[-1])
    assert runner.get(ids[0]) is None and runner.get(ids[1]) is None
    assert runner.get(ids[2]) is not None


async def test_evidence_redaction_and_cap():
    runner = make_runner(CHECKS)
    run = await wait_done(runner, await runner.start(["c.leaky"], triggered_by="a"))
    ev = run["records"][0]["evidence"]
    assert ev["api_token"] == "[redacted]"
    assert len(json.dumps(ev).encode()) <= EVIDENCE_CAP_BYTES == 4096


def test_sanitize_patterns_and_flattening():
    ev = sanitize(
        {
            "note": "-----BEGIN PRIVATE KEY-----\nMIIabc\n-----END PRIVATE KEY-----",
            "dsn": "postgres://smoke:s3cret@db:25060/x",
            "auth_header": "x",
            "jwt": "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig",
            "nested": {"a": 1},
            "n": 1.5,
            "ok": True,
            "none": None,
        }
    )
    assert "MIIabc" not in ev["note"] and "[redacted]" in ev["note"]
    assert "s3cret" not in ev["dsn"]
    assert ev["auth_header"] == "[redacted]"
    assert ev["jwt"] == "[redacted]"
    assert isinstance(ev["nested"], str)
    assert (ev["n"], ev["ok"], ev["none"]) == (1.5, True, None)


def test_sanitize_many_keys_stays_under_cap():
    ev = sanitize({f"k{i}": "v" * 400 for i in range(100)})
    assert len(json.dumps(ev).encode()) <= EVIDENCE_CAP_BYTES
    assert ev.get("_truncated") is True


def _fire(mode, on_stall=None):
    codes, fired = [], threading.Event()
    hb = watchdog.Heartbeat()
    hb.last = time.monotonic() - 100

    def fake_exit(code):
        codes.append(code)
        fired.set()

    handle = watchdog.start(
        hb, mode=mode, stall_s=0.1, poll_s=0.02, on_stall=on_stall, exit=fake_exit
    )
    assert fired.wait(5)
    handle.stop()
    return codes


async def test_watchdog_exits_70_strict_and_error_file_record_only(tmp_path):
    assert _fire("strict") == [70]

    runner = make_runner(CHECKS)
    run_id = await runner.start(["c.pass", "c.hang", "c.pass"], triggered_by="a")
    await asyncio.sleep(0.2)
    codes = _fire("record-only", on_stall=lambda: runner.write_stall_file(tmp_path))
    assert codes == [0]
    (path,) = list(tmp_path.rglob("*.json"))
    assert path.name.endswith(f"-{run_id}.json")
    assert path.parent.name == "homelab-staging"
    body = json.loads(path.read_text())
    assert_run_file(body)
    assert [r["outcome"] for r in body["records"]] == ["PASS", "ERROR", "ERROR"]
    assert body["records"][1]["evidence"]["error"] == "event loop stalled"


def test_watchdog_quiet_while_heartbeat_fresh():
    hb = watchdog.Heartbeat()
    codes = []
    handle = watchdog.start(hb, mode="strict", stall_s=0.5, poll_s=0.02, exit=codes.append)
    time.sleep(0.2)
    handle.stop()
    assert codes == []


async def test_heartbeat_pump_beats():
    hb = watchdog.Heartbeat()
    hb.last = 0
    task = asyncio.create_task(hb.pump(interval=0.01))
    await asyncio.sleep(0.05)
    task.cancel()
    assert time.monotonic() - hb.last < 1


async def test_record_build_failure_yields_error_record(monkeypatch):
    import app.runner as runner_mod

    calls = []

    def flaky_sanitize(evidence):
        calls.append(1)
        if len(calls) == 1:
            raise ValueError("boom")
        return sanitize(evidence)

    monkeypatch.setattr(runner_mod, "sanitize", flaky_sanitize)
    runner = make_runner(CHECKS)
    run = await wait_done(runner, await runner.start(["c.pass", "c.pass"], triggered_by="a"))
    assert [r["outcome"] for r in run["records"]] == ["ERROR", "PASS"]
    assert run["records"][0]["evidence"] == {"error": "record build failed: ValueError"}
    assert_run_file(run["file"]["body"])
    task = next(iter(runner._runs.values())).task
    assert task.done() and task.exception() is None
