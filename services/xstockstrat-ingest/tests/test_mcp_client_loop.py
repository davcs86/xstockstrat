"""Loop-level tests for the mcp_client scheduled query loop (feature 166, AC-4 + AC-5).

Drives a single deterministic cycle (`run_one_cycle`) against a fake MCP client / cfg-watcher and a
mocked DB, so no live MCP endpoint or database is needed. AC-4's dedup half runs the REAL
shared `IngestServicer._ingest_external_signal` over the transaction_conn mock (the same
seam the RPC uses).
"""

import asyncio
import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.engine import mcp_client_loop as loop
from app.repositories.signal_sources import derive_health_status
from tests._helpers import transaction_conn
from tests.test_ingest_servicer import make_servicer
from tests.test_mcp_client import _FakeSecretStub, _watcher_with


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

    async def resolve_secret(self, key, user_id=""):
        self.resolve_calls.append(key)
        return self._bearer


def _mcp_source(slug="acme-mcp", endpoint="https://mcp.acme.example/mcp", **over):
    row = {
        "user_id": "seed-user",  # feature 224: list_all_sources selects the owner
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


async def test_cycle_request_timeout_stored_zero_reads_as_default(monkeypatch):
    # Feature 244 @AC-6: a stored 0 timeout reads as the 30s default, not a 0s/1s request.
    monkeypatch.setattr(loop, "list_all_sources", AsyncMock(return_value=[_mcp_source()]))
    servicer = MagicMock()
    servicer._db = MagicMock()
    servicer._ingest_external_signal = AsyncMock(return_value=(42, False))
    mcp = _FakeMcpClient(result=_FakeResult([{"symbol": "AAPL", "direction": "buy"}]))
    cfg = _FakeCfgWatcher(ints={"ingest.mcp_client.request_timeout_seconds": 0})

    await loop.run_one_cycle(servicer, cfg, mcp)

    assert mcp.calls[0]["timeout_seconds"] == 30.0


async def test_poll_interval_stored_zero_reads_as_default(monkeypatch):
    # Feature 244 @AC-6: a stored 0 poll interval sleeps the 300s default, never busy-loops.
    class _StopLoop(Exception):
        pass

    slept = []

    async def _fake_sleep(seconds):
        slept.append(seconds)
        raise _StopLoop

    monkeypatch.setattr(asyncio, "sleep", _fake_sleep)
    cfg = _FakeCfgWatcher(ints={"ingest.mcp_client.poll_interval_seconds": 0})

    with pytest.raises(_StopLoop):
        await loop.run_mcp_client_loop(MagicMock(), cfg, _FakeMcpClient())

    assert slept == [300]


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

    async def spy(signal, propagation_meta=None, owner=None):
        r = await orig(signal, propagation_meta, owner=owner)
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

    async def fake_mark_error(db, user_id, slug, error):
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


class _PerOwnerCfgWatcher(_FakeCfgWatcher):
    """GetSecret fake with exact (key, user_id) scope — an unscoped lookup finds nothing."""

    def __init__(self, secrets):
        super().__init__()
        self._secrets = secrets
        self.scoped_calls = []

    async def resolve_secret(self, key, user_id=""):
        self.scoped_calls.append((key, user_id))
        return self._secrets.get((key, user_id), ("", False))


async def test_per_owner_bearers_and_ingest_as_owner(monkeypatch):
    # feature 224 AC-35: alice and bob each own `acme-mcp`; each poll carries its owner's bearer,
    # GetSecret is owner-scoped, and each signal is filed under its owner (never slug-resolved).
    sources = [_mcp_source(user_id="alice"), _mcp_source(user_id="bob")]
    monkeypatch.setattr(loop, "list_all_sources", AsyncMock(return_value=sources))
    db, conn = transaction_conn(
        db_fetchrow_side_effect=[{"slug": "acme-mcp"}, {"slug": "acme-mcp"}],
        conn_fetchrow_side_effect=[{"id": 1}, {"signal_id": 1}, {"id": 2}, {"signal_id": 2}],
        slug_holders=("alice", "bob"),
    )
    svc = make_servicer(db=db)
    svc._db = db
    key = "mcp_credential.acme-mcp"
    cfg = _PerOwnerCfgWatcher({(key, "alice"): ("tok-a", True), (key, "bob"): ("tok-b", True)})
    item = {"symbol": "AAPL", "direction": "buy", "conviction": 0.7}
    mcp = _FakeMcpClient(result=_FakeResult([item]))

    await loop.run_one_cycle(svc, cfg, mcp)

    assert cfg.scoped_calls == [(key, "alice"), (key, "bob")]
    assert [c["bearer"] for c in mcp.calls] == ["tok-a", "tok-b"]
    inserts = [
        c
        for c in conn.fetchrow.await_args_list
        if "INSERT INTO ingest.newsletter_signals" in c.args[0]
    ]
    assert [c.args[-1] for c in inserts] == ["alice", "bob"]


async def test_ac7_mcp_client_bearer_resolves_per_user_only(monkeypatch):
    # feature 225 AC-7: a global row under the same key is never read for u-1's source.
    key = "mcp_credential.6f1c2a9e-3b7d-4e21-9a55-0c8d1e2f4b10"
    src = _mcp_source(user_id="u-1", credentials_ref=f"ingest.{key}")
    monkeypatch.setattr(loop, "list_all_sources", AsyncMock(return_value=[src]))
    servicer = MagicMock()
    servicer._db = MagicMock()
    servicer._ingest_external_signal = AsyncMock(return_value=(1, False))
    cfg = _PerOwnerCfgWatcher({(key, ""): ("tok-global", True), (key, "u-1"): ("tok-u1", True)})
    mcp = _FakeMcpClient(result=_FakeResult([]))

    await loop.run_one_cycle(servicer, cfg, mcp)

    assert cfg.scoped_calls == [(key, "u-1")]
    assert [c["bearer"] for c in mcp.calls] == ["tok-u1"]


async def test_empty_string_bearer_treated_as_missing(monkeypatch):
    # feature 224 AC-35: GetSecret found:true with '' plaintext is NOT a usable bearer.
    monkeypatch.setattr(
        loop, "list_all_sources", AsyncMock(return_value=[_mcp_source(user_id="alice")])
    )
    mark_error = AsyncMock()
    monkeypatch.setattr(loop, "mark_source_error", mark_error)
    servicer = MagicMock()
    servicer._db = MagicMock()
    servicer._ingest_external_signal = AsyncMock()
    key = "mcp_credential.acme-mcp"
    cfg = _PerOwnerCfgWatcher({(key, "alice"): ("", True), (key, ""): ("", True)})
    mcp = _FakeMcpClient(result=_FakeResult([]))

    await loop.run_one_cycle(servicer, cfg, mcp)

    assert cfg.scoped_calls == [(key, "alice")]
    assert mcp.calls == []
    mark_error.assert_awaited_once_with(servicer._db, "alice", "acme-mcp", "bearer not configured")
    servicer._ingest_external_signal.assert_not_awaited()


async def test_resolve_secret_sends_exact_user_scope():
    # feature 224: the owner's user_id reaches GetSecretRequest.user_id (exact scope).
    stub = _FakeSecretStub("tok-a", True)
    w = _watcher_with(stub)

    assert await w.resolve_secret("mcp_credential.acme-mcp", user_id="alice") == ("tok-a", True)
    assert stub.last_request.user_id == "alice"
    await w.resolve_secret("mcp_credential.acme-mcp")
    assert stub.last_request.user_id == ""


def _item(symbol="AAPL", **over):
    return {"symbol": symbol, "direction": "buy", "conviction": 0.7, **over}


async def _run_cycle_with(monkeypatch, result, *, source=None, ingest=None):
    """One cycle over a single source returning `result`; yields (ingest mock, captured errors)."""
    src = source or _mcp_source()
    monkeypatch.setattr(loop, "list_all_sources", AsyncMock(return_value=[src]))
    errors = []

    async def fake_mark_error(db, user_id, slug, error):
        errors.append((slug, error))

    monkeypatch.setattr(loop, "mark_source_error", AsyncMock(side_effect=fake_mark_error))
    servicer = MagicMock()
    servicer._db = MagicMock()
    servicer._ingest_external_signal = ingest or AsyncMock(return_value=(1, False))
    await loop.run_one_cycle(servicer, _FakeCfgWatcher(), _FakeMcpClient(result=result))
    return servicer._ingest_external_signal, errors


async def test_ac5_signals_key_selected_alongside_other_list(monkeypatch):
    # AC-5 @FR-6: a `signals` list wins even when an earlier key holds another list.
    ingest, errors = await _run_cycle_with(
        monkeypatch, _FakeResult({"warnings": [], "signals": [_item("AAPL")]})
    )

    ingest.assert_awaited_once()
    assert ingest.await_args.args[0].symbol == "AAPL"
    assert errors == []


async def test_ac7_two_candidate_lists_records_ambiguous_error(monkeypatch):
    # AC-7 @FR-6: two all-dict lists and no `signals` key is ambiguous — recorded, nothing ingested.
    ingest, errors = await _run_cycle_with(
        monkeypatch, _FakeResult({"alerts": [_item("MSFT")], "rows": [_item("TSLA")]})
    )

    ingest.assert_not_awaited()
    assert any(slug == "acme-mcp" and "ambiguous result" in err for slug, err in errors)


@pytest.mark.parametrize("tags", [["ai"], []])
async def test_single_signal_object_with_tags_is_wrapped(monkeypatch, tags):
    # @AC-4 @feature-166 EXTEND: a lone signal object carrying a `tags` list is one item.
    ingest, errors = await _run_cycle_with(monkeypatch, _FakeResult(_item("AAPL", tags=tags)))

    ingest.assert_awaited_once()
    assert list(ingest.await_args.args[0].tags) == tags
    assert errors == []


async def test_all_empty_envelope_returns_no_items_silently(monkeypatch, caplog):
    # O-2: an envelope whose only lists are empty yields no items — no error, no extractor warning.
    with caplog.at_level("WARNING"):
        ingest, errors = await _run_cycle_with(
            monkeypatch, _FakeResult({"results": [], "count": 0})
        )

    ingest.assert_not_awaited()
    assert errors == []
    assert not any("mcp_client: skipping" in r.getMessage() for r in caplog.records)


async def test_sole_dict_list_selected(monkeypatch):
    # Rule 2 counts only all-dict lists, so a scalar list beside it is not a candidate.
    ingest, errors = await _run_cycle_with(
        monkeypatch, _FakeResult({"items": [_item("AAPL")], "meta": ["x"]})
    )

    ingest.assert_awaited_once()
    assert errors == []


async def test_text_fallback_signals_envelope(monkeypatch):
    # FR-6 applies to a dict decoded from the text-content fallback too.
    result = SimpleNamespace(
        structured_content=None,
        content=[SimpleNamespace(text=json.dumps({"signals": [_item("AAPL")]}))],
        is_error=False,
    )
    ingest, errors = await _run_cycle_with(monkeypatch, result)

    ingest.assert_awaited_once()
    assert ingest.await_args.args[0].symbol == "AAPL"
    assert errors == []


async def test_ac1_one_failing_item_does_not_drop_batch(monkeypatch, caplog):
    # AC-1 @FR-1: one failing item is skipped; the rest of the batch still ingests as the owner.
    caplog.set_level("INFO", logger=loop.__name__)
    ingest, errors = await _run_cycle_with(
        monkeypatch,
        _FakeResult([_item("AAPL"), _item("MSFT"), _item("TSLA")]),
        source=_mcp_source(slug="src-a", user_id="u-1"),
        ingest=AsyncMock(side_effect=[(1, False), RuntimeError("boom"), (3, False)]),
    )

    assert ingest.await_count == 3
    calls = ingest.await_args_list
    assert [calls[0].args[0].symbol, calls[2].args[0].symbol] == ["AAPL", "TSLA"]
    assert all(c.kwargs["owner"] == "u-1" for c in calls)
    assert errors == []
    assert any("src-a" in r.getMessage() and "skipped=1" in r.getMessage() for r in caplog.records)


async def test_ac8_all_items_failed_records_last_error(monkeypatch, caplog):
    # AC-8 @FR-1: an all-fail batch is recorded as a source error, after the summary record.
    caplog.set_level("INFO", logger=loop.__name__)
    ingest, errors = await _run_cycle_with(
        monkeypatch,
        _FakeResult([_item("AAPL")]),
        source=_mcp_source(slug="src-a", user_id="u-1"),
        ingest=AsyncMock(side_effect=RuntimeError("boom")),
    )

    assert any(slug == "src-a" and "all 1 items failed" in err for slug, err in errors)
    msgs = [r.getMessage() for r in caplog.records]
    summary = next(i for i, m in enumerate(msgs) if "src-a" in m and "skipped=1" in m)
    failed = next(i for i, m in enumerate(msgs) if "source src-a failed" in m)
    assert summary < failed
