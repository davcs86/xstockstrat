"""Feature 225 (FR-1) — each owner-scoped IngestService RPC is identity-gated first: headerless
→ UNAUTHENTICATED; `system` without a SAN-bound grant for that RPC → PERMISSION_DENIED."""

from unittest.mock import AsyncMock, MagicMock, patch

import grpc
import pytest
from gen.ingest.v1 import ingest_pb2

from app.handlers.servicer import IngestServicer
from tests._helpers import transaction_conn
from tests.conftest import _ctx
from tests.test_ingest_servicer import make_servicer

EXEMPT = {
    "TriggerBackfill",
    "CancelBackfill",
    "GetBackfillStatus",
    "ListBackfillJobs",
    "NormalizeRawData",
}
_SERVICE = ingest_pb2.DESCRIPTOR.services_by_name["IngestService"]
_METHODS = _SERVICE.methods
_GATED = sorted(m.name for m in _METHODS if m.name not in EXEMPT)
_ANALYSIS_SAN = ("xstockstrat-analysis",)


def test_descriptor_walk_gated_set_equals_non_exempt():
    undecorated = {
        m.name
        for m in _METHODS
        if not getattr(getattr(IngestServicer, m.name), "__owner_scoped__", False)
    }
    assert undecorated == EXEMPT


def _non_raising(**kw):
    ctx = _ctx("0", **kw)
    ctx.abort = AsyncMock()
    return ctx


def _request(method):
    return getattr(ingest_pb2, _SERVICE.methods_by_name[method].input_type.name)()


async def _assert_rejected_before_body(method, ctx, code):
    # A bare instance with only `_db`: any other attribute the body touches raises.
    svc = IngestServicer.__new__(IngestServicer)
    svc._db = MagicMock()
    assert await getattr(svc, method)(_request(method), ctx) is None
    ctx.abort.assert_awaited_once()
    assert ctx.abort.await_args.args[0] == code
    assert svc._db.mock_calls == []


@pytest.mark.parametrize("method", _GATED)
@pytest.mark.parametrize(
    "kw,code",
    [
        ({"user_id": ""}, grpc.StatusCode.UNAUTHENTICATED),
        ({"user_id": "system"}, grpc.StatusCode.PERMISSION_DENIED),
        (
            {"user_id": "system", "internal_caller": "analysis-fundsignal"},
            grpc.StatusCode.PERMISSION_DENIED,
        ),
    ],
    ids=["headerless", "system", "system-grant-without-san"],
)
async def test_gate_rejects_before_body(method, kw, code):
    await _assert_rejected_before_body(method, _non_raising(**kw), code)


async def test_granted_system_with_san_passes_gate_on_ingest_signal():
    db, conn = transaction_conn(
        db_fetchrow_side_effect=[{"slug": "fundamentals"}],
        conn_fetchrow_side_effect=[{"id": 5}, {"signal_id": 5}],
        slug_holders=("system",),
    )
    svc = make_servicer(db=db)
    ctx = _non_raising(
        user_id="system", internal_caller="analysis-fundsignal", peer_sans=_ANALYSIS_SAN
    )
    signal = ingest_pb2.ExternalSignal(source="fundamentals", symbol="NVDA", direction="buy")
    resp = await svc.IngestSignal(ingest_pb2.IngestSignalRequest(signal=signal), ctx)
    ctx.abort.assert_not_awaited()
    assert resp.signal_id == 5


async def test_read_grant_does_not_cover_ingest_signal():
    ctx = _non_raising(
        user_id="system", internal_caller="analysis-system-read", peer_sans=_ANALYSIS_SAN
    )
    await _assert_rejected_before_body("IngestSignal", ctx, grpc.StatusCode.PERMISSION_DENIED)


async def test_body_owner_resolves_under_its_own_rpc_grant_key():
    rpcs = []

    def _record(context, rpc):
        rpcs.append(rpc)
        return "bob"

    db = MagicMock()
    db.fetch = AsyncMock(return_value=[])
    svc = make_servicer(db=db)
    with patch.object(IngestServicer, "_resolve_owner", side_effect=_record):
        await svc.QuerySignals(ingest_pb2.QuerySignalsRequest(), _ctx("0", user_id="bob"))
    assert rpcs == ["QuerySignals", "QuerySignals"]
