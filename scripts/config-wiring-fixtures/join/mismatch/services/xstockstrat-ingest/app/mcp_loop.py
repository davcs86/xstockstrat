def load(cfg):
    timeout = cfg.get_int("ingest.mcp_client.request_timeout_seconds", 30)
    window = cfg.get_int("signals.window_hours", 24)
    return timeout, window
