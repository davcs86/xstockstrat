def flags(cfg):
    return (
        cfg.get_bool("ingest.alpha.enabled", False),
        cfg.get_bool("ingest.beta.enabled", False),
        cfg.get_bool("ingest.gamma.enabled", False),
    )
