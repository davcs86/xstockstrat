"""Read policy and the RPC client over descriptors synthesized with AddSerializedFile."""

import functools

import pytest
from google.protobuf import descriptor_pb2, descriptor_pool, message_factory

from app import policy
from app.catalog import from_function
from app.check_api import check
from app.rpc import MutatingRpcRefused, Rpc
from tests._helpers import make_runner, wait_done

NSE = descriptor_pb2.MethodOptions.NO_SIDE_EFFECTS
QUERY = "xstockstrat.ledger.v1.LedgerService/QueryEvents"
APPEND = "xstockstrat.ledger.v1.LedgerService/AppendEvent"
GET_CONFIG = "xstockstrat.config.v1.ConfigService/GetConfig"
GET_SECRET = "xstockstrat.config.v1.ConfigService/GetSecret"
FUNDAMENTALS = "xstockstrat.marketdata.v1.MarketDataService/GetFundamentals"
PORTFOLIO = "xstockstrat.portfolio.v1.PortfolioService/GetPortfolio"


def _file(svc: str, service: str, methods: dict[str, bool]) -> bytes:
    f = descriptor_pb2.FileDescriptorProto(
        name=f"synth/{svc}.proto", package=f"xstockstrat.{svc}.v1", syntax="proto3"
    )
    f.message_type.add(name="Req").field.add(
        name="q", number=1, type=descriptor_pb2.FieldDescriptorProto.TYPE_STRING
    )
    f.message_type.add(name="Resp")
    s = f.service.add(name=service)
    for name, annotated in methods.items():
        m = s.method.add(
            name=name,
            input_type=f".xstockstrat.{svc}.v1.Req",
            output_type=f".xstockstrat.{svc}.v1.Resp",
        )
        if annotated:
            m.options.idempotency_level = NSE
    return f.SerializeToString()


POOL = descriptor_pool.DescriptorPool()
for _svc, _service, _methods in (
    ("ledger", "LedgerService", {"QueryEvents": True, "AppendEvent": False}),
    ("config", "ConfigService", {"GetConfig": True, "GetSecret": True}),
    ("marketdata", "MarketDataService", {"GetFundamentals": False}),
    ("portfolio", "PortfolioService", {"GetPortfolio": False}),
):
    POOL.AddSerializedFile(_file(_svc, _service, _methods))


def req(svc: str):
    return message_factory.GetMessageClass(POOL.FindMessageTypeByName(f"xstockstrat.{svc}.v1.Req"))(
        q="x"
    )


class FakeChannels:
    def __init__(self):
        self.opened: list[tuple[str, str]] = []
        self.calls: list[tuple[str, dict]] = []
        self.closed = 0

    def __call__(self, endpoint, target):
        self.opened.append((endpoint, target))
        outer = self

        class Channel:
            def unary_unary(self, path, request_serializer, response_deserializer):
                async def invoke(request, *, timeout, metadata):
                    request_serializer(request)
                    outer.calls.append((path, dict(metadata)))
                    return response_deserializer(b"")

                return invoke

            async def close(self):
                outer.closed += 1

        return Channel()


ENDPOINTS = {s: f"{s}:1" for s in ("ledger", "config", "marketdata", "portfolio")}


def factory(channels, *, user_id="u-smoke-1", benign=None):
    decide = functools.partial(policy.decide, descriptors=POOL, benign=benign or {})

    def make(trace_id):
        return Rpc(
            user_id=user_id,
            trace_id=trace_id,
            endpoints=ENDPOINTS,
            channel_factory=channels,
            policy=decide,
        )

    return make


def rpc_check(cid, *methods):
    @check(cid, feature="f", part="p")
    async def run(ctx):
        for m in methods:
            await ctx.rpc.call(m, req(m.split(".")[1]))

    return from_function(run)


class FakeDb:
    async def fetchval(self, query, *args):
        return 1


@check("db.only", feature="f", part="p")
async def db_only(ctx):
    ctx.evidence("one", await ctx.db.fetchval("SELECT 1"))


async def _run(channels, checks, ids, **kw):
    runner = make_runner(checks, db=FakeDb(), rpc_factory=factory(channels, **kw))
    run_id = await runner.start(ids, triggered_by="xstockstrat-agent")
    return run_id, (await wait_done(runner, run_id))["records"]


