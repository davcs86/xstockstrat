"""ComputePool — the analysis pure-CPU thread pool, bounded by a live limit (feature 295, FR-7)."""

from concurrent.futures import ThreadPoolExecutor

from app.config.live_limits import ResizableLimiter, run_bounded


class ComputePool:
    """``threads`` is the fixed thread ceiling; ``limit_fn`` (live config) bounds how many run.

    A limit above ``threads`` queues the excess in the executor, so ``threads`` caps real
    parallelism. A slot is held until its thread finishes, even if the awaiting caller timed out.
    """

    def __init__(self, limit_fn, threads: int = 16):
        self._limiter = ResizableLimiter(limit_fn)
        self._executor = ThreadPoolExecutor(
            max_workers=threads, thread_name_prefix="analysis-compute"
        )

    @property
    def limit(self) -> int:
        return self._limiter.limit

    @property
    def in_use(self) -> int:
        return self._limiter.in_use

    def wake(self, *_args) -> None:
        self._limiter.wake()

    async def run(self, fn):
        return await run_bounded(self._limiter, self._executor, fn)

    def shutdown(self, wait: bool = True) -> None:
        self._executor.shutdown(wait=wait)
