"""Trigger client and CLI over real mTLS against the real (or a stubbed) smoke API."""

import asyncio
import json
import logging

import pytest
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Route

from app import main as service
from app import tls_server
from app.trigger import client as trigger_client
from app.trigger.__main__ import main
from tests._helpers import Counter, make_runner
from tests._trigger_helpers import git


def real_app():
    counter = Counter()
    runner = make_runner([counter.check])
    app = service.build_app(runner=runner, catalog=runner.catalog, deployed_sha="a1b2c3d")
    return tls_server.san_gate(app)


def lost_app():
    async def checks(request):
        return JSONResponse({"checks": [{"id": "c1", "check_hash": "a" * 64}]})

    async def start(request):
        return JSONResponse({"run_id": "r-9"}, 202)

    async def get(request):
        return JSONResponse({"error": "not_found"}, 404)

    return tls_server.san_gate(
        Starlette(
            routes=[
                Route("/checks", checks),
                Route("/runs", start, methods=["POST"]),
                Route("/runs/{run_id}", get),
            ]
        )
    )


def env_for(pki, leaf="xstockstrat-smoke-trigger"):
    return {"MTLS_CERT": pki[leaf]["cert"], "MTLS_KEY": pki[leaf]["key"], "MTLS_CA_CERT": pki["ca"]}


async def trigger(pki, base, *extra, mode="strict", env="homelab-staging", checks="c.count"):
    argv = ["--mode", mode, "--endpoint", base.removeprefix("https://"), "--env", env, *extra]
    if checks:
        argv += ["--checks", checks]
    return await asyncio.to_thread(main, argv, env_for(pki))


@pytest.fixture
def bare(tmp_path):
    path = tmp_path / "remote.git"
    git(tmp_path, "init", "-q", "--bare", str(path))
    return path


async def test_triggered_by_recorded(pki, serve_tls, bare, tmp_path):
    base = await serve_tls(real_app())
    rc = await trigger(pki, base, "--git-remote", str(bare), "--out", str(tmp_path / "w"))
    assert rc == 0
    (name,) = git(bare, "ls-tree", "-r", "--name-only", "smoke-results").split()
    assert name.startswith("smoke-results/homelab-staging/")
    stored = json.loads(git(bare, "show", f"smoke-results:{name}"))
    assert stored["triggered_by"] == "xstockstrat-smoke-trigger"
    assert [r["outcome"] for r in stored["records"]] == ["PASS"]


async def test_pending_checks_skip_recorded_pass(pki, serve_tls, bare, tmp_path, caplog):
    base = await serve_tls(real_app())
    args = ("--git-remote", str(bare))
    assert await trigger(pki, base, *args, "--out", str(tmp_path / "w1"), checks=None) == 0
    caplog.set_level(logging.INFO)
    assert await trigger(pki, base, *args, "--out", str(tmp_path / "w2"), checks=None) == 0
    assert len(git(bare, "ls-tree", "-r", "--name-only", "smoke-results").split()) == 1
    assert "nothing pending" in caplog.text


async def test_strict_exit_1_on_red_and_on_push_failure(pki, serve_tls, tmp_path, caplog):
    base = await serve_tls(real_app())
    missing = str(tmp_path / "missing.git")
    assert await trigger(pki, base, "--out", str(tmp_path / "ok")) == 0
    assert await trigger(pki, base, "--git-remote", missing, "--out", str(tmp_path / "w")) == 1
    assert "SMOKE_RECORD_FAILED" in caplog.text


async def test_strict_exit_1_on_red_result(pki, serve_tls, tmp_path):
    from app.catalog import Catalog, from_function
    from app.check_api import CheckFailure, check

    @check("c.red", feature="smoke-check-runtime", part="phase-1")
    async def run(ctx):
        raise CheckFailure("boom")

    runner = make_runner([from_function(run)])
    app = service.build_app(
        runner=runner, catalog=Catalog(runner.catalog.checks, []), deployed_sha="x"
    )
    base = await serve_tls(tls_server.san_gate(app))
    assert await trigger(pki, base, "--out", str(tmp_path / "s"), checks="c.red") == 1
    assert (
        await trigger(pki, base, "--out", str(tmp_path / "r"), mode="record-only", checks="c.red")
        == 0
    )


async def test_record_only_exit_0_logs_failure(pki, serve_tls, tmp_path, caplog):
    base = await serve_tls(real_app())
    missing = str(tmp_path / "missing.git")
    rc = await trigger(
        pki, base, "--git-remote", missing, "--out", str(tmp_path / "w"), mode="record-only"
    )
    assert rc == 0
    assert "SMOKE_RECORD_FAILED" in caplog.text


async def test_lost_run_logs_SMOKE_RUN_LOST_and_commits_nothing(
    pki, serve_tls, bare, tmp_path, caplog
):
    base = await serve_tls(lost_app())
    rc = await trigger(
        pki, base, "--git-remote", str(bare), "--out", str(tmp_path / "w"), mode="record-only",
        checks="c1",
    )  # fmt: skip
    assert rc == 0
    assert "SMOKE_RUN_LOST" in caplog.text
    assert git(bare, "branch", "--list", "smoke-results").strip() == ""
    assert not list((tmp_path / "w").glob("smoke-results/**/*.json"))
    rc = await trigger(pki, base, "--out", str(tmp_path / "s"), checks="c1")
    assert rc == 1  # strict: a lost run is not a pass


async def test_cert_name_mismatch_rejected(pki, serve_tls):
    hits = []

    async def anything(request):
        hits.append(1)
        return JSONResponse({})

    app = Starlette(routes=[Route("/checks", anything)])
    base = await serve_tls(tls_server.san_gate(app), leaf="xstockstrat-ledger")
    cli = trigger_client.Client(base.removeprefix("https://"), **_pems(pki))
    with pytest.raises(Exception, match="mismatch|CERTIFICATE_VERIFY_FAILED"):
        await asyncio.to_thread(cli.checks)
    assert hits == []


def _pems(pki, leaf="xstockstrat-smoke-trigger"):
    return {"cert_pem": pki[leaf]["cert"], "key_pem": pki[leaf]["key"], "ca_pem": pki["ca"]}


async def test_409_retries_after_retry_after(pki, serve_tls):
    calls = []

    async def start(request):
        calls.append(1)
        if len(calls) == 1:
            return JSONResponse({"error": "run_in_progress"}, 409, headers={"Retry-After": "7"})
        return JSONResponse({"run_id": "r1"}, 202)

    app = Starlette(routes=[Route("/runs", start, methods=["POST"])])
    base = await serve_tls(tls_server.san_gate(app))
    sleeps = []
    cli = trigger_client.Client(base.removeprefix("https://"), **_pems(pki), sleep=sleeps.append)
    assert await asyncio.to_thread(cli.start_run, ["c1"]) == "r1"
    assert sleeps == [7]
