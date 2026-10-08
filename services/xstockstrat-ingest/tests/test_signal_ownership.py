"""Feature 224 — ingest owner-scoped sources/signals, SignalScope, reserved slugs, system grants,
admin read (AC-7..12, AC-26, AC-28, AC-29, AC-33, AC-36) and the release-N headerless tolerance."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest
from gen.ingest.v1 import ingest_pb2

from tests._helpers import transaction_conn
from tests.conftest import _ctx
from tests.test_ingest_servicer import make_servicer

_SS = "app.handlers.servicer"
_ANALYSIS_SAN = ("xstockstrat-analysis",)


def _signal_req(source: str, symbol: str = "NVDA", direction: str = "buy"):
    signal = ingest_pb2.ExternalSignal(
        source=source, symbol=symbol, direction=direction, conviction=0.8
    )
    signal.valid_from.FromDatetime(datetime(2026, 10, 1, tzinfo=UTC))
    return ingest_pb2.IngestSignalRequest(signal=signal)


def _fresh_ingest_svc(signal_id: int, *, slug_holders=("seed-user",), registered=True):
    """A servicer whose DB answers one fresh (non-duplicate) IngestSignal."""
    db, conn = transaction_conn(
        db_fetchrow_side_effect=[{"slug": "x"} if registered else None],
        conn_fetchrow_side_effect=[{"id": signal_id}, {"signal_id": signal_id}],
        slug_holders=slug_holders,
    )
    return make_servicer(db=db), db, conn


def _signal_row(source: str, user_id: str, symbol: str = "NVDA") -> dict:
    return {
        "id": 1,
        "user_id": user_id,
        "source": source,
        "symbol": symbol,
        "direction": "buy",
        "conviction": 0.8,
        "valid_from": datetime(2026, 10, 1, tzinfo=UTC),
        "valid_until": None,
        "headline": "",
        "raw_url": "",
        "tags": [],
        "ingested_at": datetime(2026, 10, 1, tzinfo=UTC),
    }


def _source_row(slug: str, user_id: str, **over) -> dict:
    row = {
        "user_id": user_id,
        "slug": slug,
        "display_name": slug,
        "source_type": "derived",
        "extractor_module": "app.extractors.noop",
        "credentials_ref": None,
        "active": True,
        "config_json": None,
        "created_at": None,
        "last_seen_at": None,
        "last_error": None,
        "signals_fed": 0,
        "reliability_weight": 1.0,
    }
    row.update(over)
    return row


def _query_svc(rows):
    db = MagicMock()
    db.fetch = AsyncMock(return_value=rows)
    return make_servicer(db=db), db


def _register_req(slug: str):
    return ingest_pb2.ManageSignalSourceRequest(
        source=ingest_pb2.SignalSource(
            slug=slug, source_type="derived", extractor_module="app.extractors.noop"
        ),
        operation_enum=ingest_pb2.SIGNAL_SOURCE_OPERATION_REGISTER,
    )


def _manage_svc():
    db, conn = transaction_conn()
    return make_servicer(db=db), conn


async def _aborted_code(coro, ctx):
    with pytest.raises(Exception, match="aborted"):
        await coro
    return ctx.abort.call_args[0][0]


# ---------------------------------------------------------------------------
# conftest `_ctx` extension
# ---------------------------------------------------------------------------


def test_ctx_headerless_omits_user_id_and_adds_grant_and_sans():
    ctx = _ctx(user_id="", internal_caller="analysis-fundsignal", peer_sans=_ANALYSIS_SAN)
    md = dict(ctx.invocation_metadata())
    assert "x-user-id" not in md
    assert md["x-internal-caller"] == "analysis-fundsignal"
    assert ctx.peer_identity_key() == "x509_subject_alternative_name"
    assert list(ctx.peer_identities()) == [b"xstockstrat-analysis"]
    assert _ctx().peer_identity_key() is None


# ---------------------------------------------------------------------------
# IngestSignal — AC-9, AC-10, AC-33, headerless N
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ac9_two_owners_ingest_same_signal_into_their_own_rows():
    for owner, sid in (("alice", 11), ("bob", 12)):
        svc, db, conn = _fresh_ingest_svc(sid)
        resp = await svc.IngestSignal(_signal_req("motley-fool"), _ctx("0", user_id=owner))
        assert resp.signal_id == sid and resp.deduplicated is False
        # Source resolution is owner-scoped.
        check_sql, *check_args = db.fetchrow.call_args_list[0].args
        assert "user_id = $1" in check_sql and check_args == [owner, "motley-fool"]
        # The signal row is stamped with the owner; the dedup claim is keyed by owner.
        insert_sql, *insert_args = conn.fetchrow.call_args_list[0].args
        assert "user_id" in insert_sql and owner in insert_args
        claim_sql, *claim_args = conn.fetchrow.call_args_list[1].args
        assert "ingest.signal_dedup_claims" in claim_sql
        assert "ON CONFLICT (user_id, source, symbol, direction)" in claim_sql
        assert "signal_dedup_keys" not in claim_sql
        assert claim_args[0] == owner
        ledger_payload = svc._ledger.AppendEvent.call_args.args[0].payload
        assert ledger_payload["user_id"] == owner


@pytest.mark.asyncio
async def test_ac9_dedup_hit_lookup_is_owner_keyed():
    db, conn = transaction_conn(
        db_fetchrow_side_effect=[{"slug": "motley-fool"}, {"signal_id": 11}],
        conn_fetchrow_side_effect=[{"id": 55}, None],
    )
    svc = make_servicer(db=db)
    resp = await svc.IngestSignal(_signal_req("motley-fool"), _ctx("0", user_id="bob"))
    assert resp.deduplicated is True and resp.signal_id == 11
    hit_sql, *hit_args = db.fetchrow.call_args_list[1].args
    assert "ingest.signal_dedup_claims" in hit_sql and "user_id = $1" in hit_sql
    assert hit_args[0] == "bob"


@pytest.mark.asyncio
async def test_ac10_ingest_into_foreign_slug_is_not_found_and_inserts_nothing():
    svc, db, conn = _fresh_ingest_svc(1, registered=False)
    ctx = _ctx("0", user_id="bob")
    code = await _aborted_code(svc.IngestSignal(_signal_req("alice-feed"), ctx), ctx)
    assert code == grpc.StatusCode.NOT_FOUND
    conn.fetchrow.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "grant,sans",
    [
        ("", ()),  # no grant at all
        ("analysis-fundsignal", ("xstockstrat-agent",)),  # grant, wrong SAN
        ("analysis-fundsignal", ()),  # grant, no TLS peer identity
        ("analysis-system-read", _ANALYSIS_SAN),  # read grant does not cover IngestSignal
    ],
)
async def test_ac33_system_identity_without_bound_grant_denied(grant, sans):
    svc, db, conn = _fresh_ingest_svc(1)
    ctx = _ctx("0", user_id="system", internal_caller=grant, peer_sans=sans)
    code = await _aborted_code(svc.IngestSignal(_signal_req("fundamentals"), ctx), ctx)
    assert code == grpc.StatusCode.PERMISSION_DENIED
    conn.fetchrow.assert_not_called()
    db.fetchrow.assert_not_called()


@pytest.mark.asyncio
async def test_ac33_system_identity_with_san_bound_grant_ingests_as_system():
    svc, db, conn = _fresh_ingest_svc(5)
    ctx = _ctx(
        "0", user_id="system", internal_caller="analysis-fundsignal", peer_sans=_ANALYSIS_SAN
    )
    resp = await svc.IngestSignal(_signal_req("fundamentals"), ctx)
    assert resp.signal_id == 5
    assert "system" in conn.fetchrow.call_args_list[0].args


@pytest.mark.asyncio
async def test_headerless_ingest_zero_holders_invalid_argument():
    svc, db, conn = _fresh_ingest_svc(1, slug_holders=())
    ctx = _ctx("0", user_id="")
    code = await _aborted_code(svc.IngestSignal(_signal_req("nobody"), ctx), ctx)
    assert code == grpc.StatusCode.INVALID_ARGUMENT
    conn.fetchrow.assert_not_called()


@pytest.mark.asyncio
async def test_headerless_ingest_ambiguous_holders_failed_precondition():
    svc, db, conn = _fresh_ingest_svc(1, slug_holders=("alice", "bob"))
    ctx = _ctx("0", user_id="")
    code = await _aborted_code(svc.IngestSignal(_signal_req("motley-fool"), ctx), ctx)
    assert code == grpc.StatusCode.FAILED_PRECONDITION
    conn.fetchrow.assert_not_called()


@pytest.mark.asyncio
async def test_headerless_ingest_unique_holder_files_into_that_owner():
    svc, db, conn = _fresh_ingest_svc(9, slug_holders=("alice",))
    resp = await svc.IngestSignal(_signal_req("alice-feed"), _ctx("0", user_id=""))
    assert resp.signal_id == 9
    holder_sql = db.fetch.call_args.args[0]
    assert "user_id" in holder_sql and "slug = $1" in holder_sql
    assert "alice" in conn.fetchrow.call_args_list[0].args
    assert conn.fetchrow.call_args_list[1].args[1] == "alice"


# ---------------------------------------------------------------------------
# QuerySignals — SignalScope, AC-9/11/12/26/28/29
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ac9_ac29_query_unspecified_scope_is_own_plus_system():
    svc, db = _query_svc([_signal_row("motley-fool", "bob")])
    resp = await svc.QuerySignals(
        ingest_pb2.QuerySignalsRequest(symbol="NVDA"), _ctx("0", user_id="bob")
    )
    assert len(resp.signals) == 1 and resp.signals[0].user_id == "bob"
    sql, *args = db.fetch.call_args.args
    assert "user_id = $" in sql and "user_id = 'system'" in sql
    assert "bob" in args and "alice" not in args


@pytest.mark.asyncio
async def test_ac11_query_scope_own_excludes_system_and_other_owners():
    svc, db = _query_svc([])
    req = ingest_pb2.QuerySignalsRequest(scope=ingest_pb2.SIGNAL_SCOPE_OWN)
    await svc.QuerySignals(req, _ctx("0", user_id="bob"))
    sql, *args = db.fetch.call_args.args
    assert "user_id = $1" in sql and "'system'" not in sql
    assert args[0] == "bob"


@pytest.mark.asyncio
async def test_query_scope_system_reads_only_system_rows():
    svc, db = _query_svc([_signal_row("fundamentals", "system")])
    req = ingest_pb2.QuerySignalsRequest(scope=ingest_pb2.SIGNAL_SCOPE_SYSTEM)
    resp = await svc.QuerySignals(req, _ctx("0", user_id="bob"))
    sql, *args = db.fetch.call_args.args
    assert "user_id = 'system'" in sql and "bob" not in args
    assert resp.signals[0].user_id == "system"


@pytest.mark.asyncio
async def test_ac12_ac29_query_foreign_source_slug_is_owner_scoped():
    svc, db = _query_svc([])
    resp = await svc.QuerySignals(
        ingest_pb2.QuerySignalsRequest(source="alice-feed"), _ctx("0", user_id="bob")
    )
    assert len(resp.signals) == 0
    sql, *args = db.fetch.call_args.args
    assert "source = $" in sql and "user_id = $" in sql
    assert "bob" in args and "alice-feed" in args


@pytest.mark.asyncio
async def test_ac26_system_signals_flagged_in_owner_query():
    svc, db = _query_svc([_signal_row("fundamentals", "system"), _signal_row("mine", "bob")])
    resp = await svc.QuerySignals(ingest_pb2.QuerySignalsRequest(), _ctx("0", user_id="bob"))
    assert [s.user_id for s in resp.signals] == ["system", "bob"]


@pytest.mark.asyncio
async def test_ac33_system_query_requires_san_bound_read_grant():
    svc, db = _query_svc([])
    ctx = _ctx("0", user_id="system", internal_caller="analysis-system-read")
    code = await _aborted_code(svc.QuerySignals(ingest_pb2.QuerySignalsRequest(), ctx), ctx)
    assert code == grpc.StatusCode.PERMISSION_DENIED
    db.fetch.assert_not_called()
    ok = _ctx(
        "0", user_id="system", internal_caller="analysis-system-read", peer_sans=_ANALYSIS_SAN
    )
    await svc.QuerySignals(ingest_pb2.QuerySignalsRequest(), ok)
    db.fetch.assert_awaited_once()


@pytest.mark.asyncio
async def test_headerless_query_keeps_unscoped_behaviour():
    svc, db = _query_svc([_signal_row("motley-fool", "alice")])
    resp = await svc.QuerySignals(ingest_pb2.QuerySignalsRequest(), _ctx("0", user_id=""))
    assert "user_id =" not in db.fetch.call_args.args[0]
    assert resp.signals[0].user_id == "alice"


@pytest.mark.asyncio
async def test_ac28_admin_query_owner_selector_reads_and_audits():
    svc, db = _query_svc([_signal_row("alice-feed", "alice")])
    req = ingest_pb2.QuerySignalsRequest(owner_user_id="alice")
    resp = await svc.QuerySignals(req, _ctx("4", user_id="admin1"))
    assert [s.user_id for s in resp.signals] == ["alice"]
    sql, *args = db.fetch.call_args.args
    assert "user_id = $1" in sql and "'system'" not in sql and args[0] == "alice"
    calls = svc._ledger.AppendEvent.call_args_list
    assert sorted(c.args[0].stream_key for c in calls) == ["user:admin1", "user:alice"]
    assert all(c.args[0].event_type == "audit.admin_read" for c in calls)
    for c in calls:
        assert {k for k, _ in c.kwargs["metadata"]} == {"x-user-id", "x-access-scope", "x-trace-id"}


@pytest.mark.asyncio
async def test_ac28_non_admin_query_owner_selector_ignored():
    svc, db = _query_svc([])
    req = ingest_pb2.QuerySignalsRequest(owner_user_id="alice")
    await svc.QuerySignals(req, _ctx("0", user_id="bob"))
    args = db.fetch.call_args.args[1:]
    assert "alice" not in args and "bob" in args
    svc._ledger.AppendEvent.assert_not_called()


@pytest.mark.asyncio
async def test_ac28_admin_query_audit_failure_fails_closed():
    svc, db = _query_svc([_signal_row("alice-feed", "alice")])
    svc._ledger.AppendEvent = AsyncMock(side_effect=Exception("ledger down"))
    ctx = _ctx("4", user_id="admin1")
    code = await _aborted_code(
        svc.QuerySignals(ingest_pb2.QuerySignalsRequest(owner_user_id="alice"), ctx), ctx
    )
    assert code == grpc.StatusCode.UNAVAILABLE


# ---------------------------------------------------------------------------
# ListSignalSources — AC-7, AC-26, AC-28, headerless N
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ac7_ac26_list_is_own_plus_system_flagged():
    svc, db = _query_svc(
        [_source_row("my-newsletter", "bob"), _source_row("fundamentals", "system")]
    )
    resp = await svc.ListSignalSources(
        ingest_pb2.ListSignalSourcesRequest(), _ctx("0", user_id="bob")
    )
    assert [(s.slug, s.user_id) for s in resp.sources] == [
        ("my-newsletter", "bob"),
        ("fundamentals", "system"),
    ]
    sql, *args = db.fetch.call_args.args
    assert "(user_id = $1 OR user_id = 'system')" in sql and args[0] == "bob"


@pytest.mark.asyncio
async def test_ac7_alice_list_is_queried_as_alice():
    svc, db = _query_svc([_source_row("fundamentals", "system")])
    resp = await svc.ListSignalSources(
        ingest_pb2.ListSignalSourcesRequest(), _ctx("0", user_id="alice")
    )
    assert "my-newsletter" not in [s.slug for s in resp.sources]
    assert db.fetch.call_args.args[1] == "alice"


@pytest.mark.asyncio
async def test_headerless_list_keeps_global_rows_with_owner_populated():
    svc, db = _query_svc([_source_row("motley-fool", "alice"), _source_row("motley-fool", "bob")])
    resp = await svc.ListSignalSources(ingest_pb2.ListSignalSourcesRequest(), _ctx("0", user_id=""))
    assert [s.user_id for s in resp.sources] == ["alice", "bob"]
    sql = db.fetch.call_args.args[0]
    assert "user_id" in sql.split("FROM")[0] and "WHERE user_id" not in sql


@pytest.mark.asyncio
async def test_ac28_admin_list_owner_selector_reads_and_audits():
    svc, db = _query_svc([_source_row("alice-feed", "alice")])
    req = ingest_pb2.ListSignalSourcesRequest(owner_user_id="alice")
    resp = await svc.ListSignalSources(req, _ctx("4", user_id="admin1"))
    assert [s.slug for s in resp.sources] == ["alice-feed"]
    sql, *args = db.fetch.call_args.args
    assert "'system'" not in sql and args[0] == "alice"
    events = [c.args[0] for c in svc._ledger.AppendEvent.call_args_list]
    assert sorted(e.stream_key for e in events) == ["user:admin1", "user:alice"]
    assert list(events[0].payload["object_ids"]) == ["alice-feed"]


@pytest.mark.asyncio
async def test_ac28_non_admin_list_owner_selector_ignored():
    svc, db = _query_svc([])
    req = ingest_pb2.ListSignalSourcesRequest(owner_user_id="alice")
    await svc.ListSignalSources(req, _ctx("0", user_id="bob"))
    assert db.fetch.call_args.args[1] == "bob"
    svc._ledger.AppendEvent.assert_not_called()


@pytest.mark.asyncio
async def test_ac33_system_list_without_grant_denied():
    svc, db = _query_svc([])
    ctx = _ctx("0", user_id="system")
    code = await _aborted_code(
        svc.ListSignalSources(ingest_pb2.ListSignalSourcesRequest(), ctx), ctx
    )
    assert code == grpc.StatusCode.PERMISSION_DENIED


# ---------------------------------------------------------------------------
# ManageSignalSource — AC-7, AC-8, AC-26, AC-36, headerless N (elaboration 5)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ac7_non_admin_registers_own_source_under_advisory_lock():
    svc, conn = _manage_svc()
    captured = {}

    async def _fake_insert(_db, **kw):
        captured.update(kw)
        return _source_row(kw["slug"], kw["user_id"])

    with (
        patch(f"{_SS}.slug_holders", AsyncMock(return_value=[])),
        patch(f"{_SS}.insert_source", _fake_insert),
    ):
        resp = await svc.ManageSignalSource(
            _register_req("my-newsletter"), _ctx("0", user_id="bob")
        )
    assert captured["user_id"] == "bob"
    assert resp.source.user_id == "bob"
    lock_sql, lock_arg = conn.execute.call_args.args
    assert "pg_advisory_xact_lock(hashtext($1))" in lock_sql and lock_arg == "my-newsletter"


@pytest.mark.asyncio
async def test_ac8_two_owners_register_the_same_slug():
    svc, _ = _manage_svc()
    with (
        patch(f"{_SS}.slug_holders", AsyncMock(return_value=["alice"])),
        patch(
            f"{_SS}.insert_source",
            AsyncMock(side_effect=lambda _db, **kw: _source_row(kw["slug"], kw["user_id"])),
        ),
    ):
        resp = await svc.ManageSignalSource(_register_req("motley-fool"), _ctx("0", user_id="bob"))
    assert resp.source.user_id == "bob" and resp.source.slug == "motley-fool"


@pytest.mark.asyncio
async def test_register_existing_own_slug_already_exists():
    svc, _ = _manage_svc()
    ctx = _ctx("0", user_id="bob")
    ins = AsyncMock()
    with (
        patch(f"{_SS}.slug_holders", AsyncMock(return_value=["bob"])),
        patch(f"{_SS}.insert_source", ins),
    ):
        code = await _aborted_code(svc.ManageSignalSource(_register_req("mine"), ctx), ctx)
    assert code == grpc.StatusCode.ALREADY_EXISTS
    ins.assert_not_called()


@pytest.mark.asyncio
async def test_ac36_user_register_of_system_slug_already_exists():
    svc, _ = _manage_svc()
    ctx = _ctx("0", user_id="bob")
    ins = AsyncMock()
    with (
        patch(f"{_SS}.slug_holders", AsyncMock(return_value=["system"])),
        patch(f"{_SS}.insert_source", ins),
    ):
        code = await _aborted_code(svc.ManageSignalSource(_register_req("fundamentals"), ctx), ctx)
    assert code == grpc.StatusCode.ALREADY_EXISTS
    ins.assert_not_called()


@pytest.mark.asyncio
async def test_ac36_system_register_of_user_held_slug_failed_precondition():
    svc, _ = _manage_svc()
    ctx = _ctx(
        "0", user_id="system", internal_caller="analysis-fundsignal", peer_sans=_ANALYSIS_SAN
    )
    ins = AsyncMock()
    with (
        patch(f"{_SS}.slug_holders", AsyncMock(return_value=["bob"])),
        patch(f"{_SS}.insert_source", ins),
    ):
        code = await _aborted_code(svc.ManageSignalSource(_register_req("macro-feed"), ctx), ctx)
    assert code == grpc.StatusCode.FAILED_PRECONDITION
    ins.assert_not_called()


@pytest.mark.asyncio
async def test_ac33_system_register_without_grant_denied():
    svc, _ = _manage_svc()
    ctx = _ctx("4", user_id="system", peer_sans=_ANALYSIS_SAN)
    code = await _aborted_code(svc.ManageSignalSource(_register_req("x"), ctx), ctx)
    assert code == grpc.StatusCode.PERMISSION_DENIED


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "op",
    [
        ingest_pb2.SIGNAL_SOURCE_OPERATION_UPDATE,
        ingest_pb2.SIGNAL_SOURCE_OPERATION_DEACTIVATE,
        ingest_pb2.SIGNAL_SOURCE_OPERATION_REACTIVATE,
    ],
)
async def test_ac26_mutating_a_system_source_is_permission_denied(op):
    svc, _ = _manage_svc()
    ctx = _ctx("4", user_id="bob")  # admin bit grants no reach over system/foreign sources
    req = ingest_pb2.ManageSignalSourceRequest(
        source=ingest_pb2.SignalSource(slug="fundamentals", display_name="pwned"),
        operation_enum=op,
    )
    upd = AsyncMock()
    with (
        patch(f"{_SS}.get_source", AsyncMock(return_value=None)),
        patch(f"{_SS}.update_source", upd),
        patch(f"{_SS}.deactivate_source", AsyncMock(return_value=None)),
        patch(f"{_SS}.reactivate_source", AsyncMock(return_value=None)),
        patch(f"{_SS}.slug_holders", AsyncMock(return_value=["system"])),
    ):
        code = await _aborted_code(svc.ManageSignalSource(req, ctx), ctx)
    assert code == grpc.StatusCode.PERMISSION_DENIED
    upd.assert_not_called()


@pytest.mark.asyncio
async def test_owner_updates_own_source_without_admin_scope():
    svc, _ = _manage_svc()
    req = ingest_pb2.ManageSignalSourceRequest(
        source=ingest_pb2.SignalSource(slug="mine", display_name="New"),
        operation_enum=ingest_pb2.SIGNAL_SOURCE_OPERATION_UPDATE,
    )
    req.update_mask.paths.append("display_name")
    getter = AsyncMock(return_value=_source_row("mine", "bob"))
    upd = AsyncMock(return_value=_source_row("mine", "bob", display_name="New"))
    with patch(f"{_SS}.get_source", getter), patch(f"{_SS}.update_source", upd):
        resp = await svc.ManageSignalSource(req, _ctx("0", user_id="bob"))
    assert getter.call_args.args[1:] == ("bob", "mine")
    assert upd.call_args.kwargs["user_id"] == "bob"
    assert resp.source.display_name == "New"


@pytest.mark.asyncio
async def test_foreign_user_source_update_is_not_found():
    svc, _ = _manage_svc()
    ctx = _ctx("4", user_id="admin1")
    req = ingest_pb2.ManageSignalSourceRequest(
        source=ingest_pb2.SignalSource(slug="alice-feed"),
        operation_enum=ingest_pb2.SIGNAL_SOURCE_OPERATION_DEACTIVATE,
    )
    with (
        patch(f"{_SS}.deactivate_source", AsyncMock(return_value=None)) as deact,
        patch(f"{_SS}.slug_holders", AsyncMock(return_value=["alice"])),
    ):
        code = await _aborted_code(svc.ManageSignalSource(req, ctx), ctx)
    assert code == grpc.StatusCode.NOT_FOUND
    assert deact.call_args.args[1:] == ("admin1", "alice-feed")


@pytest.mark.asyncio
async def test_headerless_register_keeps_admin_gate():
    svc, _ = _manage_svc()
    ctx = _ctx("0", user_id="")
    code = await _aborted_code(svc.ManageSignalSource(_register_req("x"), ctx), ctx)
    assert code == grpc.StatusCode.PERMISSION_DENIED


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "holders,want",
    [([], grpc.StatusCode.FAILED_PRECONDITION), (["alice"], grpc.StatusCode.ALREADY_EXISTS)],
)
async def test_headerless_admin_register_never_creates(holders, want):
    svc, _ = _manage_svc()
    ctx = _ctx("4", user_id="")
    ins = AsyncMock()
    with (
        patch(f"{_SS}.slug_holders", AsyncMock(return_value=holders)),
        patch(f"{_SS}.insert_source", ins),
    ):
        code = await _aborted_code(svc.ManageSignalSource(_register_req("x"), ctx), ctx)
    assert code == want
    ins.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "holders,want",
    [([], grpc.StatusCode.NOT_FOUND), (["alice", "bob"], grpc.StatusCode.FAILED_PRECONDITION)],
)
async def test_headerless_admin_mutation_resolves_unique_holder(holders, want):
    svc, _ = _manage_svc()
    ctx = _ctx("4", user_id="")
    req = ingest_pb2.ManageSignalSourceRequest(
        source=ingest_pb2.SignalSource(slug="motley-fool"),
        operation_enum=ingest_pb2.SIGNAL_SOURCE_OPERATION_DEACTIVATE,
    )
    deact = AsyncMock()
    with (
        patch(f"{_SS}.slug_holders", AsyncMock(return_value=holders)),
        patch(f"{_SS}.deactivate_source", deact),
    ):
        code = await _aborted_code(svc.ManageSignalSource(req, ctx), ctx)
    assert code == want
    deact.assert_not_called()


@pytest.mark.asyncio
async def test_headerless_admin_mutation_acts_on_the_unique_holder():
    svc, _ = _manage_svc()
    req = ingest_pb2.ManageSignalSourceRequest(
        source=ingest_pb2.SignalSource(slug="motley-fool"),
        operation_enum=ingest_pb2.SIGNAL_SOURCE_OPERATION_DEACTIVATE,
    )
    deact = AsyncMock(return_value=_source_row("motley-fool", "alice", active=False))
    with (
        patch(f"{_SS}.slug_holders", AsyncMock(return_value=["alice"])),
        patch(f"{_SS}.deactivate_source", deact),
    ):
        resp = await svc.ManageSignalSource(req, _ctx("4", user_id=""))
    assert deact.call_args.args[1:] == ("alice", "motley-fool")
    assert resp.source.active is False
