"""Janitors for phase-2 write checks: sweep the smoke user's own `smoke-` fixtures left by earlier
runs (a crash, a lost hold, a failed cleanup) before a check body runs."""

from gen.portfolio.v1 import portfolio_pb2 as pb

FIXTURE_PREFIX = "smoke-"
_PORTFOLIO = "xstockstrat.portfolio.v1.PortfolioService/"
_MAX_PAGES = 20


async def sweep_watchlists(ctx) -> None:
    leftovers, token = [], ""
    for _ in range(_MAX_PAGES):
        req = pb.ListWatchlistsRequest()
        if token:
            req.page.page_token = token
        resp = await ctx.rpc.call(_PORTFOLIO + "ListWatchlists", req)
        leftovers += [
            w.watchlist_id
            for w in resp.watchlists
            if w.name.startswith(FIXTURE_PREFIX) and not w.system_managed
        ]
        token = resp.page.next_page_token
        if not token:
            break
    for wid in leftovers:
        await ctx.rpc.call(
            _PORTFOLIO + "DeleteWatchlist", pb.DeleteWatchlistRequest(watchlist_id=wid)
        )
    ctx.evidence("janitor_swept", len(leftovers))
