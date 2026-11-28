"""The daily retention prune (feature 367, FR-7): the pipeline's only production job kind."""

import time

from app.engine.job_graph import Succeeded
from app.repositories.pipeline_jobs import prune_batch

# Fixed invariants (design.md § Build order), not config keys.
PRUNE_BLOCK_BUDGET_S = 30
PRUNE_SELF_STOP_S = 600
TERMINAL_KEEP_MIN_DAYS = 30

# Terminal states go first, so a succeeded backlog cannot starve them.
_TERMINAL_STATES = ("failed", "dead", "blocked")


def make_handler(settings, *, monotonic=time.monotonic):
    async def handler(job):
        started = monotonic()
        days = settings.retention_days()
        plan = [(s, max(TERMINAL_KEEP_MIN_DAYS, days)) for s in _TERMINAL_STATES]
        plan.append(("succeeded", days))
        for state, older_than_days in plan:
            cutoff, full = None, True
            while full:
                if monotonic() - started >= PRUNE_SELF_STOP_S:
                    return Succeeded()
                async with job.db(PRUNE_BLOCK_BUDGET_S) as conn:
                    _, _, cutoff, full = await prune_batch(
                        conn=conn, state=state, older_than_days=older_than_days, cutoff=cutoff
                    )
        return Succeeded()

    return handler
