"""Loop-level tests for the mcp_client scheduled query loop (feature 166, AC-4 + AC-5).

Drives a single deterministic cycle (`run_one_cycle`) against a fake MCP client / cfg-watcher and a
mocked DB, so no live MCP endpoint or database is needed. AC-4's dedup half runs the REAL
shared `IngestServicer._ingest_external_signal` over the transaction_conn mock (the same
seam the RPC uses).
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

from app.engine import mcp_client_loop as loop
from app.repositories.signal_sources import derive_health_status
from tests._helpers import transaction_conn
from tests.test_ingest_servicer import make_servicer


class _FakeResult:
    def __init__(self, items):
        self.structured_content = items
        self.content = []
        self.is_error = False


class _FakeMcpClient:
    def __init__(self, *, result=None):
        self._result = result
        self.calls = []

    async def fetch(self, endpoint, tool, arguments, bearer, timeout_seconds):
        self.calls.append(
            {
                "endpoint": endpoint,
                "tool": tool,
                "bearer": bearer,
                "timeout_seconds": timeout_seconds,
            }
        )
        return self._result


class _SelectiveMcpClient:
    """Raises a 401-equivalent for a 'bad' endpoint, succeeds otherwise (AC-5)."""

    def __init__(self):
        self.polled = []

    async def fetch(self, endpoint, tool, arguments, bearer, timeout_seconds):
        self.polled.append(endpoint)
        if "bad" in endpoint:
            raise RuntimeError("HTTP 401 Unauthorized")
        return _FakeResult([{"symbol": "MSFT", "direction": "sell", "conviction": 0.6}])


class _FakeCfgWatcher:
    def __init__(self, *, bearer=("sk-live-abc123", True), ints=None):
        self._bearer = bearer
        self._ints = ints or {}
        self.resolve_calls = []

    def get_int(self, key, default=0):
        return self._ints.get(key, default)

    async def resolve_secret(self, key):
        self.resolve_calls.append(key)
        return self._bearer


def _mcp_source(slug="acme-mcp", endpoint="https://mcp.acme.example/mcp", **over):
    row = {
        "slug": slug,
        "source_type": "mcp_client",
        "config_json": {"mcp_endpoint": endpoint, "mcp_tool": "get_signals"},
        "credentials_ref": f"ingest.mcp_credential.{slug}",
        "active": True,
        "last_error": None,
    }
    row.update(over)
    return row


async def test_cycle_parses_and_ingests_signal(monkeypatch):
    # AC-4 parse+ingest: the loop builds an ExternalSignal from the fetched item and drives the
    # shared ingest path.
    monkeypatch.setattr(loop, "list_all_sources", AsyncMock(return_value=[_mcp_source()]))
    servicer = MagicMock()
    servicer._db = MagicMock()
    servicer._ingest_external_signal = AsyncMock(return_value=(42, False))
    mcp = _FakeMcpClient(
        result=_FakeResult(
            [{"symbol": "AAPL", "direction": "buy", "conviction": 0.72, "headline": "Flags AAPL"}]
        )
    )
    cfg = _FakeCfgWatcher()

    await loop.run_one_cycle(servicer, cfg, mcp)

    servicer._ingest_external_signal.assert_awaited_once()
    signal = servicer._ingest_external_signal.await_args.args[0]
    assert signal.source == "acme-mcp"
    assert signal.symbol == "AAPL"
    assert signal.direction == "buy"
    assert abs(signal.conviction - 0.72) < 1e-6
    # The bearer was resolved via GetSecret with the split key and sent to the client.
    assert cfg.resolve_calls == ["mcp_credential.acme-mcp"]
    assert mcp.calls[0]["bearer"] == "sk-live-abc123"


async def test_cycle_reads_namespace_prefixed_request_timeout_key(monkeypatch):
    # Regression (defect 2026-09-03): the request-timeout config key must be read under its full
    # `ingest.`-prefixed name — the WatchConfig snapshot is keyed by the raw dotted key with no
    # namespace auto-prefix, so a bare `mcp_client.request_timeout_seconds` read always misses and
    # silently falls back to the hardcoded default. Configure ONLY the prefixed key and assert the
    # loop honours it (30 default would prove the bug is back).
    monkeypatch.setattr(loop, "list_all_sources", AsyncMock(return_value=[_mcp_source()]))
    servicer = MagicMock()
    servicer._db = MagicMock()
    servicer._ingest_external_signal = AsyncMock(return_value=(42, False))
    mcp = _FakeMcpClient(result=_FakeResult([{"symbol": "AAPL", "direction": "buy"}]))
    cfg = _FakeCfgWatcher(ints={"ingest.mcp_client.request_timeout_seconds": 7})

    await loop.run_one_cycle(servicer, cfg, mcp)

    assert mcp.calls[0]["timeout_seconds"] == 7.0


async def test_second_identical_cycle_deduplicates(monkeypatch):
    # AC-4 dedup: two identical cycles over the REAL _ingest_external_signal — the second reports
    # deduplicated=True (the mock DB's claim returns None on the 2nd cycle).
    monkeypatch.setattr(loop, "list_all_sources", AsyncMock(return_value=[_mcp_source()]))
    db, _conn = transaction_conn(
        db_fetchrow_side_effect=[
            {"slug": "acme-mcp"},  # cycle 1 source lookup
            {"slug": "acme-mcp"},  # cycle 2 source lookup
            {"signal_id": 42},  # cycle 2 existing-id lookup after dedup
        ],
        conn_fetchrow_side_effect=[
            {"id": 42},  # cycle 1 insert
            {"signal_id": 42},  # cycle 1 claim -> fresh
            {"id": 43},  # cycle 2 insert (speculative)
            None,  # cycle 2 claim -> dedup
        ],
    )
    svc = make_servicer(db=db)
    svc._db = db

    results = []
    orig = svc._ingest_external_signal

    async def spy(signal, propagation_meta=None):
        r = await orig(signal, propagation_meta)
        results.append(r)
        return r

    svc._ingest_external_signal = spy

    mcp = _FakeMcpClient(
        result=_FakeResult([{"symbol": "AAPL", "direction": "buy", "conviction": 0.72}])
    )
    cfg = _FakeCfgWatcher()

    await loop.run_one_cycle(svc, cfg, mcp)
    await loop.run_one_cycle(svc, cfg, mcp)

    assert results[0][1] is False  # first cycle: a fresh ingest
    assert results[1][1] is True  # second identical cycle: deduplicated


async def test_source_failure_records_health_and_continues(monkeypatch):
    # AC-5: an unreachable/401 source records a non-empty last_error (degraded → down) and the loop
    # proceeds to the next source in the same cycle without raising.
    src_bad = _mcp_source(slug="bad-mcp", endpoint="https://bad.example/mcp")
    src_good = _mcp_source(slug="good-mcp", endpoint="https://good.example/mcp")
    monkeypatch.setattr(loop, "list_all_sources", AsyncMock(return_value=[src_bad, src_good]))

    errors = []

    async def fake_mark_error(db, slug, error):
        errors.append((slug, error))

    monkeypatch.setattr(loop, "mark_source_error", AsyncMock(side_effect=fake_mark_error))

    servicer = MagicMock()
    servicer._db = MagicMock()
    servicer._ingest_external_signal = AsyncMock(return_value=(1, False))
    mcp = _SelectiveMcpClient()
    cfg = _FakeCfgWatcher()

    await loop.run_one_cycle(servicer, cfg, mcp)

    # bad-mcp recorded a non-empty error; the loop still polled good-mcp.
    assert any(slug == "bad-mcp" and err for slug, err in errors)
    assert "https://good.example/mcp" in mcp.polled
    servicer._ingest_external_signal.assert_awaited()  # good-mcp's signal was ingested

    # A source whose last op errored derives to degraded health (down).
    assert derive_health_status(None, "HTTP 401 Unauthorized", datetime.now(UTC)) == "down"
