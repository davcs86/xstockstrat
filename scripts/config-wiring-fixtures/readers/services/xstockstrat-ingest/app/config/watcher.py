class ConfigWatcher:
    def __init__(self):
        self._snapshot = {}

    def get_int(self, key: str, default: int = 0) -> int:
        v = self._snapshot.get(key)
        return default if v is None else int(v)

    get_int_present = get_int

    def backfill_max_concurrent_jobs(self) -> int:
        return int_positive(self, "ingest.backfill.max_concurrent_jobs", 3)

    def backfill_max_retry_attempts(self) -> int:
        return self.get_int_present("ingest.backfill.max_retry_attempts", default=3)


def int_positive(cfg, key: str, default: int) -> int:
    v = cfg.get_int(key, default)
    return v if v > 0 else default
