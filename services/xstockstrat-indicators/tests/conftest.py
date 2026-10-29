"""
pytest conftest: add the shared proto stubs to sys.path so that
`from gen.xxx.v1 import ...` works in tests without a running container.

The proto stubs live at ../../packages/proto/gen/python relative to the
service root, mirroring the Dockerfile's `ln -s /proto/gen/python /app/gen`.
"""

import datetime
import pathlib
import re
import sys
import types
from unittest.mock import AsyncMock, MagicMock

import grpc
import pytest

OWNER_HEADERS = [("x-user-id", "user-a"), ("x-access-scope", "1"), ("x-trace-id", "t-1")]
OTHER_HEADERS = [("x-user-id", "user-b"), ("x-access-scope", "1"), ("x-trace-id", "t-1")]


def ctx_with(metadata, peer_sans=()):
    """A grpc.aio servicer context replaying ``metadata``; ``peer_sans`` are the mTLS peer's SAN
    entries (empty = no verified peer identity). ``abort`` raises."""
    ctx = MagicMock()
    ctx.invocation_metadata = MagicMock(return_value=list(metadata))
    ctx.peer_identity_key = MagicMock(
        return_value="x509_subject_alternative_name" if peer_sans else None
    )
    ctx.peer_identities = MagicMock(
        return_value=[s.encode() for s in peer_sans] if peer_sans else None
    )
    ctx.abort = AsyncMock(side_effect=grpc.RpcError("aborted"))
    return ctx


# Users-file entries in the `manage-users.py list-users --json` shape (feature 276).
USERS = [
    {"user_id": uid, "email_local": local, "is_active": active}
    for uid, local, active in (
        ("80880990-2b79-4d85-8761-d8d9102c2efb", "davcs86", True),
        ("11111111-1111-4111-8111-111111111111", "alice", True),
        ("22222222-2222-4222-8222-222222222222", "bob", True),
        ("33333333-3333-4333-8333-333333333333", "carol", True),
        ("44444444-4444-4444-8444-444444444444", "sam", True),
        ("55555555-5555-4555-8555-555555555555", "sam", True),
        ("66666666-6666-4666-8666-666666666666", "olduser", False),
    )
]

_FIXED_UPDATED_AT = datetime.datetime(2026, 10, 1, 12, 0, tzinfo=datetime.UTC)


def make_formula_row(formula_id, author, *, deleted=False, **fields):
    """An `indicators.formulas` row as asyncpg would return it (formula_id as str)."""
    row = {
        "formula_id": formula_id,
        "name": f"formula-{formula_id[:8]}",
        "source": "result = close",
        "description": "",
        "author": author,
        "is_public": False,
        "input_schema": "{}",
        "pending_intent_id": None,
        "updated_at": _FIXED_UPDATED_AT,
        "deleted_at": _FIXED_UPDATED_AT if deleted else None,
    }
    row.update(fields)
    return row


class FakeFormulasTable:
    """asyncpg-connection stand-in for `app.maintenance.legacy_authors`. It evaluates every
    predicate of DETECT_SQL / CLEAN_COUNT_SQL / REWRITE_SQL and raises on any other statement."""

    def __init__(self, rows=()):
        self.rows = {r["formula_id"]: dict(r) for r in rows}
        self.execute_log: list[tuple[str, tuple]] = []

    def mutate(self, formula_id, **fields):
        """Out-of-band row change (or insert) standing in for a concurrent writer."""
        if formula_id in self.rows:
            self.rows[formula_id].update(fields)
        else:
            self.rows[formula_id] = make_formula_row(formula_id, **fields)

    def update_count(self) -> int:
        return sum(1 for sql, _ in self.execute_log if sql.lstrip().upper().startswith("UPDATE"))

    @staticmethod
    def _uuid_match(pattern, author) -> bool:
        return re.search(pattern, author, re.IGNORECASE) is not None

    def _run(self, sql, args):
        from app.maintenance import legacy_authors as la

        self.execute_log.append((sql, args))
        if sql == la.DETECT_SQL:
            system, pattern = args
            return [
                dict(r)
                for _, r in sorted(self.rows.items())
                if r["author"] != system and not self._uuid_match(pattern, r["author"])
            ]
        if sql == la.CLEAN_COUNT_SQL:
            system, pattern = args
            n = sum(
                1
                for r in self.rows.values()
                if r["author"] == system or self._uuid_match(pattern, r["author"])
            )
            return [{"count": n}]
        if sql == la.REWRITE_SQL:
            new, formula_id, old, system, pattern = args
            r = self.rows.get(formula_id)
            if (
                r is None
                or r["author"] != old
                or r["author"] == system
                or self._uuid_match(pattern, r["author"])
            ):
                return []
            r["author"] = new
            return [{"formula_id": formula_id}]
        raise AssertionError(f"FakeFormulasTable: unrecognised SQL: {sql!r}")

    async def fetch(self, sql, *args):
        return self._run(sql, args)

    async def fetchrow(self, sql, *args):
        rows = self._run(sql, args)
        return rows[0] if rows else None

    async def fetchval(self, sql, *args):
        row = await self.fetchrow(sql, *args)
        return next(iter(row.values())) if row else None


def _setup_gen_path() -> None:
    """Register the proto gen directory as the 'gen' namespace package."""
    service_root = pathlib.Path(__file__).resolve().parents[1]
    proto_gen = (service_root / "../../packages/proto/gen/python").resolve()

    if not proto_gen.exists():
        return

    if str(proto_gen) not in sys.path:
        sys.path.insert(0, str(proto_gen))

    if "gen" not in sys.modules:
        gen_mod = types.ModuleType("gen")
        gen_mod.__path__ = [str(proto_gen)]
        gen_mod.__package__ = "gen"
        sys.modules["gen"] = gen_mod


# Run unconditionally at import time — conftest.py is imported before
# test modules are collected, so this executes early enough.
_setup_gen_path()


def snapshot_watcher(**values):
    """A dial-free ConfigWatcher; each value lands in the oneof member matching its Python type."""
    from gen.config.v1 import config_pb2

    from app.config.watcher import ConfigWatcher

    # __new__ bypasses __init__'s channel + watch-task dial (fails-074: never a live watcher).
    w = ConfigWatcher.__new__(ConfigWatcher)
    snap = config_pb2.ConfigSnapshot()
    for key, val in values.items():
        # bool before int: bool is an int subclass.
        if isinstance(val, bool):
            snap.values[key].bool_val = val
        elif isinstance(val, int):
            snap.values[key].int_val = val
        elif isinstance(val, float):
            snap.values[key].float_val = val
        elif isinstance(val, str):
            snap.values[key].string_val = val
        else:
            raise TypeError(f"snapshot_watcher: unsupported value type for {key}: {type(val)!r}")
    w._snapshot = snap
    return w


@pytest.fixture
def otel_reset(monkeypatch):
    """Isolate a test calling init_telemetry: the OTel tracer provider is set-once per process."""
    from opentelemetry import trace
    from opentelemetry.instrumentation.grpc import GrpcAioInstrumentorServer
    from opentelemetry.util._once import Once

    monkeypatch.setattr(trace, "_TRACER_PROVIDER_SET_ONCE", Once())
    monkeypatch.setattr(trace, "_TRACER_PROVIDER", None)
    monkeypatch.setenv("NO_PROXY", "127.0.0.1")
    monkeypatch.setenv("no_proxy", "127.0.0.1")
    monkeypatch.setattr(GrpcAioInstrumentorServer, "instrument", lambda self, **kw: None)
    yield
    provider = trace.get_tracer_provider()
    if hasattr(provider, "shutdown"):
        provider.shutdown()
