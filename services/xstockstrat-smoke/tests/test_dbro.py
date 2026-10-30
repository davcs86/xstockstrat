import asyncio
import time

from app import main
from app.catalog import from_function
from app.check_api import check
from app.dbro import ReadOnlyDb
from tests._helpers import make_runner, wait_done
from tests.conftest import PIN, free_port, tls_client


@check("db.count", feature="f", part="p")
async def db_count(ctx):
    ctx.evidence("count", await ctx.db.fetchval("SELECT count(*) FROM config.config_values"))


@check("db.update", feature="f", part="p")
async def db_update(ctx):
    await ctx.db.fetch("UPDATE config.config_values SET value_data = 'x'")


@check("db.sleep", feature="f", part="p")
async def db_sleep(ctx):
    await ctx.db.fetch("SELECT pg_sleep(10)")


DB_CHECKS = [from_function(f) for f in (db_count, db_update, db_sleep)]


async def test_select_passes_update_errors_sqlstate_25006(pg_roles):
    db = ReadOnlyDb(pg_roles["ro"])
    await db.assert_read_only_role()
    assert db.degraded is None
    runner = make_runner(DB_CHECKS, db=db)
    run = await wait_done(runner, await runner.start(["db.count", "db.update"], triggered_by="a"))
    first, second = run["records"]
    assert (first["outcome"], first["evidence"]["count"]) == ("PASS", 2)
    assert second["outcome"] == "ERROR"
    assert second["evidence"]["sqlstate"] == "25006"
    await db.close()


async def test_statement_timeout_57014(pg_roles):
    db = ReadOnlyDb(pg_roles["ro"], statement_timeout_ms=2000)
    runner = make_runner(DB_CHECKS, db=db)
    t0 = time.monotonic()
    run = await wait_done(runner, await runner.start(["db.sleep"], triggered_by="a"))
    assert time.monotonic() - t0 < 5
    (rec,) = run["records"]
    assert (rec["outcome"], rec["evidence"]["sqlstate"]) == ("ERROR", "57014")
    await db.close()


async def test_superuser_role_is_degraded(local_pg):
    db = ReadOnlyDb(local_pg())
    await db.assert_read_only_role()
    assert "db role not read-only" in db.degraded
    assert "superuser" in db.degraded


async def test_unreachable_db_is_degraded_not_fatal(tmp_path):
    db = ReadOnlyDb(f"postgresql:///postgres?host={tmp_path}&user=nobody")
    await db.assert_read_only_role()
    assert db.degraded.startswith("db unavailable")


async def test_non_readonly_role_degrades_to_check_error_and_still_binds(pg_roles, pki):
    class FakeWatcher:
        def __init__(self, endpoint, namespace):
            pass

        async def wait_for_snapshot(self, timeout_seconds):
            raise RuntimeError("no config")

        def get_str(self, key, default=""):
            return default

    leaf = pki["xstockstrat-smoke"]
    port = free_port()
    environ = {
        "SMOKE_GIT_SHA": "a1b2c3d",
        "SMOKE_ENV": "homelab-staging",
        "MTLS_CERT": leaf["cert"],
        "MTLS_KEY": leaf["key"],
        "MTLS_CA_CERT": pki["ca"],
        "DATABASE_URL": pg_roles["rw"],
    }
    catalog_checks = [from_function(db_count)]
    from app.catalog import Catalog

    catalog = Catalog(checks={c.id: c for c in catalog_checks}, load_errors=[])
    task = asyncio.create_task(
        main.serve(
            environ, host="127.0.0.1", port=port, watcher_factory=FakeWatcher, catalog=catalog
        )
    )
    base = f"https://127.0.0.1:{port}"
    try:
        async with tls_client(pki, "xstockstrat-agent") as c:
            async with asyncio.timeout(15):
                while True:
                    try:
                        r = await c.get(f"{base}/checks", extensions=PIN)
                        break
                    except Exception:
                        if task.done():
                            task.result()
                        await asyncio.sleep(0.05)
            assert r.status_code == 200
            r = await c.post(f"{base}/runs", json={"checks": ["db.count"]}, extensions=PIN)
            run_id = r.json()["run_id"]
            async with asyncio.timeout(10):
                while (body := (await c.get(f"{base}/runs/{run_id}", extensions=PIN)).json())[
                    "status"
                ] != "done":
                    await asyncio.sleep(0.05)
        (rec,) = body["records"]
        assert rec["outcome"] == "ERROR"
        assert "db role not read-only" in rec["evidence"]["error"]
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
