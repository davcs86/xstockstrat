def should_retry(cfg):
    return cfg.get_bool("ingest.backfill.retry_on_failure", True)
