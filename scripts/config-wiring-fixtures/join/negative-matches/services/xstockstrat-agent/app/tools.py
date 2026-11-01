_ALERT_THRESHOLD_CONFIG_KEY = "signal.alert_threshold"


def threshold(cfg):
    return cfg.get_float(_ALERT_THRESHOLD_CONFIG_KEY, 0.6)
