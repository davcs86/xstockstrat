def read(cfg):
    a = cfg.get_int("analysis.x.y", 1)
    b = cfg.get_float("analysis.x.z")
    return a, b
