from app.config.watcher import int_positive


def request_timeout_seconds(cfg_watcher) -> int:
    return int_positive(
        cfg_watcher,
        "ingest.mcp_client.request_timeout_seconds",
        30,
    )
