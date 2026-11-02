package config

const FactorMapKey = "marketdata.factor_map"

func load(w *Watcher, s secretClient) {
	_ = w.GetString(
		"marketdata.feed.symbols",
		"",
	)
	_ = w.GetString(FactorMapKey, "{}")
	_ = w.GetBool("marketdata.feed.enabled", true)
	// w.GetString("marketdata.commented_out", "") is a comment, not a read.
	_, _ = s.GetSecret("marketdata.alpaca.api_key")
}
