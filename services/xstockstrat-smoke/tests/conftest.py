"""Shared fixtures: proto gen path, an openssl-minted platform PKI, a throwaway PostgreSQL and a
real mTLS uvicorn listener (the round-3 SAN spike, made reusable)."""

import asyncio
import glob
import os
import pathlib
import pwd
import shutil
import socket
import ssl
import subprocess
import sys
import tempfile
import types

import httpx
import pytest

SERVICE_ROOT = pathlib.Path(__file__).resolve().parents[1]
PROTO_GEN = (SERVICE_ROOT / "../../packages/proto/gen/python").resolve()
LEAVES = (
    "xstockstrat-smoke",
    "xstockstrat-agent",
    "xstockstrat-smoke-trigger",
    "xstockstrat-trading",
    "xstockstrat-ledger",
)


def _setup_gen_path() -> None:
    if not PROTO_GEN.exists():
        return
    if str(PROTO_GEN) not in sys.path:
        sys.path.insert(0, str(PROTO_GEN))
    if "gen" not in sys.modules:
        gen_mod = types.ModuleType("gen")
        gen_mod.__path__ = [str(PROTO_GEN)]
        gen_mod.__package__ = "gen"
        sys.modules["gen"] = gen_mod


_setup_gen_path()


def _sh(*args):
    subprocess.run(args, check=True, capture_output=True)


@pytest.fixture(scope="session")
def pki(tmp_path_factory):
    """A test CA plus one leaf per name (SAN DNS:<name>, serverAuth+clientAuth); yields
    {name: {"cert": pem, "key": pem, "cert_path", "key_path"}, "ca": pem, "ca_path": path}."""
    d = tmp_path_factory.mktemp("pki")
    _sh(
        "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
        "-keyout", f"{d}/ca.key", "-out", f"{d}/ca.pem", "-subj", "/CN=test-ca", "-days", "2",
        "-addext", "basicConstraints=critical,CA:TRUE",
        "-addext", "keyUsage=critical,keyCertSign,cRLSign",
    )  # fmt: skip
    out = {"ca": (d / "ca.pem").read_text(), "ca_path": str(d / "ca.pem")}
    for name in LEAVES:
        _sh(
            "openssl", "req", "-newkey", "rsa:2048", "-nodes", "-keyout", f"{d}/{name}.key",
            "-out", f"{d}/{name}.csr", "-subj", f"/CN={name}",
        )  # fmt: skip
        (d / f"{name}.ext").write_text(
            f"subjectAltName=DNS:{name}\nextendedKeyUsage=serverAuth,clientAuth\n"
        )
        _sh(
            "openssl", "x509", "-req", "-in", f"{d}/{name}.csr", "-CA", f"{d}/ca.pem",
            "-CAkey", f"{d}/ca.key", "-CAcreateserial", "-out", f"{d}/{name}.pem",
            "-days", "2", "-extfile", f"{d}/{name}.ext",
        )  # fmt: skip
        out[name] = {
            "cert": (d / f"{name}.pem").read_text(),
            "key": (d / f"{name}.key").read_text(),
            "cert_path": str(d / f"{name}.pem"),
            "key_path": str(d / f"{name}.key"),
        }
    return out


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def tls_client(pki, leaf: str | None) -> httpx.AsyncClient:
    """A client that verifies the platform CA, pins the server name xstockstrat-smoke (via the
    request's sni_hostname extension) and presents `leaf` (None = no client certificate)."""
    ctx = ssl.create_default_context(cafile=pki["ca_path"])
    ctx.check_hostname = True
    if leaf:
        ctx.load_cert_chain(pki[leaf]["cert_path"], pki[leaf]["key_path"])
    return httpx.AsyncClient(verify=ctx, trust_env=False, timeout=10)


PIN = {"sni_hostname": "xstockstrat-smoke"}


@pytest.fixture
async def serve_tls(pki):
    """Start `app` on a real mTLS listener with the given server leaf; yields a starter returning
    the base URL. Servers are stopped at teardown."""
    from app import tls_server

    started = []

    async def start(app, leaf="xstockstrat-smoke"):
        port = free_port()
        ctx = tls_server.build_ssl_context(pki[leaf]["cert"], pki[leaf]["key"], pki["ca"])
        server = tls_server.make_server(app, ctx, host="127.0.0.1", port=port)
        task = asyncio.create_task(server.serve())
        while not server.started:
            if task.done():
                task.result()
            await asyncio.sleep(0.02)
        started.append((server, task))
        return f"https://127.0.0.1:{port}"

    yield start
    for server, task in started:
        server.should_exit = True
        await task