async def test_annotated_read_allowed_and_audited_with_headers():
    ch = FakeChannels()
    run_id, (rec,) = await _run(ch, [rpc_check("r.q", QUERY)], ["r.q"])
    assert rec["outcome"] == "PASS"
    assert rec["rpcs_invoked"] == [QUERY]
    ((path, md),) = ch.calls
    assert path == f"/{QUERY}"
    assert md["x-user-id"] == "u-smoke-1"
    assert md["x-trace-id"] == run_id
    assert int(md["x-access-scope"]) & 0x04 == 0
    assert ch.opened == [("ledger:1", "xstockstrat-ledger")]
    assert ch.closed == 1


async def test_mutating_and_unannotated_refused_before_channel():
    ch = FakeChannels()
    _, recs = await _run(
        ch, [rpc_check("r.a", APPEND), rpc_check("r.f", FUNDAMENTALS)], ["r.a", "r.f"]
    )
    assert [r["outcome"] for r in recs] == ["ERROR", "ERROR"]
    assert all("MutatingRpcRefused" in r["evidence"]["error"] for r in recs)
    assert all(r["rpcs_invoked"] == [] for r in recs)
    assert ch.opened == [] and ch.calls == []


async def test_rpcs_invoked_in_call_order():
    ch = FakeChannels()
    _, (rec,) = await _run(ch, [rpc_check("r.two", QUERY, GET_CONFIG)], ["r.two"])
    assert rec["outcome"] == "PASS"
    assert rec["rpcs_invoked"] == [QUERY, GET_CONFIG]


async def test_missing_user_id_errors_rpc_checks_not_db_checks():
    ch = FakeChannels()
    _, recs = await _run(
        ch, [from_function(db_only), rpc_check("r.q", QUERY)], ["db.only", "r.q"], user_id=""
    )
    assert [r["outcome"] for r in recs] == ["PASS", "ERROR"]
    assert "smoke.rpc.user_id unset" in recs[1]["evidence"]["error"]
    assert ch.opened == []


async def test_benign_entry_refused_when_smoke_user_owns_broker_account():
    async def no_broker_account(rpc):
        return "smoke user owns broker account acct-7"

    benign = {
        PORTFOLIO: policy.BenignRead(side_effect="refreshes cached quotes", guard=no_broker_account)
    }
    ch = FakeChannels()
    _, (rec,) = await _run(ch, [rpc_check("r.p", PORTFOLIO)], ["r.p"], benign=benign)
    assert rec["outcome"] == "ERROR"
    assert "BenignReadRefused" in rec["evidence"]["error"]
    assert ch.opened == []


async def test_benign_entry_allowed_when_guard_passes():
    async def ok(rpc):
        return None

    benign = {PORTFOLIO: policy.BenignRead(side_effect="refreshes cached quotes", guard=ok)}
    ch = FakeChannels()
    _, (rec,) = await _run(ch, [rpc_check("r.p", PORTFOLIO)], ["r.p"], benign=benign)
    assert rec["outcome"] == "PASS"
    assert rec["rpcs_invoked"] == [PORTFOLIO]


def test_production_benign_reads_is_empty():
    assert policy.BENIGN_READS == {}


@pytest.mark.parametrize(
    "method,reason",
    [
        (GET_SECRET, "denied"),
        (APPEND, "NO_SIDE_EFFECTS"),
        ("xstockstrat.ledger.v1.LedgerService/Nope", "unknown"),
        ("garbage", "unknown"),
    ],
)
def test_decide_refusals(method, reason):
    d = policy.decide(method, descriptors=POOL, benign={GET_SECRET: policy.BenignRead("x", None)})
    assert not d.allowed
    assert reason in d.reason


def test_decide_allows_annotated():
    d = policy.decide(QUERY, descriptors=POOL)
    assert d.allowed and d.guard is None


async def test_missing_endpoint_is_an_error_without_channel():
    ch = FakeChannels()
    rpc = Rpc(
        user_id="u",
        trace_id="t",
        endpoints={},
        channel_factory=ch,
        policy=functools.partial(policy.decide, descriptors=POOL),
    )
    with pytest.raises(RuntimeError, match="LEDGER_ENDPOINT"):
        await rpc.call(QUERY, req("ledger"))
    assert ch.opened == []


async def test_get_secret_refused_by_rpc():
    rpc = Rpc(
        user_id="u",
        trace_id="t",
        endpoints=ENDPOINTS,
        channel_factory=FakeChannels(),
        policy=functools.partial(policy.decide, descriptors=POOL),
    )
    with pytest.raises(MutatingRpcRefused):
        await rpc.call(GET_SECRET, req("config"))
