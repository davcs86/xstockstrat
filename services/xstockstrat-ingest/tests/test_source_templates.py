"""Feature 224 — signal-source template catalog: admin-only authoring (AC-13), private snapshot
instantiation under the REGISTER rules, origin + update_available on ListSignalSources, and no
credential on any template payload or response (@feature-166 AC-2/AC-3 PRESERVE)."""

import json
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import asyncpg
import grpc
import pytest
from gen.common.v1 import common_pb2
from gen.ingest.v1 import ingest_pb2
from google.protobuf.struct_pb2 import Struct

from app.repositories import source_templates
from tests._helpers import transaction_conn
from tests.conftest import _ctx
from tests.test_ingest_servicer import make_servicer
from tests.test_signal_ownership import _aborted_code, _source_row

_SS = "app.handlers.servicer"
_ST = "app.repositories.source_templates"
_TS = datetime(2026, 10, 1, tzinfo=UTC)
_BEARER = "ingest.mcp_credential.bob-feed"
_MCP_CFG = {"mcp_endpoint": "https://mcp.example.com", "mcp_tool": "signals"}


def _template_row(template_id="t1", *, version=1, retired=False, payload=None) -> dict:
    return {
        "template_id": template_id,
        "name": "Example feed",
        "description": "A curated feed",
        # The pool has no JSONB codec: asyncpg returns JSONB as JSON text.
        "payload": json.dumps(
            payload
            if payload is not None
            else {
                "slug": "example-feed",
                "display_name": "Example feed",
                "source_type": "derived",
                "extractor_module": "app.extractors.noop",
            }
        ),
        "version": version,
        "retired_at": _TS if retired else None,
        "created_by": "admin1",
        "created_at": _TS,
        "updated_at": _TS,
    }


def _mcp_payload() -> dict:
    return {
        "slug": "mcp-feed",
        "display_name": "MCP feed",
        "source_type": "mcp_client",
        "extractor_module": "app.extractors.mcp",
        "config_json": _MCP_CFG,
    }


def _template_msg(source_type="derived", cfg=None, **payload_over):
    cfg_struct = Struct()
    if cfg:
        cfg_struct.update(cfg)
    payload = ingest_pb2.SignalSource(
        slug="example-feed",
        display_name="Example feed",
        source_type=source_type,
        extractor_module="app.extractors.noop",
        config_json=cfg_struct,
        **payload_over,
    )
    return ingest_pb2.SourceTemplate(
        meta=common_pb2.TemplateMeta(template_id="t1", name="Example feed"), payload=payload
    )


def _manage_req(op, template=None):
    return ingest_pb2.ManageTemplateRequest(operation=op, template=template or _template_msg())


def _instantiate(*, template=None, slug="", credentials_ref="", holders=()):
    """An InstantiateTemplateRequest plus the repo patches and the insert/stamp mocks."""
    template = template if template is not None else _template_row()
    ins = AsyncMock(
        side_effect=lambda _db, **kw: _source_row(
            kw["slug"], kw["user_id"], credentials_ref=kw["credentials_ref"]
        )
    )
    stamp = AsyncMock(
        side_effect=lambda _db, user_id, slug, tid, ver: {
            **_source_row(slug, user_id),
            "origin_template_id": tid,
            "origin_template_version": ver,
            "credentials_ref": credentials_ref or None,
        }
    )
    req = ingest_pb2.InstantiateTemplateRequest(
        template_id="t1", slug=slug, credentials_ref=credentials_ref
    )
    patches = (
        patch(f"{_ST}.get", AsyncMock(return_value=template)),
        patch(f"{_SS}.slug_holders", AsyncMock(return_value=list(holders))),
        patch(f"{_SS}.insert_source", ins),
        patch(f"{_ST}.stamp_origin", stamp),
    )
    return req, patches, ins, stamp


