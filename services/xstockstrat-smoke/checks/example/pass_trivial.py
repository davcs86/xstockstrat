from app.check_api import check


@check("example.pass_trivial", feature="smoke-check-runtime", part="phase-1", timeout_s=5)
async def run(ctx):
    ctx.evidence("ok", True)
