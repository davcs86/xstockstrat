import logging

from opentelemetry import trace


async def isolated(coro):
    try:
        return (await coro), None
    # `except Exception` (not BaseException): CancelledError from a caller's deadline must
    # propagate.
    except Exception as e:
        return None, e


def log_isolation_tally(
    logger: logging.Logger, site: str, failures: list[tuple[str, Exception]], total: int
) -> None:
    if not failures:
        return
    emit = logger.error if len(failures) == total else logger.warning
    emit(
        "%s: %d/%d scanned symbols failed evaluation; sample=%s",
        site,
        len(failures),
        total,
        [f"{s}:{type(e).__name__}" for s, e in failures][:10],
        exc_info=failures[0][1],
    )
    span = trace.get_current_span()
    span.set_attribute(f"{site}.degraded_count", len(failures))
    span.record_exception(failures[0][1])