# ---------------------------------------------------------------------------
# ManageTemplate — AC-13 (source kind)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "op",
    [
        common_pb2.TEMPLATE_OPERATION_CREATE,
        common_pb2.TEMPLATE_OPERATION_UPDATE,
        common_pb2.TEMPLATE_OPERATION_RETIRE,
    ],
)
async def test_ac13_non_admin_manage_template_permission_denied(op):
    svc = make_servicer(db=MagicMock())
    ctx = _ctx("0", user_id="bob")
    writes = {name: AsyncMock() for name in ("create", "update", "retire")}
    with (
        patch(f"{_ST}.create", writes["create"]),
        patch(f"{_ST}.update", writes["update"]),
        patch(f"{_ST}.retire", writes["retire"]),
    ):
        code = await _aborted_code(svc.ManageTemplate(_manage_req(op), ctx), ctx)
    assert code == grpc.StatusCode.PERMISSION_DENIED
    for mock in writes.values():
        mock.assert_not_called()


@pytest.mark.asyncio
async def test_admin_create_stores_credential_free_payload_and_returns_meta():
    svc = make_servicer(db=MagicMock())
    create = AsyncMock(return_value=_template_row())
    # A payload claiming has_credentials must not survive into the stored template.
    req = _manage_req(
        common_pb2.TEMPLATE_OPERATION_CREATE,
        _template_msg(has_credentials=True, user_id="alice", active=True),
    )
    with patch(f"{_ST}.create", create):
        resp = await svc.ManageTemplate(req, _ctx("4", user_id="admin1"))
    kw = create.call_args.kwargs
    assert kw["template_id"] == "t1" and kw["created_by"] == "admin1"
    stored = kw["payload"]
    assert stored["source_type"] == "derived" and stored["slug"] == "example-feed"
    assert not {"has_credentials", "hasCredentials", "user_id", "userId"} & set(stored)
    assert resp.meta.kind == common_pb2.TEMPLATE_KIND_SIGNAL_SOURCE
    assert resp.meta.version == 1 and resp.meta.retired is False
    assert resp.payload.has_credentials is False


@pytest.mark.asyncio
async def test_admin_create_validates_payload_like_register():
    svc = make_servicer(db=MagicMock())
    ctx = _ctx("4", user_id="admin1")
    create = AsyncMock()
    req = _manage_req(common_pb2.TEMPLATE_OPERATION_CREATE, _template_msg("mcp_client"))
    with patch(f"{_ST}.create", create):
        code = await _aborted_code(svc.ManageTemplate(req, ctx), ctx)
    assert code == grpc.StatusCode.INVALID_ARGUMENT
    create.assert_not_called()


@pytest.mark.asyncio
async def test_admin_create_rejects_out_of_range_weight():
    svc = make_servicer(db=MagicMock())
    ctx = _ctx("4", user_id="admin1")
    req = _manage_req(common_pb2.TEMPLATE_OPERATION_CREATE, _template_msg(reliability_weight=1.5))
    with patch(f"{_ST}.create", AsyncMock()):
        code = await _aborted_code(svc.ManageTemplate(req, ctx), ctx)
    assert code == grpc.StatusCode.INVALID_ARGUMENT


@pytest.mark.asyncio
async def test_admin_create_duplicate_template_id_already_exists():
    svc = make_servicer(db=MagicMock())
    ctx = _ctx("4", user_id="admin1")
    dup = AsyncMock(side_effect=asyncpg.UniqueViolationError("dup"))
    with patch(f"{_ST}.create", dup):
        code = await _aborted_code(
            svc.ManageTemplate(_manage_req(common_pb2.TEMPLATE_OPERATION_CREATE), ctx), ctx
        )
    assert code == grpc.StatusCode.ALREADY_EXISTS


