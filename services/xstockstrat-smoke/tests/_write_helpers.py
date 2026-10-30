"""An in-memory, owner-scoped portfolio watchlist backend behind a fake gRPC channel factory, and a
runner wired with the live write policy over the real generated stubs."""

import itertools

from gen.config.v1 import config_pb2  # noqa: F401 — registers ConfigService in the default pool
from gen.portfolio.v1 import portfolio_pb2 as pb
from google.protobuf import descriptor_pool

from app import policy
from app.rpc import Rpc
from tests._helpers import make_runner

SVC = "xstockstrat.portfolio.v1.PortfolioService/"
CREATE, UPDATE, DELETE = SVC + "CreateWatchlist", SVC + "UpdateWatchlist", SVC + "DeleteWatchlist"
ADD, REMOVE = SVC + "AddWatchlistSymbols", SVC + "RemoveWatchlistSymbols"
LIST, GET = SVC + "ListWatchlists", SVC + "GetWatchlist"
SET_CONFIG = "xstockstrat.config.v1.ConfigService/SetConfig"
ENDPOINTS = {"portfolio": "portfolio:1", "config": "config:1"}


class FakePortfolio:
    """Channel factory; records every channel opened and every call's path and metadata."""

    def __init__(self):
        self.opened: list[tuple[str, str]] = []
        self.calls: list[tuple[str, dict]] = []
        self.lists: dict[str, pb.Watchlist] = {}
        self._ids = itertools.count(1)

    def seed(self, user_id: str, name: str) -> str:
        wid = f"wl-{next(self._ids)}"
        self.lists[wid] = pb.Watchlist(watchlist_id=wid, user_id=user_id, name=name)
        return wid

    def names(self, user_id: str) -> list[str]:
        return [w.name for w in self.lists.values() if w.user_id == user_id]

    def _owned(self, user, wid):
        w = self.lists.get(wid)
        if w is None or w.user_id != user:
            raise LookupError(f"NOT_FOUND {wid}")
        return w

    def _handle(self, method, req, user):
        if method == "CreateWatchlist":
            wid = self.seed(user, req.name)
            self.lists[wid].symbols.extend(req.symbols)
            return pb.CreateWatchlistResponse(watchlist=self.lists[wid])
        if method == "ListWatchlists":
            owned = [w for w in self.lists.values() if w.user_id == user]
            return pb.ListWatchlistsResponse(watchlists=owned)
        if method == "GetWatchlist":
            return pb.GetWatchlistResponse(watchlist=self._owned(user, req.watchlist_id))
        if method == "DeleteWatchlist":
            self._owned(user, req.watchlist_id)
            del self.lists[req.watchlist_id]
            return pb.DeleteWatchlistResponse()
        if method == "AddWatchlistSymbols":
            w = self._owned(user, req.watchlist_id)
            w.symbols.extend(req.symbols)
            return pb.AddWatchlistSymbolsResponse(watchlist=w)
        if method == "RemoveWatchlistSymbols":
            w = self._owned(user, req.watchlist_id)
            keep = [s for s in w.symbols if s not in set(req.symbols)]
            del w.symbols[:]
            w.symbols.extend(keep)
            return pb.RemoveWatchlistSymbolsResponse(watchlist=w)
        raise NotImplementedError(method)

    def __call__(self, endpoint, target):
        self.opened.append((endpoint, target))
        outer = self

        class Channel:
            def unary_unary(self, path, request_serializer, response_deserializer):
                async def invoke(request, *, timeout, metadata):
                    md = dict(metadata)
                    outer.calls.append((path, md))
                    req_bytes = request_serializer(request)
                    req = type(request).FromString(req_bytes)
                    resp = outer._handle(path.rsplit("/", 1)[1], req, md["x-user-id"])
                    return response_deserializer(resp.SerializeToString())

                return invoke

            async def close(self):
                pass

        return Channel()


def write_runner(checks, backend, *, enabled=True, env="do-dev", user_id="u-smoke-1"):
    """`enabled` may be a zero-arg callable read on every call (the live kill switch)."""
    flag = enabled if callable(enabled) else (lambda: enabled)
    decide = policy.live(descriptors=descriptor_pool.Default(), env=env, writes_enabled=flag)

    def make(trace_id):
        return Rpc(
            user_id=user_id,
            trace_id=trace_id,
            endpoints=ENDPOINTS,
            channel_factory=backend,
            policy=decide,
        )

    return make_runner(checks, rpc_factory=make)
