"""Pipeline job graph (feature 367): settings, engine primitives and the worker runtime."""

import logging

from app.config.watcher import int_positive

log = logging.getLogger(__name__)


class JobGraphSettings:
    """Reads the six `analysis.pipeline.*` keys fresh at each use (PLAT-6)."""

    def __init__(self, config_watcher):
        self._cfg = config_watcher
        self._warned: dict[str, int] = {}

    def _clamped(self, key: str, value: int, lo: int, hi: int) -> int:
        used = min(max(value, lo), hi)
        if used != value and self._warned.get(key) != value:
            self._warned[key] = value
            log.warning(
                "config value analysis.%s=%d outside [%d, %d]; using %d", key, value, lo, hi, used
            )
        return used

    def worker_enabled(self) -> bool:
        return self._cfg.get_bool("pipeline.worker_enabled", default=True)

    # Bounds mirror SCALAR_BOUNDS_REGISTRY: a migration-written row never passed SetConfig.
    def worker_concurrency(self) -> int:
        v = int_positive(self._cfg, "pipeline.worker_concurrency", 4)
        return self._clamped("pipeline.worker_concurrency", v, 1, 16)

    def poll_interval_ms(self) -> int:
        v = int_positive(self._cfg, "pipeline.poll_interval_ms", 1000)
        return self._clamped("pipeline.poll_interval_ms", v, 200, 5000)

    def lease_seconds(self) -> int:
        v = int_positive(self._cfg, "pipeline.lease_seconds", 60)
        return self._clamped("pipeline.lease_seconds", v, 45, 600)

    def max_attempts(self) -> int:
        v = int_positive(self._cfg, "pipeline.max_attempts", 5)
        return self._clamped("pipeline.max_attempts", v, 2, 20)

    def retention_days(self) -> int:
        v = int_positive(self._cfg, "pipeline.retention_days", 7)
        return self._clamped("pipeline.retention_days", v, 1, 90)

    def on_change(self, callback) -> None:
        self._cfg.on_change(callback)