@pytest.mark.asyncio
async def test_admin_update_returns_bumped_version():
    svc = make_servicer(db=MagicMock())
    update = AsyncMock(return_value=_template_row(version=2))
    with patch(f"{_ST}.update", update):
        resp = await svc.ManageTemplate(
            _manage_req(common_pb2.TEMPLATE_OPERATION_UPDATE), _ctx("4", user_id="admin1")
        )
    assert update.call_args.args[1] == "t1"
    assert resp.meta.version == 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "op", [common_pb2.TEMPLATE_OPERATION_UPDATE, common_pb2.TEMPLATE_OPERATION_RETIRE]
)
async def test_admin_update_or_retire_missing_template_not_found(op):
    svc = make_servicer(db=MagicMock())
    ctx = _ctx("4", user_id="admin1")
    with (
        patch(f"{_ST}.update", AsyncMock(return_value=None)),
        patch(f"{_ST}.retire", AsyncMock(return_value=None)),
    ):
        code = await _aborted_code(svc.ManageTemplate(_manage_req(op), ctx), ctx)
    assert code == grpc.StatusCode.NOT_FOUND


@pytest.mark.asyncio
async def test_admin_retire_marks_retired_and_never_touches_instances():
    svc = make_servicer(db=MagicMock())
    retire = AsyncMock(return_value=_template_row(retired=True))
    ins = AsyncMock()
    with patch(f"{_ST}.retire", retire), patch(f"{_SS}.update_source", ins):
        resp = await svc.ManageTemplate(
            _manage_req(common_pb2.TEMPLATE_OPERATION_RETIRE), _ctx("4", user_id="admin1")
        )
    assert retire.call_args.args[1] == "t1"
    assert resp.meta.retired is True
    ins.assert_not_called()


@pytest.mark.asyncio
async def test_manage_template_unspecified_operation_invalid():
    svc = make_servicer(db=MagicMock())
    ctx = _ctx("4", user_id="admin1")
    code = await _aborted_code(
        svc.ManageTemplate(_manage_req(common_pb2.TEMPLATE_OPERATION_UNSPECIFIED), ctx), ctx
    )
    assert code == grpc.StatusCode.INVALID_ARGUMENT


# ---------------------------------------------------------------------------
# ListTemplates — any authenticated caller; no credential in any payload
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_non_admin_lists_active_templates_without_credentials():
    svc = make_servicer(db=MagicMock())
    rows = [_template_row("t1"), _template_row("t2", payload=_mcp_payload(), version=3)]
    with patch(f"{_ST}.list_active", AsyncMock(return_value=rows)):
        resp = await svc.ListTemplates(ingest_pb2.ListTemplatesRequest(), _ctx("0", user_id="bob"))
    assert [(t.meta.template_id, t.meta.version) for t in resp.templates] == [("t1", 1), ("t2", 3)]
    assert resp.templates[1].payload.config_json["mcp_tool"] == "signals"
    for t in resp.templates:
        assert t.payload.has_credentials is False
        assert "credential" not in str(t.payload).lower().replace("has_credentials", "")


@pytest.mark.asyncio
async def test_list_templates_system_without_grant_denied():
    svc = make_servicer(db=MagicMock())
    ctx = _ctx("0", user_id="system")
    code = await _aborted_code(svc.ListTemplates(ingest_pb2.ListTemplatesRequest(), ctx), ctx)
    assert code == grpc.StatusCode.PERMISSION_DENIED


# ---------------------------------------------------------------------------
# InstantiateTemplate — private snapshot under the REGISTER rules
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_instantiate_creates_caller_owned_source_with_origin():
    db, conn = transaction_conn()
    svc = make_servicer(db=db)
    req, patches, ins, stamp = _instantiate(template=_template_row(version=4))
    with patches[0], patches[1], patches[2], patches[3]:
        resp = await svc.InstantiateTemplate(req, _ctx("0", user_id="bob"))
    assert ins.call_args.kwargs["user_id"] == "bob"
    assert ins.call_args.kwargs["slug"] == "example-feed"  # falls back to the payload slug
    assert stamp.call_args.args[1:] == ("bob", "example-feed", "t1", 4)
    lock_sql, lock_arg = conn.execute.call_args.args
    assert "pg_advisory_xact_lock(hashtext($1))" in lock_sql and lock_arg == "example-feed"
    assert resp.user_id == "bob" and resp.slug == "example-feed"
    assert resp.origin.template_id == "t1" and resp.origin.template_version == 4
    assert resp.origin.latest_version == 4 and resp.origin.update_available is False


