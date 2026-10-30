import asyncio

from app.catalog import Catalog, from_function
from app.check_api import check
from app.runner import Runner


class FakeRpc:
    def __init__(self, trace_id=""):
        self.trace_id = trace_id
        self.invoked: list[str] = []

    async def close(self):
        pass


class Counter:
    """A catalog with one check `c.count` that counts its executions."""

    def __init__(self):
        self.runs = 0

        @check("c.count", feature="smoke-check-runtime", part="phase-1")
        async def run(ctx):
            self.runs += 1

        self.check = from_function(run)


def make_runner(checks, *, db=None, rpc_factory=FakeRpc, **kw) -> Runner:
    return Runner(
        catalog=Catalog(checks={c.id: c for c in checks}, load_errors=[]),
        rpc_factory=rpc_factory,
        db=db,
        env="homelab-staging",
        deployed_sha="a1b2c3d",
        **kw,
    )


def with_peer(app, san="xstockstrat-agent"):
    """ASGI wrapper standing in for san_gate in tests that do not use real TLS."""

    async def wrapped(scope, receive, send):
        if scope["type"] == "http":
            scope = dict(scope, peer_san=san)
        await app(scope, receive, send)

    return wrapped


async def wait_done(runner, run_id, timeout=15.0):
    async with asyncio.timeout(timeout):
        while runner.get(run_id)["status"] != "done":
            await asyncio.sleep(0.02)
    return runner.get(run_id)
