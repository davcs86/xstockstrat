"""Feature 355 — extraction_instructions on signal sources and source templates.

Drives the real ManageSignalSource / ManageTemplate handlers with the repository calls patched, so
each test observes the keywords the handler would persist.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest
from gen.common.v1 import common_pb2
from gen.ingest.v1 import ingest_pb2
from google.protobuf.struct_pb2 import Struct

from tests._helpers import transaction_conn
from tests.conftest import _ctx
from tests.test_ingest_servicer import make_servicer
from tests.test_signal_ownership import _SS, _aborted_code, _source_row
from tests.test_source_templates import _ST, _manage_req, _template_msg, _template_row

_NOOP = "app.extractors.noop"
_PROSE = "Each bolded ticker with a call sweep over $1M is a buy signal."
_EMAIL_CFG = {"sender_patterns": ["a@example.com"], "subject_patterns": ["*"]}
_SITE_CFG = {"url": "https://example.com/feed", "scrape_selector": "main"}
_INVALID = grpc.StatusCode.INVALID_ARGUMENT
_REGISTER = ingest_pb2.SIGNAL_SOURCE_OPERATION_REGISTER
_UPDATE = ingest_pb2.SIGNAL_SOURCE_OPERATION_UPDATE

# The @AC-2 example rows: (source_type, config_json, credentials_ref, instructions or None=omitted).
_AC2_ROWS = [
    ("mediated_simple_email", _EMAIL_CFG, "", ""),
    (
        "mediated_email_attachment",
        {**_EMAIL_CFG, "attachment_mime_types": ["application/pdf"]},
        "",
        "",
    ),
    ("mediated_linked_email", {**_EMAIL_CFG, "url_patterns": ["https://example.com/*"]}, "", ""),
    ("mediated_simple_website", _SITE_CFG, "", ""),
    ("mediated_authenticated_website", _SITE_CFG, "cred-ref-1", ""),
    ("mediated_simple_email", _EMAIL_CFG, "", "   "),
    ("mediated_simple_email", _EMAIL_CFG, "", None),
]


def _source(slug, source_type, cfg=None, **fields):
    struct = Struct()
    if cfg:
        struct.update(cfg)
    return ingest_pb2.SignalSource(
        slug=slug, display_name=slug, source_type=source_type, config_json=struct, **fields
    )


def _register_req(source, credentials_ref=""):
    return ingest_pb2.ManageSignalSourceRequest(
        source=source, credentials_ref=credentials_ref, operation_enum=_REGISTER
    )


def _update_req(source, *paths):
    req = ingest_pb2.ManageSignalSourceRequest(source=source, operation_enum=_UPDATE)
    if paths:  # touching update_mask sets its presence, which would make the request masked
        req.update_mask.paths.extend(paths)
    return req


def _stored(source_type="mediated_simple_email", **over):
    cfg = _SITE_CFG if "website" in source_type else _EMAIL_CFG
    return (
        _source_row(
            "whale_alerts", "bob", source_type=source_type, config_json=cfg, extractor_module=_NOOP
        )
        | {"extraction_instructions": "Each bolded ticker is a buy signal."}
        | over
    )


def _insert_mock():
    return AsyncMock(
        side_effect=lambda _db, **kw: _source_row(
            kw["slug"],
            kw["user_id"],
            source_type=kw["source_type"],
            extractor_module=kw["extractor_module"],
            credentials_ref=kw["credentials_ref"],
            extraction_instructions=kw["extraction_instructions"],
        )
    )


async def _register(source, *, credentials_ref="", holders=()):
    """Run a REGISTER; returns (response or None, ctx, insert mock)."""
    db, _conn = transaction_conn()
    svc = make_servicer(db=db)
    ctx = _ctx("0", user_id="bob")
    ins = _insert_mock()
    resp = None
    with (
        patch(f"{_SS}.slug_holders", AsyncMock(return_value=list(holders))),
        patch(f"{_SS}.insert_source", ins),
    ):
        try:
            resp = await svc.ManageSignalSource(_register_req(source, credentials_ref), ctx)
        except Exception as exc:  # the fake context raises on abort
            assert "aborted" in str(exc)
    return resp, ctx, ins


async def _update(stored, req):
    """Run an UPDATE against `stored`; returns (response or None, ctx, update mock)."""
    svc = make_servicer(db=MagicMock())
    ctx = _ctx("0", user_id="bob")
    upd = AsyncMock(side_effect=lambda _db, **kw: {**stored, **kw})
    resp = None
    with (
        patch(f"{_SS}.get_source", AsyncMock(return_value=stored)),
        patch(f"{_SS}.update_source", upd),
    ):
        try:
            resp = await svc.ManageSignalSource(req, ctx)
        except Exception as exc:
            assert "aborted" in str(exc)
    return resp, ctx, upd


def _rejected(ctx) -> str:
    code, message = ctx.abort.call_args[0][:2]
    assert code == _INVALID, (code, message)
    return message


# ---------------------------------------------------------------------------
# REGISTER
# ---------------------------------------------------------------------------


async def test_ac1_mediated_source_registers_with_prose_and_no_extractor_module():
    src = _source(
        "whale_alerts", "mediated_simple_email", _EMAIL_CFG, extraction_instructions=_PROSE
    )
    resp, _ctx_, ins = await _register(src)
    kw = ins.call_args.kwargs
    assert kw["extraction_instructions"] == _PROSE
    assert kw["extractor_module"] == _NOOP
    assert resp.source.extraction_instructions == _PROSE
    assert resp.source.extractor_module == _NOOP


@pytest.mark.parametrize(("source_type", "cfg", "cred", "instructions"), _AC2_ROWS)
async def test_ac2_mediated_source_with_empty_instructions_is_rejected(
    source_type, cfg, cred, instructions
):
    fields = {} if instructions is None else {"extraction_instructions": instructions}
    resp, ctx, ins = await _register(
        _source("no_prose", source_type, cfg, **fields), credentials_ref=cred
    )
    assert resp is None
    assert "extraction_instructions" in _rejected(ctx)
    ins.assert_not_called()


async def test_ac18_instructions_on_a_non_mediated_source_are_rejected():
    src = _source(
        "plain_mail",
        "simple_email",
        _EMAIL_CFG,
        extractor_module="app.extractors.example_simple_email",
        extraction_instructions="Each ticker is a buy.",
    )
    resp, ctx, ins = await _register(src)
    assert resp is None
    assert "extraction_instructions" in _rejected(ctx)
    ins.assert_not_called()


@pytest.mark.parametrize(("length", "accepted"), [(16_000, True), (16_001, False)])
async def test_ac19_the_instruction_length_cap_is_16000_characters(length, accepted):
    src = _source(
        "long_prose", "mediated_simple_email", _EMAIL_CFG, extraction_instructions="x" * length
    )
    resp, ctx, ins = await _register(src)
    if accepted:
        assert len(ins.call_args.kwargs["extraction_instructions"]) == length
        assert resp is not None
    else:
        assert "extraction_instructions" in _rejected(ctx)
        ins.assert_not_called()


async def test_ac26_whitespace_only_on_a_non_mediated_source_is_stored_as_empty():
    src = _source(
        "plain_mail",
        "simple_email",
        _EMAIL_CFG,
        extractor_module="app.extractors.example_simple_email",
        extraction_instructions="   ",
    )
    resp, _ctx_, ins = await _register(src)
    kw = ins.call_args.kwargs
    assert kw["extraction_instructions"] == ""
    assert kw["extractor_module"] == "app.extractors.example_simple_email"
    assert resp.source.extraction_instructions == ""


@pytest.mark.parametrize("holders", [["bob"], ["system"]])
async def test_register_conflict_wins_over_missing_instructions(holders):
    src = _source("taken", "mediated_simple_email", _EMAIL_CFG)
    _resp, ctx, ins = await _register(src, holders=holders)
    assert ctx.abort.call_args[0][0] == grpc.StatusCode.ALREADY_EXISTS
    ins.assert_not_called()


# ---------------------------------------------------------------------------
# UPDATE
# ---------------------------------------------------------------------------


async def test_ac3_partial_update_preserves_instructions_that_are_not_supplied():
    stored = _stored()
    src = ingest_pb2.SignalSource(slug="whale_alerts", reliability_weight=0.5)
    resp, _ctx_, upd = await _update(stored, _update_req(src, "reliability_weight"))
    kw = upd.call_args.kwargs
    assert kw["reliability_weight"] == 0.5
    assert kw["extraction_instructions"] == "Each bolded ticker is a buy signal."
    assert resp.source.extraction_instructions == "Each bolded ticker is a buy signal."


async def test_ac4_partial_update_replaces_instructions_that_are_supplied():
    new = "Only tickers under the heading 'New positions' are buy signals."
    src = ingest_pb2.SignalSource(slug="whale_alerts", extraction_instructions=new)
    resp, _ctx_, upd = await _update(_stored(), _update_req(src, "extraction_instructions"))
    assert upd.call_args.kwargs["extraction_instructions"] == new
    assert resp.source.extraction_instructions == new


async def test_ac5_a_mediated_source_that_predates_the_field_keeps_working():
    stored = _stored(extraction_instructions="")
    src = ingest_pb2.SignalSource(slug="whale_alerts", display_name="Snacks")
    resp, _ctx_, upd = await _update(stored, _update_req(src, "display_name"))
    kw = upd.call_args.kwargs
    assert kw["display_name"] == "Snacks" and kw["extraction_instructions"] == ""
    assert resp.source.display_name == "Snacks"


async def test_a_stored_row_without_the_column_key_reads_as_empty():
    stored = _stored()
    del stored["extraction_instructions"]
    src = ingest_pb2.SignalSource(slug="whale_alerts", display_name="Snacks")
    _resp, _ctx_, upd = await _update(stored, _update_req(src, "display_name"))
    assert upd.call_args.kwargs["extraction_instructions"] == ""


@pytest.mark.parametrize("value", ["", "   "])
async def test_ac17_ac23_clearing_instructions_on_a_mediated_source_is_rejected(value):
    for stored in (_stored(), _stored(extraction_instructions="")):
        src = ingest_pb2.SignalSource(slug="whale_alerts", extraction_instructions=value)
        resp, ctx, upd = await _update(stored, _update_req(src, "extraction_instructions"))
        assert resp is None
        assert "extraction_instructions" in _rejected(ctx)
        upd.assert_not_called()


@pytest.mark.parametrize("stored_module", [_NOOP, ""])
async def test_ac20_a_supplied_extractor_module_is_overridden_on_a_mediated_source(
    stored_module,
):
    stored = _stored(extractor_module=stored_module)
    src = ingest_pb2.SignalSource(
        slug="whale_alerts", extractor_module="app.extractors.example_simple_email"
    )
    resp, _ctx_, upd = await _update(stored, _update_req(src, "extractor_module"))
    assert upd.call_args.kwargs["extractor_module"] == _NOOP
    assert resp.source.extractor_module == _NOOP


async def test_a_legacy_empty_extractor_module_becomes_noop_on_any_update():
    stored = _stored(extractor_module="")
    src = ingest_pb2.SignalSource(slug="whale_alerts", display_name="Snacks")
    _resp, _ctx_, upd = await _update(stored, _update_req(src, "display_name"))
    assert upd.call_args.kwargs["extractor_module"] == _NOOP


async def test_ac21_adding_instructions_to_a_non_mediated_source_is_rejected():
    stored = _stored("simple_email", extraction_instructions="")
    src = ingest_pb2.SignalSource(slug="whale_alerts", extraction_instructions="Each is a buy.")
    resp, ctx, upd = await _update(stored, _update_req(src, "extraction_instructions"))
    assert resp is None
    assert "extraction_instructions" in _rejected(ctx)
    upd.assert_not_called()


async def test_ac22_the_length_cap_applies_on_update():
    src = ingest_pb2.SignalSource(slug="whale_alerts", extraction_instructions="x" * 16_001)
    resp, ctx, upd = await _update(_stored(), _update_req(src, "extraction_instructions"))
    assert resp is None
    assert "extraction_instructions" in _rejected(ctx)
    upd.assert_not_called()


async def test_maskless_update_of_a_mediated_source_must_carry_instructions():
    stored = _stored()
    src = _source("whale_alerts", "mediated_simple_email", _EMAIL_CFG)
    resp, ctx, upd = await _update(stored, _update_req(src))
    assert resp is None
    assert "extraction_instructions" in _rejected(ctx)
    upd.assert_not_called()


async def test_maskless_update_with_instructions_replaces_them():
    src = _source(
        "whale_alerts", "mediated_simple_email", _EMAIL_CFG, extraction_instructions=_PROSE
    )
    _resp, _ctx_, upd = await _update(_stored(), _update_req(src))
    assert upd.call_args.kwargs["extraction_instructions"] == _PROSE


async def test_changing_to_a_mediated_type_requires_instructions():
    stored = _stored("simple_email", extraction_instructions="")
    src = ingest_pb2.SignalSource(slug="whale_alerts", source_type="mediated_simple_email")
    resp, ctx, upd = await _update(stored, _update_req(src, "source_type"))
    assert resp is None
    assert "extraction_instructions" in _rejected(ctx)
    upd.assert_not_called()


async def test_changing_to_a_mediated_type_with_instructions_succeeds():
    stored = _stored("simple_email", extraction_instructions="")
    src = ingest_pb2.SignalSource(
        slug="whale_alerts", source_type="mediated_simple_email", extraction_instructions=_PROSE
    )
    _resp, _ctx_, upd = await _update(
        stored, _update_req(src, "source_type", "extraction_instructions")
    )
    kw = upd.call_args.kwargs
    assert kw["extraction_instructions"] == _PROSE and kw["extractor_module"] == _NOOP


async def test_changing_a_mediated_type_away_without_clearing_is_rejected():
    src = ingest_pb2.SignalSource(slug="whale_alerts", source_type="simple_email")
    resp, ctx, upd = await _update(_stored(), _update_req(src, "source_type"))
    assert resp is None
    assert "extraction_instructions" in _rejected(ctx)
    upd.assert_not_called()


async def test_changing_a_mediated_type_away_with_a_masked_clear_succeeds():
    src = ingest_pb2.SignalSource(slug="whale_alerts", source_type="simple_email")
    _resp, _ctx_, upd = await _update(
        _stored(), _update_req(src, "source_type", "extraction_instructions")
    )
    assert upd.call_args.kwargs["extraction_instructions"] == ""


async def test_update_of_a_missing_source_is_not_found_before_validation():
    svc = make_servicer(db=MagicMock())
    ctx = _ctx("0", user_id="bob")
    src = ingest_pb2.SignalSource(slug="ghost", extraction_instructions="")
    with (
        patch(f"{_SS}.get_source", AsyncMock(return_value=None)),
        patch(f"{_SS}.slug_holders", AsyncMock(return_value=[])),
    ):
        code = await _aborted_code(
            svc.ManageSignalSource(_update_req(src, "extraction_instructions"), ctx), ctx
        )
    assert code == grpc.StatusCode.NOT_FOUND


@pytest.mark.parametrize(
    ("operation", "repo_fn"),
    [
        (ingest_pb2.SIGNAL_SOURCE_OPERATION_REACTIVATE, "reactivate_source"),
        (ingest_pb2.SIGNAL_SOURCE_OPERATION_DEACTIVATE, "deactivate_source"),
    ],
)
async def test_lifecycle_verbs_work_on_a_legacy_row_and_return_its_instructions(operation, repo_fn):
    svc = make_servicer(db=MagicMock())
    req = ingest_pb2.ManageSignalSourceRequest(
        source=ingest_pb2.SignalSource(slug="whale_alerts"), operation_enum=operation
    )
    for row in (_stored(extraction_instructions=""), _stored()):
        with patch(f"{_SS}.{repo_fn}", AsyncMock(return_value=row)):
            resp = await svc.ManageSignalSource(req, _ctx("0", user_id="bob"))
        assert resp.source.extraction_instructions == row["extraction_instructions"]


# ---------------------------------------------------------------------------
# ManageTemplate
# ---------------------------------------------------------------------------

_CREATE = common_pb2.TEMPLATE_OPERATION_CREATE
_AC25_ROWS = [
    ("mediated_simple_email", ""),
    ("simple_email", "Each ticker is a buy."),
    ("mediated_simple_email", "x" * 16_001),
]


@pytest.mark.parametrize(("source_type", "instructions"), _AC25_ROWS)
async def test_ac25_a_template_payload_obeys_the_instruction_rules(source_type, instructions):
    svc = make_servicer(db=MagicMock())
    ctx = _ctx("4", user_id="admin1")
    template = _template_msg(source_type, _EMAIL_CFG, extraction_instructions=instructions)
    create = AsyncMock()
    with patch(f"{_ST}.create", create):
        code = await _aborted_code(svc.ManageTemplate(_manage_req(_CREATE, template), ctx), ctx)
    assert code == _INVALID
    assert "extraction_instructions" in ctx.abort.call_args[0][1]
    create.assert_not_called()


async def test_template_create_stores_mediated_instructions_in_the_payload():
    svc = make_servicer(db=MagicMock())
    template = _template_msg("mediated_simple_email", _EMAIL_CFG, extraction_instructions=_PROSE)
    create = AsyncMock(
        side_effect=lambda _db, **kw: _template_row(kw["template_id"], payload=kw["payload"])
    )
    with patch(f"{_ST}.create", create):
        resp = await svc.ManageTemplate(_manage_req(_CREATE, template), _ctx("4", user_id="admin1"))
    assert create.call_args.kwargs["payload"]["extraction_instructions"] == _PROSE
    assert resp.payload.extraction_instructions == _PROSE


async def test_template_create_drops_whitespace_only_instructions_on_a_non_mediated_payload():
    svc = make_servicer(db=MagicMock())
    template = _template_msg("simple_email", _EMAIL_CFG, extraction_instructions="   ")
    create = AsyncMock(
        side_effect=lambda _db, **kw: _template_row(kw["template_id"], payload=kw["payload"])
    )
    with patch(f"{_ST}.create", create):
        await svc.ManageTemplate(_manage_req(_CREATE, template), _ctx("4", user_id="admin1"))
    assert "extraction_instructions" not in create.call_args.kwargs["payload"]


async def test_retiring_a_mediated_template_without_prose_is_not_validated():
    svc = make_servicer(db=MagicMock())
    row = _template_row(
        payload={
            "slug": "old",
            "display_name": "Old",
            "source_type": "mediated_simple_email",
            "config_json": _EMAIL_CFG,
        },
        retired=True,
    )
    with (
        patch(f"{_ST}.get", AsyncMock(return_value=row)),
        patch(f"{_ST}.retire", AsyncMock(return_value=row)),
    ):
        resp = await svc.ManageTemplate(
            _manage_req(common_pb2.TEMPLATE_OPERATION_RETIRE), _ctx("4", user_id="admin1")
        )
    assert resp.meta.retired


async def test_updating_a_system_template_stays_permission_denied():
    svc = make_servicer(db=MagicMock())
    ctx = _ctx("4", user_id="admin1")
    row = {**_template_row("tpl-prnewswire_releases"), "created_by": "system"}
    template = _template_msg("mediated_simple_website", _SITE_CFG)
    template.meta.template_id = "tpl-prnewswire_releases"
    with patch(f"{_ST}.get", AsyncMock(return_value=row)):
        code = await _aborted_code(
            svc.ManageTemplate(_manage_req(common_pb2.TEMPLATE_OPERATION_UPDATE, template), ctx),
            ctx,
        )
    assert code == grpc.StatusCode.PERMISSION_DENIED
