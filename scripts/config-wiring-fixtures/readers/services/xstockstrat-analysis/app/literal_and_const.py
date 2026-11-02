FUNDSIGNAL_ENABLED_KEY = "analysis.fundsignal.enabled"


class FundsignalLoop:
    def __init__(self, cfg, md_config_watcher, snapshot):
        self._cfg = cfg
        self._md = md_config_watcher
        self._snapshot = snapshot

    def tick(self):
        enabled = self._cfg.get_bool(FUNDSIGNAL_ENABLED_KEY, default=False)
        limit = self._cfg.get_int(
            "analysis.backtest.max_duration_seconds", 300
        )
        provider = self._md.get_str("marketdata.fundamentals.provider", "")
        raw = self._snapshot.values["analysis.index_lit"]
        return enabled, limit, provider, raw
