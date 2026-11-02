def is_enabled(cfg, name):
    return cfg.get_bool(f"analysis.{name}.enabled", default=False)