@pytest.mark.asyncio
async def test_instantiate_uses_request_slug():
    db, _ = transaction_conn()
    svc = make_servicer(db=db)
    req, patches, ins, _ = _instantiate(slug="my-copy")
    with patches[0], patches[1], patches[2], patches[3]:
        resp = await svc.InstantiateTemplate(req, _ctx("0", user_id="bob"))
    assert ins.call_args.kwargs["slug"] == "my-copy" and resp.slug == "my-copy"


@pytest.mark.asyncio
@pytest.mark.parametrize("holders", [["system"], ["bob"]])
async def test_instantiate_system_or_own_slug_already_exists(holders):
    db, _ = transaction_conn()
    svc = make_servicer(db=db)
    ctx = _ctx("0", user_id="bob")
    req, patches, ins, stamp = _instantiate(slug="fundamentals", holders=holders)
    with patches[0], patches[1], patches[2], patches[3]:
        code = await _aborted_code(svc.InstantiateTemplate(req, ctx), ctx)
    assert code == grpc.StatusCode.ALREADY_EXISTS
    ins.assert_not_called()
    stamp.assert_not_called()


@pytest.mark.asyncio
async def test_instantiate_mcp_client_without_credentials_ref_invalid():
    db, _ = transaction_conn()
    svc = make_servicer(db=db)
    ctx = _ctx("0", user_id="bob")
    req, patches, ins, _ = _instantiate(template=_template_row(payload=_mcp_payload()))
    with patches[0], patches[1], patches[2], patches[3]:
        code = await _aborted_code(svc.InstantiateTemplate(req, ctx), ctx)
    assert code == grpc.StatusCode.INVALID_ARGUMENT
    ins.assert_not_called()


@pytest.mark.asyncio
async def test_instantiate_mcp_client_with_own_credential_never_echoes_it():
    db, _ = transaction_conn()
    svc = make_servicer(db=db)
    req, patches, ins, _ = _instantiate(
        template=_template_row(payload=_mcp_payload()), credentials_ref=_BEARER
    )
    with patches[0], patches[1], patches[2], patches[3]:
        resp = await svc.InstantiateTemplate(req, _ctx("0", user_id="bob"))
    assert ins.call_args.kwargs["credentials_ref"] == _BEARER
    assert resp.has_credentials is True
    assert _BEARER not in resp.SerializeToString().decode("utf-8", "ignore")


@pytest.mark.asyncio
@pytest.mark.parametrize("template", [None, _template_row(retired=True)])
async def test_instantiate_missing_or_retired_template_not_found(template):
    db, _ = transaction_conn()
    svc = make_servicer(db=db)
    ctx = _ctx("0", user_id="bob")
    req = ingest_pb2.InstantiateTemplateRequest(template_id="t1")
    ins = AsyncMock()
    with patch(f"{_ST}.get", AsyncMock(return_value=template)), patch(f"{_SS}.insert_source", ins):
        code = await _aborted_code(svc.InstantiateTemplate(req, ctx), ctx)
    assert code == grpc.StatusCode.NOT_FOUND
    ins.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("user_id", "want"),
    [("", grpc.StatusCode.FAILED_PRECONDITION), ("system", grpc.StatusCode.PERMISSION_DENIED)],
)
async def test_instantiate_requires_a_user_owner(user_id, want):
    db, _ = transaction_conn()
    svc = make_servicer(db=db)
    ctx = _ctx("4", user_id=user_id)
    req = ingest_pb2.InstantiateTemplateRequest(template_id="t1")
    ins = AsyncMock()
    with (
        patch(f"{_ST}.get", AsyncMock(return_value=_template_row())),
        patch(f"{_SS}.insert_source", ins),
    ):
        code = await _aborted_code(svc.InstantiateTemplate(req, ctx), ctx)
    assert code == want
    ins.assert_not_called()