_PG_HOMEBREW_GLOBS = ("/opt/homebrew/opt/postgresql@*/bin", "/usr/local/opt/postgresql@*/bin")


def _pg_version_key(bin_dir):
    digits = "".join(ch for ch in pathlib.Path(bin_dir).parent.name if ch.isdigit())
    return int(digits) if digits else 0


def _pg_bin_dir():
    """``$XSTOCKSTRAT_PG_BIN``, else ``pg_ctl`` on PATH, else the newest Debian/Homebrew install."""
    override = os.environ.get("XSTOCKSTRAT_PG_BIN")
    if override:
        return override
    on_path = shutil.which("pg_ctl")
    if on_path:
        return os.path.dirname(on_path)
    for pattern in ("/usr/lib/postgresql/*/bin", *_PG_HOMEBREW_GLOBS):
        found = [d for d in glob.glob(pattern) if os.path.exists(os.path.join(d, "initdb"))]
        if found:
            return max(found, key=_pg_version_key)
    return None


@pytest.fixture(scope="session")
def local_pg():
    """A throwaway PostgreSQL on a Unix socket for the session; yields a DSN builder
    ``dsn(user)``. Skips when it cannot start, except under ``CI=true``, where it fails instead."""

    def _unavailable(reason):
        if os.environ.get("CI") == "true":
            pytest.fail(f"local_pg: {reason}")
        pytest.skip(f"local_pg: {reason}")

    bin_dir = _pg_bin_dir()
    if bin_dir is None:
        _unavailable("no PostgreSQL binaries found (set XSTOCKSTRAT_PG_BIN)")
    # Under /tmp: the Unix-socket path must stay within the ~107-byte sun_path limit.
    root = tempfile.mkdtemp(dir="/tmp", prefix="xss-pg-")
    prefix = []
    if os.geteuid() == 0:  # initdb refuses to run as root
        try:
            pwd.getpwnam("postgres")
        except KeyError:
            shutil.rmtree(root, ignore_errors=True)
            _unavailable("running as root without a postgres user")
        shutil.chown(root, "postgres")
        prefix = ["runuser", "-u", "postgres", "--"]
    pgdata = os.path.join(root, "data")
    pg_ctl = os.path.join(bin_dir, "pg_ctl")

    def _run(*cmd):
        subprocess.run([*prefix, *cmd], check=True, capture_output=True, timeout=120)

    try:
        _run(
            os.path.join(bin_dir, "initdb"), "-D", pgdata, "-U", "postgres", "-A", "trust",
            "--no-sync",
        )  # fmt: skip
        _run(
            pg_ctl, "-D", pgdata, "-l", os.path.join(root, "postgres.log"), "-w", "start",
            "-o", f"-c fsync=off -c listen_addresses='' -k {root}",
        )  # fmt: skip
    except (OSError, subprocess.SubprocessError) as e:
        stderr = getattr(e, "stderr", b"") or b""
        shutil.rmtree(root, ignore_errors=True)
        _unavailable(f"PostgreSQL did not start ({e}): {stderr.decode(errors='replace')[-500:]}")
    try:
        yield lambda user="postgres": f"postgresql:///postgres?host={root}&user={user}"
    finally:
        subprocess.run(
            [*prefix, pg_ctl, "-D", pgdata, "-m", "immediate", "stop"],
            capture_output=True,
            timeout=60,
        )
        shutil.rmtree(root, ignore_errors=True)


@pytest.fixture(scope="session")
def pg_roles(local_pg):
    """`smoke_ro` (read-only role, as the DBA provisions it) and `smoke_rw` (has INSERT)."""
    import asyncpg

    async def setup():
        con = await asyncpg.connect(local_pg())
        try:
            await con.execute(
                """
                CREATE SCHEMA config;
                CREATE TABLE config.config_values (key text, value_data text);
                INSERT INTO config.config_values VALUES ('a', '1'), ('b', '2');
                CREATE ROLE smoke_ro LOGIN;
                ALTER ROLE smoke_ro SET default_transaction_read_only = on;
                GRANT USAGE ON SCHEMA config TO smoke_ro;
                GRANT SELECT ON config.config_values TO smoke_ro;
                CREATE ROLE smoke_rw LOGIN;
                GRANT USAGE ON SCHEMA config TO smoke_rw;
                GRANT SELECT, INSERT ON config.config_values TO smoke_rw;
                """
            )
        finally:
            await con.close()

    asyncio.run(setup())
    return {"ro": local_pg("smoke_ro"), "rw": local_pg("smoke_rw")}
