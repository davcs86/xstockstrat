package config

func fillPollInterval(w *Watcher) int64 {
	return w.GetInt("trading.fill_poller.interval_ms", 5000)
}