# ---------------------------------------------------------------------------
# ListSignalSources — origin + update_available via one batched lookup
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_signal_sources_reports_update_available_after_template_update():
    db = MagicMock()
    db.fetch = AsyncMock(
        return_value=[
            _source_row("a", "bob", origin_template_id="t1", origin_template_version=1),
            _source_row("b", "bob", origin_template_id="t2", origin_template_version=2),
            _source_row("c", "bob", origin_template_id="t-retired", origin_template_version=1),
            _source_row("d", "bob"),
        ]
    )
    svc = make_servicer(db=db)
    latest = AsyncMock(return_value={"t1": 2, "t2": 2})
    with patch(f"{_ST}.latest_versions", latest):
        resp = await svc.ListSignalSources(
            ingest_pb2.ListSignalSourcesRequest(), _ctx("0", user_id="bob")
        )
    latest.assert_awaited_once()
    assert sorted(latest.call_args.args[1]) == ["t-retired", "t1", "t2"]
    by_slug = {s.slug: s.origin for s in resp.sources}
    assert (by_slug["a"].latest_version, by_slug["a"].update_available) == (2, True)
    assert (by_slug["b"].latest_version, by_slug["b"].update_available) == (2, False)
    assert (by_slug["c"].latest_version, by_slug["c"].update_available) == (0, False)
    assert by_slug["d"].template_id == ""


@pytest.mark.asyncio
async def test_list_signal_sources_without_instances_skips_template_lookup():
    db = MagicMock()
    db.fetch = AsyncMock(return_value=[_source_row("d", "bob")])
    svc = make_servicer(db=db)
    latest = AsyncMock(return_value={})
    with patch(f"{_ST}.latest_versions", latest):
        await svc.ListSignalSources(ingest_pb2.ListSignalSourcesRequest(), _ctx("0", user_id="bob"))
    latest.assert_not_called()


# ---------------------------------------------------------------------------
# Repository SQL
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_repo_update_bumps_version_in_one_statement():
    db = MagicMock()
    db.fetchrow = AsyncMock(return_value=_template_row(version=2))
    row = await source_templates.update(db, "t1", "n", "d", {"slug": "s"})
    sql, *args = db.fetchrow.call_args.args
    assert sql.count("UPDATE") == 1
    assert "version = version + 1" in sql and "updated_at = NOW()" in sql
    assert "retired_at IS NULL" in sql
    assert args[0] == "t1" and json.loads(args[3]) == {"slug": "s"}
    assert row["version"] == 2


@pytest.mark.asyncio
async def test_repo_retire_and_list_active_hide_retired():
    db = MagicMock()
    db.fetchrow = AsyncMock(return_value=_template_row(retired=True))
    db.fetch = AsyncMock(return_value=[])
    await source_templates.retire(db, "t1")
    assert "retired_at = NOW()" in db.fetchrow.call_args.args[0]
    assert await source_templates.list_active(db) == []
    assert "retired_at IS NULL" in db.fetch.call_args.args[0]


@pytest.mark.asyncio
async def test_repo_latest_versions_is_one_batched_query_over_active_templates():
    db = MagicMock()
    db.fetch = AsyncMock(return_value=[{"template_id": "t1", "version": 3}])
    assert await source_templates.latest_versions(db, ["t1", "t2"]) == {"t1": 3}
    sql, ids = db.fetch.call_args.args
    assert "ANY($1" in sql and "retired_at IS NULL" in sql and ids == ["t1", "t2"]
    db.fetch.reset_mock()
    assert await source_templates.latest_versions(db, []) == {}
    db.fetch.assert_not_called()


@pytest.mark.asyncio
async def test_repo_stamp_origin_is_owner_scoped():
    db = MagicMock()
    db.fetchrow = AsyncMock(return_value=_source_row("s", "bob", origin_template_id="t1"))
    await source_templates.stamp_origin(db, "bob", "s", "t1", 4)
    sql, *args = db.fetchrow.call_args.args
    assert "origin_template_id" in sql and "origin_template_version" in sql
    assert "user_id = $1 AND slug = $2" in sql and args == ["bob", "s", "t1", 4]
