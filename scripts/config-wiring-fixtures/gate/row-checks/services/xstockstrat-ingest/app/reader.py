def read(cfg):
    cfg.get_int("ingest.meta.missing", 3)
    cfg.get_int("ingest.default.off", 5)
    return cfg.get_int("ingest.split.key", 5)


def other(cfg):
    return cfg.get_int("ingest.split.key", 7)
