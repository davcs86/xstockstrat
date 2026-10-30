"""xstockstrat-smoke entry point: the HTTP API and the fail-closed boot sequence."""

import asyncio
import functools
import importlib
import logging
import os
import sys
import tempfile

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from app import policy, tls_server, watchdog
from app.catalog import load_catalog
from app.dbro import ReadOnlyDb
from app.rpc import Rpc
from app.runner import RunInProgress, Runner, UnknownChecks

log = logging.getLogger("xstockstrat-smoke")

PORT = 9110
HOST = "0.0.0.0"
CONFIG_SNAPSHOT_TIMEOUT_S = 90
REQUIRED_ENV = ("SMOKE_GIT_SHA", "MTLS_CERT", "MTLS_KEY", "MTLS_CA_CERT")
MODE_BY_ENV = {"homelab-staging": "strict", "do-dev": "record-only"}
RPC_SERVICES = (
    "trading", "portfolio", "marketdata", "indicators", "ingest", "analysis", "ledger",
    "identity", "notify", "config",
)  # fmt: skip


class StartupError(RuntimeError):
    pass


def build_app(*, runner: Runner, catalog, deployed_sha: str) -> Starlette:
    async def list_checks(request: Request):
        return JSONResponse(
            {
                "deployed_sha": deployed_sha,
                "checks": [
                    {
                        "id": c.id,
                        "feature": c.feature,
                        "part": c.part,
                        "timeout_s": c.timeout_s,
                        "check_hash": c.check_hash,
                    }
                    for c in catalog.checks.values()
                ],
                "load_errors": [
                    {"module": e.module, "error": e.error} for e in catalog.load_errors
                ],
            }
        )

    async def start_run(request: Request):
        try:
            ids = (await request.json()).get("checks")
        except (ValueError, AttributeError):
            ids = None
        if not isinstance(ids, list) or not ids or not all(isinstance(i, str) for i in ids):
            return JSONResponse({"error": "checks must be a non-empty list of ids"}, 400)
        try:
            run_id = await runner.start(ids, triggered_by=request.scope["peer_san"])
        except UnknownChecks as e:
            return JSONResponse({"error": "unknown_checks", "unknown": e.unknown}, 404)
        except RunInProgress as e:
            return JSONResponse(
                {"error": "run_in_progress", "retry_after_s": e.retry_after_s},
                409,
                headers={"Retry-After": str(e.retry_after_s)},
            )
        return JSONResponse({"run_id": run_id}, 202)

    async def get_run(request: Request):
        run = runner.get(request.path_params["run_id"])
        if run is None:
            return JSONResponse({"error": "not_found"}, 404)
        return JSONResponse(run)

    return Starlette(
        routes=[
            Route("/checks", list_checks, methods=["GET"]),
            Route("/runs", start_run, methods=["POST"]),
            Route("/runs/{run_id}", get_run, methods=["GET"]),
        ]
    )


def read_env(environ) -> dict:
    for name in REQUIRED_ENV:
        if not environ.get(name):
            raise StartupError(f"{name} is unset; refusing to start (fail-closed)")
    if environ.get("SMOKE_ENV") not in MODE_BY_ENV:
        raise StartupError(f"SMOKE_ENV must be one of {sorted(MODE_BY_ENV)}")
    return {name: environ[name] for name in (*REQUIRED_ENV, "SMOKE_ENV")}


def load_descriptors():
    from google.protobuf import descriptor_pool

    for svc in RPC_SERVICES:
        importlib.import_module(f"gen.{svc}.v1.{svc}_pb2")
    return descriptor_pool.Default()


def grpc_channel(endpoint: str, target: str):
    import grpc

    from app import mtls

    return grpc.aio.secure_channel(
        endpoint, mtls.channel_credentials(), options=mtls.target_override(target)
    )


async def serve(environ, *, host=HOST, port=PORT, watcher_factory=None, catalog=None) -> None:
    env = read_env(environ)
    ssl_ctx = tls_server.build_ssl_context(env["MTLS_CERT"], env["MTLS_KEY"], env["MTLS_CA_CERT"])
    if watcher_factory is None:
        from app.config.watcher import ConfigWatcher as watcher_factory
    watcher = watcher_factory(environ.get("CONFIG_ENDPOINT", "xstockstrat-config:50060"), "smoke")
    try:
        await watcher.wait_for_snapshot(CONFIG_SNAPSHOT_TIMEOUT_S)
    except RuntimeError as e:
        log.error("SMOKE_CONFIG_DEGRADED: %s; RPC checks will ERROR until a snapshot arrives", e)
    db = ReadOnlyDb(environ.get("DATABASE_URL", ""))
    await db.assert_read_only_role()
    catalog = catalog or load_catalog()
    for err in catalog.load_errors:
        log.error("SMOKE_CHECK_LOAD_ERROR %s: %s", err.module, err.error)
    decide = functools.partial(policy.decide, descriptors=load_descriptors())
    endpoints = {
        svc: environ[f"{svc.upper()}_ENDPOINT"]
        for svc in RPC_SERVICES
        if environ.get(f"{svc.upper()}_ENDPOINT")
    }

    def rpc_factory(trace_id: str) -> Rpc:
        return Rpc(
            user_id=watcher.get_str("smoke.rpc.user_id"),
            trace_id=trace_id,
            endpoints=endpoints,
            channel_factory=grpc_channel,
            policy=decide,
        )

    runner = Runner(
        catalog=catalog,
        rpc_factory=rpc_factory,
        db=db,
        env=env["SMOKE_ENV"],
        deployed_sha=env["SMOKE_GIT_SHA"],
    )
    app = tls_server.san_gate(
        build_app(runner=runner, catalog=catalog, deployed_sha=env["SMOKE_GIT_SHA"])
    )
    server = tls_server.make_server(app, ssl_ctx, host=host, port=port)
    heartbeat = watchdog.Heartbeat()
    pump = asyncio.create_task(heartbeat.pump())
    guard = watchdog.start(
        heartbeat,
        mode=MODE_BY_ENV[env["SMOKE_ENV"]],
        on_stall=lambda: runner.write_stall_file(tempfile.gettempdir()),
    )
    try:
        await server.serve()
    finally:
        guard.stop()
        pump.cancel()
        await db.close()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    try:
        asyncio.run(serve(os.environ))
    except (StartupError, tls_server.SanHookMissing) as e:
        print(f"xstockstrat-smoke: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
