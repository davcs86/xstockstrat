class ConfigWatcher:
    def retry_on_failure(self):
        return self.get_bool("ingest.backfill.retry_on_failure", True)
